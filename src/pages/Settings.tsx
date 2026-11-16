import { useState } from 'react';
import type { Data } from '../useData';
import { db } from '../db';
import { DEFAULT_SETTINGS, type Settings } from '../types';
import { Card } from '../components/ui';
import { todayISO } from '../lib/dates';

export default function SettingsPage({ data }: { data: Data }) {
  const [s, setS] = useState<Settings>(data.settings);
  const [msg, setMsg] = useState('');
  const save = async (next: Settings) => { setS(next); await db.settings.put(next); setMsg('Saved ✓'); };

  async function exportBackup() {
    const backup = {
      app: 'banker', version: 1, exportedAt: new Date().toISOString(),
      accounts: await db.accounts.toArray(), statements: await db.statements.toArray(), transactions: await db.transactions.toArray(),
      balances: await db.balances.toArray(), merchantRules: await db.merchantRules.toArray(), dismissals: await db.dismissals.toArray(),
      settings: await db.settings.toArray(),
    };
    download(`banker-backup-${todayISO()}.json`, JSON.stringify(backup, null, 2), 'application/json');
  }

  async function exportCsv() {
    const accts = new Map((await db.accounts.toArray()).map((a) => [a.id, a.name]));
    const rows = (await db.transactions.orderBy('date').toArray()).map((t) => [t.date, accts.get(t.accountId) ?? '', t.description, t.category, t.amount.toFixed(2)]);
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    download(`banker-transactions-${todayISO()}.csv`, [['Date', 'Account', 'Description', 'Category', 'Amount'], ...rows].map((r) => r.map(esc).join(',')).join('\n'), 'text/csv');
  }

  async function restore(file: File) {
    try {
      const b = JSON.parse(await file.text());
      if (b.app !== 'banker') throw new Error('This is not a Banker backup file.');
      if (!confirm('Replace ALL current data with this backup?')) return;
      await db.transaction('rw', [db.accounts, db.statements, db.transactions, db.balances, db.merchantRules, db.dismissals, db.settings], async () => {
        for (const t of [db.accounts, db.statements, db.transactions, db.balances, db.merchantRules, db.dismissals, db.settings]) await t.clear();
        await db.accounts.bulkAdd(b.accounts); await db.statements.bulkAdd(b.statements); await db.transactions.bulkAdd(b.transactions);
        await db.balances.bulkAdd(b.balances); await db.merchantRules.bulkAdd(b.merchantRules); await db.dismissals.bulkAdd(b.dismissals ?? []);
        await db.settings.bulkAdd(b.settings ?? []);
      });
      setMsg('Backup restored ✓');
    } catch (e) {
      setMsg('Restore failed: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  async function wipe() {
    if (!confirm('Delete ALL accounts, transactions and settings from this browser? Export a backup first if you might want it.')) return;
    await db.delete();
    location.reload();
  }

  const num = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) => save({ ...s, [k]: Number(e.target.value) || 0 });

  return (
    <div className="page">
      <header className="page-head"><h1>Settings</h1>{msg && <span className="muted">{msg}</span>}</header>
      <Card title="Preferences">
        <div className="form-grid">
          <label>Date format in statements
            <select value={s.dateOrder} onChange={(e) => save({ ...s, dateOrder: e.target.value as Settings['dateOrder'] })}>
              <option value="auto">Detect automatically</option><option value="MDY">MM/DD/YYYY (US)</option><option value="DMY">DD/MM/YYYY</option>
            </select>
          </label>
          <label>Currency<input value={s.currency} maxLength={3} onChange={(e) => e.target.value.length === 3 && save({ ...s, currency: e.target.value.toUpperCase() })} /></label>
          <label>Warn when a cash account drops below<input type="number" value={s.defaultLowBalance} onChange={num('defaultLowBalance')} /></label>
          <label>Flag charges larger than<input type="number" value={s.largeTransaction} onChange={num('largeTransaction')} /></label>
          <label>Remind me to import after (days)<input type="number" value={s.staleStatementDays} onChange={num('staleStatementDays')} /></label>
        </div>
        <p><button className="btn btn-ghost btn-small" onClick={() => save(DEFAULT_SETTINGS)}>Reset to defaults</button></p>
      </Card>
      <Card title="Dismissed reminders">
        <p className="muted">Hidden alerts come back automatically when something changes (new due date, new balance…).</p>
        <button className="btn" onClick={async () => { await db.dismissals.clear(); setMsg('Reminders restored ✓'); }}>Show all dismissed reminders again</button>
      </Card>
      <Card title="Your data">
        <p className="muted">🔒 Everything is stored only in this browser on this device. Nothing is sent to a server. Back up regularly — clearing browser data deletes it.</p>
        <div className="actions">
          <button className="btn" onClick={exportBackup}>Download backup (.json)</button>
          <button className="btn" onClick={exportCsv}>Export transactions (.csv)</button>
          <label className="btn">Restore backup<input type="file" accept=".json" hidden onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])} /></label>
          <button className="btn btn-danger" onClick={wipe}>Delete everything</button>
        </div>
      </Card>
    </div>
  );
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
