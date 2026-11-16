import type { AccountType, ParsedStatement, ParsedTransaction } from '../types';
import { parseAmount } from '../lib/money';
import { parseDate } from '../lib/dates';
import { detectInstitution } from './meta';

/** Read a tag value from SGML-ish (unclosed) or XML OFX. */
function tag(src: string, name: string): string | undefined {
  const m = src.match(new RegExp('<' + name + '>([^<\\r\\n]*)', 'i'));
  return m ? m[1].trim() : undefined;
}

function blocks(src: string, name: string): string[] {
  const re = new RegExp('<' + name + '>([\\s\\S]*?)(?=</' + name + '>|<' + name + '>|</BANKTRANLIST>)', 'gi');
  return [...src.matchAll(re)].map((m) => m[1]);
}

const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'");

export function parseOfx(content: string): ParsedStatement {
  const warnings: string[] = [];
  const isCard = /<CCSTMTRS>|<CREDITCARDMSGSRSV1>/i.test(content);
  const acctType = tag(content, 'ACCTTYPE')?.toUpperCase();
  let accountType: AccountType = isCard ? 'credit' : 'checking';
  if (acctType === 'SAVINGS' || acctType === 'MONEYMRKT') accountType = 'savings';
  if (acctType === 'CREDITLINE') accountType = 'credit';
  if (/<INVSTMTRS>/i.test(content)) accountType = 'investment';

  const acctId = tag(content, 'ACCTID');
  const org = tag(content, 'ORG');
  const transactions: ParsedTransaction[] = [];

  for (const b of blocks(content, 'STMTTRN')) {
    const date = parseDate((tag(b, 'DTPOSTED') ?? tag(b, 'DTUSER') ?? '').slice(0, 8));
    const amount = parseAmount(tag(b, 'TRNAMT'));
    if (!date || amount === undefined) continue;
    const name = decode(tag(b, 'NAME') ?? tag(b, 'PAYEE') ?? '');
    const memo = decode(tag(b, 'MEMO') ?? '');
    const description = name && memo && !memo.toLowerCase().includes(name.toLowerCase()) ? `${name} — ${memo}` : name || memo || '(no description)';
    transactions.push({ date, description, amount, externalId: tag(b, 'FITID') });
  }
  transactions.sort((a, b) => a.date.localeCompare(b.date));
  if (!transactions.length) warnings.push('No transactions found in this OFX/QFX file.');

  const ledger = content.match(/<LEDGERBAL>([\s\S]*?)(?:<\/LEDGERBAL>|<AVAILBAL>|$)/i)?.[1] ?? '';
  let closing = parseAmount(tag(ledger, 'BALAMT'));
  // OFX credit card balances are negative when you owe money; we store the amount owed as positive.
  if (closing !== undefined && accountType === 'credit') closing = -closing;

  return {
    format: 'ofx',
    institution: (org && (detectInstitution(org) ?? org)) || undefined,
    accountNumber: acctId,
    last4: acctId?.replace(/\D/g, '').slice(-4) || undefined,
    accountType,
    currency: tag(content, 'CURDEF'),
    periodStart: parseDate((tag(content, 'DTSTART') ?? '').slice(0, 8)) ?? transactions[0]?.date,
    periodEnd: parseDate((tag(content, 'DTEND') ?? '').slice(0, 8)) ?? transactions[transactions.length - 1]?.date,
    closingBalance: closing,
    transactions,
    warnings,
  };
}
