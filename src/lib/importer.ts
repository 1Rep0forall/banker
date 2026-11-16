import type { BankerDB } from '../db';
import type { Account, AccountType, ParsedStatement, Transaction } from '../types';
import { isLiability } from '../types';
import { normalizeMerchant, prettyMerchant } from './merchant';
import { categorize } from './categorize';
import { round2 } from './money';

export interface AccountMatch {
  account: Account;
  score: number;
  reasons: string[];
}

const norm = (s?: string) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function matchKeyFor(p: Pick<ParsedStatement, 'institution' | 'last4' | 'accountNumber'>): string | undefined {
  const last4 = p.last4 ?? p.accountNumber?.replace(/\D/g, '').slice(-4);
  if (!last4) return undefined;
  return `${norm(p.institution) || 'unknown'}|${last4}`;
}

/** Fingerprints let us re-import overlapping statements without duplicating transactions. */
export function fingerprints(txs: { date: string; amount: number }[]): string[] {
  const seen = new Map<string, number>();
  return txs.map((t) => {
    const base = `${t.date}|${t.amount.toFixed(2)}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return `${base}|${n}`;
  });
}

/** Score how likely a parsed statement belongs to each existing account. */
export function rankAccounts(parsed: ParsedStatement, accounts: Account[], overlap: Map<number, number> = new Map()): AccountMatch[] {
  const key = matchKeyFor(parsed);
  const last4 = parsed.last4 ?? parsed.accountNumber?.replace(/\D/g, '').slice(-4);
  const results: AccountMatch[] = [];
  for (const a of accounts) {
    if (a.archived) continue;
    let score = 0;
    const reasons: string[] = [];
    if (key && a.matchKeys.includes(key)) { score += 100; reasons.push('Seen this account number before'); }
    if (last4 && a.last4) {
      if (a.last4 === last4) { score += 60; reasons.push(`Account ends in ${last4}`); }
      else score -= 100;
    }
    if (parsed.institution && a.institution && norm(parsed.institution) === norm(a.institution)) { score += 30; reasons.push(`Same bank (${a.institution})`); }
    else if (parsed.institution && a.institution) score -= 20;
    if (parsed.accountType && parsed.accountType === a.type) { score += 10; reasons.push(`Same type (${a.type})`); }
    else if (parsed.accountType && a.type !== parsed.accountType) score -= 15;
    const shared = overlap.get(a.id!) ?? 0;
    if (shared >= 3) { score += 50; reasons.push(`${shared} transactions already on file`); }
    if (score > 0) results.push({ account: a, score, reasons });
  }
  return results.sort((x, y) => y.score - x.score);
}

export const AUTO_MATCH_SCORE = 60;

/** Count how many parsed transactions already exist per account (helps match CSVs with no account number). */
export async function overlapByAccount(db: BankerDB, parsed: ParsedStatement): Promise<Map<number, number>> {
  const fps = fingerprints(parsed.transactions);
  const counts = new Map<number, number>();
  if (!fps.length) return counts;
  const dates = parsed.transactions.map((t) => t.date).sort();
  const existing = await db.transactions.where('date').between(dates[0], dates[dates.length - 1], true, true).toArray();
  const fpSet = new Set(fps);
  for (const t of existing) if (fpSet.has(t.fingerprint)) counts.set(t.accountId, (counts.get(t.accountId) ?? 0) + 1);
  return counts;
}

export function suggestAccountName(p: ParsedStatement): string {
  const type: Record<AccountType, string> = {
    checking: 'Checking', savings: 'Savings', credit: 'Credit Card', loan: 'Loan', investment: 'Investments', other: 'Account',
  };
  return [p.institution, type[p.accountType ?? 'other'], p.last4 ? `••${p.last4}` : ''].filter(Boolean).join(' ');
}

export type ImportTarget = { accountId: number } | { newAccount: Partial<Account> };

export interface ImportResult {
  accountId: number;
  created: boolean;
  added: number;
  duplicates: number;
  statementId: number;
}

export async function commitImport(
  db: BankerDB,
  parsed: ParsedStatement,
  meta: { fileName: string; fileHash: string },
  target: ImportTarget,
  now = new Date(),
): Promise<ImportResult> {
  const stamp = now.toISOString();
  return db.transaction('rw', [db.accounts, db.statements, db.transactions, db.balances, db.merchantRules], async () => {
    let accountId: number;
    let created = false;
    if ('accountId' in target) {
      accountId = target.accountId;
    } else {
      const n = target.newAccount;
      accountId = await db.accounts.add({
        name: n.name || suggestAccountName(parsed),
        institution: n.institution ?? parsed.institution ?? '',
        type: n.type ?? parsed.accountType ?? 'checking',
        last4: n.last4 ?? parsed.last4 ?? '',
        matchKeys: [],
        currency: n.currency ?? parsed.currency ?? 'USD',
        createdAt: stamp,
        updatedAt: stamp,
      });
      created = true;
    }
    const account = (await db.accounts.get(accountId))!;

    // Transactions (deduped)
    const fps = fingerprints(parsed.transactions);
    const existing = new Set((await db.transactions.where('accountId').equals(accountId).toArray()).map((t) => t.fingerprint));
    const rules = new Map((await db.merchantRules.toArray()).map((r) => [r.merchant, r]));
    const statementId = await db.statements.add({
      accountId,
      fileName: meta.fileName,
      fileHash: meta.fileHash,
      format: parsed.format,
      periodStart: parsed.periodStart,
      periodEnd: parsed.periodEnd,
      openingBalance: parsed.openingBalance,
      closingBalance: parsed.closingBalance,
      importedAt: stamp,
      addedCount: 0,
      duplicateCount: 0,
    });
    const toAdd: Transaction[] = [];
    parsed.transactions.forEach((t, i) => {
      if (existing.has(fps[i])) return;
      const merchant = normalizeMerchant(t.description);
      toAdd.push({
        accountId,
        statementId,
        date: t.date,
        description: t.description,
        merchant,
        amount: round2(t.amount),
        balance: t.balance,
        category: rules.get(merchant)?.category ?? categorize(t.description, t.amount),
        fingerprint: fps[i],
      });
    });
    await db.transactions.bulkAdd(toAdd);
    const duplicates = parsed.transactions.length - toAdd.length;
    await db.statements.update(statementId, { addedCount: toAdd.length, duplicateCount: duplicates });

    // Balance snapshot + account details, only overwriting with information that is at least as new.
    const asOf = parsed.periodEnd ?? parsed.transactions[parsed.transactions.length - 1]?.date;
    let closing = parsed.closingBalance;
    if (closing === undefined) {
      const lastWithBal = [...parsed.transactions].reverse().find((t) => t.balance !== undefined);
      closing = lastWithBal?.balance;
      if (closing !== undefined && isLiability(account.type) && closing < 0) closing = -closing;
    }
    if (closing !== undefined && asOf) {
      await db.balances.where('[accountId+date]').equals([accountId, asOf]).delete();
      await db.balances.add({ accountId, date: asOf, balance: closing, source: 'statement' });
    }
    const isNewer = !account.balanceAsOf || (asOf && asOf >= account.balanceAsOf);
    const updates: Partial<Account> = { updatedAt: stamp };
    const key = matchKeyFor(parsed);
    if (key && !account.matchKeys.includes(key)) updates.matchKeys = [...account.matchKeys, key];
    if (!account.last4 && parsed.last4) updates.last4 = parsed.last4;
    if (!account.institution && parsed.institution) updates.institution = parsed.institution;
    if (isNewer) {
      if (closing !== undefined) { updates.currentBalance = closing; updates.balanceAsOf = asOf; }
      if (parsed.interestRate !== undefined) updates.interestRate = parsed.interestRate;
      if (parsed.creditLimit !== undefined) updates.creditLimit = parsed.creditLimit;
      if (parsed.minimumPayment !== undefined) updates.minimumPayment = parsed.minimumPayment;
      if (parsed.paymentDueDate !== undefined) updates.paymentDueDate = parsed.paymentDueDate;
    } else {
      // Older statement: only fill blanks
      if (account.interestRate === undefined && parsed.interestRate !== undefined) updates.interestRate = parsed.interestRate;
      if (account.creditLimit === undefined && parsed.creditLimit !== undefined) updates.creditLimit = parsed.creditLimit;
    }
    await db.accounts.update(accountId, updates);
    return { accountId, created, added: toAdd.length, duplicates, statementId };
  });
}

export function merchantLabel(merchant: string, label?: string) {
  return label || prettyMerchant(merchant);
}
