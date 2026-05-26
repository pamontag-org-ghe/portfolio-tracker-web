import { useEffect, useState } from 'react';
import { api, apiErrorMessage } from '../api/client';
import type { AllocationResponse, FxRatesResponse, Holding, PerformanceResponse, TimeRange } from '../types';
import { colorForReturn, formatMoney, formatMoneyDetail, formatNumber, formatPct } from '../utils/format';
import PortfolioChart from '../components/PortfolioChart';
import ReturnsHeatmap from '../components/ReturnsHeatmap';
import AllocationDonut from '../components/AllocationDonut';
import { Link } from 'react-router-dom';

const RANGES: TimeRange[] = ['1D', '1W', '1M', 'YTD', '1Y', '3Y', '5Y', 'ALL'];

export default function DashboardPage() {
  const [perf, setPerf] = useState<PerformanceResponse | null>(null);
  const [holdings, setHoldings] = useState<Holding[] | null>(null);
  const [alloc, setAlloc] = useState<AllocationResponse | null>(null);
  const [fx, setFx] = useState<FxRatesResponse | null>(null);
  const [range, setRange] = useState<TimeRange>('ALL');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      api.get<PerformanceResponse>('/portfolio/performance'),
      api.get<{ holdings: Holding[] }>('/portfolio/holdings'),
      api.get<AllocationResponse>('/portfolio/allocation'),
      api.get<FxRatesResponse>('/portfolio/fx-rates').catch(() => ({ data: { base: 'EUR', rates: [] } })),
    ])
      .then(([p, h, a, f]) => {
        if (!alive) return;
        setPerf(p.data);
        setHoldings(h.data.holdings);
        setAlloc(a.data);
        setFx(f.data);
      })
      .catch((err) => alive && setError(apiErrorMessage(err)))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  if (loading) return <div className="text-center py-10">Loading portfolio…</div>;
  if (error) return <div className="card text-red-600">Error: {error}</div>;
  if (!perf || !holdings) return null;

  const hasData = perf.series.length > 0;
  const activeHoldings = holdings.filter((h) => h.shares > 0);
  const totalReturn = perf.totalCost > 0
    ? (perf.totalValue + perf.realizedPnL + perf.dividendsTotal - perf.totalCost) / perf.totalCost
    : 0;

  return (
    <div className="space-y-6">
      {!hasData && (
        <div className="card bg-amber-50 dark:bg-amber-950 border-amber-200">
          <p>Your portfolio is empty. <Link className="text-brand-600" to="/import">Import an xlsx file</Link> to get started.</p>
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card">
          <div className="kpi-label">Current value</div>
          <div className="kpi-value">{formatMoneyDetail(perf.totalValue)}</div>
        </div>
        <div className="card">
          <div className="kpi-label">Total invested</div>
          <div className="kpi-value">{formatMoneyDetail(perf.totalCost)}</div>
        </div>
        <div className="card">
          <div className="kpi-label">Unrealized P/L</div>
          <div className={`kpi-value ${colorForReturn(perf.unrealizedPnL)}`}>
            {formatMoneyDetail(perf.unrealizedPnL)}
            <span className="text-sm ml-2">{formatPct(perf.unrealizedPnLPct)}</span>
          </div>
        </div>
        <div className="card">
          <div className="kpi-label">Realized + Dividends</div>
          <div className={`kpi-value ${colorForReturn(perf.realizedPnL + perf.dividendsTotal)}`}>
            {formatMoneyDetail(perf.realizedPnL + perf.dividendsTotal)}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Realized {formatMoneyDetail(perf.realizedPnL)} · Dividends {formatMoneyDetail(perf.dividendsTotal)}
          </div>
        </div>
      </div>

      {/* FX strip */}
      {fx && fx.rates.length > 0 && (
        <div className="card flex flex-wrap items-center gap-x-5 gap-y-2 py-3">
          <span className="text-xs uppercase tracking-wide text-slate-500">FX → EUR</span>
          {fx.rates.map((r) => (
            <div key={r.currency} className="flex items-baseline gap-2">
              <span className="font-medium">{r.currency}/EUR</span>
              <span className="text-base tabular-nums">
                {r.rate !== null ? r.rate.toFixed(4) : '—'}
              </span>
              {r.asOf && <span className="text-xs text-slate-500">(as of {r.asOf})</span>}
            </div>
          ))}
          <span className="text-xs text-slate-400 ml-auto">Source: Yahoo Finance ({fx.rates[0]?.currency || ''}EUR=X)</span>
        </div>
      )}

      {/* Time range selector */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-500">Range:</span>
        {RANGES.map((r) => (
          <button
            key={r}
            className={`px-3 py-1 text-sm rounded-md border ${r === range ? 'bg-brand-600 text-white border-brand-600' : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
            onClick={() => setRange(r)}
          >
            {r}
          </button>
        ))}
      </div>

      {/* Range metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {(['portfolio', 'benchmark', 'spread'] as const).map((k) => {
          const m = perf.metrics[range];
          const portfolio = m?.portfolioReturnPct ?? 0;
          const bench = m?.benchmarkReturnPct ?? 0;
          const value = k === 'portfolio' ? portfolio : k === 'benchmark' ? bench : portfolio - bench;
          const label = k === 'portfolio' ? `Portfolio (${range})` : k === 'benchmark' ? `S&P 500 (${range})` : 'Spread vs S&P 500';
          return (
            <div className="card" key={k}>
              <div className="kpi-label">{label}</div>
              <div className={`kpi-value ${colorForReturn(value)}`}>{formatPct(value)}</div>
              {m && (
                <div className="text-xs text-slate-500 mt-1">
                  {m.startDate} → {m.endDate}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Chart */}
      <PortfolioChart series={perf.series} range={range} />

      {/* Allocation donuts: 2 per row, 4 total */}
      <div className="grid md:grid-cols-2 gap-3">
        <AllocationDonut title="Asset class" data={alloc?.byAssetClass ?? {}} />
        <AllocationDonut title="Instrument type" data={alloc?.byInstrumentType ?? {}} />
        <AllocationDonut title="Currency" data={alloc?.byCurrency ?? {}} />
        <AllocationDonut title="Per security" data={alloc?.bySecurity ?? {}} maxSlices={12} hideLegend />
      </div>

      <ReturnsHeatmap series={perf.series} />

      {/* Holdings table */}
      <div className="card overflow-x-auto">
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="font-semibold">Open holdings ({activeHoldings.length})</h2>
          <span className="text-xs text-slate-500">Total return incl. realized + dividends: <span className={colorForReturn(totalReturn)}>{formatPct(totalReturn)}</span></span>
        </div>
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-200 dark:border-slate-700">
              <th className="py-2 pr-3">Name</th>
              <th className="py-2 pr-3">Class</th>
              <th className="py-2 pr-3">Wrapper</th>
              <th className="py-2 pr-3 text-right">Shares</th>
              <th className="py-2 pr-3 text-right">Avg cost</th>
              <th className="py-2 pr-3 text-right">Price</th>
              <th className="py-2 pr-3 text-right">Value (local)</th>
              <th className="py-2 pr-3 text-right">Value (€)</th>
              <th className="py-2 pr-3 text-right">P/L</th>
              <th className="py-2 pr-3 text-right">Dividends</th>
            </tr>
          </thead>
          <tbody>
            {activeHoldings.map((h) => {
              const isPct = (h.priceConvention ?? (h.category === 'Bond' ? 'percent' : 'unit')) === 'percent';
              const priceLabel = isPct ? '%' : h.currency;
              const localFmt = (v: number) => new Intl.NumberFormat('en-US', {
                style: 'currency', currency: isPct ? 'EUR' : h.currency, maximumFractionDigits: 0,
              }).format(v);
              return (
                <tr key={h.securityId} className="border-b border-slate-100 dark:border-slate-700/50">
                  <td className="py-1.5 pr-3">
                    <div className="font-medium">{h.name}</div>
                    <div className="text-xs text-slate-500">{h.ticker ?? h.isin ?? ''}</div>
                  </td>
                  <td className="py-1.5 pr-3"><span className="text-xs bg-slate-100 dark:bg-slate-700 rounded px-1.5 py-0.5">{h.assetClass}</span></td>
                  <td className="py-1.5 pr-3"><span className="text-xs bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 rounded px-1.5 py-0.5">{h.instrumentType}</span></td>
                  <td className="py-1.5 pr-3 text-right">{isPct ? formatNumber(h.shares, 0) : h.shares}</td>
                  <td className="py-1.5 pr-3 text-right">{h.averageCost.toFixed(2)} {priceLabel}</td>
                  <td className="py-1.5 pr-3 text-right">{h.currentPrice !== undefined ? `${h.currentPrice.toFixed(2)} ${priceLabel}` : '—'}</td>
                  <td className="py-1.5 pr-3 text-right">
                    {h.currentValueLocal !== undefined ? (
                      <span title={h.fxRate ? `FX ${h.currency}/EUR ${h.fxRate.toFixed(4)}` : undefined}>
                        {isPct ? formatMoney(h.currentValueLocal) : localFmt(h.currentValueLocal)}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="py-1.5 pr-3 text-right">{h.currentValue !== undefined ? formatMoney(h.currentValue) : '—'}</td>
                  <td className={`py-1.5 pr-3 text-right ${colorForReturn(h.unrealizedPnL ?? 0)}`}>
                    {h.unrealizedPnL !== undefined ? (
                      <>
                        {formatMoney(h.unrealizedPnL)}
                        <span className="text-xs ml-1">({formatPct(h.unrealizedPnLPct ?? 0)})</span>
                      </>
                    ) : '—'}
                  </td>
                  <td className="py-1.5 pr-3 text-right">{formatMoney(h.dividendsTotal)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
