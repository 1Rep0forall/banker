import type { AccountType, ParsedStatement } from '../types';
import { parseAmount } from '../lib/money';
import { parseDate, type DateOrder } from '../lib/dates';

export const KNOWN_INSTITUTIONS = [
  'Chase', 'Bank of America', 'Wells Fargo', 'Citibank', 'Citi', 'Capital One', 'American Express', 'Discover',
  'U.S. Bank', 'US Bank', 'PNC', 'Truist', 'TD Bank', 'Ally', 'Synchrony', 'Barclays', 'USAA', 'Navy Federal',
  'Charles Schwab', 'Schwab', 'Fidelity', 'Vanguard', 'Marcus', 'Goldman Sachs', 'SoFi', 'Chime', 'Citizens',
  'Fifth Third', 'KeyBank', 'Regions', 'Huntington', 'M&T', 'BMO', 'HSBC', 'Santander', 'Varo', 'Discover Bank',
  'Apple Card', 'Navient', 'Nelnet', 'MOHELA', 'Sallie Mae', 'RBC', 'Scotiabank', 'TD Canada Trust', 'CIBC',
  'Barclaycard', 'Lloyds', 'NatWest', 'Monzo', 'Revolut', 'Wise', 'Credit Union',
];

const NORMALIZE_INSTITUTION: Record<string, string> = {
  citi: 'Citibank', 'us bank': 'U.S. Bank', schwab: 'Charles Schwab', 'goldman sachs': 'Marcus',
};

export function detectInstitution(text: string): string | undefined {
  const lower = text.toLowerCase();
  let best: { name: string; idx: number } | undefined;
  for (const name of KNOWN_INSTITUTIONS) {
    const re = new RegExp('\\b' + name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
    const m = re.exec(lower);
    // prefer the earliest mention (usually the letterhead), then the longest name
    if (m && (!best || m.index < best.idx || (m.index === best.idx && name.length > best.name.length))) {
      best = { name, idx: m.index };
    }
  }
  if (!best) return undefined;
  return NORMALIZE_INSTITUTION[best.name.toLowerCase()] ?? best.name;
}

export function detectAccountNumber(text: string): { accountNumber?: string; last4?: string } {
  const patterns = [
    /account (?:number|no\.?|#)[:\s]*((?:[x*•.\-\s]*\d){4,20})/i,
    /(?:ending|ends) in[:\s]*(\d{4})\b/i,
    /card (?:number|no\.?|#)?[:\s]*((?:[x*•\-\s]*\d){4,20})/i,
    /acct(?:\.|ount)?\s*(?:#|no\.?)?[:\s]*((?:[x*•\-\s]*\d){4,20})/i,
    /\b(?:x{2,}|\*{2,}|•{2,})[\s-]?(\d{4})\b/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const raw = m[1].trim();
      const digits = raw.replace(/\D/g, '');
      if (digits.length >= 4) return { accountNumber: raw, last4: digits.slice(-4) };
    }
  }
  return {};
}

export function detectAccountType(text: string): AccountType | undefined {
  const t = text.toLowerCase();
  // Strong signals win outright.
  if (/(credit card|card ?member|minimum payment|credit limit|credit line|purchase apr|cash advance)/.test(t)) return 'credit';
  if (/(principal balance|amount financed|mortgage|payoff amount|escrow|loan balance)/.test(t)) return 'loan';
  // Otherwise the product named first (usually the letterhead) decides, so
  // "Everyday Checking ... transfer to savings" is a checking account.
  const candidates: [AccountType, RegExp][] = [
    ['investment', /(brokerage|investment account|portfolio|holdings|\bira\b|401\(?k)/],
    ['savings', /(savings|money market|high yield|\bapy\b|annual percentage yield)/],
    ['checking', /(checking|debit card|checks paid|\bchk\b)/],
    ['loan', /\bloan\b/],
  ];
  let best: { type: AccountType; idx: number } | undefined;
  for (const [type, re] of candidates) {
    const m = re.exec(t);
    if (m && (!best || m.index < best.idx)) best = { type, idx: m.index };
  }
  return best?.type;
}

const AMOUNT = '(\\(?-?\\$?\\s?[\\d,]+\\.\\d{2}\\)?-?(?:\\s?CR)?)';
const DATE = '([A-Za-z]{3,9}\\.? \\d{1,2},? \\d{4}|\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4}|\\d{4}-\\d{2}-\\d{2})';

function findAmount(text: string, labels: string[]): number | undefined {
  for (const label of labels) {
    // allow a short gap that may contain a date, e.g. "Beginning balance on 11/1 $2,454.12"
    const m = text.match(new RegExp(label + '[^\\n]{0,40}?' + AMOUNT, 'i'));
    if (m) {
      const v = parseAmount(m[1]);
      if (v !== undefined) return v;
    }
  }
  return undefined;
}

function findDate(text: string, labels: string[], order: DateOrder): string | undefined {
  for (const label of labels) {
    const m = text.match(new RegExp(label + '[^\\n\\d]{0,30}' + DATE, 'i'));
    if (m) {
      const d = parseDate(m[1], order);
      if (d) return d;
    }
  }
  return undefined;
}

function findRate(text: string, labels: string[]): number | undefined {
  for (const label of labels) {
    const m =
      text.match(new RegExp(label + '[^\\n%]{0,60}?(\\d{1,2}\\.\\d{1,3})\\s?%', 'i')) ||
      text.match(new RegExp('(\\d{1,2}\\.\\d{1,3})\\s?%[^\\n]{0,10}' + label, 'i'));
    if (m) {
      const v = parseFloat(m[1]);
      if (v > 0 && v < 100) return v;
    }
  }
  return undefined;
}

/** Pull account-level details (period, balances, APR, due date...) out of free text. */
export function extractMeta(text: string, order: DateOrder = 'MDY'): Partial<ParsedStatement> {
  const meta: Partial<ParsedStatement> = {};
  meta.institution = detectInstitution(text);
  Object.assign(meta, detectAccountNumber(text));
  meta.accountType = detectAccountType(text);

  const period =
    text.match(new RegExp(DATE + '\\s*(?:-|–|—|to|through|thru)\\s*' + DATE, 'i'));
  if (period) {
    meta.periodStart = parseDate(period[1], order);
    meta.periodEnd = parseDate(period[2], order);
  }
  if (!meta.periodEnd) meta.periodEnd = findDate(text, ['closing date', 'statement date', 'period ending', 'statement closing date'], order);
  if (meta.periodEnd && !meta.periodStart) {
    meta.periodStart = findDate(text, ['opening date', 'period beginning'], order);
  }

  meta.openingBalance = findAmount(text, [
    'beginning balance', 'opening balance', 'previous balance', 'starting balance', 'balance forward', 'balance last statement',
  ]);
  meta.closingBalance = findAmount(text, [
    'ending balance', 'closing balance', 'new balance', 'current balance', 'balance this statement', 'statement balance',
  ]);
  meta.minimumPayment = findAmount(text, ['minimum payment due', 'minimum amount due', 'minimum payment', 'payment due amount']);
  meta.creditLimit = findAmount(text, ['credit limit', 'credit line', 'total credit line']);
  meta.paymentDueDate = findDate(text, ['payment due date', 'due date', 'payment due'], order);
  meta.interestRate =
    meta.accountType === 'savings'
      ? findRate(text, ['annual percentage yield', 'apy', 'interest rate'])
      : findRate(text, ['purchase apr', 'purchases', 'annual percentage rate', 'apr', 'interest rate', 'apy']);

  for (const k of Object.keys(meta) as (keyof typeof meta)[]) if (meta[k] === undefined) delete meta[k];
  return meta;
}

/** Extract hints from a file name like "Chase_Checking_1234_2024-01.csv". */
export function metaFromFileName(fileName: string): Partial<ParsedStatement> {
  const base = fileName.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ');
  const meta: Partial<ParsedStatement> = {};
  const inst = detectInstitution(base);
  if (inst) meta.institution = inst;
  const m = base.match(/(?:^|\D)(\d{4})(?:\D|$)/g);
  if (m) {
    // last 4-digit group that doesn't look like a year
    const groups = m.map((g) => g.replace(/\D/g, '')).filter((g) => !/^(19|20)\d\d$/.test(g));
    if (groups.length) meta.last4 = groups[groups.length - 1];
  }
  const type = detectAccountType(base);
  if (type) meta.accountType = type;
  return meta;
}
