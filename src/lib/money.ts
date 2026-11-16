/**
 * Parse a money string. Handles "$1,234.56", "-1,234.56", "(1,234.56)", "1,234.56-",
 * "1.234,56" (EU), "1,234.56 CR" / "DR".
 */
export function parseAmount(raw: string | number | undefined | null): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined;
  let s = raw.trim();
  if (!s) return undefined;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (/(?:^|\s)(DR|DEBIT)$/i.test(s)) { negative = true; s = s.replace(/\s*(DR|DEBIT)$/i, ''); }
  s = s.replace(/\s*(CR|CREDIT)$/i, '');
  if (s.endsWith('-')) { negative = true; s = s.slice(0, -1); }
  if (s.startsWith('-') || s.startsWith('−')) { negative = !negative; s = s.slice(1); }
  if (s.startsWith('+')) s = s.slice(1);
  s = s.replace(/[$€£¥\s]|USD|CAD|EUR|GBP|AUD/gi, '');
  if (s.startsWith('-')) { negative = !negative; s = s.slice(1); }
  // EU format: 1.234,56
  if (/^\d{1,3}(\.\d{3})*,\d{2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  if (!/^\d*\.?\d+$/.test(s)) return undefined;
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return undefined;
  return round2(negative ? -n : n);
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function formatMoney(n: number | undefined, currency = 'USD', opts: { sign?: boolean } = {}): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '—';
  const f = new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 });
  const s = f.format(Math.abs(n));
  if (n < 0) return '−' + s;
  return opts.sign && n > 0 ? '+' + s : s;
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
