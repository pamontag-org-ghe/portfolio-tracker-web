import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, apiErrorMessage } from '../api/client';
import type { ImportSummary } from '../types';

export default function ImportPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  async function upload(file: File) {
    setError(null);
    setSummary(null);
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await api.post<ImportSummary>('/portfolio/import', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setSummary(res.data);
    } catch (err) { setError(apiErrorMessage(err)); }
    finally { setSubmitting(false); }
  }

  return (
    <div className="space-y-6">
      <div className="card">
        <h1 className="font-semibold text-lg">Import portfolio from xlsx</h1>
        <p className="text-sm text-slate-500 mt-1">
          We parse the <code>Securities</code>, <code>Transactions_Buy</code>, <code>Transaction_Sell</code> and <code>Dividends</code> sheets.
          Imports are idempotent — re-uploading the same file will not create duplicates.
        </p>
      </div>

      <div
        className={`card border-2 border-dashed ${dragOver ? 'border-brand-500 bg-brand-50 dark:bg-slate-700' : 'border-slate-300 dark:border-slate-600'} text-center py-12 cursor-pointer`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault(); setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) upload(f);
        }}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xlsm"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
          }}
        />
        <p className="text-lg">Drop your <code>.xlsx</code> file here</p>
        <p className="text-sm text-slate-500 mt-1">or click to browse</p>
      </div>

      {submitting && <div className="card">Uploading & parsing…</div>}
      {error && <div className="card text-red-600">Error: {error}</div>}

      {summary && (
        <div className="card space-y-3">
          <h2 className="font-semibold">Import complete</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {([
              ['Securities', summary.securities],
              ['Transactions', summary.transactions],
              ['Dividends', summary.dividends],
            ] as const).map(([label, stats]) => (
              <div key={label} className="border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                <div className="font-medium mb-1">{label}</div>
                <div className="text-sm text-emerald-600">Created: {stats.created}</div>
                <div className="text-sm text-slate-500">Updated: {stats.updated}</div>
                <div className="text-sm text-amber-600">Skipped: {stats.skipped}</div>
              </div>
            ))}
          </div>

          {summary.warnings.length > 0 && (
            <div>
              <h3 className="font-medium text-amber-700">Warnings ({summary.warnings.length})</h3>
              <ul className="list-disc pl-5 text-sm text-amber-700">
                {summary.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}

          {summary.errors.length > 0 && (
            <div>
              <h3 className="font-medium text-red-700">Errors ({summary.errors.length})</h3>
              <ul className="list-disc pl-5 text-sm text-red-700">
                {summary.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}

          <Link className="btn-primary inline-flex" to="/">Go to dashboard</Link>
        </div>
      )}
    </div>
  );
}
