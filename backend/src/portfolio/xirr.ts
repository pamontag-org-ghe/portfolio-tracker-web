/**
 * Compute money-weighted return (XIRR) given a series of dated cash flows.
 * Convention: negative = money in (deposits/buys), positive = money out (sells/dividends/final value).
 *
 * Returns the annualized rate of return as a decimal (e.g. 0.07 = 7%/year), or undefined when
 * the cash flow sequence cannot yield a meaningful root (all-zero, all same sign, etc.).
 */

export interface CashFlow {
  date: Date;
  amount: number;
}

const SECONDS_PER_YEAR = 365 * 86_400;

function npv(rate: number, flows: CashFlow[], anchor: Date): number {
  let sum = 0;
  for (const cf of flows) {
    const years = (cf.date.getTime() - anchor.getTime()) / 1000 / SECONDS_PER_YEAR;
    sum += cf.amount / Math.pow(1 + rate, years);
  }
  return sum;
}

function dnpv(rate: number, flows: CashFlow[], anchor: Date): number {
  let sum = 0;
  for (const cf of flows) {
    const years = (cf.date.getTime() - anchor.getTime()) / 1000 / SECONDS_PER_YEAR;
    sum += -years * cf.amount / Math.pow(1 + rate, years + 1);
  }
  return sum;
}

export function xirr(flows: CashFlow[], guess = 0.1): number | undefined {
  if (flows.length < 2) return undefined;
  // Require both positive and negative flows.
  let pos = false, neg = false;
  for (const f of flows) { if (f.amount > 0) pos = true; if (f.amount < 0) neg = true; }
  if (!pos || !neg) return undefined;

  const sorted = [...flows].sort((a, b) => a.date.getTime() - b.date.getTime());
  const anchor = sorted[0].date;

  // Newton-Raphson with safety bisection.
  let r = guess;
  for (let i = 0; i < 80; i++) {
    const f = npv(r, sorted, anchor);
    const df = dnpv(r, sorted, anchor);
    if (!Number.isFinite(f) || !Number.isFinite(df) || df === 0) break;
    const next = r - f / df;
    if (!Number.isFinite(next)) break;
    if (Math.abs(next - r) < 1e-7) return next;
    r = next;
    if (r <= -0.999999) r = -0.999;
  }

  // Fallback: bisection on a wide range.
  let lo = -0.99;
  let hi = 10;
  let fLo = npv(lo, sorted, anchor);
  let fHi = npv(hi, sorted, anchor);
  if (Number.isFinite(fLo) && Number.isFinite(fHi) && fLo * fHi < 0) {
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      const fMid = npv(mid, sorted, anchor);
      if (Math.abs(fMid) < 1e-7) return mid;
      if (fLo * fMid < 0) { hi = mid; fHi = fMid; } else { lo = mid; fLo = fMid; }
    }
    return (lo + hi) / 2;
  }
  return undefined;
}
