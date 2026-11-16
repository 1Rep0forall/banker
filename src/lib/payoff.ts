import { addMonths } from './dates';
import { round2 } from './money';

export interface Debt {
  id: number;
  name: string;
  balance: number;
  /** APR percent */
  apr: number;
  minimum: number;
  /** true when the minimum payment was estimated rather than read from a statement */
  estimatedMinimum?: boolean;
}

export type Strategy = 'avalanche' | 'snowball';

export interface PayoffResult {
  months: number;
  totalInterest: number;
  totalPaid: number;
  /** month index (1-based) each debt is paid off, keyed by debt id */
  payoffMonth: Record<number, number>;
  /** order debts get extra money in */
  order: number[];
  neverPaysOff: boolean;
}

/** Typical card minimum when the statement didn't say: 1% of balance + interest, at least $25. */
export function estimateMinimum(balance: number, apr: number): number {
  return round2(Math.min(balance, Math.max(25, balance * 0.01 + (balance * apr) / 1200)));
}

/**
 * Month-by-month simulation. Every month all minimums are paid; `extra` plus the minimums
 * of debts already paid off ("rollover") go to the target debt:
 *  - avalanche: highest APR first (least interest)
 *  - snowball: smallest balance first (quick wins, good for motivation)
 */
export function simulatePayoff(debts: Debt[], extra: number, strategy: Strategy, maxMonths = 600): PayoffResult {
  const live = debts.filter((d) => d.balance > 0).map((d) => ({ ...d }));
  const order = [...live]
    .sort((a, b) => (strategy === 'avalanche' ? b.apr - a.apr || a.balance - b.balance : a.balance - b.balance || b.apr - a.apr))
    .map((d) => d.id);
  const budget = live.reduce((s, d) => s + d.minimum, 0) + Math.max(0, extra);
  const payoffMonth: Record<number, number> = {};
  let totalInterest = 0;
  let totalPaid = 0;
  let month = 0;

  while (live.some((d) => d.balance > 0.005) && month < maxMonths) {
    month++;
    for (const d of live) {
      if (d.balance <= 0) continue;
      const interest = (d.balance * d.apr) / 1200;
      d.balance += interest;
      totalInterest += interest;
    }
    let left = budget;
    for (const d of live) {
      if (d.balance <= 0) continue;
      const pay = Math.min(d.balance, d.minimum, left);
      d.balance -= pay;
      left -= pay;
    }
    for (const id of order) {
      if (left <= 0) break;
      const d = live.find((x) => x.id === id)!;
      if (d.balance <= 0) continue;
      const pay = Math.min(d.balance, left);
      d.balance -= pay;
      left -= pay;
    }
    totalPaid += budget - left;
    for (const d of live) {
      if (d.balance <= 0.005 && payoffMonth[d.id] === undefined) {
        d.balance = 0;
        payoffMonth[d.id] = month;
      }
    }
  }
  return {
    months: month,
    totalInterest: round2(totalInterest),
    totalPaid: round2(totalPaid),
    payoffMonth,
    order,
    neverPaysOff: live.some((d) => d.balance > 0.005),
  };
}

export function payoffDate(fromISO: string, months: number): string {
  return addMonths(fromISO, months);
}
