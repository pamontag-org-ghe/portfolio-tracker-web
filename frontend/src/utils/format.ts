export function formatMoney(value: number, currency = 'EUR'): string {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value);
}

// Kept for callers that explicitly want the 2-decimal variant. Same behavior as
// `formatMoney` now that the default has been bumped to 2 decimals.
export function formatMoneyDetail(value: number, currency = 'EUR'): string {
  return formatMoney(value, currency);
}

// Compact, no-decimal money formatter for chart axis ticks where horizontal
// space is tight (e.g. yearly bar chart, portfolio chart Y axis).
export function formatMoneyCompact(value: number, currency = 'EUR'): string {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency, maximumFractionDigits: 0,
  }).format(value);
}

export function formatPct(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatNumber(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value);
}

export function formatDate(iso: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
}

export function colorForReturn(value: number, neutralZero = true): string {
  if (neutralZero && value === 0) return 'text-slate-500';
  return value >= 0 ? 'text-emerald-600' : 'text-red-600';
}
