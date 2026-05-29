import { useEffect, useMemo, useState } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend, LabelList,
} from 'recharts';
import { api, apiErrorMessage } from '../api/client';
import type { DividendAnalytics } from '../types';
import { colorForReturn, formatMoney, formatMoneyCompact, formatPct } from '../utils/format';
import { useIsMobile } from '../utils/useIsMobile';

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function DividendsPage() {
  const [data, setData] = useState<DividendAnalytics | null>(null);
  const [allTime, setAllTime] = useState<DividendAnalytics | null>(null);
  const [yearFilter, setYearFilter] = useState<number | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    setLoading(true);
    api.get<DividendAnalytics>('/portfolio/dividends-analytics')
      .then((res) => {
        setAllTime(res.data);
        setData(res.data);
      })
      .catch((err) => setError(apiErrorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (yearFilter === 'all') {
      setData(allTime);
      return;
    }
    setLoading(true);
    api.get<DividendAnalytics>('/portfolio/dividends-analytics', { params: { year: yearFilter } })
      .then((res) => setData(res.data))
      .catch((err) => setError(apiErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [yearFilter, allTime]);

  const availableYears = useMemo(() => {
    if (!allTime) return [] as number[];
    return [...allTime.perYear.map((y) => y.year)].sort((a, b) => b - a);
  }, [allTime]);

  if (loading && !data) return <div className="text-center py-10">Loading dividends…</div>;
  if (error) return <div className="card text-red-600">Error: {error}</div>;
  if (!data || !allTime) return <div className="card">No dividend data yet.</div>;
  if (allTime.perYear.length === 0) {
    return <div className="card">No dividends recorded. Once you receive a dividend, the analytics will appear here.</div>;
  }

  const yearlyChartData = allTime.perYear.map((y) => ({
    year: y.year,
    gross: y.gross,
    net: y.net,
    growth: y.growthPct !== null ? y.growthPct * 100 : null,
    growthLabel: y.growthPct !== null
      ? `${y.growthPct >= 0 ? '+' : ''}${(y.growthPct * 100).toFixed(1)}%`
      : '',
  }));

  const monthlyChartData = data.perMonth.map((m) => ({
    month: MONTH_LABELS[m.month - 1] ?? String(m.month),
    gross: m.gross,
    net: m.net,
  }));

  const showMonthly = yearFilter !== 'all';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Dividends</h1>
        <p className="text-sm text-slate-500">
          Yearly and monthly dividend income, with growth, yield-on-cost and CAGR.
        </p>
      </div>

      <div className="card">
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="font-semibold">{showMonthly ? `Monthly dividends · ${yearFilter}` : 'Yearly dividends'}</h2>
          {!showMonthly && (
            <span className="text-xs text-slate-500">growth % vs previous year</span>
          )}
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            {showMonthly ? (
              <ComposedChart data={monthlyChartData} margin={{ top: 16, right: 20, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatMoneyCompact(v)} width={75} />
                <Tooltip formatter={(value: number, name: string) => [formatMoney(value), name]} />
                <Legend />
                <Bar dataKey="gross" name="Gross" fill="#10b981" />
                <Bar dataKey="net" name="Net" fill="#2563eb" />
                {/* Line across the bars highlights the net trajectory month-over-month. */}
                <Line type="monotone" dataKey="net" name="Net (line)" stroke="#1d4ed8" strokeWidth={2} dot />
              </ComposedChart>
            ) : (
              <ComposedChart data={yearlyChartData} margin={{ top: 28, right: 20, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="year" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatMoneyCompact(v)} width={75} />
                <Tooltip formatter={(value: number, name: string) => [formatMoney(value), name]} />
                <Legend />
                <Bar dataKey="gross" name="Gross" fill="#10b981">
                  <LabelList
                    dataKey="growthLabel"
                    position="top"
                    style={{ fontSize: 11, fill: '#64748b' }}
                  />
                </Bar>
                <Bar dataKey="net" name="Net" fill="#2563eb" />
                {/* Line across the columns to emphasise net-amount progression year over year. */}
                <Line type="monotone" dataKey="net" name="Net (line)" stroke="#1d4ed8" strokeWidth={2} dot />
              </ComposedChart>
            )}
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card">
        <h2 className="font-semibold mb-2">Filter</h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={`px-3 py-1.5 rounded-md text-sm border ${yearFilter === 'all' ? 'bg-brand-600 text-white border-brand-600' : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200'}`}
            onClick={() => setYearFilter('all')}
          >
            All time
          </button>
          {availableYears.map((y) => (
            <button
              key={y}
              type="button"
              className={`px-3 py-1.5 rounded-md text-sm border ${yearFilter === y ? 'bg-brand-600 text-white border-brand-600' : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200'}`}
              onClick={() => setYearFilter(y)}
            >
              {y}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="card">
          <div className="kpi-label">Total gross</div>
          <div className="kpi-value">{formatMoney(data.totals.gross)}</div>
          <div className="text-xs text-slate-500 mt-1">
            {showMonthly ? `Year ${yearFilter}` : 'Lifetime'}
          </div>
        </div>
        <div className="card">
          <div className="kpi-label">Total net</div>
          <div className="kpi-value">{formatMoney(data.totals.net)}</div>
          <div className="text-xs text-slate-500 mt-1">
            {showMonthly ? `Year ${yearFilter} · ` : ''}After {formatMoney(data.totals.gross - data.totals.net)} tax
          </div>
        </div>
        <div className="card">
          <div className="kpi-label">TTM (gross)</div>
          <div className="kpi-value">{formatMoney(data.totals.ttmGross)}</div>
          <div className="text-xs text-slate-500 mt-1" title="Trailing 12 months as of today — always lifetime, ignores year filter.">
            Net {formatMoney(data.totals.ttmNet)} · lifetime
          </div>
        </div>
        <div className="card">
          <div className="kpi-label">YoC-TTM</div>
          <div className="kpi-value">
            {data.totals.yieldOnCostTtm !== null ? formatPct(data.totals.yieldOnCostTtm) : '—'}
          </div>
          <div className="text-xs text-slate-500 mt-1" title="TTM gross / cost basis of dividend-paying holdings — lifetime.">
            on {formatMoney(data.totals.coveredCost)} cost · lifetime
          </div>
        </div>
        <div className="card">
          <div className="kpi-label">CAGR</div>
          <div className="kpi-value">
            {data.totals.cagr !== null ? formatPct(data.totals.cagr) : '—'}
          </div>
          <div className="text-xs text-slate-500 mt-1" title="Compound annual growth of yearly gross dividends — lifetime.">Compound annual · lifetime</div>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <h2 className="font-semibold mb-2">
          Per-security {showMonthly ? `· ${yearFilter}` : ''}
        </h2>
        {data.perSecurity.length === 0 ? (
          <p className="text-sm text-slate-500">No dividend-paying securities in this period.</p>
        ) : isMobile ? (
          <ul className="space-y-3">
            {data.perSecurity.map((s) => (
              <li key={s.securityId} className="border border-slate-200 dark:border-slate-700 rounded-lg p-3 text-sm">
                <div className="flex items-baseline justify-between mb-2 gap-2">
                  <span className="font-semibold truncate">{s.name}</span>
                  <span className="text-xs text-slate-500 shrink-0">{s.ticker ?? s.isin ?? ''}</span>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
                  <div>Gross</div><div className="text-right tabular-nums">{formatMoney(s.gross)}</div>
                  <div>Net</div><div className="text-right tabular-nums">{formatMoney(s.net)}</div>
                  <div>TTM gross</div><div className="text-right tabular-nums">{formatMoney(s.ttmGross)}</div>
                  <div>YoC-TTM</div>
                  <div className="text-right tabular-nums">{s.yieldOnCostTtm !== null ? formatPct(s.yieldOnCostTtm) : '—'}</div>
                  <div>YoY growth</div>
                  <div className={`text-right tabular-nums ${s.growthYoY !== null ? colorForReturn(s.growthYoY) : ''}`}>
                    {s.growthYoY !== null ? formatPct(s.growthYoY) : '—'}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-slate-500 border-b border-slate-200 dark:border-slate-700">
                <th className="py-2 pr-3 text-left">Security</th>
                <th className="py-2 pr-3 text-left">Ticker</th>
                <th className="py-2 pr-3 text-right">Gross</th>
                <th className="py-2 pr-3 text-right">Net</th>
                <th className="py-2 pr-3 text-right">TTM gross</th>
                <th className="py-2 pr-3 text-right">YoC-TTM</th>
                <th className="py-2 pr-3 text-right">YoY growth</th>
              </tr>
            </thead>
            <tbody>
              {data.perSecurity.map((s) => (
                <tr key={s.securityId} className="border-b border-slate-100 dark:border-slate-700/50">
                  <td className="py-1.5 pr-3 font-medium">{s.name}</td>
                  <td className="py-1.5 pr-3 text-slate-500 text-xs">{s.ticker ?? s.isin ?? ''}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(s.gross)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(s.net)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(s.ttmGross)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">
                    {s.yieldOnCostTtm !== null ? formatPct(s.yieldOnCostTtm) : '—'}
                  </td>
                  <td className={`py-1.5 pr-3 text-right tabular-nums ${s.growthYoY !== null ? colorForReturn(s.growthYoY) : ''}`}>
                    {s.growthYoY !== null ? formatPct(s.growthYoY) : '—'}
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
