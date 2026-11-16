const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const pad = (n: number) => String(n).padStart(2, '0');

export function iso(y: number, m: number, d: number): string | undefined {
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return undefined; // e.g. Feb 30
  return `${y}-${pad(m)}-${pad(d)}`;
}

function fullYear(y: number): number {
  if (y >= 100) return y;
  return y + (y >= 70 ? 1900 : 2000);
}

export type DateOrder = 'MDY' | 'DMY';

/**
 * Parse common statement date formats into YYYY-MM-DD.
 * `fallbackYear` is used for dates without a year (e.g. "01/15" or "Jan 15").
 */
export function parseDate(raw: string, order: DateOrder = 'MDY', fallbackYear?: number): string | undefined {
  const s = raw.trim().replace(/\s+/g, ' ');
  let m: RegExpMatchArray | null;

  // 2024-01-15, 2024/01/15, 20240115 (OFX)
  if ((m = s.match(/^(\d{4})[-/.]?(\d{2})[-/.]?(\d{2})/))) return iso(+m[1], +m[2], +m[3]);

  // 01/15/2024, 15/01/24, 1-15-2024
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/))) {
    let [a, b] = [+m[1], +m[2]];
    const y = fullYear(+m[3]);
    if (order === 'DMY' || a > 12) [a, b] = [b, a];
    return iso(y, a, b);
  }

  // 01/15 (no year)
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})$/)) && fallbackYear) {
    let [a, b] = [+m[1], +m[2]];
    if (order === 'DMY' || a > 12) [a, b] = [b, a];
    return iso(fallbackYear, a, b);
  }

  // Jan 15, 2024 / January 15 2024 / Jan 15
  if ((m = s.match(/^([A-Za-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?,? ?(\d{2,4})?$/))) {
    const mo = MONTHS[m[1].slice(0, 4).toLowerCase()] ?? MONTHS[m[1].slice(0, 3).toLowerCase()];
    const y = m[3] ? fullYear(+m[3]) : fallbackYear;
    if (mo && y) return iso(y, mo, +m[2]);
  }

  // 15 Jan 2024 / 15-Jan-24 / 15 Jan
  if ((m = s.match(/^(\d{1,2})[ -]([A-Za-z]{3,9})\.?[ -]?(\d{2,4})?$/))) {
    const mo = MONTHS[m[2].slice(0, 4).toLowerCase()] ?? MONTHS[m[2].slice(0, 3).toLowerCase()];
    const y = m[3] ? fullYear(+m[3]) : fallbackYear;
    if (mo && y) return iso(y, mo, +m[1]);
  }
  return undefined;
}

/** Guess whether a set of slash dates are MDY or DMY. */
export function guessDateOrder(samples: string[]): DateOrder {
  let mdy = 0;
  let dmy = 0;
  for (const s of samples) {
    const m = s.trim().match(/^(\d{1,2})[/.-](\d{1,2})/);
    if (!m) continue;
    if (+m[1] > 12) dmy++;
    if (+m[2] > 12) mdy++;
  }
  return dmy > mdy ? 'DMY' : 'MDY';
}

export const toDate = (isoDate: string) => new Date(isoDate + 'T00:00:00Z');

export function todayISO(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function addDays(isoDate: string, days: number): string {
  const d = toDate(isoDate);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addMonths(isoDate: string, months: number): string {
  const d = toDate(isoDate);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86400000);
}
