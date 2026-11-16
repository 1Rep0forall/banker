import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Data } from '../useData';
import { AlertRow, Card, Empty, Money, Stat, TYPE_ICON } from '../components/ui';
import { CategoryBars } from '../components/charts';
import { findCardPayment, netWorth, safeToSpend, whenText } from '../lib/insights';
import { CheckIn } from '../components/CheckIn';
import { upcoming } from '../lib/recurring';
import { addDays, addMonths, daysBetween } from '../lib/dates';
import { NON_SPENDING } from '../lib/categorize';
import { isLiability } from '../types';
import { formatMoney, round2 } from '../lib/money';

export default function Dashboard({ data }: { data: Data }) {
  const { accounts, transactions, recurring, alerts, settings, today } = data;
  const cur = settings.currency;
  const [showAll, setShowAll] = useState(false);
  const navigate = useNavigate();
  const active = accounts.filter((a) => !a.archived);

  const sts = useMemo(() => safeToSpend(accounts, recurring, today, transactions), [accounts, recurring, today, transactions]);
  const nw = useMemo(() => netWorth(accounts), [accounts]);
  const monthlyBills = round2(recurring.filter((r) => r.kind === 'bill' && r.status === 'active').reduce((s, r) => s - r.monthly, 0));
  const monthlyInterest = round2(active.filter((a) => isLiability(a.type) && a.interestRate && (a.currentBalance ?? 0) > 0).reduce((s, a) => s + (a.currentBalance! * a.interestRate!) / 1200, 0));

  // Coming up: recurring + card due dates, next 14 days
  const soon = useMemo(() => {
    const until = addDays(today, 14);
    const items: { date: string; label: string; amount?: number; kind: 'bill' | 'income' | 'due' | 'paid'; to: string }[] = upcoming(recurring, today, until).map(({ item, date }) => ({
      date, label: item.label, amount: item.amount, kind: item.kind, to: '/recurring',
    }));
    for (const a of active) {
      if (isLiability(a.type) && a.paymentDueDate && a.paymentDueDate >= today && a.paymentDueDate <= until) {
        const paid = findCardPayment(a, transactions);
        items.push(paid
          ? { date: a.paymentDueDate, label: `${a.name} paid ✓`, kind: 'paid', to: `/accounts/${a.id}` }
          : { date: a.paymentDueDate, label: `${a.name} payment due`, amount: a.minimumPayment !== undefined ? -a.minimumPayment : undefined, kind: 'due', to: `/accounts/${a.id}` });
      }
    }
    return items.sort((x, y) => x.date.localeCompare(y.date));
  }, [recurring, active, today, transactions]);

  // Spending by category: latest month in the data vs the month before
  const spending = useMemo(() => {
    const latest = transactions.reduce((m, t) => (t.date > m ? t.date : m), '');
    if (!latest) return null;
    const month = latest.slice(0, 7);
    const prev = addMonths(month + '-01', -1).slice(0, 7);
    const sum = (m: string) => {
      const out = new Map<string, number>();
      for (const t of transactions) {
        if (t.date.slice(0, 7) !== m || t.amount >= 0 || NON_SPENDING.has(t.category)) continue;
        out.set(t.category, (out.get(t.category) ?? 0) - t.amount);
      }
      return out;
    };
    const now = sum(month), before = sum(prev);
    const rows = [...now.entries()].map(([label, value]) => ({ label, value: round2(value), compare: round2(before.get(label) ?? 0) })).sort((a, b) => b.value - a.value).slice(0, 8);
    const total = round2([...now.values()].reduce((s, v) => s + v, 0));
    return { month, rows, total };
  }, [transactions]);

  if (!accounts.length) {
    return (
      <div className="page">
        <h1>Welcome 👋</h1>
        <Card>
          <Empty>
            <p className="lead">Start by importing a bank or credit card statement.</p>
            <p className="muted">PDF, CSV, OFX and QFX files work. I'll figure out which account it belongs to — or create a new one — and keep building from there each time you import.</p>
            <Link to="/import" className="btn btn-primary btn-big">📥 Import a statement</Link>
          </Empty>
        </Card>
      </div>
    );
  }

  const focus = alerts[0];
  const rest = alerts.slice(1);
  const visible = showAll ? rest : rest.slice(0, 4);
  const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{greeting}</h1>
          <p className="muted">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        </div>
        <Link to="/import" className="btn btn-primary">📥 Import statement</Link>
      </header>

      {focus ? (
        <section className="focus" aria-label="Most important thing right now">
          <div className="focus-label">🎯 One thing to do next</div>
          <ul className="alerts"><AlertRow alert={focus} big /></ul>
        </section>
      ) : (
        <section className="focus focus-calm"><div className="focus-label">✅ Nothing urgent. You're all caught up.</div></section>
      )}

      <div className="stats">
        <Stat
          label="Safe to spend"
          value={<Money value={sts.safe} currency={cur} />}
          tone={sts.safe < 0 ? 'bad' : 'good'}
          hint={<>until {sts.nextIncome ? `payday (${whenText(daysBetween(today, sts.until))})` : sts.until} — checking {formatMoney(sts.cash, cur)} minus {formatMoney(sts.billsBeforePayday + sts.cardPaymentsBeforePayday, cur)} in bills</>}
        />
        <Stat label="Net worth" value={<Money value={nw.net} currency={cur} />} hint={<>{formatMoney(nw.assets, cur)} saved · {formatMoney(nw.debts, cur)} owed</>} />
        <Stat label="Recurring bills" value={<>{formatMoney(monthlyBills, cur)}<small>/mo</small></>} hint={<Link to="/recurring">{recurring.filter((r) => r.kind === 'bill' && r.status === 'active').length} subscriptions & bills</Link>} />
        <Stat label="Interest you pay" value={<>{formatMoney(monthlyInterest, cur)}<small>/mo</small></>} tone={monthlyInterest > 0 ? 'bad' : ''} hint={monthlyInterest > 0 ? 'Pay the highest-APR debt first' : 'No interest-bearing debt found'} />
      </div>

      <div className="grid-2">
        <Card title="Needs attention" action={rest.length > 4 && <button className="btn btn-small btn-ghost" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show less' : `Show all ${rest.length}`}</button>}>
          {rest.length ? <ul className="alerts">{visible.map((a) => <AlertRow key={a.key} alert={a} />)}</ul> : <p className="muted">Nothing else right now. 🎉</p>}
        </Card>

        <Card title="Next 14 days">
          {soon.length ? (
            <ul className="timeline">
              {soon.map((s, i) => {
                const d = daysBetween(today, s.date);
                return (
                  <li key={i} className={s.kind === 'paid' ? 'done' : d <= 2 ? 'soon' : ''}>
                    <Link to={s.to}>
                      <span className="when">{whenText(d)}<br /><small className="muted">{s.date.slice(5)}</small></span>
                      <span className="what">{s.kind === 'income' ? '💰 ' : s.kind === 'due' ? '📅 ' : ''}{s.label}</span>
                      <Money value={s.amount} currency={cur} sign />
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted">No bills or paychecks expected. Recurring items show up after 2–3 statements.</p>
          )}
        </Card>
      </div>

      <div className="grid-2">
        <Card title="Accounts" action={<Link to="/accounts" className="btn btn-small btn-ghost">All accounts</Link>}>
          <ul className="acct-list">
            {active.map((a) => (
              <li key={a.id}>
                <Link to={`/accounts/${a.id}`}>
                  <span aria-hidden>{TYPE_ICON[a.type]}</span>
                  <span className="acct-name">{a.name}<small className="muted">{a.balanceAsOf ? ` as of ${a.balanceAsOf}` : ''}</small></span>
                  <Money value={a.currentBalance === undefined ? undefined : isLiability(a.type) ? -a.currentBalance : a.currentBalance} currency={a.currency} />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
        <Card title={spending ? `Spending in ${monthName(spending.month)}` : 'Spending'} action={spending && <span className="muted">{formatMoney(spending.total, cur)} total</span>}>
          {spending?.rows.length ? (
            <>
              <CategoryBars rows={spending.rows} currency={cur} onSelect={(c) => navigate(`/transactions?category=${encodeURIComponent(c)}&month=${spending.month}`)} />
              <p className="small muted">The thin mark shows last month. Transfers and card payments aren't counted.</p>
            </>
          ) : <p className="muted">No spending found yet.</p>}
        </Card>
      </div>

      <CheckIn data={data} />
    </div>
  );
}

function monthName(ym: string) {
  return new Date(ym + '-15').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}
