import { describe, expect, it } from 'vitest';
import { estimateMinimum, simulatePayoff, type Debt } from '../src/lib/payoff';
import { buildIcs } from '../src/lib/ics';
import { budgetStatus, buildAlerts, calendarEvents, findCardPayment } from '../src/lib/insights';
import { DEFAULT_SETTINGS, type Account, type Transaction } from '../src/types';

const card = (over: Partial<Account> = {}): Account => ({
  id: 2, name: 'Capital One Card', institution: 'Capital One', type: 'credit', last4: '7730', matchKeys: [], currency: 'USD',
  currentBalance: 1623.27, balanceAsOf: '2026-10-31', paymentDueDate: '2026-11-25', minimumPayment: 40, interestRate: 27.49,
  createdAt: '', updatedAt: '', ...over,
});
const tx = (accountId: number, date: string, description: string, amount: number, category: string): Transaction => ({
  accountId, date, description, amount, category, merchant: description.toLowerCase(), fingerprint: date + amount,
});

describe('debt payoff', () => {
  const debts: Debt[] = [
    { id: 1, name: 'Card A', balance: 3000, apr: 24, minimum: 90 },
    { id: 2, name: 'Card B', balance: 800, apr: 12, minimum: 30 },
  ];
  it('avalanche pays less interest than snowball, and extra money helps', () => {
    const av = simulatePayoff(debts, 200, 'avalanche');
    const sn = simulatePayoff(debts, 200, 'snowball');
    const minOnly = simulatePayoff(debts, 0, 'avalanche');
    expect(av.neverPaysOff).toBe(false);
    expect(av.totalInterest).toBeLessThan(sn.totalInterest);
    expect(av.order).toEqual([1, 2]);
    expect(sn.order).toEqual([2, 1]);
    expect(sn.payoffMonth[2]).toBeLessThan(sn.payoffMonth[1]); // quick win first
    expect(av.months).toBeLessThan(minOnly.months);
    expect(av.totalInterest).toBeLessThan(minOnly.totalInterest);
  });
  it('detects payments that never cover the interest', () => {
    expect(simulatePayoff([{ id: 1, name: 'X', balance: 10000, apr: 30, minimum: 100 }], 0, 'avalanche').neverPaysOff).toBe(true);
    expect(estimateMinimum(1000, 24)).toBe(30);
    expect(estimateMinimum(500, 0)).toBe(25);
  });
});

describe('card payments', () => {
  it('marks the bill paid when a payment arrives after the statement closes', () => {
    const a = card();
    expect(findCardPayment(a, [tx(1, '2026-10-22', 'CAPITAL ONE CRCARDPMT', -250, 'Credit Card Payment')])).toBeUndefined();
    const fromChecking = [tx(1, '2026-11-10', 'CAPITAL ONE CRCARDPMT', -250, 'Credit Card Payment')];
    expect(findCardPayment(a, fromChecking)).toEqual({ date: '2026-11-10', amount: 250 });
    expect(findCardPayment(a, [tx(1, '2026-11-10', 'CAPITAL ONE CRCARDPMT', -20, 'Credit Card Payment')])).toBeUndefined(); // below minimum
    expect(findCardPayment(a, [tx(2, '2026-11-12', 'PAYMENT THANK YOU', 100, 'Credit Card Payment')])).toEqual({ date: '2026-11-12', amount: 100 });

    const alerts = buildAlerts({ accounts: [a], transactions: fromChecking, statements: [], recurring: [], settings: DEFAULT_SETTINGS, today: '2026-11-20' });
    expect(alerts.some((x) => x.key.startsWith('due'))).toBe(false);
    expect(alerts.find((x) => x.key.startsWith('paid:'))?.severity).toBe('good');
    // long after the due date there's no stale "was due" warning either
    const later = buildAlerts({ accounts: [a], transactions: fromChecking, statements: [], recurring: [], settings: DEFAULT_SETTINGS, today: '2026-12-10' });
    expect(later.some((x) => x.key.startsWith('due') || x.key.startsWith('paid'))).toBe(false);
  });
});

describe('budgets', () => {
  it('compares the latest month with data against limits', () => {
    const txs = [tx(1, '2026-10-03', 'DOORDASH', -150, 'Dining'), tx(1, '2026-10-20', 'CHIPOTLE', -80, 'Dining'), tx(1, '2026-10-05', 'KROGER', -100, 'Groceries'), tx(1, '2026-09-05', 'CHIPOTLE', -500, 'Dining')];
    const s = budgetStatus([{ category: 'Dining', monthly: 200 }, { category: 'Groceries', monthly: 400 }], txs, '2026-11-16');
    expect(s.month).toBe('2026-10');
    expect(s.rows[0]).toMatchObject({ category: 'Dining', spent: 230 });
    const alerts = buildAlerts({ accounts: [], transactions: txs, statements: [], recurring: [], settings: DEFAULT_SETTINGS, today: '2026-11-16', budgets: [{ category: 'Dining', monthly: 200 }] });
    expect(alerts.some((a) => a.title.startsWith('Over budget on Dining'))).toBe(true);
  });
});

describe('calendar export', () => {
  it('builds a valid iCalendar file with reminders', () => {
    const events = calendarEvents([card()], [], [], '2026-11-16');
    expect(events).toHaveLength(1);
    const ics = buildIcs(events, new Date('2026-11-16T12:00:00Z'));
    expect(ics).toContain('BEGIN:VCALENDAR\r\n');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261125');
    expect(ics).toContain('DTEND;VALUE=DATE:20261126');
    expect(ics).toContain('TRIGGER:-PT63H'); // 3 days before, 9am
    expect(ics).toContain('SUMMARY:💳 Pay Capital One Card (min $40.00)');
    expect(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });
});
