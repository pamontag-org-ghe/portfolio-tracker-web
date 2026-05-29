import { useMemo } from 'react';
import {
  ComposedChart, Area, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend,
  type TooltipProps,
} from 'recharts';
import type { PerformancePoint, TimeRange } from '../types';
import { colorForReturn, formatMoney, formatMoneyCompact, formatPct } from '../utils/format';

interface Props {
  series: PerformancePoint[];
  range: TimeRange;
}

function startDateFor(range: TimeRange, today: Date, firstDate: Date | null): Date {
  const d = new Date(today);
  switch (range) {
    case '1D': d.setUTCDate(d.getUTCDate() - 1); break;
    case '1W': d.setUTCDate(d.getUTCDate() - 7); break;
    case '1M': d.setUTCMonth(d.getUTCMonth() - 1); break;
    case 'YTD': return new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
    case '1Y': d.setUTCFullYear(d.getUTCFullYear() - 1); break;
    case '3Y': d.setUTCFullYear(d.getUTCFullYear() - 3); break;
    case '5Y': d.setUTCFullYear(d.getUTCFullYear() - 5); break;
    case 'ALL': return firstDate ?? d;
  }
  if (firstDate && d < firstDate) return firstDate;
  return d;
}

export default function PortfolioChart({ series, range }: Props) {
  const filtered = useMemo(() => {
    if (series.length === 0) return [];
    const today = new Date(series[series.length - 1].date);
    const first = new Date(series[0].date);
    const start = startDateFor(range, today, first);
    const startIso = start.toISOString().slice(0, 10);
    return series.filter((p) => p.date >= startIso);
  }, [series, range]);

  // Auto-zoom Y axis to the visible range so short windows show movement clearly.
  const yDomain = useMemo<[number | string, number | string]>(() => {
    if (filtered.length === 0) return ['auto', 'auto'];
    let min = Infinity;
    let max = -Infinity;
    for (const p of filtered) {
      const candidates = [p.portfolioValue, p.benchmarkValue, p.invested].filter((v) => Number.isFinite(v) && v > 0);
      for (const v of candidates) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return ['auto', 'auto'];
    // Add ~5% padding on either side so the line doesn't kiss the borders.
    const pad = (max - min) * 0.05 || max * 0.01;
    return [Math.max(0, min - pad), max + pad];
  }, [filtered]);

  // Baseline TWR indices at the start of the visible window. Used to compute
  // range-relative yield % for the tooltip hover.
  const basePortfolioTwr = filtered[0]?.portfolioTwrIndex ?? 1;
  const baseBenchmarkTwr = filtered[0]?.benchmarkTwrIndex ?? 1;

  const renderTooltip = ({ active, payload, label }: TooltipProps<number, string>) => {
    if (!active || !payload || payload.length === 0) return null;
    const point = payload[0].payload as PerformancePoint;
    const portfolioYield = basePortfolioTwr > 0
      ? point.portfolioTwrIndex / basePortfolioTwr - 1
      : 0;
    const benchmarkYield = baseBenchmarkTwr > 0
      ? point.benchmarkTwrIndex / baseBenchmarkTwr - 1
      : 0;
    const spread = portfolioYield - benchmarkYield;
    return (
      <div className="rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-lg px-3 py-2 text-xs">
        <div className="font-medium mb-1">{label as string}</div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-500">Portfolio</span>
          <span className="tabular-nums">
            {formatMoney(point.portfolioValue)}
            <span className={`ml-2 ${colorForReturn(portfolioYield)}`}>{formatPct(portfolioYield)}</span>
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-500">S&amp;P 500</span>
          <span className="tabular-nums">
            {formatMoney(point.benchmarkValue)}
            <span className={`ml-2 ${colorForReturn(benchmarkYield)}`}>{formatPct(benchmarkYield)}</span>
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-500">Invested</span>
          <span className="tabular-nums">{formatMoney(point.invested)}</span>
        </div>
        <div className="flex items-center justify-between gap-4 mt-1 pt-1 border-t border-slate-200 dark:border-slate-600">
          <span className="text-slate-500">Spread</span>
          <span className={`tabular-nums ${colorForReturn(spread)}`}>{formatPct(spread)}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="card">
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="font-semibold">Portfolio value vs S&amp;P 500</h2>
        <span className="text-xs text-slate-500">{filtered.length} data points</span>
      </div>
      <p className="text-xs text-slate-500 mb-2">
        The orange line is a <strong>synthetic S&amp;P 500</strong>: starting from your very first
        contribution, every buy/sell you made is replayed as if invested in the index. So its
        absolute € reflects <em>years of prior compounding</em> on those contributions — it can
        end higher than your portfolio in € even when your portfolio's TWR % for the visible
        window is higher. The KPI <em>Portfolio (range) %</em> and <em>S&amp;P (range) %</em>{' '}
        are TWRs over the visible window only (cash-flow-neutral, like-for-like).
      </p>
      <div className="h-72 sm:h-96">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={filtered} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="gradPort" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#2563eb" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={40} />
            <YAxis
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => formatMoneyCompact(v)}
              width={78}
              domain={yDomain}
              allowDataOverflow={false}
            />
            <Tooltip content={renderTooltip} />
            <Legend />
            <Area
              type="monotone"
              dataKey="portfolioValue"
              name="Portfolio"
              stroke="#2563eb"
              strokeWidth={2}
              fill="url(#gradPort)"
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="benchmarkValue"
              name="S&P 500 (synthetic)"
              stroke="#f59e0b"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="invested"
              name="Invested"
              stroke="#94a3b8"
              strokeDasharray="4 4"
              strokeWidth={1}
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

