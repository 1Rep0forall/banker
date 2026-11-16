import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Data } from '../useData';
import { db } from '../db';
import { CATEGORIES } from '../lib/categorize';
import { Card, Money } from '../components/ui';
import { formatMoney, round2 } from '../lib/money';
import { prettyMerchant } from '../lib/merchant';
import type { Transaction } from '../types';

const PAGE = 100;

export default function Transactions({ data }: { data: Data }) {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const account = params.get('account') ?? '';
  const category = params.get('category') ?? '';
  const month = params.get('month') ?? '';
  const [limit, setLimit] = useState(PAGE);
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }); setLimit(PAGE); };

  const months = useMemo(() => [...new Set(data.transactions.map((t) => t.date.slice(0, 7)))].sort().reverse(), [data.transactions]);
  const filtered = useMemo(() => {
    const needle = q.toLowerCase();
    return data.transactions
      .filter((t) => (!account || t.accountId === +account) && (!category || t.category === category) && (!month || t.date.startsWith(month)) && (!needle || t.description.toLowerCase().includes(needle) || t.merchant.includes(needle)))
      .reverse();
  }, [data.transactions, q, account, category, month]);
  const totalIn = round2(filtered.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0));
  const totalOut = round2(filtered.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0));
  const acctName = (id: number) => data.accounts.find((a) => a.id === id)?.name ?? '';
  const cur = data.settings.currency;

  return (
    <div className="page">
      <header className="page-head"><h1>Transactions</h1></header>
      <div className="filters">
        <input type="search" placeholder="Search…" value={q} onChange={(e) => set('q', e.target.value)} aria-label="Search transactions" />
        <select value={account} onChange={(e) => set('account', e.target.value)} aria-label="Account">
          <option value="">All accounts</option>
          {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select value={category} onChange={(e) => set('category', e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select value={month} onChange={(e) => set('month', e.target.value)} aria-label="Month">
          <option value="">All months</option>
          {months.map((m) => <option key={m}>{m}</option>)}
        </select>
        {(q || account || category || month) && <button className="btn btn-small btn-ghost" onClick={() => setParams({})}>Clear</button>}
      </div>
      <Card title={`${filtered.length} transactions`} action={<span className="muted">in {formatMoney(totalIn, cur)} · out {formatMoney(-totalOut, cur)}</span>}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Date</th><th>Description</th><th>Category</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {filtered.slice(0, limit).map((t) => (
                <tr key={t.id}>
                  <td className="nowrap">{t.date}</td>
                  <td>{t.description}<br /><small className="muted">{acctName(t.accountId)}</small></td>
                  <td><CategorySelect tx={t} /></td>
                  <td className="num"><Money value={t.amount} currency={cur} sign /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length > limit && <button className="btn" onClick={() => setLimit(limit + PAGE)}>Show more</button>}
      </Card>
    </div>
  );
}

function CategorySelect({ tx }: { tx: Transaction }) {
  async function change(category: string) {
    const all = confirm(`Use "${category}" for every transaction from ${prettyMerchant(tx.merchant)} (now and future imports)?\n\nOK = all of them · Cancel = just this one`);
    if (all) {
      const existing = (await db.merchantRules.get(tx.merchant)) ?? { merchant: tx.merchant };
      await db.transaction('rw', db.merchantRules, db.transactions, async () => {
        await db.merchantRules.put({ ...existing, category });
        await db.transactions.where('merchant').equals(tx.merchant).modify({ category });
      });
    } else {
      await db.transactions.update(tx.id!, { category });
    }
  }
  return (
    <select className="select-quiet" value={tx.category} onChange={(e) => change(e.target.value)} aria-label="Category">
      {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
    </select>
  );
}
