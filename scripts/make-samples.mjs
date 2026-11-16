// Generates FAKE demo statements in ./samples (CSV checking, OFX savings, PDF credit card).
// Usage: node scripts/make-samples.mjs   (PDF generation needs Playwright + Chromium)
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

mkdirSync('samples', { recursive: true });
const months = ['2026-08', '2026-09', '2026-10'];
const fmt = (n) => n.toFixed(2);
const mdy = (iso) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;

// Checking CSV, one file per month, newest-first like many banks export
let bal = 1850;
const paydays = ['2026-08-07', '2026-08-21', '2026-09-04', '2026-09-18', '2026-10-02', '2026-10-16', '2026-10-30'];
for (const m of months) {
  const rows = [
    [`${m}-01`, 'ACH DEBIT SUNRISE APTS RENT', -1450],
    [`${m}-03`, 'POS PURCHASE NETFLIX.COM 866-579-7172 CA', m === '2026-10' ? -17.99 : -15.49],
    [`${m}-06`, 'SPOTIFY USA 8775778', -11.99],
    [`${m}-09`, 'DUKE ENERGY PAYMENT', m === '2026-08' ? -142.1 : m === '2026-09' ? -128.44 : -97.3],
    [`${m}-11`, 'WHOLE FOODS MARKET #10231', -86.12],
    [`${m}-14`, 'STARBUCKS STORE 0381', -6.45],
    [`${m}-18`, 'VERIZON WIRELESS PAYMENTS', -75],
    [`${m}-22`, 'CAPITAL ONE CRCARDPMT', -250],
    [`${m}-24`, 'SHELL OIL 57442', -41.2],
    [`${m}-26`, 'PLANET FITNESS CLUB FEE', -24.99],
    ...paydays.filter((d) => d.startsWith(m)).map((d) => [d, 'ACME CORP PAYROLL DIR DEP', 1625]),
  ];
  if (m === '2026-10') {
    rows.push(['2026-10-12', 'OVERDRAFT FEE', -35], ['2026-10-20', 'HULU 877-8244858 CA', -9.99], ['2026-10-21', 'DOORDASH*THAI', -38.5], ['2026-10-22', 'DOORDASH*THAI', -38.5]);
  }
  if (m === '2026-09') rows.push(['2026-09-20', 'HULU 877-8244858 CA', -9.99]);
  rows.sort((a, b) => a[0].localeCompare(b[0]));
  const out = rows.map(([d, desc, amt]) => { bal += amt; return [mdy(d), desc, fmt(amt), fmt(bal)]; }).reverse();
  const lines = ['Posting Date,Description,Amount,Balance', ...out.map((r) => r.join(','))];
  writeFileSync(`samples/Chase_Checking_4821_${m}.csv`, lines.join('\n'));
}

// Savings OFX
const ofxTx = months.map((m, i) => {
  const ym = m.replace('-', '');
  return `<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>${ym}15<TRNAMT>200.00<FITID>S${i}A<NAME>TRANSFER FROM CHECKING</STMTTRN>
<STMTTRN><TRNTYPE>INT<DTPOSTED>${ym}28<TRNAMT>${fmt(14 + i * 0.6)}<FITID>S${i}B<NAME>INTEREST PAID</STMTTRN>`;
}).join('\n');
writeFileSync('samples/Ally_Savings_9911.ofx', `OFXHEADER:100
DATA:OFXSGML
<OFX><SIGNONMSGSRSV1><SONRS><FI><ORG>Ally Bank</ORG></FI></SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>USD
<BANKACCTFROM><BANKID>124003116<ACCTID>2087739911<ACCTTYPE>SAVINGS</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20260801<DTEND>20261031
${ofxTx}
</BANKTRANLIST><LEDGERBAL><BALAMT>4642.40<DTASOF>20261031</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`);

// Credit card statements: October as a normal (text) PDF, September as a SCANNED image-only PDF for OCR.
const row = (d, n, a) => `<tr><td>${d}</td><td style="width:340px">${n}</td><td>${a}</td></tr>`;
const cardHtml = ({ cycle, prev, next, due, payment, tx }) => `<html><body style="font-family:Helvetica;font-size:13px;padding:30px;background:#fff">
<h2>Capital One Quicksilver</h2>
<p>Account ending in 7730</p>
<p>Billing Cycle: ${cycle}</p>
<table style="width:420px">
<tr><td>Previous Balance</td><td>$${prev}</td></tr>
<tr><td>New Balance</td><td>$${next}</td></tr>
<tr><td>Minimum Payment Due</td><td>$40.00</td></tr>
<tr><td>Payment Due Date</td><td>${due}</td></tr>
<tr><td>Credit Limit</td><td>$3,000.00</td></tr></table>
<h3>Payments, Credits and Adjustments</h3>
<table style="width:520px">${row(payment, 'PAYMENT - THANK YOU', '-$250.00')}</table>
<h3>Transactions</h3>
<table style="width:520px">${tx.map(([d, n, a]) => row(d, n, '$' + fmt(a))).join('')}</table>
<h3>Interest Charge Calculation</h3>
<p>Purchases 27.49% APR</p></body></html>`;

const october = cardHtml({
  cycle: '10/01/2026 - 10/31/2026', prev: '1,520.00', next: '1,623.27', due: '11/25/2026', payment: '10/22',
  tx: [
    ['10/06', 'AMAZON MKTPLACE PMTS', 64.18], ['10/09', 'ADOBE *CREATIVE CLOUD', 59.99], ['10/13', 'TRADER JOE S #552', 72.4],
    ['10/17', 'UBER *TRIP', 23.1], ['10/22', 'TARGET 00012345', 118.75], ['10/27', 'CHIPOTLE 2210', 14.85],
  ],
});
const september = cardHtml({
  cycle: '09/01/2026 - 09/30/2026', prev: '1,480.00', next: '1,520.00', due: '10/25/2026', payment: '09/22',
  tx: [
    ['09/05', 'COSTCO WHSE #0481', 132.66], ['09/09', 'ADOBE *CREATIVE CLOUD', 59.99], ['09/14', 'SHELL OIL 57442', 38.1],
    ['09/19', 'PANERA BREAD #601', 18.25], ['09/28', 'AMAZON MKTPLACE PMTS', 41.0],
  ],
});

try {
  // require() honours NODE_PATH, so a globally installed Playwright works too
  const { chromium } = createRequire(import.meta.url)('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 800, height: 1000 }, deviceScaleFactor: 2 });
  await page.setContent(october);
  await page.pdf({ path: 'samples/CapitalOne_Statement_Oct2026.pdf' });

  // "Scan": screenshot with a slight tilt, blur and grey tone, then put only the image in a PDF (no text layer).
  const scanStyle = 'filter:grayscale(1) blur(0.4px) contrast(0.9);transform:rotate(0.6deg);transform-origin:top left;';
  await page.setContent(september.replace('<body style="', '<body style="' + scanStyle));
  const img = await page.screenshot({ fullPage: true, type: 'jpeg', quality: 70 });
  await page.setContent(`<html><body style="margin:0"><img style="width:100%" src="data:image/jpeg;base64,${img.toString('base64')}"></body></html>`);
  await page.pdf({ path: 'samples/CapitalOne_SCANNED_Sep2026.pdf', printBackground: true });
  await browser.close();
} catch (e) {
  console.warn('Skipped PDF samples (Playwright not available):', e.message);
}
console.log('Samples written to ./samples');
