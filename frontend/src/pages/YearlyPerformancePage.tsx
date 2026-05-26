import { useEffect, useState } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend,
} from 'recharts';
import { api, apiErrorMessage } from '../api/client';
import type { YearlyPerformance } from '../types';
import { colorForReturn, formatMoney, formatMoneyDetail, formatPct } from '../utils/format';

export default function YearlyPerformancePage() {
  const [years, setYears] = useState<YearlyPerformance[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
              <YAxis yAxisId="left" tick={{ fontSize: 11 }} tickFormatter={(v) => formatMoney(v)} width={75} />
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
                <td className="py-1.5 pr-3 text-right">{formatMoneyDetail(y.startValue)}</td>
                <td className="py-1.5 pr-3 text-right">{formatMoneyDetail(y.endValue)}</td>
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
                <td className={`py-1.5 pr-3 text-right ${colorForReturn(y.benchmarkTwr)}`}>{formatPct(y.benchmarkTwr)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-slate-500 mt-3">
          <strong>Gross yield</strong> = return before taxes (includes the tax already paid back in).
          <strong className="ml-2">Net yield</strong> = what you actually keep after dividend withholding and capital-gains tax.
          The <em>Taxes</em> column hovers tooltip splits dividend tax vs. capital gains tax.
        </p>
      </div>
    </div>
  );
}
