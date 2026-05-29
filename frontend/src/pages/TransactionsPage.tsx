import { useEffect, useMemo, useRef, useState } from 'react';
import { api, apiErrorMessage } from '../api/client';
import type { Transaction, AssetCategory, Dividend } from '../types';
import { formatDate, formatMoney } from '../utils/format';
import { useIsMobile } from '../utils/useIsMobile';

type Activity = {
  id: string;
  date: string;
  securityName: string;
  ticker?: string;
  isin?: string;
  type: 'BUY' | 'SELL' | 'DIVIDEND';
  shares: number | null;
  /** Gross amount in EUR for sorting and display. */
  grossEur: number;
  /** Raw gross in the security's currency (for transactions; same as grossEur for dividends). */
  grossLocal: number;
  currency: string;
  fees: number;
  taxes: number;
  /** Underlying source object so we can still expose delete actions. */
  source: { kind: 'transaction'; tx: Transaction } | { kind: 'dividend'; dv: Dividend };
};

type SortKey = 'date' | 'security' | 'type' | 'gross';
type SortDir = 'asc' | 'desc';

type FormType = 'BUY' | 'SELL' | 'DIVIDEND';

interface FormState {
  type: FormType;
  name?: string;
  ticker?: string;
  isin?: string;
  category: AssetCategory;
  currency: string;
  date: string;
  shares: number;
  grossAmount: number;
  exchangeRate: number;
  fees: number;
  taxes: number;
  broker?: string;
  notes?: string;
}

const EMPTY: FormState = {
  type: 'BUY',
  shares: 1,
  grossAmount: 0,
  exchangeRate: 1,
  fees: 0,
  taxes: 0,
  date: new Date().toISOString().slice(0, 10),
  currency: 'EUR',
  category: 'Stock',
};

type LookupSide = { ok: boolean; name?: string; currency?: string; reason?: string } | null;
type LookupState = { ticker: LookupSide; isin: LookupSide; loading: boolean };

function typeBadgeClass(t: Activity['type']): string {
  if (t === 'BUY') return 'bg-emerald-100 text-emerald-700';
  if (t === 'SELL') return 'bg-amber-100 text-amber-700';
  return 'bg-sky-100 text-sky-700'; // DIVIDEND / coupon
}

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [dividends, setDividends] = useState<Dividend[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState>({ ...EMPTY });
  const [submitting, setSubmitting] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [lookup, setLookup] = useState<LookupState>({ ticker: null, isin: null, loading: false });
  const [overrideValidation, setOverrideValidation] = useState(false);
  const lookupTimer = useRef<number | null>(null);
  const isMobile = useIsMobile();

  const reload = () => {
    setLoading(true);
    Promise.all([
      api.get<{ transactions: Transaction[] }>('/portfolio/transactions'),
      api.get<{ dividends: Dividend[] }>('/portfolio/dividends'),
    ])
      .then(([t, d]) => {
        setTransactions(t.data.transactions);
        setDividends(d.data.dividends);
      })
      .catch((err) => setError(apiErrorMessage(err)))
      .finally(() => setLoading(false));
  };
  useEffect(reload, []);

  // Debounced ticker/ISIN lookup against /api/securities/lookup. Re-runs
  // whenever either field changes; clears the override flag so the user has to
  // re-confirm after editing.
  useEffect(() => {
    const ticker = (form.ticker ?? '').trim();
    const isin = (form.isin ?? '').trim();
    if (!ticker && !isin) {
      setLookup({ ticker: null, isin: null, loading: false });
      return;
    }
    if (lookupTimer.current) window.clearTimeout(lookupTimer.current);
    setLookup((s) => ({ ...s, loading: true }));
    lookupTimer.current = window.setTimeout(async () => {
      try {
        const params: Record<string, string> = {};
        if (ticker) params.ticker = ticker;
        if (isin) params.isin = isin;
        const { data } = await api.get<{ ticker: LookupSide; isin: LookupSide }>('/securities/lookup', { params });
        setLookup({ ticker: data.ticker, isin: data.isin, loading: false });
      } catch {
        // Network or backend failure: leave both indicators neutral so the user
        // can still submit (the override flow also covers this).
        setLookup({ ticker: null, isin: null, loading: false });
      }
    }, 500);
    setOverrideValidation(false);
    return () => {
      if (lookupTimer.current) window.clearTimeout(lookupTimer.current);
    };
  }, [form.ticker, form.isin]);

  const activities: Activity[] = useMemo(() => {
    const tx: Activity[] = transactions.map((t) => ({
      id: `T:${t.id}`,
      date: t.date,
      securityName: t.securityName,
      ticker: t.ticker,
      isin: t.isin,
      type: t.type,
      shares: t.shares,
      grossEur: t.grossAmount * (t.exchangeRate || 1) * (t.type === 'SELL' ? 1 : 1),
      grossLocal: t.grossAmount,
      currency: 'EUR',
      fees: t.fees,
      taxes: t.taxes,
      source: { kind: 'transaction', tx: t },
    }));
    const dv: Activity[] = dividends.map((d) => ({
      id: `D:${d.id}`,
      date: d.date,
      securityName: d.securityName,
      type: 'DIVIDEND',
      shares: null,
      grossEur: d.amount + d.taxes,
      grossLocal: d.amount + d.taxes,
      currency: 'EUR',
      fees: 0,
      taxes: d.taxes,
      source: { kind: 'dividend', dv: d },
    }));
    return [...tx, ...dv];
  }, [transactions, dividends]);

  const sorted = useMemo(() => {
    const list = [...activities];
    const dir = sortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'date':
          cmp = a.date.localeCompare(b.date);
          break;
        case 'security':
          cmp = a.securityName.localeCompare(b.securityName);
          break;
        case 'type':
          cmp = a.type.localeCompare(b.type);
          break;
        case 'gross':
          cmp = a.grossEur - b.grossEur;
          break;
      }
      return cmp * dir;
    });
    return list;
  }, [activities, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir(k === 'date' ? 'desc' : 'asc'); }
  };

  const isDividend = form.type === 'DIVIDEND';
  const tickerOk = !lookup.ticker || lookup.ticker.ok;
  const isinOk = !lookup.isin || lookup.isin.ok;
  const validationFailed = !tickerOk || !isinOk;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.ticker || !form.isin) {
      setError('Security name, ticker and ISIN are required.');
      return;
    }
    if (validationFailed && !overrideValidation) {
      setError('Ticker or ISIN could not be verified. Click "Submit anyway" to insert it as-is.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (isDividend) {
        await api.post('/portfolio/dividends', {
          name: form.name,
          ticker: form.ticker,
          isin: form.isin,
          category: form.category,
          currency: form.currency,
          amount: Number(form.grossAmount),
          taxes: Number(form.taxes || 0),
          date: form.date,
          notes: form.notes || undefined,
        });
      } else {
        await api.post('/portfolio/transactions', {
          name: form.name,
          ticker: form.ticker,
          isin: form.isin,
          category: form.category,
          currency: form.currency,
          type: form.type,
          shares: Number(form.shares),
          grossAmount: Number(form.grossAmount),
          exchangeRate: Number(form.exchangeRate || 1),
          fees: Number(form.fees || 0),
          taxes: Number(form.taxes || 0),
          date: form.date,
          broker: form.broker || undefined,
          notes: form.notes || undefined,
        });
      }
      setForm({ ...EMPTY });
      setLookup({ ticker: null, isin: null, loading: false });
      setOverrideValidation(false);
      reload();
    } catch (err) { setError(apiErrorMessage(err)); }
    finally { setSubmitting(false); }
  }

  async function del(activity: Activity) {
    if (!confirm(`Delete this ${activity.type.toLowerCase()}?`)) return;
    try {
      if (activity.source.kind === 'transaction') {
        await api.delete(`/portfolio/transactions/${activity.source.tx.id}`);
      } else {
        await api.delete(`/portfolio/dividends/${activity.source.dv.id}`);
      }
      reload();
    } catch (err) { setError(apiErrorMessage(err)); }
  }

  const SortHeader = ({ k, label, align = 'left' }: { k: SortKey; label: string; align?: 'left' | 'right' }) => (
    <th className={`py-2 pr-3 select-none cursor-pointer ${align === 'right' ? 'text-right' : 'text-left'}`} onClick={() => toggleSort(k)}>
      <span className="inline-flex items-center gap-1">
        {label}
        {sortKey === k ? <span className="text-xs">{sortDir === 'asc' ? '▲' : '▼'}</span> : <span className="text-xs text-slate-300">↕</span>}
      </span>
    </th>
  );

  function LookupBadge({ result }: { result: LookupSide }) {
    if (lookup.loading && !result) return <span className="text-[10px] text-slate-400">checking…</span>;
    if (!result) return null;
    if (result.ok) {
      return (
        <span className="text-[10px] text-emerald-600" title={result.name ?? ''}>
          ✓ {result.name ? result.name.slice(0, 32) : 'verified'}
        </span>
      );
    }
    return <span className="text-[10px] text-red-600">✗ not found</span>;
  }

  return (
    <div className="space-y-6">
      <div className="card">
        <h2 className="font-semibold mb-3">Add a transaction</h2>
        <form className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3" onSubmit={submit}>
          <div>
            <label className="label">Security name *</label>
            <input className="input" required value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="label flex items-center justify-between gap-2">
              <span>Ticker *</span>
              <LookupBadge result={lookup.ticker} />
            </label>
            <input
              className={`input ${lookup.ticker && !lookup.ticker.ok ? 'border-red-400' : ''}`}
              required
              value={form.ticker ?? ''}
              onChange={(e) => setForm({ ...form, ticker: e.target.value })}
            />
          </div>
          <div>
            <label className="label flex items-center justify-between gap-2">
              <span>ISIN *</span>
              <LookupBadge result={lookup.isin} />
            </label>
            <input
              className={`input ${lookup.isin && !lookup.isin.ok ? 'border-red-400' : ''}`}
              required
              value={form.isin ?? ''}
              onChange={(e) => setForm({ ...form, isin: e.target.value.toUpperCase() })}
            />
          </div>
          <div>
            <label className="label">Category</label>
            <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as AssetCategory })}>
              {(['Stock', 'Bond', 'ETF', 'MutualFund', 'Commodities', 'Crypto', 'Other'] as AssetCategory[]).map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Type</label>
            <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as FormType })}>
              <option value="BUY">Buy</option>
              <option value="SELL">Sell</option>
              <option value="DIVIDEND">Dividend</option>
            </select>
          </div>
          <div>
            <label className="label">Date</label>
            <input className="input" type="date" required value={form.date ?? ''} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </div>
          {!isDividend && (
            <div>
              <label className="label">Shares</label>
              <input className="input" type="number" step="any" required value={form.shares ?? 0} onChange={(e) => setForm({ ...form, shares: parseFloat(e.target.value) })} />
            </div>
          )}
          <div>
            <label className="label">{isDividend ? 'Net amount (EUR)' : 'Gross amount (currency)'}</label>
            <input className="input" type="number" step="any" required value={form.grossAmount ?? 0} onChange={(e) => setForm({ ...form, grossAmount: parseFloat(e.target.value) })} />
          </div>
          {!isDividend && (
            <div>
              <label className="label">Currency</label>
              <input className="input" value={form.currency ?? 'EUR'} onChange={(e) => setForm({ ...form, currency: e.target.value })} />
            </div>
          )}
          {!isDividend && (
            <div>
              <label className="label">FX rate → EUR</label>
              <input className="input" type="number" step="any" value={form.exchangeRate ?? 1} onChange={(e) => setForm({ ...form, exchangeRate: parseFloat(e.target.value) })} />
            </div>
          )}
          {!isDividend && (
            <div>
              <label className="label">Fees</label>
              <input className="input" type="number" step="any" value={form.fees ?? 0} onChange={(e) => setForm({ ...form, fees: parseFloat(e.target.value) })} />
            </div>
          )}
          <div>
            <label className="label">{isDividend ? 'Withholding tax (EUR)' : 'Taxes'}</label>
            <input className="input" type="number" step="any" value={form.taxes ?? 0} onChange={(e) => setForm({ ...form, taxes: parseFloat(e.target.value) })} />
          </div>
          <div className="sm:col-span-2 md:col-span-3 flex flex-wrap justify-end items-center gap-3">
            {validationFailed && !overrideValidation && (form.ticker || form.isin) && (
              <button
                type="button"
                className="text-xs text-amber-700 hover:underline"
                onClick={() => setOverrideValidation(true)}
              >
                Submit anyway
              </button>
            )}
            {overrideValidation && (
              <span className="text-xs text-amber-700">Validation bypassed — will submit as-is.</span>
            )}
            <button className="btn-primary" disabled={submitting}>{submitting ? 'Saving…' : (isDividend ? 'Add dividend' : 'Add transaction')}</button>
          </div>
        </form>
        {error && <div className="text-sm text-red-600 mt-2">{error}</div>}
      </div>

      <div className="card overflow-x-auto">
        <h2 className="font-semibold mb-3">
          Activity ({transactions.length} transactions · {dividends.length} dividends/coupons)
        </h2>
        {loading ? <p>Loading…</p> : isMobile ? (
          <ul className="space-y-2">
            {sorted.map((a) => (
              <li key={a.id} className="border border-slate-200 dark:border-slate-700 rounded-lg p-3 text-sm">
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{a.securityName}</div>
                    <div className="text-xs text-slate-500 truncate">{a.ticker ?? a.isin ?? ''} · {formatDate(a.date)}</div>
                  </div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${typeBadgeClass(a.type)}`}>{a.type}</span>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                  <div className="text-slate-500">Gross</div>
                  <div className="text-right tabular-nums">{formatMoney(a.grossEur)}</div>
                  {a.shares !== null && (
                    <>
                      <div className="text-slate-500">Shares</div>
                      <div className="text-right tabular-nums">{a.shares}</div>
                    </>
                  )}
                  {a.fees > 0 && (
                    <>
                      <div className="text-slate-500">Fees</div>
                      <div className="text-right tabular-nums">{formatMoney(a.fees)}</div>
                    </>
                  )}
                  {a.taxes > 0 && (
                    <>
                      <div className="text-slate-500">Taxes</div>
                      <div className="text-right tabular-nums">{formatMoney(a.taxes)}</div>
                    </>
                  )}
                </div>
                <div className="text-right mt-1">
                  <button className="text-red-600 text-xs hover:underline" onClick={() => del(a)}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-slate-500 border-b border-slate-200 dark:border-slate-700">
                <SortHeader k="date" label="Date" />
                <SortHeader k="security" label="Security" />
                <SortHeader k="type" label="Type" />
                <th className="py-2 pr-3 text-right">Shares</th>
                <SortHeader k="gross" label="Gross" align="right" />
                <th className="py-2 pr-3 text-right">Fees</th>
                <th className="py-2 pr-3 text-right">Taxes</th>
                <th className="py-2 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((a) => (
                <tr key={a.id} className="border-b border-slate-100 dark:border-slate-700/50">
                  <td className="py-1.5 pr-3 whitespace-nowrap">{formatDate(a.date)}</td>
                  <td className="py-1.5 pr-3">
                    <div className="font-medium">{a.securityName}</div>
                    <div className="text-xs text-slate-500">{a.ticker ?? a.isin ?? ''}</div>
                  </td>
                  <td className="py-1.5 pr-3">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${typeBadgeClass(a.type)}`}>{a.type}</span>
                  </td>
                  <td className="py-1.5 pr-3 text-right">{a.shares ?? '—'}</td>
                  <td className="py-1.5 pr-3 text-right">{formatMoney(a.grossEur)}</td>
                  <td className="py-1.5 pr-3 text-right">{a.fees ? formatMoney(a.fees) : '—'}</td>
                  <td className="py-1.5 pr-3 text-right">{a.taxes ? formatMoney(a.taxes) : '—'}</td>
                  <td className="py-1.5 pr-3 text-right">
                    <button className="text-red-600 text-xs hover:underline" onClick={() => del(a)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

