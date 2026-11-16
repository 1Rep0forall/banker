import type { AccountType, ParsedStatement, ParsedTransaction } from '../types';
import { parseAmount, round2 } from '../lib/money';
import { parseDate, type DateOrder } from '../lib/dates';
import { extractMeta } from './meta';

const LEAD_DATE =
  /^(\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?|\d{4}-\d{2}-\d{2}|[A-Za-z]{3}\.? \d{1,2}(?:,? \d{4})?|\d{1,2} [A-Za-z]{3}(?: \d{2,4})?)\s+/;
const AMT = String.raw`\(?-?\$?\s?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}\)?-?(?:\s?CR)?`;
const TRAILING_AMOUNTS = new RegExp(`\\s+(${AMT})(?:\\s+(${AMT}))?\\s*$`, 'i');

const SKIP = /\b(beginning balance|ending balance|opening balance|closing balance|previous balance|new balance|balance forward|total|subtotal|daily balance|average balance|minimum payment|payment due|credit limit|available credit|page \d)/i;

type Section = 'in' | 'out' | undefined;

function sectionFor(line: string, type: AccountType | undefined): Section | null {
  const l = line.toLowerCase().trim();
  if (l.length > 60 || /\d+\.\d{2}/.test(l)) return null; // headers don't carry amounts
  const credit = type === 'credit';
  if (credit) {
    if (/^(payments?|credits?|payments,? credits|payments and (other )?credits|other credits)/.test(l)) return 'in';
    if (/^(purchases?|fees?|interest charged|cash advances?|transactions|balance transfers?|charges)/.test(l)) return 'out';
  } else {
    if (/^(deposits?|additions|credits?|other credits|deposits and (other )?(additions|credits)|electronic deposits|money in)/.test(l)) return 'in';
    if (/^(withdrawals?|debits?|checks?( paid)?|electronic (withdrawals|payments|debits)|atm (&|and) debit|card purchases|purchases|fees|other (withdrawals|debits|subtractions)|subtractions|money out|payments)/.test(l)) return 'out';
  }
  return null;
}

const INFLOW_WORDS = /\b(deposit|payroll|direct dep|salary|transfer from|refund|interest (paid|earned)|credit|reversal|cashback|payment received|payment thank you|thank you)\b/i;

/**
 * Parse statement text (from a PDF or pasted text). Lines are expected in reading order.
 */
export function parseStatementText(text: string, order: DateOrder = 'MDY', format: 'pdf' | 'image' | 'text' = 'text', ocr = false): ParsedStatement {
  const warnings: string[] = [];
  if (ocr) text = cleanOcrText(text);
  const meta = extractMeta(text, order);
  const type = meta.accountType;
  const endYear = meta.periodEnd ? +meta.periodEnd.slice(0, 4) : new Date().getFullYear();
  const endMonth = meta.periodEnd ? +meta.periodEnd.slice(5, 7) : 12;

  const transactions: ParsedTransaction[] = [];
  let section: Section;
  let prevBalance = meta.openingBalance;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    const sec = sectionFor(line, type);
    if (sec !== null) { section = sec; continue; }

    const dm = line.match(LEAD_DATE);
    if (!dm) continue;
    let rest = line.slice(dm[0].length);
    // optional second (posting) date
    const dm2 = rest.match(LEAD_DATE);
    if (dm2) rest = rest.slice(dm2[0].length);
    const am = rest.match(TRAILING_AMOUNTS);
    if (!am) continue;
    const description = rest.slice(0, am.index).trim();
    if (!description || SKIP.test(description)) continue;

    let date = parseDate(dm[1], order, endYear);
    if (!date) continue;
    // A December transaction in a January statement belongs to the previous year.
    if (!/\d{4}/.test(dm[1]) && +date.slice(5, 7) > endMonth + 1) date = parseDate(dm[1], order, endYear - 1)!;

    const first = parseAmount(am[1])!;
    const balance = am[2] ? parseAmount(am[2]) : undefined;
    const explicitSign = /^\(|^-|-$|CR$/i.test(am[1].trim());
    let amount: number;

    if (type === 'credit') {
      // On card statements charges are positive and payments/credits negative or marked CR.
      if (section === 'in') amount = Math.abs(first);
      else if (section === 'out') amount = -Math.abs(first);
      else amount = explicitSign ? Math.abs(first) : INFLOW_WORDS.test(description) ? Math.abs(first) : -Math.abs(first);
    } else if (balance !== undefined && prevBalance !== undefined) {
      const delta = round2(balance - prevBalance);
      amount = Math.abs(delta - Math.abs(first)) < 0.01 ? Math.abs(first) : Math.abs(delta + Math.abs(first)) < 0.01 ? -Math.abs(first) : sectionSign(section, first, description, explicitSign);
    } else {
      amount = sectionSign(section, first, description, explicitSign);
    }
    if (balance !== undefined) prevBalance = balance;
    transactions.push({ date, description, amount: round2(amount), balance });
  }

  if (!transactions.length) {
    warnings.push(
      text.trim().length < 50
        ? 'No readable text found. This might be a scanned image — try downloading a CSV, OFX or QFX export from your bank instead.'
        : "Couldn't find any transaction lines in this statement. Try a CSV/OFX export from your bank.",
    );
  }
  transactions.sort((a, b) => a.date.localeCompare(b.date));
  if (meta.openingBalance !== undefined && meta.closingBalance !== undefined && transactions.length) {
    const sum = round2(transactions.reduce((s, t) => s + t.amount, 0));
    const expected = round2(type === 'credit' ? meta.openingBalance - meta.closingBalance : meta.closingBalance - meta.openingBalance);
    if (Math.abs(sum - expected) > 0.01) {
      warnings.push(
        `Transactions add up to ${sum.toFixed(2)} but the statement balances change by ${expected.toFixed(2)}. Some lines may have been missed or have the wrong sign — please review.`,
      );
    }
  }

  return {
    format,
    ocr: ocr || undefined,
    ...meta,
    periodStart: meta.periodStart ?? transactions[0]?.date,
    periodEnd: meta.periodEnd ?? transactions[transactions.length - 1]?.date,
    transactions,
    warnings,
  };
}

function sectionSign(section: Section, value: number, description: string, explicitSign: boolean): number {
  if (section === 'in') return Math.abs(value);
  if (section === 'out') return -Math.abs(value);
  if (explicitSign) return value;
  return INFLOW_WORDS.test(description) ? Math.abs(value) : -Math.abs(value);
}

/**
 * Fix the most common OCR mistakes in numbers and dates without touching words:
 * "S1,234.S6" -> "$1,234.56", "l2/O5" -> "12/05", "45 .00" -> "45.00", "12,34" (misread dot) -> "12.34".
 */
export function cleanOcrText(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/[|]/g, ' ')
        .replace(/[—–]/g, '-')
        // join amounts split around the decimal point: "1,234 .56" / "1,234. 56"
        .replace(/(\d)\s+\.(\d{2})\b/g, '$1.$2')
        .replace(/(\d)\.\s+(\d{2})\b/g, '$1.$2')
        // numeric-looking tokens: fix letters that OCR confuses with digits
        .replace(/(^|\s)([$S]?\(?-?[$S]?[\dOoIlBS,./()-]*\d[\dOoIlBS,./()-]*)(?=\s|$)/g, (_m, pre: string, tok: string) => {
          let t = tok.replace(/^\(?-?S(?=[\dOoIl])/, (x) => x.replace('S', '$'));
          const digits = (t.match(/\d/g) ?? []).length;
          const letters = (t.match(/[OoIlBS]/g) ?? []).length;
          if (digits >= 2 && letters <= 2) {
            t = t.replace(/(?<=[\d,./])[Oo]|[Oo](?=[\d,./])/g, '0').replace(/[Il](?=[\d,./])|(?<=[\d,./])[Il]/g, '1').replace(/(?<=[\d.,])S|S(?=\d)/g, '5').replace(/(?<=\d)B|B(?=\d)/g, '8');
          }
          // A comma followed by exactly two digits at the end of an amount is a misread decimal point.
          t = t.replace(/^(\$?\(?-?\$?\d{1,3}(?:[,.]\d{3})*),(\d{2}\)?-?)$/, '$1.$2');
          return pre + t;
        }),
    )
    .join('\n');
}
