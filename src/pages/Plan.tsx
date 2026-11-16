import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Data } from '../useData';
import { db } from '../db';
import { Card, Stat } from '../components/ui';
import { CalendarButton } from '../components/CalendarButton';
import { CATEGORIES, NON_SPENDING } from '../lib/categorize';
import { averageSpend, budgetStatus } from '../lib/insights';
import { estimateMinimum, payoffDate, simulatePayoff, type Debt, type Strategy } from '../lib/payoff';
import { formatMoney, parseAmount } from '../lib/money';
import { isLiability } from '../types';

export default function Plan({ data }: { data: Data }) {
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Plan</h1>
          <p className="muted">Budgets, a plan to get out of debt, and reminders in your own calendar.</p>
        </div>
      </header>
      <Budgets data={data} />
      <DebtPlanner data={data} />
      <Card title="Reminders in your calendar">
        <p>
          Download your upcoming bills, paydays and card due dates as a calendar file. Open it on your phone or computer to add them
          to Apple Calendar, Google Calendar or Outlook, with an alert before each one.
        </p>
        <p className="muted small">It's a snapshot of the next 90 days. Download again after you import new statements.</p>
        <CalendarButton data={data} className="btn btn-primary" />
      </Card>
    </div>
  );
}

const SPENDING_CATEGORIES = CATEGORIES.filter((c) => !NON_SPENDING.has(c));

function Budgets({ data }: { data: Data }) {
  const cur = data.settings.currency;
  const [showAll, setShowAll] = useState(false);
  const avg = useMemo(() => averageSpend(data.transactions), [data.transactions]);
  const status = useMemo(() => budgetStatus(data.budgets, data.transactions, data.today), [data.budgets, data.transactions, data.today]);
  const limit = new Map(data.budgets.map((b) => [b.category, b.monthly]));
  const cats = SPENDING_CATEGORIES.filter((c) => showAll || limit.has(c) || (avg.get(c) ?? 0) > 0);
  const totalBudget = data.budgets.reduce((s, b) => s + b.monthly, 0);
  const totalSpent = status.rows.reduce((s, r) => s + r.spent, 0);
  const monthLabel = new Date(status.month + '-15').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  async function save(category: string, raw: string) {
    const v = parseAmount(raw);
    if (!v || v <= 0) await db.budgets.delete(category);
    else await db.budgets.put({ category, monthly: v });
  }
  async function suggest() {
    const rows = [...avg.entries()].filter(([c, v]) => v > 0 && !limit.has(c) && !NON_SPENDING.has(c)).map(([category, v]) => ({ category, monthly: Math.ceil(v / 10) * 10 }));
    await db.budgets.bulkPut(rows);
  }

  return (
    <Card
      title="Monthly budgets"
      action={<span className="muted">{monthLabel}{status.isCurrentMonth ? ` · ${status.daysLeft} days left` : ' (latest imported month)'}</span>}
    >
      {data.budgets.length > 0 && (
        <div className="stats stats-inline">
          <Stat label="Budgeted" value={formatMoney(totalBudget, cur)} />
          <Stat label="Spent in budgeted categories" value={formatMoney(totalSpent, cur)} tone={totalSpent > totalBudget ? 'bad' : 'good'} />
        </div>
      )}
      {!data.budgets.length && (
        <p className="muted">
          Set a monthly limit for the categories you want to keep an eye on. You'll get a heads-up at 85% and when you go over.
          {avg.size > 0 && ' Not sure where to start? Use your recent average.'}
        </p>
      )}
      <div className="table-wrap">
        <table className="table budget-table">
          <thead><tr><th>Category</th><th className="num">3-mo average</th><th>Monthly limit</th><th>Spent</th></tr></thead>
          <tbody>
            {cats.map((c) => {
              const row = status.rows.find((r) => r.category === c);
              const spent = status.spentByCategory.get(c) ?? 0;
              return (
                <tr key={c}>
                  <td><Link to={`/transactions?category=${encodeURIComponent(c)}&month=${status.month}`}>{c}</Link></td>
                  <td className="num muted budget-avg" data-label="3-mo avg">{avg.get(c) ? formatMoney(avg.get(c), cur) : '—'}</td>
                  <td>
                    <input className="input-money" inputMode="decimal" aria-label={`${c} monthly budget`} placeholder="no limit" defaultValue={limit.get(c) ?? ''} key={limit.get(c) ?? 'none'} onBlur={(e) => save(c, e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
                  </td>
                  <td className="budget-cell">
                    {row ? <BudgetBar pct={row.pct} spent={row.spent} limit={row.limit} cur={cur} /> : <span className="muted small">{formatMoney(spent, cur)}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="actions">
        {avg.size > 0 && <button className="btn" onClick={suggest}>Fill empty limits from my average</button>}
        <button className="btn btn-ghost btn-small" onClick={() => setShowAll(!showAll)}>{showAll ? 'Hide unused categories' : 'Show all categories'}</button>
      </div>
    </Card>
  );
}

function BudgetBar({ pct, spent, limit, cur }: { pct: number; spent: number; limit: number; cur: string }) {
  const tone = spent > limit + 0.005 ? 'over' : pct >= 85 ? 'near' : 'ok';
  return (
    <div className={`budget-bar budget-${tone}`} title={`${Math.round(pct)}% used`}>
      <div className="progress"><span style={{ width: `${Math.min(100, pct)}%` }} /></div>
      <span className="small">
        {formatMoney(spent, cur)} of {formatMoney(limit, cur)}
        {tone === 'over' ? <strong> · {formatMoney(spent - limit, cur)} over</strong> : spent >= limit ? <span className="muted"> · right at the limit</span> : <span className="muted"> · {formatMoney(limit - spent, cur)} left</span>}
      </span>
    </div>
  );
}

function readExtra(): number {
  try { return Number(localStorage.getItem('banker.payoffExtra')) || 100; } catch { return 100; }
}

function DebtPlanner({ data }: { data: Data }) {
  const cur = data.settings.currency;
  const [extra, setExtra] = useState(readExtra);
  const [strategy, setStrategy] = useState<Strategy>('avalanche');
  const liabilities = data.accounts.filter((a) => !a.archived && isLiability(a.type) && (a.currentBalance ?? 0) > 0);
  const debts: Debt[] = liabilities.map((a) => ({
    id: a.id!, name: a.name, balance: a.currentBalance!, apr: a.interestRate ?? 0,
    minimum: a.minimumPayment ?? estimateMinimum(a.currentBalance!, a.interestRate ?? 0), estimatedMinimum: a.minimumPayment === undefined,
  }));
  const missingApr = liabilities.filter((a) => a.interestRate === undefined);

  const plan = useMemo(() => simulatePayoff(debts, extra, strategy), [JSON.stringify(debts), extra, strategy]);
  const other = useMemo(() => simulatePayoff(debts, extra, strategy === 'avalanche' ? 'snowball' : 'avalanche'), [JSON.stringify(debts), extra, strategy]);
  const minOnly = useMemo(() => simulatePayoff(debts, 0, strategy), [JSON.stringify(debts), strategy]);
  const setExtraSaved = (v: number) => { setExtra(v); try { localStorage.setItem('banker.payoffExtra', String(v)); } catch { /* storage unavailable */ } };
  const when = (months: number) => new Date(payoffDate(data.today, months) + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', year: 'numeric' });

  if (!debts.length) {
    return <Card title="Debt payoff plan"><p className="muted">No credit card or loan balances found. 🎉</p></Card>;
  }
  const saved = minOnly.neverPaysOff ? undefined : minOnly.totalInterest - plan.totalInterest;

  return (
    <Card title="Debt payoff plan">
      {missingApr.length > 0 && (
        <p className="note warn">⚠️ Missing interest rate for {missingApr.map((a, i) => <span key={a.id}>{i > 0 && ', '}<Link to={`/accounts/${a.id}`}>{a.name}</Link></span>)}. I'm treating it as 0%, so add the rate for an accurate plan.</p>
      )}
      <div className="planner-controls">
        <label>Extra I can pay each month, on top of minimums
          <input className="input-money" type="number" min={0} step={25} value={extra} onChange={(e) => setExtraSaved(Math.max(0, Number(e.target.value) || 0))} />
        </label>
        <fieldset className="segmented">
          <legend className="sr-only">Strategy</legend>
          <label className={strategy === 'avalanche' ? 'on' : ''}><input type="radio" checked={strategy === 'avalanche'} onChange={() => setStrategy('avalanche')} /> Avalanche <small>highest interest first, saves the most</small></label>
          <label className={strategy === 'snowball' ? 'on' : ''}><input type="radio" checked={strategy === 'snowball'} onChange={() => setStrategy('snowball')} /> Snowball <small>smallest balance first, quick wins</small></label>
        </fieldset>
      </div>

      {plan.neverPaysOff ? (
        <p className="note warn">⚠️ At these payments the interest grows faster than you pay it off. Try a bigger extra amount.</p>
      ) : (
        <div className="stats stats-inline">
          <Stat label="Debt-free" value={when(plan.months)} tone="good" hint={`${plan.months} months`} />
          <Stat label="Interest you'll pay" value={formatMoney(plan.totalInterest, cur)} hint={saved !== undefined && saved > 0 ? `${formatMoney(saved, cur)} less than minimums only` : undefined} />
          <Stat label="Minimums only" value={minOnly.neverPaysOff ? 'Never' : when(minOnly.months)} tone="bad" hint={minOnly.neverPaysOff ? 'interest outpaces the minimums' : `${formatMoney(minOnly.totalInterest, cur)} interest`} />
        </div>
      )}
      {!plan.neverPaysOff && Math.abs(other.totalInterest - plan.totalInterest) >= 1 && (
        <p className="small muted">
          {strategy === 'snowball'
            ? `Avalanche would save ${formatMoney(plan.totalInterest - other.totalInterest, cur)} more interest. Snowball is still great if the quick wins keep you going.`
            : `Snowball would cost ${formatMoney(other.totalInterest - plan.totalInterest, cur)} more but clears your first debt sooner.`}
        </p>
      )}

      <ol className="payoff-list">
        {plan.order.map((id, i) => {
          const d = debts.find((x) => x.id === id)!;
          return (
            <li key={id}>
              <span className="payoff-step">{i + 1}</span>
              <span className="payoff-name">
                <Link to={`/accounts/${id}`}>{d.name}</Link>
                <small className="muted">
                  {formatMoney(d.balance, cur)} at {d.apr}% · min {formatMoney(d.minimum, cur)}{d.estimatedMinimum ? ' (estimated)' : ''}
                </small>
              </span>
              <span className="payoff-when">{plan.payoffMonth[id] ? <>Paid off <strong>{when(plan.payoffMonth[id])}</strong></> : '—'}</span>
            </li>
          );
        })}
      </ol>
      <p className="small muted">
        Each month: pay every minimum, then put the extra on #1. When a debt is gone, its minimum rolls on to the next. Assumes no new charges.
      </p>
    </Card>
  );
}

