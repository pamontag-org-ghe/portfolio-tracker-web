import type { Repository } from '../data/repository.js';
import type {
  AssetCategory, Dividend, Holding, PriceSeries, Security, Transaction,
} from '../types.js';
import { deriveAssetClass, deriveInstrumentType } from '../types.js';
import { MarketDataService, SP500_SYMBOL } from '../market/marketData.js';
import { BondDataService } from '../market/bondData.js';
import { toIsoDate } from '../utils/ids.js';
import { xirr } from './xirr.js';

export type TimeRange = '1D' | '1W' | '1M' | 'YTD' | '1Y' | '3Y' | '5Y' | 'ALL';

export interface PerformancePoint {
  date: string;
  portfolioValue: number;
  benchmarkValue: number;
  invested: number;
  /** Cumulative time-weighted return index (1.0 at first day). */
  portfolioTwrIndex: number;
  /** Cumulative time-weighted return index for the S&P 500 benchmark. */
  benchmarkTwrIndex: number;
}

export interface RangeMetrics {
  range: TimeRange;
  startDate: string;
  endDate: string;
  portfolioReturnPct: number;
  benchmarkReturnPct: number;
  portfolioStartValue: number;
  portfolioEndValue: number;
  benchmarkStartValue: number;
  benchmarkEndValue: number;
}

export interface PerformanceResponse {
  asOf: string;
  totalValue: number;
  totalCost: number;
  unrealizedPnL: number;
  unrealizedPnLPct: number;
  realizedPnL: number;
  dividendsTotal: number;
  series: PerformancePoint[];
  metrics: Record<TimeRange, RangeMetrics>;
}

const RANGES: TimeRange[] = ['1D', '1W', '1M', 'YTD', '1Y', '3Y', '5Y', 'ALL'];

function isoToday(): string {
  return toIsoDate(new Date());
}

function rangeStart(range: TimeRange, today: Date, firstTxDate?: Date): Date {
  const d = new Date(today);
  switch (range) {
    case '1D': d.setUTCDate(d.getUTCDate() - 1); break;
    case '1W': d.setUTCDate(d.getUTCDate() - 7); break;
    case '1M': d.setUTCMonth(d.getUTCMonth() - 1); break;
    case 'YTD': return new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
    case '1Y': d.setUTCFullYear(d.getUTCFullYear() - 1); break;
    case '3Y': d.setUTCFullYear(d.getUTCFullYear() - 3); break;
    case '5Y': d.setUTCFullYear(d.getUTCFullYear() - 5); break;
    case 'ALL': return firstTxDate ?? d;
  }
  if (firstTxDate && d < firstTxDate) return firstTxDate;
  return d;
}

function eachDay(from: Date, to: Date): string[] {
  const dates: string[] = [];
  const d = new Date(from);
  while (d <= to) {
    dates.push(toIsoDate(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dates;
}

interface SymbolBundle {
  security: Security;
  series: PriceSeries | null;
  lookup: (date: string) => number | undefined;
}

/**
 * Map FX currency code to Yahoo ticker for conversion to EUR.
 * For EUR returns null (no conversion needed).
 */
function fxTickerToEur(currency: string): string | null {
  if (!currency || currency === 'EUR') return null;
  // Yahoo uses tickers like USDEUR=X
  return `${currency}EUR=X`;
}

export class PerformanceEngine {
  private market: MarketDataService;
  private bonds: BondDataService;
  constructor(private readonly repo: Repository) {
    this.market = new MarketDataService(repo);
    this.bonds = new BondDataService(repo);
  }

  /**
   * Convert a raw quoted price into the "amount per share/nominal" in the security currency.
   * For 'unit' convention this is just `price`; for 'percent' (bonds) it's `price/100`.
   */
  private valuePerShare(price: number, sec: Security): number {
    const conv = sec.priceConvention ?? (sec.category === 'Bond' ? 'percent' : 'unit');
    return conv === 'percent' ? price / 100 : price;
  }

  private async fetchSecuritySeries(sec: Security): Promise<PriceSeries | null> {
    if (sec.category === 'Bond' && sec.isin) {
      const s = await this.bonds.getHistoryByIsin(sec.isin);
      return s.points.length > 0 ? s : null;
    }
    if (!sec.ticker) return null;
    const s = await this.market.getHistory(sec.ticker);
    return s.points.length > 0 ? s : null;
  }

  async computeHoldings(userId: string, range?: TimeRange): Promise<{
    holdings: Holding[];
    transactions: Transaction[];
    dividends: Dividend[];
    securities: Map<string, Security>;
  }> {
    const [transactions, dividends, securityList] = await Promise.all([
      this.repo.transactions.listByUser(userId),
      this.repo.dividends.listByUser(userId),
      this.repo.securities.list(),
    ]);
    const securities = new Map(securityList.map((s) => [s.id, s]));

    const bySec = new Map<string, Transaction[]>();
    for (const t of transactions) {
      const arr = bySec.get(t.securityId) ?? [];
      arr.push(t);
      bySec.set(t.securityId, arr);
    }
    const divBySec = new Map<string, number>();
    for (const d of dividends) {
      divBySec.set(d.securityId, (divBySec.get(d.securityId) ?? 0) + d.amount);
    }

    const fxLookups = new Map<string, (date: string) => number | undefined>();
    async function fxLookupFor(currency: string, engine: PerformanceEngine): Promise<(d: string) => number> {
      if (!currency || currency === 'EUR') return () => 1;
      const cached = fxLookups.get(currency);
      if (cached) return (d) => cached(d) ?? 1;
      const ticker = fxTickerToEur(currency);
      if (!ticker) return () => 1;
      const series = await engine.market.getHistory(ticker);
      const lookup = MarketDataService.toLookup(series);
      fxLookups.set(currency, lookup);
      return (d) => lookup(d) ?? 1;
    }

    // Pre-compute the range start date once (relative to today and the user's first
    // transaction). Each holding clamps this further to its own first transaction.
    const today = new Date(isoToday());
    const allFirstTxIso = transactions.length > 0
      ? transactions.reduce((min, t) => t.date < min ? t.date : min, transactions[0].date)
      : undefined;
    const rangeStartIso = range && allFirstTxIso
      ? toIsoDate(rangeStart(range, today, new Date(allFirstTxIso)))
      : null;

    const holdings: Holding[] = [];
    for (const [secId, txs] of bySec) {
      const sec = securities.get(secId);
      if (!sec) continue;
      const sortedTx = txs.slice().sort((a, b) => a.date.localeCompare(b.date));
      let shares = 0;
      let costBasisLocal = 0;   // running cost basis in security currency
      let costBasisEur = 0;
      let realizedPnL = 0;

      // Range accumulators: snapshot shares/cost at the moment the first in-range
      // transaction is encountered, and sum buys/sells/realized P/L that happen
      // during the requested window. When no range was requested these stay zero
      // and we leave the optional fields off the resulting Holding.
      let sharesAtRangeStart: number | null = null;
      let costEurAtRangeStart: number | null = null;
      let buysInRangeEur = 0;
      let sellsInRangeEur = 0;

      const fxToEur = await fxLookupFor(sec.currency, this);
      for (const t of sortedTx) {
        // Freeze the "before range" snapshot the first time we cross into the range.
        if (rangeStartIso !== null && sharesAtRangeStart === null && t.date >= rangeStartIso) {
          sharesAtRangeStart = shares;
          costEurAtRangeStart = costBasisEur;
        }
        const fx = t.exchangeRate || fxToEur(t.date) || 1;
        const inRange = rangeStartIso !== null && t.date >= rangeStartIso;
        if (t.type === 'BUY') {
          shares += t.shares;
          const totalCost = t.grossAmount + t.fees;
          costBasisLocal += totalCost;
          costBasisEur += totalCost * fx;
          if (inRange) buysInRangeEur += totalCost * fx;
        } else {
          // sell - average cost method
          const avg = shares > 0 ? costBasisLocal / shares : 0;
          const proceedsLocal = t.grossAmount - t.fees - t.taxes;
          const proceedsEur = proceedsLocal * fx;
          const soldCostLocal = avg * t.shares;
          const soldCostEur = costBasisEur > 0 && shares > 0 ? (costBasisEur * (t.shares / shares)) : 0;
          realizedPnL += proceedsEur - soldCostEur;
          shares -= t.shares;
          costBasisLocal = Math.max(0, costBasisLocal - soldCostLocal);
          costBasisEur = Math.max(0, costBasisEur - soldCostEur);
          if (inRange) sellsInRangeEur += proceedsEur;
        }
      }
      // If all transactions for this security happened before the range started,
      // the snapshot was never frozen — capture the final state now.
      if (rangeStartIso !== null && sharesAtRangeStart === null) {
        sharesAtRangeStart = shares;
        costEurAtRangeStart = costBasisEur;
      }

      // Fetch the price series once and reuse for both current price and range
      // start price. Cached at the market layer so this is cheap on warm calls.
      let priceLookup: (date: string) => number | undefined = () => undefined;
      const needPrice = shares > 0 || (rangeStartIso !== null && (sharesAtRangeStart ?? 0) > 0);
      if (needPrice) {
        try {
          const series = await this.fetchSecuritySeries(sec);
          if (series) priceLookup = MarketDataService.toLookup(series);
        } catch { /* ignore — leave priceLookup as no-op */ }
      }

      let currentPrice: number | undefined;
      let currentValue: number | undefined;
      let currentValueLocal: number | undefined;
      let fxRate: number | undefined;
      if (shares > 0) {
        const todayPrice = priceLookup(isoToday());
        if (todayPrice !== undefined) {
          currentPrice = todayPrice;
          const fx = fxToEur(isoToday()) || 1;
          fxRate = fx;
          currentValueLocal = this.valuePerShare(todayPrice, sec) * shares;
          currentValue = currentValueLocal * fx;
        }
      }

      // Range-scoped P/L computation. We only emit the fields when a range was
      // requested AND we managed to value the starting position (or it was empty).
      let rangePnL: number | undefined;
      let rangePnLPct: number | undefined;
      let rangeStartValueEur: number | undefined;
      let dividendsInRange = 0;
      if (rangeStartIso !== null) {
        for (const d of dividends) {
          if (d.securityId !== secId) continue;
          if (d.date >= rangeStartIso) dividendsInRange += d.amount;
        }
        const startShares = sharesAtRangeStart ?? 0;
        if (startShares <= 0) {
          rangeStartValueEur = 0;
        } else {
          const startPrice = priceLookup(rangeStartIso);
          if (startPrice !== undefined) {
            const fxAtStart = fxToEur(rangeStartIso) || 1;
            rangeStartValueEur = this.valuePerShare(startPrice, sec) * startShares * fxAtStart;
          } else {
            // No market quote at range start: fall back to cost basis snapshot so
            // we can still surface a reasonable P/L instead of hiding the field.
            rangeStartValueEur = costEurAtRangeStart ?? 0;
          }
        }
        const endValueEur = currentValue ?? 0;
        rangePnL = endValueEur + sellsInRangeEur + dividendsInRange - rangeStartValueEur - buysInRangeEur;
        const denom = rangeStartValueEur + buysInRangeEur;
        rangePnLPct = denom > 0 ? rangePnL / denom : undefined;
      }

      holdings.push({
        securityId: sec.id,
        ticker: sec.ticker,
        isin: sec.isin,
        name: sec.name,
        category: sec.category,
        assetClass: deriveAssetClass(sec),
        instrumentType: deriveInstrumentType(sec),
        currency: sec.currency,
        priceConvention: sec.priceConvention ?? (sec.category === 'Bond' ? 'percent' : 'unit'),
        shares,
        averageCost: shares > 0 ? (sec.priceConvention === 'percent' || sec.category === 'Bond'
          ? (costBasisLocal / shares) * 100
          : costBasisLocal / shares) : 0,
        costBasis: costBasisEur,
        currentPrice,
        currentValueLocal,
        currentValue,
        fxRate,
        unrealizedPnL: currentValue !== undefined ? currentValue - costBasisEur : undefined,
        unrealizedPnLPct: currentValue !== undefined && costBasisEur > 0
          ? (currentValue - costBasisEur) / costBasisEur : undefined,
        realizedPnL,
        dividendsTotal: divBySec.get(sec.id) ?? 0,
        rangePnL,
        rangePnLPct,
        rangeStartValue: rangeStartValueEur,
        rangeBuys: rangeStartIso !== null ? buysInRangeEur : undefined,
        rangeSells: rangeStartIso !== null ? sellsInRangeEur : undefined,
        rangeDividends: rangeStartIso !== null ? dividendsInRange : undefined,
      });
    }

    holdings.sort((a, b) => (b.currentValue ?? 0) - (a.currentValue ?? 0));
    return { holdings, transactions, dividends, securities };
  }

  async computePerformance(userId: string): Promise<PerformanceResponse> {
    const { holdings, transactions, dividends, securities } = await this.computeHoldings(userId);
    const todayIso = isoToday();
    const today = new Date(todayIso);

    if (transactions.length === 0) {
      const empty: PerformanceResponse = {
        asOf: todayIso,
        totalValue: 0,
        totalCost: 0,
        unrealizedPnL: 0,
        unrealizedPnLPct: 0,
        realizedPnL: 0,
        dividendsTotal: 0,
        series: [],
        metrics: Object.fromEntries(RANGES.map((r) => [r, {
          range: r, startDate: todayIso, endDate: todayIso,
          portfolioReturnPct: 0, benchmarkReturnPct: 0,
          portfolioStartValue: 0, portfolioEndValue: 0,
          benchmarkStartValue: 0, benchmarkEndValue: 0,
        }])) as Record<TimeRange, RangeMetrics>,
      };
      void holdings; void securities; // silence unused
      return empty;
    }

    const firstTxDate = new Date(transactions.reduce((min, t) => t.date < min ? t.date : min, transactions[0].date));

    // Pre-fetch price series for every distinct security
    const symbolBundles = new Map<string, SymbolBundle>();
    const fxLookups = new Map<string, (date: string) => number>();
    const ensureFx = async (currency: string) => {
      if (!currency || currency === 'EUR') { fxLookups.set('EUR', () => 1); return; }
      if (fxLookups.has(currency)) return;
      const ticker = fxTickerToEur(currency)!;
      const series = await this.market.getHistory(ticker);
      const lk = MarketDataService.toLookup(series);
      fxLookups.set(currency, (d) => lk(d) ?? 1);
    };
    await ensureFx('EUR');

    for (const sec of securities.values()) {
      await ensureFx(sec.currency);
      const series = await this.fetchSecuritySeries(sec);
      if (!series) {
        symbolBundles.set(sec.id, { security: sec, series: null, lookup: () => undefined });
        continue;
      }
      symbolBundles.set(sec.id, {
        security: sec, series, lookup: MarketDataService.toLookup(series),
      });
    }

    // Benchmark (S&P 500) in EUR
    const benchSeries = await this.market.getHistory(SP500_SYMBOL, toIsoDate(firstTxDate));
    const benchLookup = MarketDataService.toLookup(benchSeries);
    const benchCurrency = benchSeries.currency || 'USD';
    await ensureFx(benchCurrency);
    const benchFx = (d: string) => fxLookups.get(benchCurrency)?.(d) ?? 1;

    const txBySecSorted = new Map<string, Transaction[]>();
    for (const t of transactions) {
      const arr = txBySecSorted.get(t.securityId) ?? [];
      arr.push(t);
      txBySecSorted.set(t.securityId, arr);
    }
    for (const arr of txBySecSorted.values()) arr.sort((a, b) => a.date.localeCompare(b.date));

    const allDates = eachDay(firstTxDate, today);
    const series: PerformancePoint[] = [];

    let cumulativeInvested = 0;
    let cumulativeBenchmarkShares = 0;
    let cumulativeRealized = 0;
    let firstBenchPrice: number | undefined;
    let portfolioTwrIndex = 1;
    let benchmarkTwrIndex = 1;
    let prevPortfolioValue = 0;
    let prevBenchmarkValue = 0;

    // Pointer per security into transactions array
    const idxPerSec = new Map<string, number>();
    const sharesPerSec = new Map<string, number>();
    const costLocalPerSec = new Map<string, number>();
    const costEurPerSec = new Map<string, number>();
    for (const id of txBySecSorted.keys()) {
      idxPerSec.set(id, 0); sharesPerSec.set(id, 0);
      costLocalPerSec.set(id, 0); costEurPerSec.set(id, 0);
    }

    for (const date of allDates) {
      // Apply all transactions <= this date. We track two cash-flow figures:
      //   * netInflow      — recorded *cost-basis* cash flow (drives invested / benchmark accumulation)
      //   * marketCashFlow — *market value* of the position added/removed today
      // The two diverge when the user records an averaged or estimated price that differs
      // from the actual market price on that date. TWR must use marketCashFlow so the
      // daily return isn't poisoned by cost-basis artefacts (which could push 1+r below 0).
      let netInflow = 0;
      let marketCashFlow = 0;
      for (const [secId, arr] of txBySecSorted) {
        let i = idxPerSec.get(secId)!;
        while (i < arr.length && arr[i].date <= date) {
          const t = arr[i];
          const sec = securities.get(secId)!;
          const fx = t.exchangeRate || fxLookups.get(sec.currency)?.(date) || 1;
          const bundle = symbolBundles.get(secId);
          const marketPrice = bundle?.lookup(date);
          if (t.type === 'BUY') {
            const totalCostLocal = t.grossAmount + t.fees;
            const totalCostEur = totalCostLocal * fx;
            sharesPerSec.set(secId, (sharesPerSec.get(secId)! + t.shares));
            costLocalPerSec.set(secId, costLocalPerSec.get(secId)! + totalCostLocal);
            costEurPerSec.set(secId, costEurPerSec.get(secId)! + totalCostEur);
            cumulativeInvested += totalCostEur;
            netInflow += totalCostEur;
            const marketValueAdded = marketPrice !== undefined
              ? this.valuePerShare(marketPrice, sec) * t.shares * fx
              : totalCostEur;
            marketCashFlow += marketValueAdded;
          } else {
            const currShares = sharesPerSec.get(secId)!;
            const currCostLocal = costLocalPerSec.get(secId)!;
            const currCostEur = costEurPerSec.get(secId)!;
            const proceedsLocal = t.grossAmount - t.fees - t.taxes;
            const proceedsEur = proceedsLocal * fx;
            const soldFraction = currShares > 0 ? t.shares / currShares : 0;
            const costSoldLocal = currCostLocal * soldFraction;
            const costSoldEur = currCostEur * soldFraction;
            cumulativeRealized += proceedsEur - costSoldEur;
            sharesPerSec.set(secId, currShares - t.shares);
            costLocalPerSec.set(secId, currCostLocal - costSoldLocal);
            costEurPerSec.set(secId, currCostEur - costSoldEur);
            cumulativeInvested -= costSoldEur;
            netInflow -= proceedsEur;
            const marketValueRemoved = marketPrice !== undefined
              ? this.valuePerShare(marketPrice, sec) * t.shares * fx
              : proceedsEur;
            marketCashFlow -= marketValueRemoved;
          }
          i++;
        }
        idxPerSec.set(secId, i);
      }

      // Compute current portfolio value (mark to market)
      let portfolioValue = 0;
      for (const [secId, shares] of sharesPerSec) {
        if (shares <= 0) continue;
        const bundle = symbolBundles.get(secId);
        const sec = securities.get(secId)!;
        const fx = fxLookups.get(sec.currency)?.(date) ?? 1;
        const price = bundle?.lookup(date);
        if (price !== undefined) {
          portfolioValue += this.valuePerShare(price, sec) * shares * fx;
        } else {
          // fallback to cost basis if no price
          portfolioValue += costEurPerSec.get(secId) ?? 0;
        }
      }

      // Benchmark synthetic position: when money flows in, buy equivalent EUR of S&P 500.
      const benchPrice = benchLookup(date);
      const benchPriceEur = benchPrice !== undefined ? benchPrice * benchFx(date) : undefined;
      if (benchPriceEur && benchPriceEur > 0) {
        if (firstBenchPrice === undefined) firstBenchPrice = benchPriceEur;
        if (netInflow !== 0) {
          cumulativeBenchmarkShares += netInflow / benchPriceEur;
        }
      }
      const benchmarkValue = benchPriceEur ? cumulativeBenchmarkShares * benchPriceEur : 0;

      // Time-weighted return: strip cash flows *at market value* before computing daily change.
      // Clamp the resulting daily return to a sensible lower bound so a corrupt single day
      // can never make the cumulative index go negative.
      if (prevPortfolioValue > 0) {
        const adjustedPortfolio = portfolioValue - marketCashFlow;
        const rawReturn = (adjustedPortfolio - prevPortfolioValue) / prevPortfolioValue;
        const dailyPortfolioReturn = Math.max(-0.95, Math.min(2, rawReturn));
        portfolioTwrIndex *= 1 + dailyPortfolioReturn;
      }
      if (prevBenchmarkValue > 0) {
        const adjustedBenchmark = benchmarkValue - netInflow;
        const rawBench = (adjustedBenchmark - prevBenchmarkValue) / prevBenchmarkValue;
        const dailyBenchReturn = Math.max(-0.95, Math.min(2, rawBench));
        benchmarkTwrIndex *= 1 + dailyBenchReturn;
      }
      prevPortfolioValue = portfolioValue;
      prevBenchmarkValue = benchmarkValue;

      series.push({
        date,
        portfolioValue: round2(portfolioValue),
        benchmarkValue: round2(benchmarkValue),
        invested: round2(cumulativeInvested),
        portfolioTwrIndex: round4(portfolioTwrIndex),
        benchmarkTwrIndex: round4(benchmarkTwrIndex),
      });
    }

    const dividendsTotal = dividends.reduce((sum, d) => sum + d.amount, 0);
    const lastPoint = series[series.length - 1];
    const totalCost = lastPoint?.invested ?? 0;
    const totalValue = lastPoint?.portfolioValue ?? 0;
    const unrealizedPnL = totalValue - totalCost;
    const unrealizedPnLPct = totalCost > 0 ? unrealizedPnL / totalCost : 0;

    const metrics = {} as Record<TimeRange, RangeMetrics>;
    for (const r of RANGES) {
      const start = rangeStart(r, today, firstTxDate);
      const startIso = toIsoDate(start);
      const startPoint = series.find((p) => p.date >= startIso) ?? series[0];
      const endPoint = lastPoint;
      // Time-weighted return: ratio of TWR index endpoints (cash-flow-neutral).
      const portfolioReturn = startPoint.portfolioTwrIndex > 0
        ? (endPoint.portfolioTwrIndex / startPoint.portfolioTwrIndex) - 1
        : 0;
      const benchmarkReturn = startPoint.benchmarkTwrIndex > 0
        ? (endPoint.benchmarkTwrIndex / startPoint.benchmarkTwrIndex) - 1
        : 0;
      metrics[r] = {
        range: r,
        startDate: startPoint.date,
        endDate: endPoint.date,
        portfolioReturnPct: round4(portfolioReturn),
        benchmarkReturnPct: round4(benchmarkReturn),
        portfolioStartValue: round2(startPoint.portfolioValue),
        portfolioEndValue: round2(endPoint.portfolioValue),
        benchmarkStartValue: round2(startPoint.benchmarkValue),
        benchmarkEndValue: round2(endPoint.benchmarkValue),
      };
    }

    // Silence unused warnings if AssetCategory ever becomes unused after refactors.
    void firstBenchPrice;
    return {
      asOf: todayIso,
      totalValue: round2(totalValue),
      totalCost: round2(totalCost),
      unrealizedPnL: round2(unrealizedPnL),
      unrealizedPnLPct: round4(unrealizedPnLPct),
      realizedPnL: round2(cumulativeRealized),
      dividendsTotal: round2(dividendsTotal),
      series,
      metrics,
    };
  }

  async allocation(userId: string): Promise<{
    byAssetClass: Record<string, number>;
    byInstrumentType: Record<string, number>;
    bySecurity: Record<string, number>;
    byCategory: Record<string, number>;
    byCurrency: Record<string, number>;
  }> {
    const { holdings } = await this.computeHoldings(userId);
    const byAssetClass: Record<string, number> = {};
    const byInstrumentType: Record<string, number> = {};
    const bySecurity: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    const byCurrency: Record<string, number> = {};
    for (const h of holdings) {
      const v = h.currentValue && h.currentValue > 0 ? h.currentValue : h.costBasis;
      if (!v || v <= 0) continue;
      byAssetClass[h.assetClass] = (byAssetClass[h.assetClass] ?? 0) + v;
      byInstrumentType[h.instrumentType] = (byInstrumentType[h.instrumentType] ?? 0) + v;
      bySecurity[h.name] = (bySecurity[h.name] ?? 0) + v;
      byCategory[h.category] = (byCategory[h.category] ?? 0) + v;
      byCurrency[h.currency] = (byCurrency[h.currency] ?? 0) + v;
    }
    return { byAssetClass, byInstrumentType, bySecurity, byCategory, byCurrency };
  }

  /**
   * Per-year metrics: portfolio value, contributions, dividends, gross/net yield,
   * money-weighted (XIRR) and time-weighted returns.
   */
  async yearlyPerformance(userId: string): Promise<YearlyPerformance[]> {
    const perf = await this.computePerformance(userId);
    const [transactions, dividends] = await Promise.all([
      this.repo.transactions.listByUser(userId),
      this.repo.dividends.listByUser(userId),
    ]);
    if (perf.series.length === 0) return [];

    const seriesByDate = new Map<string, typeof perf.series[number]>();
    for (const p of perf.series) seriesByDate.set(p.date, p);

    const years = new Set<number>();
    for (const p of perf.series) years.add(Number(p.date.slice(0, 4)));
    const sortedYears = Array.from(years).sort();

    // We use a forward-fill series lookup for arbitrary dates.
    const dates = perf.series.map((p) => p.date);
    function pointAtOrBefore(target: string) {
      let lo = 0, hi = dates.length - 1;
      if (target < dates[0]) return perf.series[0];
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (dates[mid] <= target) lo = mid; else hi = mid - 1;
      }
      return perf.series[lo];
    }

    const todayIso = perf.asOf;
    const out: YearlyPerformance[] = [];

    for (const year of sortedYears) {
      const yearStartIso = `${year}-01-01`;
      const yearEndIso = `${year}-12-31`;
      const effectiveEndIso = yearEndIso > todayIso ? todayIso : yearEndIso;
      // Start-of-year value = value at end of previous calendar year.
      // For the very first year we explicitly use 0 (no portfolio existed yet),
      // and all of that year's buys show up as new inflows.
      const priorYearEndIso = `${year - 1}-12-31`;
      const hasPriorData = perf.series.length > 0 && perf.series[0].date <= priorYearEndIso;
      const startPortfolioValue = hasPriorData ? pointAtOrBefore(priorYearEndIso).portfolioValue : 0;
      const startTwrIndex = hasPriorData ? pointAtOrBefore(priorYearEndIso).portfolioTwrIndex : 1;
      const startBenchTwrIndex = hasPriorData ? pointAtOrBefore(priorYearEndIso).benchmarkTwrIndex : 1;
      const startDate = hasPriorData ? priorYearEndIso : yearStartIso;
      const endPoint = pointAtOrBefore(effectiveEndIso) ?? perf.series[perf.series.length - 1];

      let invested = 0;
      let buys = 0;
      let sells = 0;
      let transactionCosts = 0; // commissions / fees paid in buys + sells
      let capitalGainsTaxes = 0; // taxes paid on sells (capital gains tax, Tobin tax, etc.)
      for (const t of transactions) {
        if (t.date.slice(0, 4) !== String(year)) continue;
        const fx = t.exchangeRate || 1;
        transactionCosts += (t.fees || 0) * fx;
        if (t.type === 'BUY') {
          const v = (t.grossAmount + t.fees) * fx;
          buys += v; invested += v;
        } else {
          capitalGainsTaxes += (t.taxes || 0) * fx;
          const v = (t.grossAmount - t.fees - t.taxes) * fx;
          sells += v; invested -= v;
        }
      }
      let dividendsNet = 0;
      let dividendsTaxes = 0;
      for (const d of dividends) {
        if (d.date.slice(0, 4) !== String(year)) continue;
        dividendsNet += d.amount;
        // Be tolerant of legacy data that stored taxes as a signed value.
        dividendsTaxes += Math.abs(d.taxes);
      }
      const dividendsGross = dividendsNet + dividendsTaxes;
      const taxesPaid = capitalGainsTaxes + dividendsTaxes;

      const twr = startTwrIndex > 0 ? (endPoint.portfolioTwrIndex / startTwrIndex) - 1 : 0;
      const benchmarkTwr = startBenchTwrIndex > 0 ? (endPoint.benchmarkTwrIndex / startBenchTwrIndex) - 1 : 0;

      const flows: { date: Date; amount: number }[] = [];
      if (startPortfolioValue > 0) {
        flows.push({ date: new Date(startDate), amount: -startPortfolioValue });
      }
      for (const t of transactions) {
        if (t.date.slice(0, 4) !== String(year)) continue;
        const fx = t.exchangeRate || 1;
        if (t.type === 'BUY') {
          flows.push({ date: new Date(t.date), amount: -(t.grossAmount + t.fees) * fx });
        } else {
          flows.push({ date: new Date(t.date), amount: (t.grossAmount - t.fees - t.taxes) * fx });
        }
      }
      for (const d of dividends) {
        if (d.date.slice(0, 4) !== String(year)) continue;
        flows.push({ date: new Date(d.date), amount: d.amount });
      }
      flows.push({ date: new Date(effectiveEndIso), amount: endPoint.portfolioValue });
      const mwr = xirr(flows);

      const endValue = endPoint.portfolioValue;
      const valueChange = endValue - startPortfolioValue;
      // "Gross yield" = before any taxes, "net yield" = after taxes.
      // The current `invested` figure already nets out sell-side fees+taxes;
      // grossing it up requires adding the taxes back into the return numerator.
      const baseCapital = Math.max(1, startPortfolioValue + Math.max(0, invested) / 2);
      const netYield = (valueChange - invested + dividendsNet) / baseCapital;
      const grossYield = (valueChange - invested + dividendsGross + capitalGainsTaxes) / baseCapital;

      out.push({
        year,
        startDate,
        endDate: endPoint.date,
        startValue: round2(startPortfolioValue),
        endValue: round2(endValue),
        invested: round2(invested),
        buys: round2(buys),
        sells: round2(sells),
        dividendsGross: round2(dividendsGross),
        dividendsNet: round2(dividendsNet),
        dividendsTaxes: round2(dividendsTaxes),
        capitalGainsTaxes: round2(capitalGainsTaxes),
        taxesPaid: round2(taxesPaid),
        transactionCosts: round2(transactionCosts),
        valueChange: round2(valueChange),
        grossYield: round4(grossYield),
        netYield: round4(netYield),
        twr: round4(twr),
        mwr: mwr !== undefined ? round4(mwr) : null,
        benchmarkTwr: round4(benchmarkTwr),
      });
    }
    return out;
  }
}

export interface YearlyPerformance {
  year: number;
  startDate: string;
  endDate: string;
  startValue: number;
  endValue: number;
  /** Net cash put in (buys minus sells, in EUR). */
  invested: number;
  buys: number;
  sells: number;
  dividendsGross: number;
  dividendsNet: number;
  dividendsTaxes: number;
  /** Capital gains taxes paid on sells in the year. */
  capitalGainsTaxes: number;
  /** Total taxes paid (dividend withholding + capital gains). */
  taxesPaid: number;
  /** Total transaction costs (fees / commissions on buys and sells). */
  transactionCosts: number;
  valueChange: number;
  grossYield: number;
  netYield: number;
  twr: number;
  /** Money-weighted return (annualised XIRR). null if convergence failed. */
  mwr: number | null;
  benchmarkTwr: number;
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
function round4(n: number): number { return Math.round(n * 10000) / 10000; }

// Silence unused warnings if AssetCategory ever becomes unused after refactors.
export type _AssetCategory = AssetCategory;
