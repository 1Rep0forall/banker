export type AccountType = 'checking' | 'savings' | 'credit' | 'loan' | 'investment' | 'other';

export const ACCOUNT_TYPES: AccountType[] = ['checking', 'savings', 'credit', 'loan', 'investment', 'other'];

/** Liabilities: the balance is money you owe. */
export const isLiability = (t: AccountType) => t === 'credit' || t === 'loan';

export interface Account {
  id?: number;
  name: string;
  institution: string;
  type: AccountType;
  /** Last 4 digits of the account number, if known. */
  last4: string;
  /** Normalized identifiers seen on statements, used to match future imports. */
  matchKeys: string[];
  currency: string;
  /** For liabilities this is the amount owed (positive). */
  currentBalance?: number;
  balanceAsOf?: string;
  /** APR for credit/loans, APY for savings. Percent, e.g. 24.99 */
  interestRate?: number;
  creditLimit?: number;
  minimumPayment?: number;
  /** YYYY-MM-DD */
  paymentDueDate?: string;
  /** Warn when balance (asset accounts) drops below this. */
  lowBalanceAlert?: number;
  notes?: string;
  archived?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Statement {
  id?: number;
  accountId: number;
  fileName: string;
  fileHash: string;
  format: ImportFormat;
  periodStart?: string;
  periodEnd?: string;
  openingBalance?: number;
  closingBalance?: number;
  importedAt: string;
  addedCount: number;
  duplicateCount: number;
}

export interface Transaction {
  id?: number;
  accountId: number;
  statementId?: number;
  /** YYYY-MM-DD */
  date: string;
  description: string;
  /** Normalized merchant key used for grouping/recurring detection. */
  merchant: string;
  /** Signed from the user's point of view: negative = money out / charge, positive = money in / payment. */
  amount: number;
  balance?: number;
  category: string;
  /** Dedupe key, unique per account. */
  fingerprint: string;
  note?: string;
}

export interface BalanceSnapshot {
  id?: number;
  accountId: number;
  date: string;
  balance: number;
  source: 'statement' | 'manual';
}

/** Per-merchant user decisions (category rule, recurring confirmation). */
export interface MerchantRule {
  merchant: string;
  category?: string;
  recurring?: 'confirmed' | 'ignored';
  /** User's label, e.g. "Netflix" */
  label?: string;
  /** User flagged it as something they want to cancel. */
  wantToCancel?: boolean;
}

export interface Dismissal {
  key: string;
  dismissedAt: string;
}

export interface Settings {
  id: 'settings';
  dateOrder: 'auto' | 'MDY' | 'DMY';
  currency: string;
  defaultLowBalance: number;
  largeTransaction: number;
  staleStatementDays: number;
}

export const DEFAULT_SETTINGS: Settings = {
  id: 'settings',
  dateOrder: 'auto',
  currency: 'USD',
  defaultLowBalance: 100,
  largeTransaction: 500,
  staleStatementDays: 35,
};

export type ImportFormat = 'csv' | 'ofx' | 'pdf' | 'image' | 'text';

/** Output of every statement parser. */
export interface ParsedStatement {
  format: ImportFormat;
  /** Text was read with OCR (scanned PDF or photo), so it deserves a closer look. */
  ocr?: boolean;
  institution?: string;
  accountName?: string;
  /** Full or masked account number as seen on the statement. */
  accountNumber?: string;
  last4?: string;
  accountType?: AccountType;
  currency?: string;
  periodStart?: string;
  periodEnd?: string;
  openingBalance?: number;
  closingBalance?: number;
  interestRate?: number;
  creditLimit?: number;
  minimumPayment?: number;
  paymentDueDate?: string;
  transactions: ParsedTransaction[];
  warnings: string[];
}

export interface ParsedTransaction {
  date: string;
  description: string;
  amount: number;
  balance?: number;
  /** Bank-provided unique id (OFX FITID) when available. */
  externalId?: string;
}
