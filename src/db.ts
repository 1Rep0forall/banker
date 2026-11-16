import Dexie, { type Table } from 'dexie';
import type { Account, BalanceSnapshot, Budget, Dismissal, MerchantRule, Settings, Statement, Transaction } from './types';
import { DEFAULT_SETTINGS } from './types';

export class BankerDB extends Dexie {
  accounts!: Table<Account, number>;
  statements!: Table<Statement, number>;
  transactions!: Table<Transaction, number>;
  balances!: Table<BalanceSnapshot, number>;
  merchantRules!: Table<MerchantRule, string>;
  dismissals!: Table<Dismissal, string>;
  settings!: Table<Settings, string>;
  budgets!: Table<Budget, string>;

  constructor(name = 'banker') {
    super(name);
    this.version(1).stores({
      accounts: '++id, last4, institution, type, *matchKeys',
      statements: '++id, accountId, fileHash, periodEnd',
      transactions: '++id, accountId, date, merchant, category, [accountId+fingerprint], statementId',
      balances: '++id, accountId, date, [accountId+date]',
      merchantRules: 'merchant',
      dismissals: 'key',
      settings: 'id',
    });
    this.version(2).stores({ budgets: 'category' });
  }
}

export const db = new BankerDB();

export async function getSettings(database: BankerDB = db): Promise<Settings> {
  return (await database.settings.get('settings')) ?? DEFAULT_SETTINGS;
}
