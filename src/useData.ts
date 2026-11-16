import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { DEFAULT_SETTINGS } from './types';
import { detectRecurring } from './lib/recurring';
import { buildAlerts } from './lib/insights';
import { todayISO } from './lib/dates';

/** One live view of everything; the dataset for a personal finance app is small enough for this. */
export function useData() {
  const accounts = useLiveQuery(() => db.accounts.toArray(), []);
  const transactions = useLiveQuery(() => db.transactions.orderBy('date').toArray(), []);
  const statements = useLiveQuery(() => db.statements.toArray(), []);
  const balances = useLiveQuery(() => db.balances.orderBy('date').toArray(), []);
  const rules = useLiveQuery(() => db.merchantRules.toArray(), []);
  const dismissals = useLiveQuery(() => db.dismissals.toArray(), []);
  const settings = useLiveQuery(() => db.settings.get('settings'), []) ?? DEFAULT_SETTINGS;
  const today = todayISO();

  const loading = !accounts || !transactions || !statements || !balances || !rules || !dismissals;

  const recurring = useMemo(
    () => (transactions && rules ? detectRecurring(transactions, rules, today) : []),
    [transactions, rules, today],
  );
  const alerts = useMemo(() => {
    if (loading) return [];
    const dismissed = new Set(dismissals!.map((d) => d.key));
    return buildAlerts({ accounts: accounts!, transactions: transactions!, statements: statements!, recurring, settings, today }).filter(
      (a) => !dismissed.has(a.key),
    );
  }, [loading, accounts, transactions, statements, recurring, settings, today, dismissals]);

  return {
    loading,
    accounts: accounts ?? [],
    transactions: transactions ?? [],
    statements: statements ?? [],
    balances: balances ?? [],
    rules: rules ?? [],
    settings,
    recurring,
    alerts,
    today,
  };
}

export type Data = ReturnType<typeof useData>;
