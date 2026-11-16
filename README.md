# Banker

A private, local-first web app that **reads your bank statements and keeps your accounts organised for you**. It's designed to be ADHD-friendly: one clear "do this next" item, plain-language reminders, and no spreadsheets to maintain.

## What it does

- **Scan statements**: drop in **PDF, CSV, OFX, or QFX** files from any bank or credit card.
- **Creates or continues accounts on its own**: each statement is matched to an existing account by account number (last 4 digits), bank name, account type, and transactions it has already seen. If nothing matches, a new account is created. Either way you can override the choice before importing.
- **Never double-counts**: re-importing the same or an overlapping statement skips transactions already on file.
- **Tracks what matters**:
  - Balances over time, net worth, and **safe to spend** until your next payday
  - **Recurring** subscriptions, bills, and paychecks (detected automatically), with the next date for each
  - **Price increases** on subscriptions, **new** subscriptions you may have forgotten about, and a "want to cancel" reminder
  - **Credit card due dates** and minimum payments, **APR / APY**, estimated **monthly interest cost**, and **credit utilisation**
  - **Fees** (overdraft, late fees, interest charges), **possible double charges**, and large purchases
  - Reminders when an account hasn't been updated in a while
  - Spending by category this month compared with last month
- **Private**: all data lives in your browser (IndexedDB). Nothing is uploaded anywhere. You can export or restore a JSON backup and export your transactions as CSV.

## Running it

```bash
npm install
npm run dev
```

Then open the URL it prints (usually http://localhost:5173).

Other scripts:

```bash
npm test          # parser, matching, recurring-detection tests
npm run build     # type-check and build a static site to dist/
```

The build is a fully static site, so `dist/` can be hosted anywhere (GitHub Pages, Netlify, or just opened locally through `npm run preview`).

### Try it with demo data

`samples/` contains **fake** statements: three months of checking CSVs, a savings OFX, and a credit card PDF. Import the October checking CSV first (it creates the account), then August and September (they're added to the same account), then the others (each creates a new account).

To regenerate them: `node scripts/make-samples.mjs` (the PDF needs Playwright).

## Tips for best results

- **CSV, OFX, and QFX exports are the most accurate.** Most banks offer them under "Download transactions".
- PDFs are read from their text layer. **Scanned or photographed PDFs won't work yet** (no OCR).
- If a PDF's money in and money out look reversed, tick **"Flip money in/out"** in the import preview.
- Change a transaction's category and choose "all of them" to teach it a rule for that merchant.
- Click **Done** on a reminder to hide it. It comes back if something changes, like a new due date.

## How it's built

| Area | Where |
|---|---|
| Statement parsers | `src/parsers/` (`csv.ts`, `ofx.ts`, `text.ts` for PDF/text, `meta.ts` for bank, account number, APR, and due-date extraction) |
| Account matching and import | `src/lib/importer.ts` |
| Recurring detection | `src/lib/recurring.ts` |
| Alerts and safe-to-spend | `src/lib/insights.ts` |
| Storage | `src/db.ts` (Dexie / IndexedDB) |
| UI | `src/pages/`, `src/components/` (React and Vite) |

Amounts are stored from your point of view: negative means money out (or a charge on a card), positive means money in (or a card payment). Credit card and loan balances are stored as the amount owed.
