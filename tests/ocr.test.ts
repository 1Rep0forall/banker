import { describe, expect, it } from 'vitest';
import { cleanOcrText, parseStatementText } from '../src/parsers/text';

// Real Tesseract output from a blurry, tilted photo of a (fake) checking statement.
const PHOTO = `Wells Fargo

Everyday Checking Account number: 8812045519

Statement period: 11/01/2026 to 11/15/2026

Beginning balance on 11/1 $2,454.12

Ending balance on 11/15 $4,167.34

Transaction history
11/01         ONLINE TRANSFER TO SAVINGS                                     300.00              2,154.12
11/03         PAYROLL DEPOSIT GLOBEX INC                                2,210.45            4,364.57
11/04         KROGER #0442                                                                93.18             4271.39
11/07        COMCAST CABLE COMM                                         89.99           4,181.40
11/10         CVS/PHARMACY #0811                                                    14.06            4,167.34`;

describe('OCR statements', () => {
  it('fixes common OCR misreads in numbers but leaves words alone', () => {
    expect(cleanOcrText('l2/O5 SHELL OIL S1,234.S6')).toBe('12/05 SHELL OIL $1,234.56');
    expect(cleanOcrText('11/04 KROGER 93 .18 4,271. 39')).toBe('11/04 KROGER 93.18 4,271.39');
    expect(cleanOcrText('11/04 STARBUCKS 12,34')).toBe('11/04 STARBUCKS 12.34');
    expect(cleanOcrText('BOOKS & SOCKS 1,234.56')).toBe('BOOKS & SOCKS 1,234.56');
  });

  it('parses a photographed checking statement, using running balances for signs', () => {
    const p = parseStatementText(PHOTO, 'MDY', 'image', true);
    expect(p.ocr).toBe(true);
    expect(p.institution).toBe('Wells Fargo');
    expect(p.accountType).toBe('checking');
    expect(p.last4).toBe('5519');
    expect(p.openingBalance).toBe(2454.12);
    expect(p.closingBalance).toBe(4167.34);
    expect(p.transactions.map((t) => t.amount)).toEqual([-300, 2210.45, -93.18, -89.99, -14.06]);
    expect(p.warnings).toEqual([]);
  });

  it('still parses when OCR garbles digits', () => {
    const garbled = PHOTO.replace('2,210.45', '2,2l0.45').replace('11/07', 'l1/O7').replace('14.06', '14 .06');
    const p = parseStatementText(garbled, 'MDY', 'image', true);
    expect(p.transactions.map((t) => [t.date, t.amount])).toContainEqual(['2026-11-07', -89.99]);
    expect(p.transactions.map((t) => t.amount)).toEqual([-300, 2210.45, -93.18, -89.99, -14.06]);
  });
});
