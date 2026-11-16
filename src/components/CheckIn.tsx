import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Data } from '../useData';
import { db } from '../db';
import { Card } from './ui';
import { addDays, daysBetween } from '../lib/dates';

/**
 * A short weekly routine. Steps tick themselves off when the app can tell they're done,
 * so it's quick to finish and the streak gives a small reward for coming back.
 */
export function CheckIn({ data }: { data: Data }) {
  const { settings, today, statements, transactions, alerts } = data;
  const [reviewed, setReviewed] = useState(false);
  const [open, setOpen] = useState(false);
  const since = settings.lastCheckIn ? daysBetween(settings.lastCheckIn, today) : undefined;
  const doneRecently = since !== undefined && since < 7;
  const streak = settings.checkInStreak ?? 0;

  const lastImport = statements.reduce((m, s) => (s.importedAt.slice(0, 10) > m ? s.importedAt.slice(0, 10) : m), '');
  const importedThisWeek = !!lastImport && daysBetween(lastImport, today) < 7;
  const recentCutoff = addDays(today, -90);
  const uncategorized = transactions.filter((t) => t.category === 'Uncategorized' && t.date >= recentCutoff).length;
  const urgent = alerts.filter((a) => a.severity === 'critical' || a.severity === 'warning').length;

  const steps = [
    { done: importedThisWeek, label: 'Import your newest statements', hint: !lastImport ? 'nothing imported yet' : daysBetween(lastImport, today) === 0 ? 'last import today' : `last import ${daysBetween(lastImport, today)} days ago`, to: '/import' },
    { done: uncategorized === 0, label: 'Sort uncategorized transactions', hint: uncategorized ? `${uncategorized} to sort` : 'all sorted', to: '/transactions?category=Uncategorized' },
    { done: urgent === 0, label: 'Clear the urgent and heads-up items', hint: urgent ? `${urgent} left on Today` : 'nothing urgent', to: '/' },
    { done: reviewed, label: 'Look over the next 14 days', hint: 'any bill you need to move money for?', manual: true },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  async function finish() {
    const keepsStreak = since !== undefined && since <= 14;
    await db.settings.put({ ...settings, lastCheckIn: today, checkInStreak: keepsStreak ? streak + 1 : 1 });
    setOpen(false);
  }

  if (doneRecently && !open) {
    return (
      <Card className="checkin checkin-done">
        <div className="checkin-row">
          <span>
            ✅ <strong>Weekly check-in done</strong> {since === 0 ? 'today' : `${since} day${since === 1 ? '' : 's'} ago`}.
            {streak > 1 && <span className="chip">🔥 {streak}-week streak</span>}
            <br />
            <small className="muted">Next one: {new Date(addDays(settings.lastCheckIn!, 7) + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</small>
          </span>
          <button className="btn btn-small btn-ghost" onClick={() => setOpen(true)}>Do it again</button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="checkin" title={<>🧘 Weekly money check-in <small className="muted">· about 5 minutes</small></>} action={streak > 0 ? <span className="chip">🔥 {streak}-week streak</span> : undefined}>
      <ol className="checklist">
        {steps.map((s, i) => (
          <li key={i} className={s.done ? 'done' : ''}>
            {s.manual ? (
              <label><input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} /> <span>{s.label}</span></label>
            ) : (
              <span><span className="check" aria-hidden>{s.done ? '✓' : i + 1}</span> {s.to ? <Link to={s.to}>{s.label}</Link> : s.label}</span>
            )}
            <small className="muted"> · {s.hint}</small>
            <span className="sr-only">{s.done ? '(done)' : '(to do)'}</span>
          </li>
        ))}
      </ol>
      <div className="actions">
        <button className="btn btn-primary" onClick={finish}>{doneCount === steps.length ? 'Finish check-in 🎉' : `Finish check-in (${doneCount}/${steps.length} done)`}</button>
        <small className="muted">Done is better than perfect. Finish even if a step is left.</small>
      </div>
    </Card>
  );
}
