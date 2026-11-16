import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Data } from '../useData';
import { db } from '../db';
import { ACCOUNT_TYPES, isLiability, type Account, type AccountType } from '../types';
import { Card, Money, Stat } from '../components/ui';
import { BalanceChart } from '../components/charts';
import { formatMoney, parseAmount, round2 } from '../lib/money';
import { daysBetween, todayISO } from '../lib/dates';
import { whenText } from '../lib/insights';

export default function AccountDetail({ data }: { data: Data }) {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const account = data.accounts.find((a) => a.id === id);
  const txs = useMemo(() => data.transactions.filter((t) => t.accountId === id), [data.transactions, id]);
  const statements = data.statements.filter((s) => s.accountId === id).sort((a, b) => (b.periodEnd ?? '').localeCompare(a.periodEnd ?? ''));
  const recurring = data.recurring.filter((r) => r.accountId === id && r.status === 'active');
  const points = data.balances.filter((b) => b.accountId === id).map((b) => ({ date: b.date, value: b.balance }));

  if (!account) return <div className="page"><p>Account not found. <Link to="/accounts">Back to accounts</Link></p></div>;
  const liability = isLiability(account.type);
  const cur = account.currency;
  const due = account.paymentDueDate ? daysBetween(data.today, account.paymentDueDate) : undefined;
  const monthlyInterest = account.interestRate && account.currentBalance ? round2((account.currentBalance * account.interestRate) / 1200) : undefined;
  const util = account.creditLimit && account.currentBalance !== undefined ? (account.currentBalance / account.creditLimit) * 100 : undefined;

  async function remove() {
    if (!confirm(`Delete "${account!.name}" and all ${txs.length} of its transactions? This can't be undone.`)) return;
    await db.transaction('rw', [db.accounts, db.transactions, db.statements, db.balances], async () => {
      await db.transactions.where('accountId').equals(id).delete();
      await db.statements.where('accountId').equals(id).delete();
      await db.balances.where('accountId').equals(id).delete();
      await db.accounts.delete(id);
    });
    navigate('/accounts');
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="muted small"><Link to="/accounts">← Accounts</Link></p>
          <h1>{account.name}</h1>
          <p className="muted">{[account.institution, account.type, account.last4 && `ending ${account.last4}`].filter(Boolean).join(' · ')}</p>
        </div>
      </header>

      <div className="stats">
        <Stat label={liability ? 'Balance owed' : 'Balance'} value={<Money value={account.currentBalance} currency={cur} />} hint={account.balanceAsOf ? `as of ${account.balanceAsOf}` : 'unknown'} />
        {liability && <Stat label="Payment due" value={account.paymentDueDate ?? '—'} tone={due !== undefined && due <= 3 ? 'bad' : ''} hint={due !== undefined ? `${whenText(due)}${account.minimumPayment !== undefined ? ` · min ${formatMoney(account.minimumPayment, cur)}` : ''}` : 'add it below'} />}
        <Stat label={account.type === 'savings' ? 'APY' : 'Interest rate'} value={account.interestRate !== undefined ? `${account.interestRate}%` : '—'} hint={monthlyInterest !== undefined ? (liability ? `≈ ${formatMoney(monthlyInterest, cur)}/mo in interest` : `≈ ${formatMoney(monthlyInterest, cur)}/mo earned`) : 'add it below'} tone={liability && monthlyInterest ? 'bad' : ''} />
        {util !== undefined && <Stat label="Credit used" value={`${Math.round(util)}%`} tone={util >= 30 ? 'bad' : 'good'} hint={`of ${formatMoney(account.creditLimit, cur)} limit`} />}
      </div>

      <Card title="Balance over time"><BalanceChart points={points} currency={cur} label={`${account.name} balance over time`} /></Card>

      <div className="grid-2">
        <Card title="Details"><AccountForm account={account} /></Card>
        <Card title="Recurring on this account">
          {recurring.length ? (
            <ul className="acct-list">
              {recurring.map((r) => <li key={r.id}><Link to="/recurring"><span>{r.label} <small className="muted">· {r.cadence} · next {r.nextDate}</small></span><Money value={r.amount} currency={cur} sign /></Link></li>)}
            </ul>
          ) : <p className="muted">None detected yet.</p>}
        </Card>
      </div>

      <Card title="Recent transactions" action={<Link className="btn btn-small btn-ghost" to={`/transactions?account=${id}`}>See all {txs.length}</Link>}>
        <table className="table">
          <tbody>
            {txs.slice(-15).reverse().map((t) => (
              <tr key={t.id}><td className="nowrap">{t.date}</td><td>{t.description}<br /><small className="muted">{t.category}</small></td><td className="num"><Money value={t.amount} currency={cur} sign /></td></tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Statements imported">
        <table className="table">
          <thead><tr><th>Period</th><th>File</th><th className="num">Added</th><th className="num">Ending balance</th></tr></thead>
          <tbody>
            {statements.map((s) => (
              <tr key={s.id}>
                <td className="nowrap">{s.periodStart ?? '?'} → {s.periodEnd ?? '?'}</td>
                <td>{s.fileName}</td>
                <td className="num">{s.addedCount}{s.duplicateCount ? <small className="muted"> (+{s.duplicateCount} dup)</small> : null}</td>
                <td className="num">{formatMoney(s.closingBalance, cur)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="actions danger-zone">
        <button className="btn btn-ghost" onClick={() => db.accounts.update(id, { archived: !account.archived })}>{account.archived ? 'Unarchive' : 'Archive account'}</button>
        <button className="btn btn-danger" onClick={remove}>Delete account</button>
      </div>
    </div>
  );
}

function AccountForm({ account }: { account: Account }) {
  const toForm = (a: Account) => ({
    name: a.name, institution: a.institution, type: a.type, last4: a.last4,
    currentBalance: a.currentBalance?.toString() ?? '', interestRate: a.interestRate?.toString() ?? '',
    creditLimit: a.creditLimit?.toString() ?? '', minimumPayment: a.minimumPayment?.toString() ?? '',
    paymentDueDate: a.paymentDueDate ?? '', lowBalanceAlert: a.lowBalanceAlert?.toString() ?? '', notes: a.notes ?? '',
  });
  const [f, setF] = useState(toForm(account));
  const [saved, setSaved] = useState(false);
  useEffect(() => setF(toForm(account)), [account.id, account.updatedAt]);
  const liability = isLiability(f.type);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => { setF({ ...f, [k]: e.target.value }); setSaved(false); };
  const num = (s: string) => (s.trim() === '' ? undefined : parseAmount(s));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const balance = num(f.currentBalance);
    const balanceChanged = balance !== account.currentBalance;
    await db.accounts.update(account.id!, {
      name: f.name.trim() || account.name, institution: f.institution, type: f.type as AccountType, last4: f.last4,
      currentBalance: balance, interestRate: num(f.interestRate), creditLimit: num(f.creditLimit),
      minimumPayment: num(f.minimumPayment), paymentDueDate: f.paymentDueDate || undefined,
      lowBalanceAlert: num(f.lowBalanceAlert), notes: f.notes, updatedAt: new Date().toISOString(),
      ...(balanceChanged ? { balanceAsOf: todayISO() } : {}),
    });
    if (balanceChanged && balance !== undefined) await db.balances.add({ accountId: account.id!, date: todayISO(), balance, source: 'manual' });
    setSaved(true);
  }

  return (
    <form className="form-grid" onSubmit={save}>
      <label>Name<input value={f.name} onChange={set('name')} /></label>
      <label>Bank<input value={f.institution} onChange={set('institution')} /></label>
      <label>Type<select value={f.type} onChange={set('type')}>{ACCOUNT_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
      <label>Last 4 digits<input value={f.last4} maxLength={4} onChange={set('last4')} /></label>
      <label>{liability ? 'Balance owed' : 'Current balance'}<input inputMode="decimal" value={f.currentBalance} onChange={set('currentBalance')} /></label>
      <label>{f.type === 'savings' ? 'APY %' : 'APR / interest %'}<input inputMode="decimal" value={f.interestRate} onChange={set('interestRate')} /></label>
      {liability && <label>Payment due date<input type="date" value={f.paymentDueDate} onChange={set('paymentDueDate')} /></label>}
      {liability && <label>Minimum payment<input inputMode="decimal" value={f.minimumPayment} onChange={set('minimumPayment')} /></label>}
      {f.type === 'credit' && <label>Credit limit<input inputMode="decimal" value={f.creditLimit} onChange={set('creditLimit')} /></label>}
      {!liability && <label>Low balance alert below<input inputMode="decimal" placeholder="use default" value={f.lowBalanceAlert} onChange={set('lowBalanceAlert')} /></label>}
      <label className="span-2">Notes<textarea rows={2} value={f.notes} onChange={set('notes')} placeholder="e.g. autopay is on, promo APR ends in June" /></label>
      <div className="span-2 actions"><button className="btn btn-primary">Save</button>{saved && <span className="muted"> Saved ✓</span>}</div>
    </form>
  );
}
