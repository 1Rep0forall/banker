import Papa from 'papaparse';
import type { ParsedStatement, ParsedTransaction } from '../types';
import { parseAmount, round2 } from '../lib/money';
import { guessDateOrder, parseDate, type DateOrder } from '../lib/dates';
import { metaFromFileName, extractMeta } from './meta';

const H = {
  date: /^(transaction |trans\.? |posted |posting |post |value )?date$|^date posted$|^posting date$|^trans date$|^date$/i,
  description: /^(description|payee|merchant|name|details|transaction description|narrative|memo|particulars)$/i,
  memo: /^(memo|notes?|extended description|reference)$/i,
  amount: /^(amount|transaction amount|amt|value|amount \(\w+\))$/i,
  debit: /^(debit|debits|withdrawal|withdrawals|money out|paid out|withdrawal amount|debit amount|charges?)$/i,
  credit: /^(credit|credits|deposit|deposits|money in|paid in|deposit amount|credit amount|payments?)$/i,
  balance: /^(balance|running balance|running bal\.?|available balance|ledger balance)$/i,
  type: /^(type|transaction type|dr\/cr|debit\/credit|cr\/dr)$/i,
  account: /^(account|account number|account #|acct)$/i,
};

function findCol(headers: string[], re: RegExp, exclude: number[] = []): number {
  return headers.findIndex((h, i) => !exclude.includes(i) && re.test(h.trim()));
}

export function parseCsv(content: string, fileName = '', forcedOrder?: DateOrder): ParsedStatement {
  const warnings: string[] = [];
  const rows = Papa.parse<string[]>(content.trim(), { skipEmptyLines: true }).data;

  // Some banks put a preamble before the header; find the first row that looks like a header.
  let headerIdx = rows.findIndex(
    (r) => r.some((c) => H.date.test(c.trim())) && r.some((c) => H.amount.test(c.trim()) || H.debit.test(c.trim()) || H.credit.test(c.trim())),
  );
  const preamble = headerIdx > 0 ? rows.slice(0, headerIdx).map((r) => r.join(' ')).join('\n') : '';
  if (headerIdx < 0) {
    warnings.push('No header row found; guessing columns as Date, Description, Amount.');
    headerIdx = -1;
  }
  const headers = headerIdx >= 0 ? rows[headerIdx].map((h) => h.trim()) : ['Date', 'Description', 'Amount'];
  const body = rows.slice(headerIdx + 1);

  const c = {
    date: findCol(headers, H.date),
    description: findCol(headers, H.description),
    amount: findCol(headers, H.amount),
    debit: findCol(headers, H.debit),
    credit: findCol(headers, H.credit),
    balance: findCol(headers, H.balance),
    type: findCol(headers, H.type),
    account: findCol(headers, H.account),
  };
  const memoCol = findCol(headers, H.memo, [c.description]);
  if (c.date < 0) throw new Error('Could not find a date column in this CSV.');
  if (c.amount < 0 && c.debit < 0 && c.credit < 0) throw new Error('Could not find an amount column in this CSV.');

  const order = forcedOrder ?? guessDateOrder(body.map((r) => r[c.date] ?? ''));
  const transactions: ParsedTransaction[] = [];
  let skipped = 0;

  for (const r of body) {
    const date = parseDate(r[c.date] ?? '', order);
    if (!date) { skipped++; continue; }
    let amount: number | undefined;
    if (c.amount >= 0) {
      amount = parseAmount(r[c.amount]);
      if (amount !== undefined && c.type >= 0) {
        const t = (r[c.type] ?? '').toLowerCase();
        if (/^(debit|dr|withdrawal|sale|purchase)/.test(t)) amount = -Math.abs(amount);
        else if (/^(credit|cr|deposit|payment|return)/.test(t)) amount = Math.abs(amount);
      }
    } else {
      const debit = parseAmount(r[c.debit]);
      const credit = parseAmount(r[c.credit]);
      if (debit !== undefined || credit !== undefined) amount = round2((credit ? Math.abs(credit) : 0) - (debit ? Math.abs(debit) : 0));
    }
    if (amount === undefined) { skipped++; continue; }
    const desc = [r[c.description], memoCol >= 0 ? r[memoCol] : ''].filter((x) => x && x.trim()).join(' — ').trim();
    transactions.push({
      date,
      description: desc || '(no description)',
      amount,
      balance: c.balance >= 0 ? parseAmount(r[c.balance]) : undefined,
    });
  }
  if (skipped) warnings.push(`Skipped ${skipped} row(s) that had no valid date or amount.`);

  const meta = { ...metaFromFileName(fileName), ...stripUndefined(extractMeta(preamble, order)) };
  if (c.account >= 0 && body[0]?.[c.account]) {
    const digits = body[0][c.account].replace(/\D/g, '');
    if (digits.length >= 4) meta.last4 = digits.slice(-4);
  }

  // Sort oldest -> newest; derive balances when there is a running balance column.
  transactions.sort((a, b) => a.date.localeCompare(b.date));
  const withBal = transactions.filter((t) => t.balance !== undefined);
  const result: ParsedStatement = {
    format: 'csv',
    ...meta,
    periodStart: meta.periodStart ?? transactions[0]?.date,
    periodEnd: meta.periodEnd ?? transactions[transactions.length - 1]?.date,
    transactions,
    warnings,
  };
  if (withBal.length && result.closingBalance === undefined) {
    // The latest running balance; for same-day ties, use the original file order's newest row.
    const latestDate = withBal[withBal.length - 1].date;
    const sameDay = body.filter((r) => parseDate(r[c.date] ?? '', order) === latestDate);
    const firstRowIsNewest = parseDate(body[0]?.[c.date] ?? '', order)! >= parseDate(body[body.length - 1]?.[c.date] ?? '', order)!;
    const pick = firstRowIsNewest ? sameDay[0] : sameDay[sameDay.length - 1];
    result.closingBalance = pick ? parseAmount(pick[c.balance]) : withBal[withBal.length - 1].balance;
  }
  return result;
}

function stripUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}
