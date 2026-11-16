import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Alert, Severity } from '../lib/insights';
import { formatMoney } from '../lib/money';
import { db } from '../db';

export function Money({ value, currency = 'USD', sign, className = '' }: { value?: number; currency?: string; sign?: boolean; className?: string }) {
  const tone = value === undefined ? '' : value < 0 ? 'neg' : sign && value > 0 ? 'pos' : '';
  return <span className={`money ${tone} ${className}`}>{formatMoney(value, currency, { sign })}</span>;
}

const ICON: Record<Severity, string> = { critical: '⛔', warning: '⚠️', info: '💡', good: '✅' };
const LABEL: Record<Severity, string> = { critical: 'Urgent', warning: 'Heads up', info: 'FYI', good: 'Good' };

export function AlertRow({ alert, big }: { alert: Alert; big?: boolean }) {
  const dismiss = () => db.dismissals.put({ key: alert.key, dismissedAt: new Date().toISOString() });
  return (
    <li className={`alert sev-${alert.severity} ${big ? 'alert-big' : ''}`}>
      <span className="alert-icon" aria-hidden>{ICON[alert.severity]}</span>
      <div className="alert-body">
        <span className="sr-only">{LABEL[alert.severity]}: </span>
        <strong>{alert.title}</strong>
        {alert.detail && <p>{alert.detail}</p>}
      </div>
      <div className="alert-actions">
        {alert.to && <Link className="btn btn-small" to={alert.to}>Open</Link>}
        <button className="btn btn-small btn-ghost" onClick={dismiss} title="Hide this until something changes">
          Done
        </button>
      </div>
    </li>
  );
}

export function Card({ title, children, action, className = '' }: { title?: ReactNode; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <header className="card-head">
          {title && <h2>{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'good' | 'bad' | '' }) {
  return (
    <div className={`stat ${tone ? 'stat-' + tone : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export const TYPE_ICON: Record<string, string> = {
  checking: '💳', savings: '🐖', credit: '💳', loan: '🏠', investment: '📈', other: '🏦',
};
