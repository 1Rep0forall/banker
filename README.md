# Banker

A private, local-first web app that **reads your bank statements and keeps your accounts organised for you**. It's designed to be ADHD-friendly: one clear "do this next" item, plain-language reminders, and no spreadsheets to maintain.

## What it does

- **Scan statements**: drop in **PDF, CSV, OFX, or QFX** files from any bank or credit card, **scanned PDFs**, or **photos of paper statements**. Scans and photos are read with OCR right in your browser.
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
  - Card bills that are **already paid**: when a payment shows up, the due reminder switches to "✓ paid" instead of nagging you
- **Plan**:
  - **Monthly budgets** per category, with a one-click "fill from my average" and alerts at 85% and when you go over
  - **Debt payoff planner**: avalanche (highest interest first) vs snowball (smallest balance first), your debt-free date, and interest saved compared with paying minimums
  - **Calendar reminders**: download an `.ics` file of bills, paydays, card due dates and "cancel this?" reminders, with alerts, for Apple, Google or Outlook calendar
- **Weekly money check-in**: four quick steps that tick themselves off as you do them, plus a streak counter
- **Private**: all data lives in your browser (IndexedDB). Nothing is uploaded anywhere, including for OCR, since the text-recognition engine is served by the app itself. You can export or restore a JSON backup and export your transactions as CSV.

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

### Deploying to GitHub Pages

`.github/workflows/deploy.yml` runs the tests, builds the site, and publishes it on every push to `main` (or on demand from the Actions tab).

One-time setup: in the repository on GitHub, go to **Settings → Pages** and set **Source** to **GitHub Actions**. The site will be at `https://<owner>.github.io/banker/`.

- Pages on a **private** repository needs a paid GitHub plan, and the published site is public either way. That's fine here: the site is just the app, and your financial data only ever lives in your own browser.
- Data is stored per browser and per site address. Statements imported on `localhost` won't show up on the Pages site (or on another device). Use **Settings → Download backup** and **Restore backup** to move them.

### Try it with demo data

`samples/` contains **fake** statements: three months of checking CSVs, a savings OFX, a credit card PDF, and a **scanned** credit card PDF (an image with no text, so it's read with OCR). Import the October checking CSV first (it creates the account), then August and September (they're added to the same account). Then import the October card PDF (it creates a new account), then the scanned September one (it's added to that card).

To regenerate them: `node scripts/make-samples.mjs` (the PDF needs Playwright).

## Tips for best results

- **CSV, OFX, and QFX exports are the most accurate.** Most banks offer them under "Download transactions".
- Scanned PDFs and photos are read with OCR. Expect around 5–20 seconds per page, and **double-check the amounts** in the preview. Flat, well-lit photos work best.
- If a PDF's money in and money out look reversed, tick **"Flip money in/out"** in the import preview.
- Change a transaction's category and choose "all of them" to teach it a rule for that merchant.
- Click **Done** on a reminder to hide it. It comes back if something changes, like a new due date.

## How it's built

| Area | Where |
|---|---|
| Statement parsers | `src/parsers/` (`csv.ts`, `ofx.ts`, `text.ts` for PDF/OCR text, `pdf.ts`, `ocr.ts`, `meta.ts` for bank, account number, APR, and due-date extraction) |
| OCR assets | `scripts/copy-ocr-assets.mjs` copies the tesseract.js engine and English data into `public/ocr/` on `npm run dev` / `npm run build` |
| Budgets, payoff, calendar | `src/lib/insights.ts`, `src/lib/payoff.ts`, `src/lib/ics.ts`, `src/pages/Plan.tsx` |
| Account matching and import | `src/lib/importer.ts` |
| Recurring detection | `src/lib/recurring.ts` |
| Alerts and safe-to-spend | `src/lib/insights.ts` |
| Storage | `src/db.ts` (Dexie / IndexedDB) |
| UI | `src/pages/`, `src/components/` (React and Vite) |

Amounts are stored from your point of view: negative means money out (or a charge on a card), positive means money in (or a card payment). Credit card and loan balances are stored as the amount owed.
