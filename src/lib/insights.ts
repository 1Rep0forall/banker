import type { Account, Budget, Settings, Statement, Transaction } from '../types';
import type { CalEvent } from './ics';
import { NON_SPENDING } from './categorize';
import { isLiability } from '../types';
import type { RecurringItem } from './recurring';
import { upcoming } from './recurring';
import { addDays, daysBetween, toDate } from './dates';
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
  budgets?: Budget[];
}

/**
 * Has the current card/loan bill been paid? Looks for payments made after the statement
 * closed: either a credit on the card itself, or a "card payment" leaving another account
 * that mentions this bank or the last 4 digits.
 */
export function findCardPayment(a: Account, transactions: Transaction[]): { date: string; amount: number } | undefined {
  if (!a.balanceAsOf) return undefined;
  const since = a.balanceAsOf;
  const until = a.paymentDueDate ? addDays(a.paymentDueDate, 3) : addDays(since, 40);
  const bank = a.institution.toLowerCase().split(/\s+/)[0];
  const onCard = transactions.filter((t) => t.accountId === a.id && t.amount > 0 && t.date > since && t.date <= until);
  const fromElsewhere = transactions.filter(
    (t) => t.accountId !== a.id && t.amount < 0 && t.date > since && t.date <= until && t.category === 'Credit Card Payment' &&
      ((bank && t.description.toLowerCase().includes(bank)) || (a.last4 && t.description.includes(a.last4))),
  );
  const payments = onCard.length ? onCard.map((t) => ({ date: t.date, amount: t.amount })) : fromElsewhere.map((t) => ({ date: t.date, amount: -t.amount }));
  if (!payments.length) return undefined;
  const total = round2(payments.reduce((s, p) => s + p.amount, 0));
  if (a.minimumPayment !== undefined && total < a.minimumPayment) return undefined;
  return { date: payments[payments.length - 1].date, amount: total };
}

export interface BudgetRow { category: string; limit: number; spent: number; pct: number }

/** Spending vs budget for the latest month that has data (statements usually lag behind today). */
export function budgetStatus(budgets: Budget[], transactions: Transaction[], today: string) {
  const latest = transactions.reduce((m, t) => (t.date > m ? t.date : m), '');
  const month = (latest && latest.slice(0, 7) <= today.slice(0, 7) ? latest : today).slice(0, 7);
  const spent = new Map<string, number>();
  for (const t of transactions) {
    if (t.date.slice(0, 7) !== month || t.amount >= 0 || NON_SPENDING.has(t.category)) continue;
    spent.set(t.category, (spent.get(t.category) ?? 0) - t.amount);
  }
  const rows: BudgetRow[] = budgets
    .filter((b) => b.monthly > 0)
    .map((b) => {
      const s = round2(spent.get(b.category) ?? 0);
      return { category: b.category, limit: b.monthly, spent: s, pct: (s / b.monthly) * 100 };
    })
    .sort((a, b) => b.pct - a.pct);
  const isCurrentMonth = month === today.slice(0, 7);
  const end = toDate(month + '-01');
  end.setUTCMonth(end.getUTCMonth() + 1, 0);
  const daysLeft = isCurrentMonth ? daysBetween(today, end.toISOString().slice(0, 10)) : 0;
  return { month, rows, isCurrentMonth, daysLeft, spentByCategory: spent };
}

/** Average monthly spend per category over the last `months` full months with data. */
export function averageSpend(transactions: Transaction[], months = 3): Map<string, number> {
  const all = [...new Set(transactions.map((t) => t.date.slice(0, 7)))].sort();
  const use = new Set(all.slice(-months));
  const sums = new Map<string, number>();
  for (const t of transactions) {
    if (!use.has(t.date.slice(0, 7)) || t.amount >= 0 || NON_SPENDING.has(t.category)) continue;
    sums.set(t.category, (sums.get(t.category) ?? 0) - t.amount);
  }
  for (const [k, v] of sums) sums.set(k, round2(v / Math.max(1, use.size)));
  return sums;
}

export function buildAlerts({ accounts, transactions, statements, recurring, settings, today, budgets = [] }: InsightInput): Alert[] {
  const alerts: Alert[] = [];
  const cur = settings.currency;
  const active = accounts.filter((a) => !a.archived);

  for (const a of active) {
    const to = `/accounts/${a.id}`;
    // Payment due dates (skipped once a payment shows up)
    const paid = isLiability(a.type) && a.paymentDueDate ? findCardPayment(a, transactions) : undefined;
    if (paid) {
      if (daysBetween(today, a.paymentDueDate!) >= -7) {
        alerts.push({ key: `paid:${a.id}:${a.paymentDueDate}`, severity: 'good', title: `${a.name} is paid for this cycle`, detail: `${formatMoney(paid.amount, cur)} paid on ${paid.date}. Nice work.`, to });
      }
    } else if (isLiability(a.type) && a.paymentDueDate && (a.currentBalance ?? 1) > 0) {
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

  // Budgets
  const bs = budgetStatus(budgets, transactions, today);
  for (const r of bs.rows) {
    const label = bs.isCurrentMonth ? 'this month' : `in ${bs.month}`;
    if (r.spent > r.limit + 0.005) {
      alerts.push({ key: `budget-over:${r.category}:${bs.month}:${Math.floor(r.pct / 10)}`, severity: 'warning', title: `Over budget on ${r.category}: ${formatMoney(r.spent, cur)} of ${formatMoney(r.limit, cur)}`, detail: `${formatMoney(r.spent - r.limit, cur)} over ${label}.`, to: '/plan' });
    } else if (r.pct >= 85 && bs.isCurrentMonth) {
      alerts.push({ key: `budget-near:${r.category}:${bs.month}`, severity: 'info', title: `${r.category} is at ${Math.round(r.pct)}% of its budget`, detail: `${formatMoney(r.limit - r.spent, cur)} left for the next ${bs.daysLeft} days.`, to: '/plan' });
    }
  }

  // Weekly check-in nudge
  if (accounts.length) {
    const since = settings.lastCheckIn ? daysBetween(settings.lastCheckIn, today) : undefined;
    if (since === undefined || since >= 7) {
      alerts.push({ key: `checkin:${settings.lastCheckIn ?? 'never'}:${Math.floor((since ?? 0) / 7)}`, severity: 'info', title: since === undefined ? 'Try a 5-minute weekly money check-in' : `It's been ${since} days since your money check-in`, detail: 'Four quick steps. It is at the bottom of this page.', to: '/' });
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
export function safeToSpend(accounts: Account[], recurring: RecurringItem[], today: string, transactions: Transaction[] = []): SafeToSpend {
  const cash = round2(accounts.filter((a) => !a.archived && a.type === 'checking').reduce((s, a) => s + (a.currentBalance ?? 0), 0));
  const income = upcoming(recurring.filter((r) => r.kind === 'income' && r.category === 'Income'), today, addDays(today, 45));
  const nextIncome = income[0];
  const until = nextIncome?.date ?? addDays(today, 14);
  const bills = upcoming(recurring.filter((r) => r.kind === 'bill' && r.category !== 'Credit Card Payment'), today, until);
  const billsBeforePayday = round2(bills.reduce((s, b) => s + Math.abs(b.item.amount), 0));
  const cardPaymentsBeforePayday = round2(
    accounts
      .filter((a) => !a.archived && isLiability(a.type) && a.paymentDueDate && a.paymentDueDate >= today && a.paymentDueDate <= until && !findCardPayment(a, transactions))
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

/** Calendar reminders for the next `days` days: bills, paydays, card due dates, and cancel reminders. */
export function calendarEvents(accounts: Account[], recurring: RecurringItem[], transactions: Transaction[], today: string, currency = 'USD', days = 90): CalEvent[] {
  const until = addDays(today, days);
  const events: CalEvent[] = [];
  for (const { item, date } of upcoming(recurring, today, until)) {
    const amt = formatMoney(Math.abs(item.amount), currency);
    if (item.kind === 'income') {
      events.push({ uid: `inc-${item.id}-${date}`, date, title: `💰 ${item.label} (${amt})` });
    } else if (item.wantToCancel) {
      events.push({ uid: `cancel-${item.id}-${date}`, date, title: `❌ ${item.label} renews (${amt}). Cancel?`, description: 'You flagged this to cancel in Banker. Cancel before this date to avoid the charge.', alarmDaysBefore: 3 });
    } else {
      events.push({ uid: `bill-${item.id}-${date}`, date, title: `${item.label} (${item.variable ? '≈' : ''}${amt})`, description: `${item.cadence} ${item.category}. Make sure there's enough in the account.`, alarmDaysBefore: 1 });
    }
  }
  for (const a of accounts) {
    if (a.archived || !isLiability(a.type) || !a.paymentDueDate || a.paymentDueDate < today || a.paymentDueDate > until) continue;
    if (findCardPayment(a, transactions)) continue;
    const min = a.minimumPayment !== undefined ? ` (min ${formatMoney(a.minimumPayment, currency)})` : '';
    events.push({ uid: `due-${a.id}-${a.paymentDueDate}`, date: a.paymentDueDate, title: `💳 Pay ${a.name}${min}`, description: `Statement balance ${formatMoney(a.currentBalance, currency)}. Paying in full avoids interest.`, alarmDaysBefore: 3 });
  }
  return events.sort((x, y) => x.date.localeCompare(y.date));
}
