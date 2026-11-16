import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Data } from '../useData';
import { db } from '../db';
import { ACCEPTED_FILES, parseFile } from '../parsers';
import { AUTO_MATCH_SCORE, commitImport, overlapByAccount, rankAccounts, suggestAccountName, type AccountMatch, type ImportResult } from '../lib/importer';
import { ACCOUNT_TYPES, type AccountType, type ParsedStatement } from '../types';
import { Card, Money } from '../components/ui';
import { formatMoney } from '../lib/money';

interface Job {
  id: string;
  file: File;
  status: 'parsing' | 'ready' | 'importing' | 'done' | 'error';
  parsed?: ParsedStatement;
  hash?: string;
  error?: string;
  matches?: AccountMatch[];
  duplicateFile?: boolean;
  result?: ImportResult;
  progress?: { message: string; fraction?: number };
}

export default function ImportPage({ data }: { data: Data }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [dragging, setDragging] = useState(false);

  const update = (id: string, patch: Partial<Job>) => setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...patch } : j)));

  async function addFiles(files: FileList | File[]) {
    const fresh = [...files].map((file) => ({ id: crypto.randomUUID(), file, status: 'parsing' as const }));
    setJobs((js) => [...fresh, ...js]);
    for (const job of fresh) {
      try {
        const { parsed, hash } = await parseFile(job.file, data.settings.dateOrder, (message, fraction) => update(job.id, { progress: { message, fraction } }));
        const accounts = await db.accounts.toArray();
        const matches = rankAccounts(parsed, accounts, await overlapByAccount(db, parsed));
        const duplicateFile = (await db.statements.where('fileHash').equals(hash).count()) > 0;
        update(job.id, { status: 'ready', parsed, hash, matches, duplicateFile });
      } catch (e) {
        update(job.id, { status: 'error', error: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  const pending = jobs.filter((j) => j.status === 'ready');

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Import statements</h1>
          <p className="muted">Drop in PDF, CSV, OFX or QFX files, scanned statements, or photos of paper statements. Everything is processed on this device. Nothing is uploaded.</p>
        </div>
      </header>

      <label
        className={`dropzone ${dragging ? 'dragging' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
      >
        <input type="file" multiple accept={ACCEPTED_FILES} onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
        <span className="dropzone-icon" aria-hidden>📄</span>
        <strong>Drag statements here, or click to choose files</strong>
        <span className="muted small">Tip: CSV/OFX downloads from your bank's website are the most accurate. PDFs, scans and photos work too.</span>
      </label>

      {pending.length > 1 && (
        <p><button className="btn btn-primary" onClick={() => document.querySelectorAll<HTMLButtonElement>('[data-import-btn]').forEach((b) => b.click())}>Import all {pending.length} files</button></p>
      )}

      {jobs.map((job) => (
        <JobCard key={job.id} job={job} data={data} onUpdate={(p) => update(job.id, p)} onRemove={() => setJobs((js) => js.filter((j) => j.id !== job.id))} />
      ))}
    </div>
  );
}

function JobCard({ job, data, onUpdate, onRemove }: { job: Job; data: Data; onUpdate: (p: Partial<Job>) => void; onRemove: () => void }) {
  if (job.status === 'parsing') {
    const p = job.progress;
    return (
      <Card title={job.file.name}>
        <p className="muted" aria-live="polite">{p?.message ?? 'Reading statement…'}</p>
        {p?.fraction !== undefined && (
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p.fraction * 100)}>
            <span style={{ width: `${Math.round(p.fraction * 100)}%` }} />
          </div>
        )}
        {p && <p className="small muted">Scanned pages take around 5–20 seconds each. You can keep using the app meanwhile.</p>}
      </Card>
    );
  }
  if (job.status === 'error') {
    return (
      <Card title={job.file.name} action={<button className="btn btn-small btn-ghost" onClick={onRemove}>Remove</button>}>
        <p className="error">Couldn't read this file: {job.error}</p>
      </Card>
    );
  }
  if (job.status === 'done' && job.result) {
    const acct = data.accounts.find((a) => a.id === job.result!.accountId);
    return (
      <Card className="card-done" title={<>✅ {job.file.name}</>} action={<button className="btn btn-small btn-ghost" onClick={onRemove}>Clear</button>}>
        <p>
          {job.result.created ? <>Created new account <strong>{acct?.name}</strong> and added </> : <>Added </>}
          <strong>{job.result.added}</strong> new transaction{job.result.added === 1 ? '' : 's'}
          {!job.result.created && <> to <strong>{acct?.name}</strong></>}.
          {job.result.duplicates > 0 && <span className="muted"> Skipped {job.result.duplicates} already on file.</span>}
        </p>
        <Link to={`/accounts/${job.result.accountId}`} className="btn btn-small">View account</Link>
      </Card>
    );
  }
  return <ReviewCard job={job} data={data} onUpdate={onUpdate} onRemove={onRemove} />;
}

function ReviewCard({ job, data, onUpdate, onRemove }: { job: Job; data: Data; onUpdate: (p: Partial<Job>) => void; onRemove: () => void }) {
  const parsed = job.parsed!;
  const best = job.matches?.[0];
  const autoMatch = best && best.score >= AUTO_MATCH_SCORE ? best.account.id! : undefined;
  const [mode, setMode] = useState<'existing' | 'new'>(autoMatch ? 'existing' : 'new');
  const [accountId, setAccountId] = useState<number | undefined>(autoMatch ?? best?.account.id ?? data.accounts[0]?.id);
  const [flip, setFlip] = useState(false);
  const [form, setForm] = useState({
    name: suggestAccountName(parsed),
    institution: parsed.institution ?? '',
    type: (parsed.accountType ?? 'checking') as AccountType,
    last4: parsed.last4 ?? '',
  });
  useEffect(() => { if (!data.accounts.length) setMode('new'); }, [data.accounts.length]);

  const txs = useMemo(() => (flip ? parsed.transactions.map((t) => ({ ...t, amount: -t.amount })) : parsed.transactions), [parsed, flip]);
  const totalIn = txs.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const totalOut = txs.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0);
  const matchReason = job.matches?.find((m) => m.account.id === accountId);

  async function doImport() {
    onUpdate({ status: 'importing' });
    try {
      const result = await commitImport(
        db,
        { ...parsed, transactions: txs },
        { fileName: job.file.name, fileHash: job.hash! },
        mode === 'existing' && accountId ? { accountId } : { newAccount: { ...form, currency: parsed.currency ?? data.settings.currency } },
      );
      onUpdate({ status: 'done', result });
    } catch (e) {
      onUpdate({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <Card title={job.file.name} action={<button className="btn btn-small btn-ghost" onClick={onRemove}>Cancel</button>}>
      {job.duplicateFile && <p className="note warn">⚠️ You've imported this exact file before. Importing again is safe — duplicates are skipped.</p>}
      {parsed.warnings.map((w) => <p key={w} className="note warn">⚠️ {w}</p>)}

      <dl className="facts">
        <div><dt>Found</dt><dd>{parsed.transactions.length} transactions</dd></div>
        {parsed.periodStart && <div><dt>Period</dt><dd>{parsed.periodStart} → {parsed.periodEnd}</dd></div>}
        {parsed.closingBalance !== undefined && <div><dt>Ending balance</dt><dd>{formatMoney(parsed.closingBalance, parsed.currency)}</dd></div>}
        {parsed.interestRate !== undefined && <div><dt>Rate</dt><dd>{parsed.interestRate}%</dd></div>}
        {parsed.paymentDueDate && <div><dt>Payment due</dt><dd>{parsed.paymentDueDate}</dd></div>}
        {parsed.minimumPayment !== undefined && <div><dt>Minimum payment</dt><dd>{formatMoney(parsed.minimumPayment)}</dd></div>}
        {parsed.creditLimit !== undefined && <div><dt>Credit limit</dt><dd>{formatMoney(parsed.creditLimit)}</dd></div>}
      </dl>

      <fieldset className="choice">
        <legend>Which account is this?</legend>
        {data.accounts.length > 0 && (
          <label className={`choice-opt ${mode === 'existing' ? 'on' : ''}`}>
            <input type="radio" checked={mode === 'existing'} onChange={() => setMode('existing')} />
            <span>
              <strong>Add to an existing account</strong>
              <select value={accountId} onChange={(e) => { setAccountId(+e.target.value); setMode('existing'); }}>
                {data.accounts.filter((a) => !a.archived).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              {mode === 'existing' && matchReason && <small className="muted">Matched because: {matchReason.reasons.join(' · ')}</small>}
            </span>
          </label>
        )}
        <label className={`choice-opt ${mode === 'new' ? 'on' : ''}`}>
          <input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} />
          <span>
            <strong>Create a new account</strong>
            {!autoMatch && data.accounts.length > 0 && <small className="muted">No existing account matched this statement.</small>}
            {mode === 'new' && (
              <span className="form-grid">
                <label>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
                <label>Bank<input value={form.institution} onChange={(e) => setForm({ ...form, institution: e.target.value })} /></label>
                <label>Type<select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as AccountType })}>{ACCOUNT_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
                <label>Last 4 digits<input value={form.last4} maxLength={4} inputMode="numeric" onChange={(e) => setForm({ ...form, last4: e.target.value.replace(/\D/g, '') })} /></label>
              </span>
            )}
          </span>
        </label>
      </fieldset>

      <details className="preview">
        <summary>
          Preview transactions — money in <Money value={totalIn} sign /> · money out <Money value={totalOut} />
        </summary>
        <label className="inline"><input type="checkbox" checked={flip} onChange={(e) => setFlip(e.target.checked)} /> Amounts look backwards? Flip money in/out</label>
        <table className="table">
          <thead><tr><th>Date</th><th>Description</th><th className="num">Amount</th></tr></thead>
          <tbody>
            {txs.slice(0, 50).map((t, i) => <tr key={i}><td>{t.date}</td><td>{t.description}</td><td className="num"><Money value={t.amount} sign /></td></tr>)}
          </tbody>
        </table>
        {txs.length > 50 && <p className="muted small">…and {txs.length - 50} more</p>}
      </details>

      <div className="actions">
        <button data-import-btn className="btn btn-primary" disabled={job.status === 'importing' || (mode === 'existing' && !accountId)} onClick={doImport}>
          {job.status === 'importing' ? 'Importing…' : mode === 'new' ? 'Create account & import' : 'Import'}
        </button>
      </div>
    </Card>
  );
}
