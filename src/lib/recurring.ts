import type { MerchantRule, Transaction } from '../types';
import { addDays, addMonths, daysBetween } from './dates';
import { median, round2 } from './money';
import { prettyMerchant } from './merchant';

export type Cadence = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'semiannual' | 'yearly';

const CADENCES: { name: Cadence; days: number; tol: number; minCount: number }[] = [
  { name: 'weekly', days: 7, tol: 2, minCount: 3 },
  { name: 'biweekly', days: 14, tol: 3, minCount: 3 },
  { name: 'monthly', days: 30.44, tol: 5, minCount: 2 },
  { name: 'quarterly', days: 91.3, tol: 12, minCount: 2 },
  { name: 'semiannual', days: 182.6, tol: 15, minCount: 2 },
  { name: 'yearly', days: 365.25, tol: 20, minCount: 2 },
];

export interface RecurringItem {
  id: string;
  merchant: string;
  label: string;
  accountId: number;
  kind: 'bill' | 'income';
  category: string;
  cadence: Cadence;
  /** typical amount, signed */
  amount: number;
  lastAmount: number;
  lastDate: string;
  firstDate: string;
  /** next expected date on or after `today` */
  nextDate: string;
  occurrences: number;
  variable: boolean;
  priceChange?: { from: number; to: number };
  /** Normalised to a monthly figure (signed). */
  monthly: number;
  status: 'active' | 'maybe-stopped';
  confirmed: boolean;
  wantToCancel: boolean;
}

function step(date: string, c: Cadence): string {
  switch (c) {
    case 'weekly': return addDays(date, 7);
    case 'biweekly': return addDays(date, 14);
    case 'monthly': return addMonths(date, 1);
    case 'quarterly': return addMonths(date, 3);
    case 'semiannual': return addMonths(date, 6);
    case 'yearly': return addMonths(date, 12);
  }
}

const EXCLUDE = new Set(['Transfer', 'Cash']);

export function detectRecurring(transactions: Transaction[], rules: MerchantRule[], today: string): RecurringItem[] {
  const ruleMap = new Map(rules.map((r) => [r.merchant, r]));
  const dataThrough = new Map<number, string>();
  for (const t of transactions) if ((dataThrough.get(t.accountId) ?? '') < t.date) dataThrough.set(t.accountId, t.date);

  const groups = new Map<string, Transaction[]>();
  for (const t of transactions) {
    const rule = ruleMap.get(t.merchant);
    if (rule?.recurring === 'ignored') continue;
    if (EXCLUDE.has(t.category) && rule?.recurring !== 'confirmed') continue;
    const key = `${t.accountId}|${t.merchant}|${t.amount < 0 ? 'out' : 'in'}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(t);
  }

  const items: RecurringItem[] = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.date.localeCompare(b.date));
    // Merge same-day duplicates (e.g. split payments) into one occurrence.
    const occ: { date: string; amount: number }[] = [];
    for (const t of list) {
      const last = occ[occ.length - 1];
      if (last && last.date === t.date) last.amount = round2(last.amount + t.amount);
      else occ.push({ date: t.date, amount: t.amount });
    }
    if (occ.length < 2) continue;
    const intervals = occ.slice(1).map((o, i) => daysBetween(occ[i].date, o.date));
    const med = median(intervals);
    const cad = CADENCES.find((c) => Math.abs(med - c.days) <= c.tol);
    if (!cad) continue;
    const consistent = intervals.filter((d) => Math.abs(d - cad.days) <= cad.tol * 1.5).length / intervals.length;
    if (consistent < 0.7) continue;

    const amounts = occ.map((o) => Math.abs(o.amount));
    const medAmt = median(amounts);
    const spread = Math.max(...amounts) - Math.min(...amounts);
    const variable = medAmt > 0 && spread / medAmt > 0.1;
    const rule = ruleMap.get(list[0].merchant);
    const confirmed = rule?.recurring === 'confirmed';
    // Two monthly hits with very different amounts is weak evidence (e.g. two random Amazon orders).
    if (!confirmed) {
      if (occ.length < cad.minCount) continue;
      if (occ.length === 2 && variable) continue;
      if (variable && spread / medAmt > 0.6) continue;
    }

    const sign = list[0].amount < 0 ? -1 : 1;
    const lastOcc = occ[occ.length - 1];
    const prevOcc = occ[occ.length - 2];
    let nextDate = step(lastOcc.date, cad.name);
    const through = dataThrough.get(list[0].accountId) ?? lastOcc.date;
    const stopped = daysBetween(nextDate, through) > cad.tol * 2 + 3;
    while (nextDate < today) nextDate = step(nextDate, cad.name);

    let priceChange: RecurringItem['priceChange'];
    if (!variable || occ.length >= 3) {
      const a = Math.abs(prevOcc.amount);
      const b = Math.abs(lastOcc.amount);
      // Only flag a change when earlier amounts were stable.
      const earlierStable = occ.slice(0, -1).every((o) => Math.abs(Math.abs(o.amount) - a) < 0.01);
      if (earlierStable && Math.abs(b - a) >= 0.5 && Math.abs(b - a) / a >= 0.02) priceChange = { from: a, to: b };
    }

    const typical = sign * (priceChange ? Math.abs(lastOcc.amount) : medAmt);
    items.push({
      id: key,
      merchant: list[0].merchant,
      label: rule?.label || prettyMerchant(list[0].merchant),
      accountId: list[0].accountId,
      kind: sign < 0 ? 'bill' : 'income',
      category: list[list.length - 1].category,
      cadence: cad.name,
      amount: round2(typical),
      lastAmount: lastOcc.amount,
      lastDate: lastOcc.date,
      firstDate: occ[0].date,
      nextDate,
      occurrences: occ.length,
      variable: variable && !priceChange,
      priceChange,
      monthly: round2((typical * 30.44) / cad.days),
      status: stopped ? 'maybe-stopped' : 'active',
      confirmed,
      wantToCancel: !!rule?.wantToCancel,
    });
  }
  return items.sort((a, b) => a.nextDate.localeCompare(b.nextDate));
}

/** Expand recurring items into dated occurrences within [from, to]. */
export function upcoming(items: RecurringItem[], from: string, to: string) {
  const out: { item: RecurringItem; date: string }[] = [];
  for (const item of items) {
    if (item.status !== 'active') continue;
    let d = item.nextDate;
    while (d <= to) {
      if (d >= from) out.push({ item, date: d });
      d = step(d, item.cadence);
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
