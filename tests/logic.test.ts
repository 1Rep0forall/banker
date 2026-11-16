import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { BankerDB } from '../src/db';
import { commitImport, overlapByAccount, rankAccounts, AUTO_MATCH_SCORE } from '../src/lib/importer';
import { detectRecurring } from '../src/lib/recurring';
import { buildAlerts, safeToSpend } from '../src/lib/insights';
import { DEFAULT_SETTINGS, type ParsedStatement } from '../src/types';

const stmt = (over: Partial<ParsedStatement>): ParsedStatement => ({ format: 'csv', transactions: [], warnings: [], ...over });

let db: BankerDB;
beforeEach(async () => {
  db = new BankerDB('test-' + Math.random());
  await db.open();
});

describe('importing statements', () => {
  it('creates an account the first time, then builds on it', async () => {
    const jan = stmt({
      institution: 'Chase', last4: '4821', accountType: 'checking', periodEnd: '2024-01-31', closingBalance: 900,
      transactions: [
        { date: '2024-01-05', description: 'NETFLIX.COM', amount: -15.49 },
        { date: '2024-01-15', description: 'ACME PAYROLL', amount: 1000 },
      ],
    });
    const r1 = await commitImport(db, jan, { fileName: 'jan.csv', fileHash: 'a' }, { newAccount: {} });
    expect(r1.created).toBe(true);
    expect(r1.added).toBe(2);

    // February statement overlaps one January transaction
    const feb = stmt({
      institution: 'Chase', last4: '4821', accountType: 'checking', periodEnd: '2024-02-29', closingBalance: 1500,
      transactions: [
        { date: '2024-01-15', description: 'Acme Payroll (different text)', amount: 1000 },
        { date: '2024-02-05', description: 'NETFLIX.COM', amount: -15.49 },
      ],
    });
    const accounts = await db.accounts.toArray();
    const ranked = rankAccounts(feb, accounts, await overlapByAccount(db, feb));
    expect(ranked[0].account.id).toBe(r1.accountId);
    expect(ranked[0].score).toBeGreaterThanOrEqual(AUTO_MATCH_SCORE);

    const r2 = await commitImport(db, feb, { fileName: 'feb.csv', fileHash: 'b' }, { accountId: ranked[0].account.id! });
    expect(r2).toMatchObject({ created: false, added: 1, duplicates: 1 });
    const acct = await db.accounts.get(r1.accountId);
    expect(acct!.currentBalance).toBe(1500);
    expect(acct!.name).toBe('Chase Checking ••4821');
    expect(await db.transactions.count()).toBe(3);

    // An older statement must not overwrite the newer balance
    await commitImport(db, stmt({ last4: '4821', periodEnd: '2023-12-31', closingBalance: 10 }), { fileName: 'dec.csv', fileHash: 'c' }, { accountId: r1.accountId });
    expect((await db.accounts.get(r1.accountId))!.currentBalance).toBe(1500);
  });

  it('does not match an account with a different number', async () => {
    const r = await commitImport(db, stmt({ institution: 'Chase', last4: '1111', accountType: 'credit' }), { fileName: 'x', fileHash: 'x' }, { newAccount: {} });
    const ranked = rankAccounts(stmt({ institution: 'Chase', last4: '2222', accountType: 'credit' }), await db.accounts.toArray());
    expect(ranked.find((m) => m.account.id === r.accountId)).toBeUndefined();
  });
});

describe('recurring & insights', () => {
  const tx = (date: string, description: string, amount: number, merchant: string, category = 'Subscriptions') => ({
    accountId: 1, date, description, amount, merchant, category, fingerprint: date + amount,
  });

  it('detects monthly subscriptions, price increases, and paychecks', () => {
    const txs = [
      tx('2024-01-05', 'NETFLIX', -15.49, 'netflix.com'),
      tx('2024-02-05', 'NETFLIX', -15.49, 'netflix.com'),
      tx('2024-03-05', 'NETFLIX', -15.49, 'netflix.com'),
      tx('2024-04-05', 'NETFLIX', -17.99, 'netflix.com'),
      tx('2024-03-01', 'PAY', 1500, 'acme payroll', 'Income'),
      tx('2024-03-15', 'PAY', 1500, 'acme payroll', 'Income'),
      tx('2024-03-29', 'PAY', 1500, 'acme payroll', 'Income'),
      tx('2024-04-12', 'PAY', 1500, 'acme payroll', 'Income'),
      tx('2024-01-09', 'AMAZON', -12, 'amazon', 'Shopping'),
      tx('2024-02-11', 'AMAZON', -230, 'amazon', 'Shopping'),
    ];
    const items = detectRecurring(txs, [], '2024-04-15');
    const netflix = items.find((i) => i.merchant === 'netflix.com')!;
    expect(netflix.cadence).toBe('monthly');
    expect(netflix.priceChange).toEqual({ from: 15.49, to: 17.99 });
    expect(netflix.nextDate).toBe('2024-05-05');
    const pay = items.find((i) => i.merchant === 'acme payroll')!;
    expect(pay).toMatchObject({ cadence: 'biweekly', kind: 'income', nextDate: '2024-04-26' });
    expect(items.find((i) => i.merchant === 'amazon')).toBeUndefined();

    const accounts = [{ id: 1, name: 'Checking', institution: '', type: 'checking' as const, last4: '', matchKeys: [], currency: 'USD', currentBalance: 300, createdAt: '', updatedAt: '' }];
    const s = safeToSpend(accounts, items, '2024-04-15');
    expect(s.until).toBe('2024-04-26');
    expect(s.safe).toBe(300);

    const alerts = buildAlerts({ accounts, transactions: txs, statements: [], recurring: items, settings: DEFAULT_SETTINGS, today: '2024-04-15' });
    expect(alerts.some((a) => a.key.startsWith('price:'))).toBe(true);
  });
});
