import { useEffect, useState } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend,
} from 'recharts';
import { api, apiErrorMessage } from '../api/client';
import type { YearlyPerformance } from '../types';
import { colorForReturn, formatMoney, formatMoneyCompact, formatPct } from '../utils/format';
import { useIsMobile } from '../utils/useIsMobile';

export default function YearlyPerformancePage() {
  const [years, setYears] = useState<YearlyPerformance[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const isMobile = useIsMobile();

  useEffect(() => {
    setLoading(true);
    api.get<{ years: YearlyPerformance[] }>('/portfolio/yearly-performance')
      .then((res) => setYears(res.data.years))
      .catch((err) => setError(apiErrorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-10">Computing yearly performance…</div>;
  if (error) return <div className="card text-red-600">Error: {error}</div>;
  if (years.length === 0) return <div className="card">No history yet. Import or add a transaction first.</div>;

  const chartData = years.map((y) => ({
    year: y.year,
    invested: y.invested,
    dividends: y.dividendsGross,
    portfolio: y.endValue,
    twr: y.twr * 100,
    mwr: (y.mwr ?? 0) * 100,
    benchmarkTwr: y.benchmarkTwr * 100,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Yearly performance</h1>
        <p className="text-sm text-slate-500">
          Breakdown of each calendar year: contributions, gains, and both time-weighted
          (cash-flow-neutral, comparable) and money-weighted (XIRR, your actual return) yields.
        </p>
      </div>

      <div className="card">
        <h2 className="font-semibold mb-2">Yearly returns</h2>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="year" tick={{ fontSize: 12 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 11 }} tickFormatter={(v) => formatMoneyCompact(v)} width={75} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} tickFormatter={(v) => `${v.toFixed(0)}%`} width={45} />
              <Tooltip
                formatter={(value: number, name: string) => {
                  if (name === 'TWR' || name === 'MWR' || name === 'S&P TWR') return [`${value.toFixed(2)}%`, name];
                  return [formatMoney(value), name];
                }}
              />
              <Legend />
              <Bar yAxisId="left" dataKey="invested" name="Net invested" fill="#94a3b8" />
              <Bar yAxisId="left" dataKey="dividends" name="Dividends (gross)" fill="#10b981" />
              <Line yAxisId="right" type="monotone" dataKey="twr" name="TWR" stroke="#2563eb" strokeWidth={2} dot />
              <Line yAxisId="right" type="monotone" dataKey="mwr" name="MWR" stroke="#7c3aed" strokeWidth={2} strokeDasharray="4 4" dot />
              <Line yAxisId="right" type="monotone" dataKey="benchmarkTwr" name="S&P TWR" stroke="#f59e0b" strokeWidth={2} dot />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <h2 className="font-semibold mb-2">Per-year detail</h2>
        {isMobile ? (
          <ul className="space-y-3">
            {[...years].reverse().map((y) => (
              <li key={y.year} className="border border-slate-200 dark:border-slate-700 rounded-lg p-3 text-sm">
                <div className="flex items-baseline justify-between mb-2">
                  <span className="font-semibold text-base">{y.year}</span>
                  <span className={`tabular-nums font-semibold ${colorForReturn(y.twr)}`}>{formatPct(y.twr)} TWR</span>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
                  <div>Start</div><div className="text-right tabular-nums">{formatMoney(y.startValue)}</div>
                  <div>End</div><div className="text-right tabular-nums">{formatMoney(y.endValue)}</div>
                  <div>Growth</div>
                  <div className={`text-right tabular-nums ${colorForReturn(y.valueChange)}`}>{formatMoney(y.valueChange)}</div>
                  <div>Invested</div><div className="text-right tabular-nums">{formatMoney(y.invested)}</div>
                  <div>Div. gross</div><div className="text-right tabular-nums">{formatMoney(y.dividendsGross)}</div>
                  <div>Div. net</div><div className="text-right tabular-nums">{formatMoney(y.dividendsNet)}</div>
                  <div>Taxes</div>
                  <div className="text-right tabular-nums text-red-600" title={`Dividend tax ${formatMoney(y.dividendsTaxes)} + cap gains ${formatMoney(y.capitalGainsTaxes)}`}>
                    {y.taxesPaid > 0 ? formatMoney(y.taxesPaid) : '—'}
                  </div>
                  <div>Tx costs</div>
                  <div className="text-right tabular-nums text-slate-500">{y.transactionCosts > 0 ? formatMoney(y.transactionCosts) : '—'}</div>
                  <div>Gross yield</div>
                  <div className={`text-right tabular-nums ${colorForReturn(y.grossYield)}`}>{formatPct(y.grossYield)}</div>
                  <div>Net yield</div>
                  <div className={`text-right tabular-nums ${colorForReturn(y.netYield)}`}>{formatPct(y.netYield)}</div>
                  <div>MWR</div>
                  <div className={`text-right tabular-nums ${y.mwr !== null ? colorForReturn(y.mwr) : ''}`}>
                    {y.mwr !== null ? formatPct(y.mwr) : '—'}
                  </div>
                  <div>S&amp;P TWR</div>
                  <div
                    className={`text-right tabular-nums ${y.benchmarkTwr === y.twr ? 'text-slate-500' : y.benchmarkTwr < y.twr ? 'text-emerald-600' : 'text-red-600'}`}
                    title={`vs portfolio TWR ${formatPct(y.twr)} — ${y.benchmarkTwr < y.twr ? 'you beat the index' : y.benchmarkTwr > y.twr ? 'index beat you' : 'tied'}`}
                  >
                    {formatPct(y.benchmarkTwr)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-slate-500 border-b border-slate-200 dark:border-slate-700">
              <th className="py-2 pr-3 text-left">Year</th>
              <th className="py-2 pr-3 text-right">Start value</th>
              <th className="py-2 pr-3 text-right">End value</th>
              <th className="py-2 pr-3 text-right">Growth</th>
              <th className="py-2 pr-3 text-right">Invested (net)</th>
              <th className="py-2 pr-3 text-right">Div. gross</th>
              <th className="py-2 pr-3 text-right">Div. net</th>
              <th className="py-2 pr-3 text-right">Taxes</th>
              <th className="py-2 pr-3 text-right">Tx&nbsp;costs</th>
              <th className="py-2 pr-3 text-right">Gross yield</th>
              <th className="py-2 pr-3 text-right">Net yield</th>
              <th className="py-2 pr-3 text-right">TWR</th>
              <th className="py-2 pr-3 text-right">MWR</th>
              <th className="py-2 pr-3 text-right">S&amp;P TWR</th>
            </tr>
          </thead>
          <tbody>
            {[...years].reverse().map((y) => (
              <tr key={y.year} className="border-b border-slate-100 dark:border-slate-700/50">
                <td className="py-1.5 pr-3 font-semibold">{y.year}</td>
                <td className="py-1.5 pr-3 text-right">{formatMoney(y.startValue)}</td>
                <td className="py-1.5 pr-3 text-right">{formatMoney(y.endValue)}</td>
                <td className={`py-1.5 pr-3 text-right ${colorForReturn(y.valueChange)}`}>{formatMoney(y.valueChange)}</td>
                <td className="py-1.5 pr-3 text-right">{formatMoney(y.invested)}</td>
                <td className="py-1.5 pr-3 text-right">{formatMoney(y.dividendsGross)}</td>
                <td className="py-1.5 pr-3 text-right">{formatMoney(y.dividendsNet)}</td>
                <td className="py-1.5 pr-3 text-right text-red-600" title={`Dividend tax ${formatMoney(y.dividendsTaxes)} + capital gains tax ${formatMoney(y.capitalGainsTaxes)}`}>
                  {y.taxesPaid > 0 ? formatMoney(y.taxesPaid) : '—'}
                </td>
                <td className="py-1.5 pr-3 text-right text-slate-500">
                  {y.transactionCosts > 0 ? formatMoney(y.transactionCosts) : '—'}
                </td>
                <td className={`py-1.5 pr-3 text-right ${colorForReturn(y.grossYield)}`}>{formatPct(y.grossYield)}</td>
                <td className={`py-1.5 pr-3 text-right ${colorForReturn(y.netYield)}`}>{formatPct(y.netYield)}</td>
                <td className={`py-1.5 pr-3 text-right ${colorForReturn(y.twr)}`}>{formatPct(y.twr)}</td>
                <td className={`py-1.5 pr-3 text-right ${y.mwr !== null ? colorForReturn(y.mwr) : ''}`}>
                  {y.mwr !== null ? formatPct(y.mwr) : '—'}
                </td>
                <td className={`py-1.5 pr-3 text-right ${y.benchmarkTwr === y.twr ? 'text-slate-500' : y.benchmarkTwr < y.twr ? 'text-emerald-600' : 'text-red-600'}`} title={`vs portfolio TWR ${formatPct(y.twr)} — ${y.benchmarkTwr < y.twr ? 'you beat the index' : y.benchmarkTwr > y.twr ? 'index beat you' : 'tied'}`}>
                  {formatPct(y.benchmarkTwr)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        )}
        <p className="text-xs text-slate-500 mt-3">
          <strong>Gross yield</strong> = return before taxes (includes the tax already paid back in).
          <strong className="ml-2">Net yield</strong> = what you actually keep after dividend withholding and capital-gains tax.
          The <em>Taxes</em> column hovers tooltip splits dividend tax vs. capital gains tax.
        </p>
      </div>
    </div>
  );
}
