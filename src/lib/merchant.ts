const PREFIXES = [
  'pos purchase', 'pos debit', 'pos', 'debit card purchase', 'debit card', 'dbt crd', 'checkcard', 'check card',
  'purchase authorized on', 'purchase', 'recurring payment authorized on', 'recurring payment', 'recurring',
  'ach debit', 'ach credit', 'ach', 'electronic payment', 'online payment', 'preauthorized debit', 'pre-auth',
  'visa', 'mc', 'sq \\*', 'sq', 'tst\\*', 'tst', 'pp\\*', 'paypal \\*', 'paypal', 'withdrawal', 'deposit',
];

/**
 * Reduce a raw bank description to a stable merchant key, e.g.
 * "POS PURCHASE NETFLIX.COM 866-579-7172 CA 01/15" -> "netflix.com"
 */
export function normalizeMerchant(description: string): string {
  let s = description.toLowerCase();
  s = s.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i++) {
    for (const p of PREFIXES) s = s.replace(new RegExp('^' + p + '\\b[\\s*#:-]*'), '');
    s = s.replace(/^\d{1,2}\/\d{1,2}(\/\d{2,4})?\s+/, '');
  }
  s = s
    .replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, ' ') // dates
    .replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, ' ') // phone numbers
    .replace(/(?:#|\bx+|\*+)\s*\w*\d\w*/g, ' ') // #1234, xxxx1234, *ref
    .replace(/\b(?:id|ref|conf|trace|ppd|web|ccd|tel|card)\b[:#]?\s*\S*/g, ' ')
    .replace(/\b[a-z]*\d{4,}[a-z0-9]*\b/g, ' ') // long reference ids
    .replace(/\b\d+\b/g, ' ')
    .replace(/\s+\b[a-z]{2}\b\s*$/, '') // trailing state code
    .replace(/[^a-z0-9.&' ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = s.split(' ').filter(Boolean).slice(0, 3);
  return words.join(' ') || description.toLowerCase().trim().slice(0, 30);
}

/** Make a merchant key look nice for display: "netflix.com" -> "Netflix.com" */
export function prettyMerchant(key: string): string {
  return key.replace(/(^|[\s&'-])([a-z])/g, (_, pre, c) => pre + c.toUpperCase());
}
