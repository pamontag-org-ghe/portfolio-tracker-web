import { useEffect, useMemo, useState } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend,
} from 'recharts';
import { api, apiErrorMessage } from '../api/client';
import type { RealizedAnalytics } from '../types';
import { colorForReturn, formatDate, formatMoney, formatMoneyCompact, formatNumber, formatPct } from '../utils/format';
import { useIsMobile } from '../utils/useIsMobile';

export default function RealizedPage() {
  const [data, setData] = useState<RealizedAnalytics | null>(null);
  const [yearFilter, setYearFilter] = useState<number | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    setLoading(true);
    api.get<RealizedAnalytics>('/portfolio/realized')
      .then((res) => setData(res.data))
      .catch((err) => setError(apiErrorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  const availableYears = useMemo(() => {
    if (!data) return [] as number[];
    return [...data.perYear.map((y) => y.year)].sort((a, b) => b - a);
  }, [data]);

  const filteredTrades = useMemo(() => {
    if (!data) return [];
    if (yearFilter === 'all') return data.trades;
    return data.trades.filter((t) => new Date(t.date).getFullYear() === yearFilter);
  }, [data, yearFilter]);

  const filteredTotals = useMemo(() => {
    const empty = {
      grossEur: 0,
      netEur: 0,
      pnlEur: 0,
      dividendsEur: 0,
      pnlWithDividendsEur: 0,
      costBasisEur: 0,
      avgPnlPct: null as number | null,
      avgPnlWithDividendsPct: null as number | null,
      trades: 0,
    };
    if (yearFilter === 'all') return data?.totals ?? empty;
    const agg = filteredTrades.reduce(
      (acc, t) => {
        acc.grossEur += t.grossEur;
        acc.netEur += t.netEur;
        acc.pnlEur += t.pnlAbsEur;
        acc.dividendsEur += t.dividendsEur;
        acc.pnlWithDividendsEur += t.pnlWithDividendsEur;
        acc.costBasisEur += t.costBasisEur;
        acc.trades += 1;
        return acc;
      },
      { ...empty },
    );
    agg.avgPnlPct = agg.costBasisEur > 0 ? agg.pnlEur / agg.costBasisEur : null;
    agg.avgPnlWithDividendsPct = agg.costBasisEur > 0 ? agg.pnlWithDividendsEur / agg.costBasisEur : null;
    return agg;
  }, [data, yearFilter, filteredTrades]);

  if (loading) return <div className="text-center py-10">Loading realized gains…</div>;
  if (error) return <div className="card text-red-600">Error: {error}</div>;
  if (!data) return <div className="card">No realized data.</div>;
  if (data.trades.length === 0) {
    return <div className="card">No realized trades yet. Once you sell a position, it will appear here.</div>;
  }

  const chartData = data.perYear.map((y) => ({
    year: y.year,
    gross: y.grossEur,
    net: y.netEur,
    pnl: y.pnlEur,
    dividends: y.dividendsEur,
    pnlWithDiv: y.pnlWithDividendsEur,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Realized gains</h1>
        <p className="text-sm text-slate-500">
          Sells history and realized profit / loss per year (EUR, FX-adjusted, average-cost method).
          Dividends and coupons attributed to each sold lot pro-rata of the shares sold.
        </p>
      </div>

      <div className="card">
        <h2 className="font-semibold mb-2">Realized P/L per year</h2>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="year" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatMoneyCompact(v)} width={75} />
              <Tooltip formatter={(value: number, name: string) => [formatMoney(value), name]} />
              <Legend />
              <Bar dataKey="pnl" name="Realized P/L (capital)" fill="#10b981" />
              <Bar dataKey="dividends" name="Dividends collected" fill="#f59e0b" />
              {/* Line that crosses the bars to highlight the realized P/L trajectory. */}
              <Line type="monotone" dataKey="pnl" name="P/L (line)" stroke="#1d4ed8" strokeWidth={2} dot />
              <Line type="monotone" dataKey="pnlWithDiv" name="P/L incl. dividends" stroke="#7c3aed" strokeWidth={2} strokeDasharray="4 4" dot />
            </ComposedChart>
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

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="card">
          <div className="kpi-label">Trades</div>
          <div className="kpi-value">{filteredTotals.trades}</div>
        </div>
        <div className="card">
          <div className="kpi-label">Gross proceeds</div>
          <div className="kpi-value">{formatMoney(filteredTotals.grossEur)}</div>
        </div>
        <div className="card">
          <div className="kpi-label">Net proceeds</div>
          <div className="kpi-value">{formatMoney(filteredTotals.netEur)}</div>
          <div className="text-xs text-slate-500 mt-1">After fees &amp; capital-gains tax</div>
        </div>
        <div className="card">
          <div className="kpi-label">Realized P/L</div>
          <div className={`kpi-value ${colorForReturn(filteredTotals.pnlEur)}`}>{formatMoney(filteredTotals.pnlEur)}</div>
          <div className="text-xs text-slate-500 mt-1">Capital gain only</div>
        </div>
        <div className="card">
          <div className="kpi-label">Dividends collected</div>
          <div className={`kpi-value ${colorForReturn(filteredTotals.dividendsEur)}`}>{formatMoney(filteredTotals.dividendsEur)}</div>
          <div className="text-xs text-slate-500 mt-1">Net, attributed to sold lots</div>
        </div>
        <div
          className="card"
          title="Sum of capital gain + dividends collected on the sold shares."
        >
          <div className="kpi-label">P/L incl. dividends</div>
          <div className={`kpi-value ${colorForReturn(filteredTotals.pnlWithDividendsEur)}`}>{formatMoney(filteredTotals.pnlWithDividendsEur)}</div>
          <div
            className={`text-xs mt-1 ${filteredTotals.avgPnlWithDividendsPct !== null ? colorForReturn(filteredTotals.avgPnlWithDividendsPct) : 'text-slate-500'}`}
            title="Total P/L incl. dividends divided by total cost basis (cost-basis-weighted average)."
          >
            Avg yield {filteredTotals.avgPnlWithDividendsPct !== null ? formatPct(filteredTotals.avgPnlWithDividendsPct) : '—'}
          </div>
        </div>
      </div>

      <div className="text-xs text-slate-500 -mt-2">
        Avg P/L (capital only):{' '}
        <span className={filteredTotals.avgPnlPct !== null ? colorForReturn(filteredTotals.avgPnlPct) : ''}>
          {filteredTotals.avgPnlPct !== null ? formatPct(filteredTotals.avgPnlPct) : '—'}
        </span>{' '}
        · cost basis sold {formatMoney(filteredTotals.costBasisEur)} · weighted by cost basis.
      </div>

      <div className="card overflow-x-auto">
        <h2 className="font-semibold mb-2">
          Sell trades {yearFilter !== 'all' ? `· ${yearFilter}` : ''}
        </h2>
        {filteredTrades.length === 0 ? (
          <p className="text-sm text-slate-500">No sells in this period.</p>
        ) : isMobile ? (
          <ul className="space-y-3">
            {filteredTrades.map((t) => (
              <li key={t.transactionId} className="border border-slate-200 dark:border-slate-700 rounded-lg p-3 text-sm">
                <div className="flex items-baseline justify-between mb-2 gap-2">
                  <span className="font-semibold truncate">{t.name}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${t.positionClosed ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>
                    {t.positionClosed ? 'Closed' : 'Partial'}
                  </span>
                </div>
                <div className="text-xs text-slate-500 mb-2">{t.ticker ?? t.isin ?? ''} · {formatDate(t.date)}</div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
                  <div>Shares sold</div><div className="text-right tabular-nums">{formatNumber(t.sharesSold, 4)}</div>
                  <div>Price buy ({t.currency})</div>
                  <div className="text-right tabular-nums">
                    {t.priceConvention === 'percent' ? `${t.priceBought.toFixed(3)}%` : formatMoney(t.priceBought, t.currency)}
                  </div>
                  <div>Price sold ({t.currency})</div>
                  <div className="text-right tabular-nums">
                    {t.priceConvention === 'percent' ? `${t.priceSold.toFixed(3)}%` : formatMoney(t.priceSold, t.currency)}
                  </div>
                  <div>Gross (EUR)</div><div className="text-right tabular-nums">{formatMoney(t.grossEur)}</div>
                  <div>Net (EUR)</div><div className="text-right tabular-nums">{formatMoney(t.netEur)}</div>
                  <div>Cost basis</div><div className="text-right tabular-nums">{formatMoney(t.costBasisEur)}</div>
                  <div>P/L (capital)</div>
                  <div className={`text-right tabular-nums ${colorForReturn(t.pnlAbsEur)}`}>{formatMoney(t.pnlAbsEur)}</div>
                  <div>P/L %</div>
                  <div className={`text-right tabular-nums ${t.pnlPct !== null ? colorForReturn(t.pnlPct) : ''}`}>
                    {t.pnlPct !== null ? formatPct(t.pnlPct) : '—'}
                  </div>
                  <div title="Net dividends/coupons attributed to the sold shares.">Dividends</div>
                  <div className={`text-right tabular-nums ${colorForReturn(t.dividendsEur)}`}>
                    {t.dividendsEur !== 0 ? formatMoney(t.dividendsEur) : '—'}
                  </div>
                  <div>P/L incl. div</div>
                  <div className={`text-right tabular-nums ${colorForReturn(t.pnlWithDividendsEur)}`}>{formatMoney(t.pnlWithDividendsEur)}</div>
                  <div>P/L incl. div %</div>
                  <div className={`text-right tabular-nums ${t.pnlWithDividendsPct !== null ? colorForReturn(t.pnlWithDividendsPct) : ''}`}>
                    {t.pnlWithDividendsPct !== null ? formatPct(t.pnlWithDividendsPct) : '—'}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-slate-500 border-b border-slate-200 dark:border-slate-700">
                <th className="py-2 pr-3 text-left">Date</th>
                <th className="py-2 pr-3 text-left">Security</th>
                <th className="py-2 pr-3 text-right">Shares</th>
                <th className="py-2 pr-3 text-right">Price buy</th>
                <th className="py-2 pr-3 text-right">Price sold</th>
                <th className="py-2 pr-3 text-right">Gross (EUR)</th>
                <th className="py-2 pr-3 text-right">Net (EUR)</th>
                <th className="py-2 pr-3 text-right">Cost basis</th>
                <th className="py-2 pr-3 text-right" title="Capital gain only — excludes dividends.">P/L</th>
                <th className="py-2 pr-3 text-right">P/L %</th>
                <th className="py-2 pr-3 text-right" title="Net dividends / coupons attributed to the sold shares (pro-rata).">Dividends</th>
                <th className="py-2 pr-3 text-right">P/L incl. div</th>
                <th className="py-2 pr-3 text-right">P/L incl. div %</th>
                <th className="py-2 pr-3 text-center">Closed</th>
              </tr>
            </thead>
            <tbody>
              {filteredTrades.map((t) => (
                <tr key={t.transactionId} className="border-b border-slate-100 dark:border-slate-700/50">
                  <td className="py-1.5 pr-3 text-slate-600 dark:text-slate-300">{formatDate(t.date)}</td>
                  <td className="py-1.5 pr-3">
                    <div className="font-medium">{t.name}</div>
                    <div className="text-xs text-slate-500">{t.ticker ?? t.isin ?? ''}</div>
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{formatNumber(t.sharesSold, 4)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-slate-500" title={`Currency: ${t.currency}`}>
                    {t.priceConvention === 'percent'
                      ? `${t.priceBought.toFixed(3)}%`
                      : formatMoney(t.priceBought, t.currency)}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums" title={`Currency: ${t.currency}`}>
                    {t.priceConvention === 'percent'
                      ? `${t.priceSold.toFixed(3)}%`
                      : formatMoney(t.priceSold, t.currency)}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(t.grossEur)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(t.netEur)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(t.costBasisEur)}</td>
                  <td className={`py-1.5 pr-3 text-right tabular-nums ${colorForReturn(t.pnlAbsEur)}`}>{formatMoney(t.pnlAbsEur)}</td>
                  <td className={`py-1.5 pr-3 text-right tabular-nums ${t.pnlPct !== null ? colorForReturn(t.pnlPct) : ''}`}>
                    {t.pnlPct !== null ? formatPct(t.pnlPct) : '—'}
                  </td>
                  <td className={`py-1.5 pr-3 text-right tabular-nums ${t.dividendsEur !== 0 ? colorForReturn(t.dividendsEur) : 'text-slate-400'}`}>
                    {t.dividendsEur !== 0 ? formatMoney(t.dividendsEur) : '—'}
                  </td>
                  <td className={`py-1.5 pr-3 text-right tabular-nums ${colorForReturn(t.pnlWithDividendsEur)}`}>{formatMoney(t.pnlWithDividendsEur)}</td>
                  <td className={`py-1.5 pr-3 text-right tabular-nums ${t.pnlWithDividendsPct !== null ? colorForReturn(t.pnlWithDividendsPct) : ''}`}>
                    {t.pnlWithDividendsPct !== null ? formatPct(t.pnlWithDividendsPct) : '—'}
                  </td>
                  <td className="py-1.5 pr-3 text-center">
                    {t.positionClosed ? (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">Yes</span>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
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
