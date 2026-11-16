import type { Account, Settings, Statement, Transaction } from '../types';
import { isLiability } from '../types';
import type { RecurringItem } from './recurring';
import { upcoming } from './recurring';
import { addDays, daysBetween } from './dates';
import { formatMoney, round2 } from './money';
import { prettyMerchant } from './merchant';

export type Severity = 'critical' | 'warning' | 'info' | 'good';

export interface Alert {
  key: string;
  severity: Severity;
  title: string;
  detail?: string;
  to?: string;
}

const pct = (n: number) => `${n.toFixed(n % 1 ? 2 : 0)}%`;

export function whenText(days: number): string {
  if (days < -1) return `${-days} days ago`;
  if (days === -1) return 'yesterday';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

export interface InsightInput {
  accounts: Account[];
  transactions: Transaction[];
  statements: Statement[];
  recurring: RecurringItem[];
  settings: Settings;
  today: string;
}

export function buildAlerts({ accounts, transactions, statements, recurring, settings, today }: InsightInput): Alert[] {
  const alerts: Alert[] = [];
  const cur = settings.currency;
  const active = accounts.filter((a) => !a.archived);

  for (const a of active) {
    const to = `/accounts/${a.id}`;
    // Payment due dates
    if (isLiability(a.type) && a.paymentDueDate && (a.currentBalance ?? 1) > 0) {
      const d = daysBetween(today, a.paymentDueDate);
      const amt = a.minimumPayment !== undefined ? ` Minimum: ${formatMoney(a.minimumPayment, cur)}.` : '';
      if (d < 0 && d >= -20) {
        alerts.push({ key: `due-past:${a.id}:${a.paymentDueDate}`, severity: 'critical', title: `${a.name} payment was due ${whenText(d)}`, detail: `If you already paid it, import your newest statement or dismiss this.${amt}`, to });
      } else if (d >= 0 && d <= 3) {
        alerts.push({ key: `due:${a.id}:${a.paymentDueDate}`, severity: 'critical', title: `Pay ${a.name} ${whenText(d)}`, detail: `Balance ${formatMoney(a.currentBalance, cur)}.${amt}`, to });
      } else if (d > 3 && d <= 10) {
        alerts.push({ key: `due:${a.id}:${a.paymentDueDate}`, severity: 'warning', title: `${a.name} payment due ${whenText(d)}`, detail: `Balance ${formatMoney(a.currentBalance, cur)}.${amt}`, to });
      }
    }
    // Low balance
    const threshold = a.lowBalanceAlert ?? settings.defaultLowBalance;
    if (!isLiability(a.type) && a.type !== 'investment' && a.currentBalance !== undefined && a.currentBalance < threshold) {
      alerts.push({ key: `low:${a.id}:${a.balanceAsOf}`, severity: a.currentBalance < 0 ? 'critical' : 'warning', title: `${a.name} is low: ${formatMoney(a.currentBalance, cur)}`, detail: `Below your ${formatMoney(threshold, cur)} alert level.`, to });
    }
    // Credit utilisation
    if (a.type === 'credit' && a.creditLimit && a.currentBalance !== undefined) {
      const u = (a.currentBalance / a.creditLimit) * 100;
      if (u >= 80) alerts.push({ key: `util:${a.id}:${a.balanceAsOf}`, severity: 'warning', title: `${a.name} is ${Math.round(u)}% maxed out`, detail: 'Using more than 30% of your limit can lower your credit score.', to });
      else if (u >= 30) alerts.push({ key: `util:${a.id}:${a.balanceAsOf}`, severity: 'info', title: `${a.name} is at ${Math.round(u)}% of its limit`, detail: 'Under 30% is generally better for your credit score.', to });
    }
    // Interest costs
    if (isLiability(a.type) && a.interestRate && (a.currentBalance ?? 0) > 0) {
      const monthly = round2((a.currentBalance! * a.interestRate) / 1200);
      if (monthly >= 1) alerts.push({ key: `interest:${a.id}:${a.balanceAsOf}`, severity: 'info', title: `${a.name} costs about ${formatMoney(monthly, cur)}/month in interest`, detail: `${pct(a.interestRate)} APR on ${formatMoney(a.currentBalance, cur)}.`, to });
    }
    // Missing info nudges
    if (isLiability(a.type) && (!a.paymentDueDate || a.interestRate === undefined)) {
      const missing = [!a.paymentDueDate && 'due date', a.interestRate === undefined && 'interest rate'].filter(Boolean).join(' and ');
      alerts.push({ key: `missing:${a.id}`, severity: 'info', title: `Add the ${missing} for ${a.name}`, detail: 'So I can remind you before it\'s due and show what it costs.', to });
    }
    // Stale statements
    const last = statements.filter((s) => s.accountId === a.id).map((s) => s.periodEnd ?? s.importedAt.slice(0, 10)).sort().pop();
    if (last && daysBetween(last, today) > settings.staleStatementDays) {
      alerts.push({ key: `stale:${a.id}:${last}`, severity: 'info', title: `${a.name} hasn't been updated in ${daysBetween(last, today)} days`, detail: 'Import a newer statement to keep balances and reminders accurate.', to: '/import' });
    }
  }

  // Recurring: price changes, new subscriptions, wanted-to-cancel
  for (const r of recurring) {
    if (r.status !== 'active') continue;
    if (r.priceChange && r.kind === 'bill' && r.priceChange.to > r.priceChange.from) {
      alerts.push({ key: `price:${r.id}:${r.lastDate}`, severity: 'warning', title: `${r.label} went up: ${formatMoney(r.priceChange.from, cur)} → ${formatMoney(r.priceChange.to, cur)}`, detail: `That's ${formatMoney((r.priceChange.to - r.priceChange.from) * (12 * 30.44 / cadenceDays(r.cadence)), cur)} more per year.`, to: '/recurring' });
    }
    if (r.kind === 'bill' && daysBetween(r.firstDate, today) <= 60 && r.occurrences <= 3) {
      alerts.push({ key: `newsub:${r.id}`, severity: 'info', title: `New recurring charge: ${r.label}`, detail: `${formatMoney(Math.abs(r.amount), cur)} ${r.cadence}. Did you mean to sign up for this?`, to: '/recurring' });
    }
    if (r.wantToCancel) {
      const d = daysBetween(today, r.nextDate);
      alerts.push({ key: `cancel:${r.id}:${r.nextDate}`, severity: d <= 3 ? 'warning' : 'info', title: `Reminder: cancel ${r.label}`, detail: `Next charge of ${formatMoney(Math.abs(r.amount), cur)} is ${whenText(d)}.`, to: '/recurring' });
    }
  }

  // Recent transaction checks (based on the newest data we have)
  const latest = transactions.reduce((m, t) => (t.date > m ? t.date : m), '');
  if (latest) {
    const since60 = addDays(latest, -60);
    const since14 = addDays(latest, -14);
    const recent = transactions.filter((t) => t.date >= since60);
    const fees = recent.filter((t) => t.category === 'Fees & Interest' && t.amount < 0);
    if (fees.length) {
      const total = round2(fees.reduce((s, t) => s + t.amount, 0));
      alerts.push({ key: `fees:${fees.map((f) => f.id).join(',')}`, severity: 'warning', title: `You paid ${formatMoney(-total, cur)} in fees & interest recently`, detail: fees.slice(0, 3).map((f) => f.description).join(' · '), to: '/transactions?category=Fees%20%26%20Interest' });
    }
    // Possible duplicate charges
    const byKey = new Map<string, Transaction[]>();
    for (const t of recent) {
      if (t.amount >= 0) continue;
      const k = `${t.accountId}|${t.merchant}|${t.amount}`;
      (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(t);
    }
    for (const list of byKey.values()) {
      list.sort((a, b) => a.date.localeCompare(b.date));
      for (let i = 1; i < list.length; i++) {
        if (daysBetween(list[i - 1].date, list[i].date) <= 2 && Math.abs(list[i].amount) >= 5) {
          alerts.push({ key: `dup:${list[i - 1].id}:${list[i].id}`, severity: 'warning', title: `Possible double charge: ${prettyMerchant(list[i].merchant)}`, detail: `${formatMoney(-list[i].amount, cur)} on ${list[i - 1].date} and ${list[i].date}. Check with the merchant if you only bought once.`, to: `/transactions?q=${encodeURIComponent(list[i].merchant)}` });
          break;
        }
      }
    }
    // Large transactions
    for (const t of transactions) {
      if (t.date >= since14 && Math.abs(t.amount) >= settings.largeTransaction && t.amount < 0 && t.category !== 'Credit Card Payment' && t.category !== 'Transfer') {
        alerts.push({ key: `large:${t.id}`, severity: 'info', title: `Large charge: ${formatMoney(-t.amount, cur)} at ${prettyMerchant(t.merchant)}`, detail: `${t.date} — just making sure you know about it.`, to: `/transactions?q=${encodeURIComponent(t.merchant)}` });
      }
    }
  }

  const order: Record<Severity, number> = { critical: 0, warning: 1, info: 2, good: 3 };
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
}

export function cadenceDays(c: RecurringItem['cadence']): number {
  return { weekly: 7, biweekly: 14, monthly: 30.44, quarterly: 91.3, semiannual: 182.6, yearly: 365.25 }[c];
}

export interface SafeToSpend {
  cash: number;
  billsBeforePayday: number;
  cardPaymentsBeforePayday: number;
  safe: number;
  until: string;
  nextIncome?: { label: string; date: string; amount: number };
}

/** Cash in checking/savings minus bills and card minimums due before the next paycheck. */
export function safeToSpend(accounts: Account[], recurring: RecurringItem[], today: string): SafeToSpend {
  const cash = round2(accounts.filter((a) => !a.archived && a.type === 'checking').reduce((s, a) => s + (a.currentBalance ?? 0), 0));
  const income = upcoming(recurring.filter((r) => r.kind === 'income' && r.category === 'Income'), today, addDays(today, 45));
  const nextIncome = income[0];
  const until = nextIncome?.date ?? addDays(today, 14);
  const bills = upcoming(recurring.filter((r) => r.kind === 'bill' && r.category !== 'Credit Card Payment'), today, until);
  const billsBeforePayday = round2(bills.reduce((s, b) => s + Math.abs(b.item.amount), 0));
  const cardPaymentsBeforePayday = round2(
    accounts
      .filter((a) => !a.archived && isLiability(a.type) && a.paymentDueDate && a.paymentDueDate >= today && a.paymentDueDate <= until)
      .reduce((s, a) => s + (a.minimumPayment ?? 0), 0),
  );
  return {
    cash,
    billsBeforePayday,
    cardPaymentsBeforePayday,
    safe: round2(cash - billsBeforePayday - cardPaymentsBeforePayday),
    until,
    nextIncome: nextIncome && { label: nextIncome.item.label, date: nextIncome.date, amount: nextIncome.item.amount },
  };
}

export function netWorth(accounts: Account[]) {
  let assets = 0;
  let debts = 0;
  for (const a of accounts) {
    if (a.archived || a.currentBalance === undefined) continue;
    if (isLiability(a.type)) debts += a.currentBalance;
    else assets += a.currentBalance;
  }
  return { assets: round2(assets), debts: round2(debts), net: round2(assets - debts) };
}
