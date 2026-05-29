import { useMemo } from 'react';
import type { PerformancePoint } from '../types';
import { useIsMobile } from '../utils/useIsMobile';

interface Props {
  series: PerformancePoint[];
}

interface MonthCell { year: number; month: number; ret: number | null }

/**
 * Year × Month heatmap of *monthly* returns. Bigger cells with the percentage shown inline.
 * Rows = years (most recent first), columns = Jan-Dec.
 */
export default function ReturnsHeatmap({ series }: Props) {
  const isMobile = useIsMobile();
  const rows = useMemo<MonthCell[][]>(() => {
    if (series.length < 2) return [];
    // Build a map of monthly TWR using portfolioTwrIndex endpoints.
    // ret = twrIndex[last day of month] / twrIndex[last day of previous month] - 1
    const byMonth = new Map<string, { firstIdx: number; lastIdx: number }>();
    for (let i = 0; i < series.length; i++) {
      const key = series[i].date.slice(0, 7); // YYYY-MM
      const cur = byMonth.get(key);
      if (!cur) byMonth.set(key, { firstIdx: i, lastIdx: i });
      else cur.lastIdx = i;
    }
    const keys = Array.from(byMonth.keys()).sort();
    const monthly = new Map<string, number>();
    for (let k = 0; k < keys.length; k++) {
      const cur = byMonth.get(keys[k])!;
      // Previous month's last twrIndex (or this month's first if no previous).
      let prevIndex: number | undefined;
      if (k > 0) {
        const prev = byMonth.get(keys[k - 1])!;
        prevIndex = series[prev.lastIdx]?.portfolioTwrIndex;
      } else {
        prevIndex = series[Math.max(0, cur.firstIdx - 1)]?.portfolioTwrIndex;
      }
      const curIndex = series[cur.lastIdx]?.portfolioTwrIndex;
      if (prevIndex && curIndex && prevIndex > 0) {
        monthly.set(keys[k], curIndex / prevIndex - 1);
      }
    }

    const years = new Set<number>();
    for (const key of keys) years.add(Number(key.slice(0, 4)));
    const sortedYears = Array.from(years).sort((a, b) => b - a); // descending

    return sortedYears.map((year) => {
      const row: MonthCell[] = [];
      for (let m = 1; m <= 12; m++) {
        const key = `${year}-${String(m).padStart(2, '0')}`;
        const ret = monthly.get(key);
        row.push({ year, month: m, ret: ret === undefined ? null : ret });
      }
      return row;
    });
  }, [series]);

  function colorFor(ret: number | null): string {
    if (ret === null || ret === undefined) return '#f1f5f9';
    if (ret === 0) return '#e2e8f0';
    const pct = Math.max(-0.15, Math.min(0.15, ret));
    if (pct > 0) {
      const intensity = Math.min(1, pct / 0.10);
      return `rgba(16, 185, 129, ${0.20 + intensity * 0.7})`;
    }
    const intensity = Math.min(1, -pct / 0.10);
    return `rgba(239, 68, 68, ${0.20 + intensity * 0.7})`;
  }

  function textColorFor(ret: number | null): string {
    if (ret === null) return '#94a3b8';
    return Math.abs(ret) > 0.05 ? '#ffffff' : '#0f172a';
  }

  if (rows.length === 0) {
    return (
      <div className="card">
        <h2 className="font-semibold mb-2">Monthly returns</h2>
        <p className="text-sm text-slate-500">Not enough data to plot.</p>
      </div>
    );
  }

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // On mobile we shrink cells aggressively and abbreviate month names to a
  // single letter so the 12-month grid fits the viewport without a horizontal
  // scrollbar overflowing the page.
  const monthLabels = isMobile ? months.map((m) => m[0]) : months;
  const cellMinWidth = isMobile ? 22 : 44;
  const yearCellMinWidth = isMobile ? 32 : 56;
  const cellPadding = isMobile ? '4px 2px' : '6px 4px';
  const yearCellPadding = isMobile ? '4px 3px' : '6px 6px';

  return (
    <div className="card overflow-x-auto">
      <div className="flex items-baseline justify-between mb-3 gap-2 flex-wrap">
        <h2 className="font-semibold">Monthly returns</h2>
        <div className="flex items-center gap-1 text-xs text-slate-500">
          <span>Worse</span>
          <span className="inline-block w-3 h-3 rounded" style={{ background: 'rgba(239,68,68,0.9)' }} />
          <span className="inline-block w-3 h-3 rounded" style={{ background: 'rgba(239,68,68,0.35)' }} />
          <span className="inline-block w-3 h-3 rounded" style={{ background: '#e2e8f0' }} />
          <span className="inline-block w-3 h-3 rounded" style={{ background: 'rgba(16,185,129,0.35)' }} />
          <span className="inline-block w-3 h-3 rounded" style={{ background: 'rgba(16,185,129,0.9)' }} />
          <span>Better</span>
        </div>
      </div>
      <table className="border-separate border-spacing-1 text-[10px] sm:text-sm w-full">
        <thead>
          <tr>
            <th className="w-8 sm:w-12 text-slate-500 font-medium"></th>
            {monthLabels.map((m, i) => (
              <th key={i} className="px-0.5 sm:px-1 py-1 text-slate-500 font-medium text-center">{m}</th>
            ))}
            <th className="px-1 sm:px-2 py-1 text-slate-500 font-medium text-center">Year</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            // Compute total year return as product of monthly returns.
            const yearProduct = row.reduce((acc, c) => c.ret === null ? acc : acc * (1 + c.ret), 1);
            const yearReturn = row.some((c) => c.ret !== null) ? yearProduct - 1 : null;
            return (
              <tr key={row[0].year}>
                <td className="px-1 sm:px-2 py-1 text-right font-semibold text-slate-600">{row[0].year}</td>
                {row.map((cell) => (
                  <td
                    key={cell.month}
                    className="text-center font-medium tabular-nums rounded"
                    style={{
                      background: colorFor(cell.ret),
                      color: textColorFor(cell.ret),
                      minWidth: cellMinWidth,
                      padding: cellPadding,
                    }}
                    title={cell.ret === null ? 'no data' : `${cell.year}-${String(cell.month).padStart(2,'0')}: ${(cell.ret * 100).toFixed(2)}%`}
                  >
                    {cell.ret === null ? '—' : isMobile ? `${(cell.ret * 100).toFixed(0)}` : `${(cell.ret * 100).toFixed(1)}%`}
                  </td>
                ))}
                <td
                  className="text-center font-semibold tabular-nums rounded"
                  style={{
                    background: colorFor(yearReturn),
                    color: textColorFor(yearReturn),
                    minWidth: yearCellMinWidth,
                    padding: yearCellPadding,
                  }}
                >
                  {yearReturn === null ? '—' : `${(yearReturn * 100).toFixed(1)}%`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

