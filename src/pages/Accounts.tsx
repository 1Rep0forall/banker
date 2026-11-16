import { Link } from 'react-router-dom';
import type { Data } from '../useData';
import { Card, Empty, Money, TYPE_ICON } from '../components/ui';
import { isLiability } from '../types';
import { daysBetween } from '../lib/dates';
import { whenText } from '../lib/insights';

export default function Accounts({ data }: { data: Data }) {
  const { accounts, statements, today } = data;
  const groups: [string, (a: (typeof accounts)[number]) => boolean][] = [
    ['Cash', (a) => a.type === 'checking' || a.type === 'savings'],
    ['Credit cards & loans', (a) => isLiability(a.type)],
    ['Investments & other', (a) => a.type === 'investment' || a.type === 'other'],
  ];
  const active = accounts.filter((a) => !a.archived);
  const archived = accounts.filter((a) => a.archived);

  return (
    <div className="page">
      <header className="page-head">
        <h1>Accounts</h1>
        <Link to="/import" className="btn btn-primary">📥 Import statement</Link>
      </header>
      {!accounts.length && <Card><Empty><p>No accounts yet — they're created automatically when you import a statement.</p></Empty></Card>}
      {groups.map(([title, filter]) => {
        const list = active.filter(filter);
        if (!list.length) return null;
        return (
          <Card key={title} title={title}>
            <div className="acct-grid">
              {list.map((a) => {
                const count = statements.filter((s) => s.accountId === a.id).length;
                const due = a.paymentDueDate ? daysBetween(today, a.paymentDueDate) : undefined;
                const util = a.type === 'credit' && a.creditLimit && a.currentBalance !== undefined ? (a.currentBalance / a.creditLimit) * 100 : undefined;
                return (
                  <Link key={a.id} to={`/accounts/${a.id}`} className="acct-card">
                    <div className="acct-top"><span aria-hidden>{TYPE_ICON[a.type]}</span><strong>{a.name}</strong></div>
                    <div className="acct-bal">
                      <Money value={a.currentBalance} currency={a.currency} />
                      {isLiability(a.type) && <small className="muted"> owed</small>}
                    </div>
                    <div className="acct-meta">
                      {a.interestRate !== undefined && <span className="chip">{a.interestRate}% {a.type === 'savings' ? 'APY' : 'APR'}</span>}
                      {util !== undefined && <span className={`chip ${util >= 30 ? 'chip-warn' : ''}`}>{Math.round(util)}% used</span>}
                      {due !== undefined && due >= -5 && isLiability(a.type) && <span className={`chip ${due <= 3 ? 'chip-bad' : due <= 10 ? 'chip-warn' : ''}`}>due {whenText(due)}</span>}
                      <span className="chip chip-quiet">{count} statement{count === 1 ? '' : 's'}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </Card>
        );
      })}
      {archived.length > 0 && (
        <Card title="Archived">
          <ul className="acct-list">{archived.map((a) => <li key={a.id}><Link to={`/accounts/${a.id}`}><span>{a.name}</span></Link></li>)}</ul>
        </Card>
      )}
    </div>
  );
}
