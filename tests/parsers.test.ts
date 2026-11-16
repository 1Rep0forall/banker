import { describe, expect, it } from 'vitest';
import { parseCsv } from '../src/parsers/csv';
import { parseOfx } from '../src/parsers/ofx';
import { parseStatementText } from '../src/parsers/text';
import { parseAmount } from '../src/lib/money';
import { parseDate } from '../src/lib/dates';
import { normalizeMerchant } from '../src/lib/merchant';
import { categorize } from '../src/lib/categorize';

describe('money & dates', () => {
  it('parses amount formats', () => {
    expect(parseAmount('$1,234.56')).toBe(1234.56);
    expect(parseAmount('(45.00)')).toBe(-45);
    expect(parseAmount('12.50-')).toBe(-12.5);
    expect(parseAmount('-$9.99')).toBe(-9.99);
    expect(parseAmount('1.234,56')).toBe(1234.56);
    expect(parseAmount('100.00 CR')).toBe(100);
    expect(parseAmount('abc')).toBeUndefined();
  });
  it('parses date formats', () => {
    expect(parseDate('01/15/2024')).toBe('2024-01-15');
    expect(parseDate('15/01/2024')).toBe('2024-01-15');
    expect(parseDate('15/01/24', 'DMY')).toBe('2024-01-15');
    expect(parseDate('2024-03-02')).toBe('2024-03-02');
    expect(parseDate('20240302120000[-5:EST]')).toBe('2024-03-02');
    expect(parseDate('Jan 5, 2024')).toBe('2024-01-05');
    expect(parseDate('03/04', 'MDY', 2023)).toBe('2023-03-04');
    expect(parseDate('02/30/2024')).toBeUndefined();
  });
  it('normalizes merchants', () => {
    expect(normalizeMerchant('POS PURCHASE NETFLIX.COM 866-579-7172 CA')).toBe('netflix.com');
    expect(normalizeMerchant('NETFLIX.COM 01/15 #12345')).toBe('netflix.com');
    expect(normalizeMerchant('SPOTIFY USA 123456789')).toBe('spotify usa');
    expect(categorize('NETFLIX.COM', -15.49)).toBe('Subscriptions');
    expect(categorize('ACME CORP PAYROLL', 2000)).toBe('Income');
    expect(categorize('OVERDRAFT FEE', -35)).toBe('Fees & Interest');
  });
});

describe('CSV', () => {
  it('handles single amount column', () => {
    const csv = `Date,Description,Amount,Balance
01/03/2024,PAYROLL ACME,2000.00,2500.00
01/05/2024,NETFLIX.COM,-15.49,2484.51`;
    const p = parseCsv(csv, 'Chase_Checking_4821.csv');
    expect(p.transactions).toHaveLength(2);
    expect(p.transactions[1]).toMatchObject({ date: '2024-01-05', amount: -15.49 });
    expect(p.institution).toBe('Chase');
    expect(p.last4).toBe('4821');
    expect(p.accountType).toBe('checking');
    expect(p.closingBalance).toBe(2484.51);
  });
  it('handles debit/credit columns, preamble and newest-first order', () => {
    const csv = `Account Name: Ally Savings
Account Number: xxxxxx9911
Posted Date,Payee,Withdrawal,Deposit,Running Balance
2024-02-10,Interest Paid,,1.25,5001.25
2024-02-01,Transfer to checking,500.00,,5000.00`;
    const p = parseCsv(csv, 'export.csv');
    expect(p.transactions.map((t) => t.amount)).toEqual([-500, 1.25]);
    expect(p.last4).toBe('9911');
    expect(p.institution).toBe('Ally');
    expect(p.accountType).toBe('savings');
    expect(p.closingBalance).toBe(5001.25);
  });
});

describe('OFX', () => {
  it('parses SGML credit card OFX', () => {
    const ofx = `OFXHEADER:100
<OFX><SIGNONMSGSRSV1><SONRS><FI><ORG>Capital One</ORG></FI></SONRS></SIGNONMSGSRSV1>
<CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CURDEF>USD
<CCACCTFROM><ACCTID>5555444433331234</CCACCTFROM>
<BANKTRANLIST><DTSTART>20240101<DTEND>20240131
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20240105120000<TRNAMT>-42.10<FITID>A1<NAME>SHELL OIL 1234</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20240120<TRNAMT>200.00<FITID>A2<NAME>PAYMENT THANK YOU</STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>-842.10<DTASOF>20240131</LEDGERBAL></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`;
    const p = parseOfx(ofx);
    expect(p.accountType).toBe('credit');
    expect(p.last4).toBe('1234');
    expect(p.institution).toBe('Capital One');
    expect(p.closingBalance).toBe(842.1);
    expect(p.transactions.map((t) => t.amount)).toEqual([-42.1, 200]);
    expect(p.periodEnd).toBe('2024-01-31');
  });
});

describe('PDF/text statements', () => {
  it('parses a checking statement with running balances', () => {
    const text = `Wells Fargo Everyday Checking
Account number: 1234567890
Statement period: 12/15/2023 - 01/14/2024
Beginning balance on 12/15 $1,000.00
Ending balance on 1/14 $2,950.00
Transaction history
12/20 Netflix.com 866-579-7172 CA 15.49 984.51
12/29 Acme Payroll Dir Dep 2,000.00 2,984.51
01/02 Shell Oil 57442 34.51 2,950.00`;
    const p = parseStatementText(text);
    expect(p.institution).toBe('Wells Fargo');
    expect(p.last4).toBe('7890');
    expect(p.accountType).toBe('checking');
    expect(p.transactions.map((t) => [t.date, t.amount])).toEqual([
      ['2023-12-20', -15.49],
      ['2023-12-29', 2000],
      ['2024-01-02', -34.51],
    ]);
    expect(p.warnings).toEqual([]);
  });
  it('parses a credit card statement with sections and APR', () => {
    const text = `Chase Freedom
Account Number: XXXX XXXX XXXX 4417
Opening/Closing Date 02/04/24 - 03/03/24
Previous Balance $500.00
New Balance $612.30
Payment Due Date: 03/28/24
Minimum Payment Due: $35.00
Credit Limit $5,000
PAYMENTS AND OTHER CREDITS
02/15 Payment Thank You-Mobile -200.00
PURCHASE
02/06 SPOTIFY USA 11.99
02/20 WHOLE FOODS MARKET 300.31
Purchases 24.99% (v)(d) $612.30`;
    const p = parseStatementText(text);
    expect(p.accountType).toBe('credit');
    expect(p.last4).toBe('4417');
    expect(p.paymentDueDate).toBe('2024-03-28');
    expect(p.minimumPayment).toBe(35);
    expect(p.interestRate).toBe(24.99);
    expect(p.closingBalance).toBe(612.3);
    expect(p.transactions.map((t) => t.amount)).toEqual([-11.99, 200, -300.31]);
    expect(p.warnings).toEqual([]);
  });
});
