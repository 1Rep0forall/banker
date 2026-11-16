import { useState } from 'react';
import type { Data } from '../useData';
import { db } from '../db';
import type { RecurringItem } from '../lib/recurring';
import { upcoming } from '../lib/recurring';
import { Card, Money, Stat } from '../components/ui';
import { formatMoney, round2 } from '../lib/money';
import { addDays, daysBetween } from '../lib/dates';
import { whenText } from '../lib/insights';
import { CalendarButton } from '../components/CalendarButton';

async function setRule(merchant: string, patch: Partial<{ recurring: 'confirmed' | 'ignored' | undefined; label: string; wantToCancel: boolean }>) {
  const existing = (await db.merchantRules.get(merchant)) ?? { merchant };
  await db.merchantRules.put({ ...existing, ...patch });
}

export default function Recurring({ data }: { data: Data }) {
  const { recurring, accounts, today, settings } = data;
  const cur = settings.currency;
  const bills = recurring.filter((r) => r.kind === 'bill' && r.status === 'active');
  const income = recurring.filter((r) => r.kind === 'income' && r.status === 'active');
  const stopped = recurring.filter((r) => r.status === 'maybe-stopped');
  const ignored = data.rules.filter((r) => r.recurring === 'ignored');
  const billsMonthly = round2(bills.reduce((s, r) => s - r.monthly, 0));
  const incomeMonthly = round2(income.reduce((s, r) => s + r.monthly, 0));
  const cancelSavings = round2(bills.filter((r) => r.wantToCancel).reduce((s, r) => s - r.monthly, 0));
  const next30 = upcoming(recurring, today, addDays(today, 30));
  const acctName = (id: number) => accounts.find((a) => a.id === id)?.name ?? '';

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Recurring</h1>
          <p className="muted">Subscriptions, bills and paychecks I spotted repeating in your statements.</p>
        </div>
        <CalendarButton data={data} />
      </header>
      <div className="stats">
        <Stat label="Bills & subscriptions" value={<>{formatMoney(billsMonthly, cur)}<small>/mo</small></>} hint={`${formatMoney(billsMonthly * 12, cur)} per year`} />
        <Stat label="Recurring income" value={<>{formatMoney(incomeMonthly, cur)}<small>/mo</small></>} tone="good" />
        <Stat label="Left after bills" value={<Money value={round2(incomeMonthly - billsMonthly)} currency={cur} />} tone={incomeMonthly - billsMonthly < 0 ? 'bad' : 'good'} />
        {cancelSavings > 0 && <Stat label="If you cancel flagged" value={<>{formatMoney(cancelSavings * 12, cur)}<small>/yr</small></>} tone="good" hint="saved" />}
      </div>

      <Card title="Next 30 days">
        {next30.length ? (
          <ul className="timeline">
            {next30.map(({ item, date }, i) => (
              <li key={i} className={daysBetween(today, date) <= 2 ? 'soon' : ''}>
                <div>
                  <span className="when">{whenText(daysBetween(today, date))}<br /><small className="muted">{date.slice(5)}</small></span>
                  <span className="what">{item.kind === 'income' ? '💰 ' : ''}{item.label}{item.wantToCancel && <span className="chip chip-warn">cancel?</span>}</span>
                  <Money value={item.amount} currency={cur} sign />
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="muted">Nothing expected in the next 30 days.</p>}
      </Card>

      <Card title={`Bills & subscriptions (${bills.length})`}>
        {bills.length ? <RecurringTable items={bills} cur={cur} acctName={acctName} today={today} /> : <p className="muted">I need about 2–3 statements to spot repeating charges.</p>}
      </Card>
      {income.length > 0 && <Card title="Income"><RecurringTable items={income} cur={cur} acctName={acctName} today={today} /></Card>}
      {stopped.length > 0 && (
        <Card title="Might have stopped">
          <p className="muted small">These used to repeat but haven't shown up when expected. Cancelled? 🎉 Or did a card change?</p>
          <RecurringTable items={stopped} cur={cur} acctName={acctName} today={today} />
        </Card>
      )}
      {ignored.length > 0 && (
        <Card title="Hidden (marked not recurring)">
          <ul className="chips">{ignored.map((r) => <li key={r.merchant}><button className="chip" onClick={() => setRule(r.merchant, { recurring: undefined })}>{r.label || r.merchant} ✕ unhide</button></li>)}</ul>
        </Card>
      )}
    </div>
  );
}

function RecurringTable({ items, cur, acctName, today }: { items: RecurringItem[]; cur: string; acctName: (id: number) => string; today: string }) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>Name</th><th>How often</th><th className="num">Amount</th><th>Next</th><th></th></tr></thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.id} className={r.wantToCancel ? 'row-flag' : ''}>
              <td>
                {editing === r.id ? (
                  <input autoFocus defaultValue={r.label} onBlur={(e) => { setRule(r.merchant, { label: e.target.value.trim() }); setEditing(null); }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
                ) : (
                  <button className="linklike" onClick={() => setEditing(r.id)} title="Rename">{r.label}</button>
                )}
                <br /><small className="muted">{acctName(r.accountId)} · {r.category} · seen {r.occurrences}×</small>
                {r.priceChange && <span className={`chip ${r.priceChange.to > r.priceChange.from ? 'chip-warn' : ''}`}>{r.priceChange.to > r.priceChange.from ? '▲' : '▼'} was {formatMoney(r.priceChange.from, cur)}</span>}
                {r.variable && <span className="chip chip-quiet">varies</span>}
              </td>
              <td>{r.cadence}</td>
              <td className="num"><Money value={r.amount} currency={cur} sign />{r.cadence !== 'monthly' && <><br /><small className="muted">{formatMoney(Math.abs(r.monthly), cur)}/mo</small></>}</td>
              <td className="nowrap">{r.status === 'active' ? whenText(daysBetween(today, r.nextDate)) : `last ${r.lastDate}`}</td>
              <td className="row-actions">
                {r.kind === 'bill' && (
                  <button className={`btn btn-small ${r.wantToCancel ? 'btn-warn' : 'btn-ghost'}`} onClick={() => setRule(r.merchant, { wantToCancel: !r.wantToCancel })} title="Remind me to cancel this">
                    {r.wantToCancel ? '✓ Cancel reminder' : 'Want to cancel'}
                  </button>
                )}
                <button className="btn btn-small btn-ghost" onClick={() => setRule(r.merchant, { recurring: 'ignored' })} title="This isn't actually recurring">Not recurring</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
