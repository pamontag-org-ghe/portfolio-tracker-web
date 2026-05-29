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
    const fxMeta = new Map<string, { lastDate?: string; fetchedAt?: string }>();
    async function fxLookupFor(currency: string, engine: PerformanceEngine): Promise<(d: string) => number> {
      if (!currency || currency === 'EUR') return () => 1;
      const cached = fxLookups.get(currency);
      if (cached) return (d) => cached(d) ?? 1;
      const ticker = fxTickerToEur(currency);
      if (!ticker) return () => 1;
      const series = await engine.market.getHistory(ticker);
      const lookup = MarketDataService.toLookup(series);
      fxLookups.set(currency, lookup);
      const last = series.points[series.points.length - 1];
      fxMeta.set(currency, { lastDate: last?.date, fetchedAt: series.updatedAt });
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
      let priceAsOf: string | undefined;
      let priceFetchedAt: string | undefined;
      const needPrice = shares > 0 || (rangeStartIso !== null && (sharesAtRangeStart ?? 0) > 0);
      if (needPrice) {
        try {
          const series = await this.fetchSecuritySeries(sec);
          if (series) {
            priceLookup = MarketDataService.toLookup(series);
            const last = series.points[series.points.length - 1];
            priceAsOf = last?.date;
            priceFetchedAt = series.updatedAt;
          }
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

      const fxInfo = fxMeta.get(sec.currency);
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
        priceAsOf,
        priceFetchedAt,
        fxAsOf: sec.currency === 'EUR' ? undefined : fxInfo?.lastDate,
        fxFetchedAt: sec.currency === 'EUR' ? undefined : fxInfo?.fetchedAt,
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

  /**
   * Roll-up of every year already returned by `yearlyPerformance` into a single
   * "all-time" entry with the same shape. Computed from the per-year output and
   * the underlying performance series so the same definitions apply.
   *
   * Note: `twr` and `benchmarkTwr` on this row are **annualised** so they can be
   * compared directly with `mwr` (XIRR is annualised). The cumulative (period)
   * returns are also exposed via `twrCumulative` / `benchmarkTwrCumulative`.
   */
  async allTimePerformance(userId: string): Promise<YearlyPerformance | null> {
    const years = await this.yearlyPerformance(userId);
    if (years.length === 0) return null;
    const perf = await this.computePerformance(userId);
    if (perf.series.length === 0) return null;
    const first = perf.series[0];
    const last = perf.series[perf.series.length - 1];

    let invested = 0, buys = 0, sells = 0, dividendsGross = 0, dividendsNet = 0;
    let dividendsTaxes = 0, capitalGainsTaxes = 0, transactionCosts = 0;
    for (const y of years) {
      invested += y.invested;
      buys += y.buys;
      sells += y.sells;
      dividendsGross += y.dividendsGross;
      dividendsNet += y.dividendsNet;
      dividendsTaxes += y.dividendsTaxes;
      capitalGainsTaxes += y.capitalGainsTaxes;
      transactionCosts += y.transactionCosts;
    }
    const taxesPaid = capitalGainsTaxes + dividendsTaxes;
    const startValue = first.portfolioValue;
    const endValue = last.portfolioValue;
    const valueChange = endValue - startValue;

    // Cumulative (period) TWR: the raw ratio of the TWR indices end / start.
    const twrCumulative = first.portfolioTwrIndex > 0
      ? (last.portfolioTwrIndex / first.portfolioTwrIndex) - 1
      : 0;
    const benchmarkTwrCumulative = first.benchmarkTwrIndex > 0
      ? (last.benchmarkTwrIndex / first.benchmarkTwrIndex) - 1
      : 0;
    // Annualise so the all-time row is comparable with the per-year rows and
    // with MWR (which is XIRR, already annualised). Time span uses calendar
    // days between the first and last sample to avoid leap-year drift.
    const spanDays = Math.max(1,
      (new Date(last.date).getTime() - new Date(first.date).getTime()) / 86_400_000);
    const yearsSpan = spanDays / 365.25;
    const annualise = (cum: number): number =>
      yearsSpan > 0 && 1 + cum > 0
        ? Math.pow(1 + cum, 1 / yearsSpan) - 1
        : 0;
    const twr = annualise(twrCumulative);
    const benchmarkTwr = annualise(benchmarkTwrCumulative);

    const baseCapital = Math.max(1, startValue + Math.max(0, invested) / 2);
    const netYield = (valueChange - invested + dividendsNet) / baseCapital;
    const grossYield = (valueChange - invested + dividendsGross + capitalGainsTaxes) / baseCapital;

    // MWR over the entire history: replay all flows + final value.
    const [transactions, dividends] = await Promise.all([
      this.repo.transactions.listByUser(userId),
      this.repo.dividends.listByUser(userId),
    ]);
    const flows: { date: Date; amount: number }[] = [];
    for (const t of transactions) {
      const fx = t.exchangeRate || 1;
      if (t.type === 'BUY') flows.push({ date: new Date(t.date), amount: -(t.grossAmount + t.fees) * fx });
      else flows.push({ date: new Date(t.date), amount: (t.grossAmount - t.fees - t.taxes) * fx });
    }
    for (const d of dividends) flows.push({ date: new Date(d.date), amount: d.amount });
    flows.push({ date: new Date(last.date), amount: endValue });
    const mwr = xirr(flows);

    return {
      year: 0, // sentinel: callers should check `isAllTime` / display separately
      startDate: first.date,
      endDate: last.date,
      startValue: round2(startValue),
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
      twrCumulative: round4(twrCumulative),
      benchmarkTwrCumulative: round4(benchmarkTwrCumulative),
      yearsSpan: Math.round(yearsSpan * 100) / 100,
    };
  }

  /**
   * Dividend analytics — per year, per month, per security plus rolling metrics
   * (TTM, YoC-TTM, CAGR). All amounts are EUR. We treat `Dividend.amount` as the
   * net amount and `Dividend.taxes` as withheld tax to derive gross.
   */
  async dividendAnalytics(userId: string, yearFilter?: number): Promise<DividendAnalytics> {
    const [dividends, transactions, securityList] = await Promise.all([
      this.repo.dividends.listByUser(userId),
      this.repo.transactions.listByUser(userId),
      this.repo.securities.list(),
    ]);
    const securities = new Map(securityList.map((s) => [s.id, s]));
    const todayIso = isoToday();
    const ttmStartIso = (() => {
      const d = new Date(todayIso);
      d.setUTCFullYear(d.getUTCFullYear() - 1);
      return toIsoDate(d);
    })();

    // Per year totals -------------------------------------------------------
    const yearAgg = new Map<number, { gross: number; net: number; taxes: number }>();
    for (const d of dividends) {
      const y = Number(d.date.slice(0, 4));
      const taxes = Math.abs(d.taxes || 0);
      const net = d.amount;
      const gross = net + taxes;
      const cur = yearAgg.get(y) ?? { gross: 0, net: 0, taxes: 0 };
      cur.gross += gross; cur.net += net; cur.taxes += taxes;
      yearAgg.set(y, cur);
    }
    const sortedYears = Array.from(yearAgg.keys()).sort();
    const perYear: DividendYearStat[] = [];
    let prevGross = 0;
    let firstNonZeroGross = 0;
    let firstNonZeroYear = 0;
    for (const y of sortedYears) {
      const cur = yearAgg.get(y)!;
      const growthPct = prevGross > 0 ? (cur.gross - prevGross) / prevGross : null;
      perYear.push({
        year: y,
        gross: round2(cur.gross),
        net: round2(cur.net),
        taxes: round2(cur.taxes),
        growthPct: growthPct !== null ? round4(growthPct) : null,
      });
      if (firstNonZeroGross === 0 && cur.gross > 0) {
        firstNonZeroGross = cur.gross;
        firstNonZeroYear = y;
      }
      prevGross = cur.gross;
    }

    // Per month for the filtered year ---------------------------------------
    const perMonth: DividendMonthStat[] = [];
    if (yearFilter !== undefined) {
      const months = new Map<number, { gross: number; net: number; taxes: number }>();
      for (let m = 1; m <= 12; m++) months.set(m, { gross: 0, net: 0, taxes: 0 });
      for (const d of dividends) {
        const y = Number(d.date.slice(0, 4));
        if (y !== yearFilter) continue;
        const m = Number(d.date.slice(5, 7));
        const taxes = Math.abs(d.taxes || 0);
        const net = d.amount;
        const gross = net + taxes;
        const cur = months.get(m)!;
        cur.gross += gross; cur.net += net; cur.taxes += taxes;
      }
      for (let m = 1; m <= 12; m++) {
        const cur = months.get(m)!;
        perMonth.push({
          month: m,
          gross: round2(cur.gross),
          net: round2(cur.net),
          taxes: round2(cur.taxes),
        });
      }
    }

    // Aggregate totals + TTM ------------------------------------------------
    // When a specific year is selected, the headline "Total gross / Total net"
    // boxes should reflect only that year — otherwise the user sees the same
    // lifetime number regardless of filter. TTM, YoC-TTM and CAGR remain
    // global metrics by definition (they are rolling / multi-year).
    const totalGross = yearFilter !== undefined
      ? (yearAgg.get(yearFilter)?.gross ?? 0)
      : perYear.reduce((s, y) => s + y.gross, 0);
    const totalNet = yearFilter !== undefined
      ? (yearAgg.get(yearFilter)?.net ?? 0)
      : perYear.reduce((s, y) => s + y.net, 0);
    let ttmGross = 0;
    let ttmNet = 0;
    for (const d of dividends) {
      if (d.date < ttmStartIso || d.date > todayIso) continue;
      const taxes = Math.abs(d.taxes || 0);
      ttmNet += d.amount;
      ttmGross += d.amount + taxes;
    }

    // Cost basis of dividend-paying securities (lifetime) — for Yield-on-Cost.
    // We only consider securities that ever paid a dividend, and use the *current*
    // cost basis of the still-open shares plus the historical cost of any sold
    // shares (since YoC is a backward-looking measure of yield vs invested €).
    const dividendPayerIds = new Set<string>();
    for (const d of dividends) dividendPayerIds.add(d.securityId);
    let costOfPayers = 0;
    const fxLookups = new Map<string, (date: string) => number | undefined>();
    const fxFor = async (currency: string): Promise<(d: string) => number> => {
      if (!currency || currency === 'EUR') return () => 1;
      const cached = fxLookups.get(currency);
      if (cached) return (d) => cached(d) ?? 1;
      const ticker = fxTickerToEur(currency);
      if (!ticker) return () => 1;
      const series = await this.market.getHistory(ticker);
      const lookup = MarketDataService.toLookup(series);
      fxLookups.set(currency, lookup);
      return (d) => lookup(d) ?? 1;
    };
    for (const secId of dividendPayerIds) {
      const sec = securities.get(secId);
      if (!sec) continue;
      const fx = await fxFor(sec.currency);
      for (const t of transactions) {
        if (t.securityId !== secId) continue;
        const rate = t.exchangeRate || fx(t.date) || 1;
        if (t.type === 'BUY') {
          costOfPayers += (t.grossAmount + t.fees) * rate;
        }
      }
    }
    const yocTtm = costOfPayers > 0 ? ttmGross / costOfPayers : null;

    // CAGR of yearly gross dividends from the first non-zero year to the latest one.
    let cagr: number | null = null;
    if (firstNonZeroGross > 0 && perYear.length > 0) {
      const last = perYear[perYear.length - 1];
      const span = last.year - firstNonZeroYear;
      if (span > 0 && last.gross > 0) {
        cagr = Math.pow(last.gross / firstNonZeroGross, 1 / span) - 1;
      }
    }

    // Per security stats ----------------------------------------------------
    // Per-security aggregates honour the active year filter (gross/net/taxes
    // describe what the user actually picked). TTM, YoC-TTM and YoY growth are
    // computed from global maps further down so they remain meaningful.
    const perSecMap = new Map<string, {
      securityId: string;
      name: string;
      ticker?: string;
      isin?: string;
      currency: string;
      gross: number; net: number; taxes: number;
      cost: number; // lifetime cost basis in EUR (buys only) of this security
    }>();
    // Pre-compute per-security lifetime cost from BUYs (in EUR)
    const costBySec = new Map<string, number>();
    for (const t of transactions) {
      if (t.type !== 'BUY') continue;
      const sec = securities.get(t.securityId);
      if (!sec) continue;
      const fx = t.exchangeRate || (await fxFor(sec.currency))(t.date) || 1;
      costBySec.set(t.securityId, (costBySec.get(t.securityId) ?? 0) + (t.grossAmount + t.fees) * fx);
    }
    // Pre-compute per-security GLOBAL TTM gross + per-year history regardless of
    // any active year filter, so the table can still surface lifetime-relevant
    // metrics like YoC-TTM and YoY growth even when the user picks a single year.
    const ttmGrossBySec = new Map<string, number>();
    const yearHistoryBySec = new Map<string, Map<number, number>>();
    for (const d of dividends) {
      const taxesAll = Math.abs(d.taxes || 0);
      const grossAll = d.amount + taxesAll;
      if (d.date >= ttmStartIso && d.date <= todayIso) {
        ttmGrossBySec.set(d.securityId, (ttmGrossBySec.get(d.securityId) ?? 0) + grossAll);
      }
      const yh = yearHistoryBySec.get(d.securityId) ?? new Map<number, number>();
      const yKey = Number(d.date.slice(0, 4));
      yh.set(yKey, (yh.get(yKey) ?? 0) + grossAll);
      yearHistoryBySec.set(d.securityId, yh);
    }
    for (const d of dividends) {
      // When the page is showing a single year, restrict per-security stats to
      // that year so the table matches the totals/chart. Lifetime metrics
      // (ttmGross, cost) remain global so YoC-TTM and growth still make sense.
      if (yearFilter !== undefined && Number(d.date.slice(0, 4)) !== yearFilter) continue;
      const sec = securities.get(d.securityId);
      const name = sec?.name ?? d.securityName;
      const taxes = Math.abs(d.taxes || 0);
      const net = d.amount;
      const gross = net + taxes;
      let row = perSecMap.get(d.securityId);
      if (!row) {
        row = {
          securityId: d.securityId,
          name,
          ticker: sec?.ticker,
          isin: sec?.isin,
          currency: sec?.currency ?? 'EUR',
          gross: 0, net: 0, taxes: 0,
          cost: costBySec.get(d.securityId) ?? 0,
        };
        perSecMap.set(d.securityId, row);
      }
      row.gross += gross; row.net += net; row.taxes += taxes;
    }
    const perSecurity: DividendSecurityStat[] = [];
    for (const r of perSecMap.values()) {
      // Growth YoY uses the GLOBAL per-year history for this security so it
      // remains meaningful even when the user has selected a single year.
      // When filtered: compare the filtered year to the year immediately before
      // it. When unfiltered: compare the latest year on record to its prior.
      const ys = Array.from(yearHistoryBySec.get(r.securityId)?.keys() ?? []).sort();
      let growth: number | null = null;
      if (ys.length >= 2) {
        const focusYear = yearFilter !== undefined ? yearFilter : ys[ys.length - 1];
        const prior = [...ys].reverse().find((y) => y < focusYear);
        const lastY = yearHistoryBySec.get(r.securityId)?.get(focusYear) ?? 0;
        const prevY = prior !== undefined ? (yearHistoryBySec.get(r.securityId)?.get(prior) ?? 0) : 0;
        growth = prevY > 0 ? (lastY - prevY) / prevY : null;
      }
      // ttmGross / YoC-TTM stay as lifetime (trailing-12-months as of today)
      // regardless of the filter — they describe the security's CURRENT yield.
      const ttmGrossForSec = ttmGrossBySec.get(r.securityId) ?? 0;
      const yieldOnCostTtm = r.cost > 0 ? ttmGrossForSec / r.cost : null;
      perSecurity.push({
        securityId: r.securityId,
        name: r.name,
        ticker: r.ticker,
        isin: r.isin,
        currency: r.currency,
        gross: round2(r.gross),
        net: round2(r.net),
        taxes: round2(r.taxes),
        ttmGross: round2(ttmGrossForSec),
        cost: round2(r.cost),
        yieldOnCostTtm: yieldOnCostTtm !== null ? round4(yieldOnCostTtm) : null,
        growthYoY: growth !== null ? round4(growth) : null,
      });
    }
    perSecurity.sort((a, b) => b.gross - a.gross);

    return {
      asOf: todayIso,
      yearFilter: yearFilter ?? null,
      perYear,
      perMonth,
      perSecurity,
      totals: {
        gross: round2(totalGross),
        net: round2(totalNet),
        ttmGross: round2(ttmGross),
        ttmNet: round2(ttmNet),
        yieldOnCostTtm: yocTtm !== null ? round4(yocTtm) : null,
        cagr: cagr !== null ? round4(cagr) : null,
        coveredCost: round2(costOfPayers),
      },
    };
  }

  /**
   * Realized P/L: per-year aggregates + per-SELL details. Position is "closed"
   * when the SELL drains the running share count to (~) zero.
   *
   * Dividends attribution: for each security we keep a running "dividend pool"
   * — cumulative EUR dividends/coupons received since the last sell. Each sell
   * gets a share of the pool proportional to `sharesSold / sharesHeldBefore`.
   * What's left stays in the pool until the next sell. This means realized P/L
   * with dividends is fully attributed across the lifetime of the position.
   */
  async realizedAnalytics(userId: string): Promise<RealizedAnalytics> {
    const [transactions, securityList, dividends] = await Promise.all([
      this.repo.transactions.listByUser(userId),
      this.repo.securities.list(),
      this.repo.dividends.listByUser(userId),
    ]);
    const securities = new Map(securityList.map((s) => [s.id, s]));

    const fxLookups = new Map<string, (date: string) => number | undefined>();
    const fxFor = async (currency: string): Promise<(d: string) => number> => {
      if (!currency || currency === 'EUR') return () => 1;
      const cached = fxLookups.get(currency);
      if (cached) return (d) => cached(d) ?? 1;
      const ticker = fxTickerToEur(currency);
      if (!ticker) return () => 1;
      const series = await this.market.getHistory(ticker);
      const lookup = MarketDataService.toLookup(series);
      fxLookups.set(currency, lookup);
      return (d) => lookup(d) ?? 1;
    };

    // Index dividends by security and pre-sort by date so we can stream them
    // alongside transactions per security.
    const dividendsBySec = new Map<string, typeof dividends>();
    for (const d of dividends) {
      const arr = dividendsBySec.get(d.securityId) ?? [];
      arr.push(d);
      dividendsBySec.set(d.securityId, arr);
    }
    for (const arr of dividendsBySec.values()) arr.sort((a, b) => a.date.localeCompare(b.date));

    const bySec = new Map<string, Transaction[]>();
    for (const t of transactions) {
      const arr = bySec.get(t.securityId) ?? [];
      arr.push(t);
      bySec.set(t.securityId, arr);
    }
    const trades: RealizedTrade[] = [];
    // Marks any sells whose date matches one where the position fell to ~0
    // (after processing every transaction on that date). This makes same-day
    // multi-tranche sells that together close the position all show "Closed",
    // not just the last one in the loop order.
    const closingDates = new Set<string>();
    for (const [secId, txs] of bySec) {
      const sec = securities.get(secId);
      const sortedTx = txs.slice().sort((a, b) => a.date.localeCompare(b.date));
      const fxResolve = await fxFor(sec?.currency ?? 'EUR');
      const sec2 = securities.get(secId);
      const isPctConv = (sec2?.priceConvention ?? (sec2?.category === 'Bond' ? 'percent' : 'unit')) === 'percent';
      const secDivs = dividendsBySec.get(secId) ?? [];
      let divIdx = 0;
      let dividendPool = 0; // EUR of dividends accumulated since the previous sell.
      let shares = 0;
      let costLocal = 0;
      // Track running cost in EUR using the FX rate that applied at *each buy*.
      // Without this, FX moves between buy and sell silently disappear because
      // costEur would otherwise be reconstructed from costLocal at the sell-date FX.
      let costEur = 0;
      // Display-only: running "clean" cost in security currency (Value only, no fees)
      // so `priceBought` matches `priceSold` semantics and the raw xlsx price column.
      // P/L still uses the fee-inclusive `costLocal` / `costEur`.
      let cleanCostLocal = 0;
      // Pre-compute end-of-date share balance so we can flag every sell on the
      // day the position reaches zero, regardless of intra-day order.
      let runningShares = 0;
      const sharesEndOfDate = new Map<string, number>();
      for (const t of sortedTx) {
        runningShares += t.type === 'BUY' ? t.shares : -t.shares;
        sharesEndOfDate.set(t.date, runningShares);
      }
      for (const t of sortedTx) {
        // Drain dividends with date <= current tx date into the pool first, so
        // any dividends that landed BEFORE this sell get a chance to be
        // attributed to it. Dividend.amount is already in EUR.
        while (divIdx < secDivs.length && secDivs[divIdx].date <= t.date) {
          dividendPool += secDivs[divIdx].amount;
          divIdx++;
        }
        const fx = t.exchangeRate || fxResolve(t.date) || 1;
        if (t.type === 'BUY') {
          shares += t.shares;
          costLocal += t.grossAmount + t.fees;
          // Cost basis in EUR captured at the FX rate that prevailed on the buy date.
          costEur += (t.grossAmount + t.fees) * fx;
          // Clean price reservoir (excludes fees) for the display column.
          cleanCostLocal += t.grossAmount;
        } else {
          const sharesBefore = shares;
          const avgLocal = sharesBefore > 0 ? costLocal / sharesBefore : 0;
          const avgEur = sharesBefore > 0 ? costEur / sharesBefore : 0;
          const avgCleanLocal = sharesBefore > 0 ? cleanCostLocal / sharesBefore : 0;
          const soldCostLocal = avgLocal * t.shares;
          const soldCostEur = avgEur * t.shares;
          const soldCleanLocal = avgCleanLocal * t.shares;
          const proceedsLocalGross = t.grossAmount; // before fees & tax
          const proceedsLocalNet = t.grossAmount - t.fees - t.taxes;
          const grossEur = proceedsLocalGross * fx;
          const netEur = proceedsLocalNet * fx;
          // FX-aware cost basis: weighted-average EUR cost actually paid for
          // the sold shares (includes FX moves between buy and sell).
          const costEurForTrade = soldCostEur;
          const pnlAbs = netEur - costEurForTrade;
          const pnlPct = costEurForTrade > 0 ? pnlAbs / costEurForTrade : null;
          // Attribute the share of the pool that belongs to the shares being sold.
          const fractionSold = sharesBefore > 0 ? t.shares / sharesBefore : 0;
          const dividendsEur = dividendPool * fractionSold;
          dividendPool -= dividendsEur;
          const pnlWithDivAbs = pnlAbs + dividendsEur;
          const pnlWithDivPct = costEurForTrade > 0 ? pnlWithDivAbs / costEurForTrade : null;
          shares -= t.shares;
          costLocal = Math.max(0, costLocal - soldCostLocal);
          costEur = Math.max(0, costEur - soldCostEur);
          cleanCostLocal = Math.max(0, cleanCostLocal - soldCleanLocal);
          // Closed iff at end-of-day the position is at (or below) zero —
          // groups same-day multi-tranche sells into a single closure event.
          const eodShares = sharesEndOfDate.get(t.date) ?? shares;
          const closedAfter = eodShares <= 1e-9;
          if (closedAfter) closingDates.add(`${secId}|${t.date}`);
          // Average buy price for the shares being sold, in security currency,
          // EXCLUDING fees (matches `priceSold` semantics and the raw xlsx price).
          // Bonds use percent-of-face convention, so scale ×100 for display.
          const buyPriceLocal = isPctConv ? avgCleanLocal * 100 : avgCleanLocal;
          const pricePerShare = t.shares > 0
            ? (isPctConv ? (t.grossAmount / t.shares) * 100 : t.grossAmount / t.shares)
            : 0;
          trades.push({
            transactionId: t.id,
            securityId: secId,
            name: sec2?.name ?? t.securityName,
            ticker: sec2?.ticker ?? t.ticker,
            isin: sec2?.isin ?? t.isin,
            currency: sec2?.currency ?? 'EUR',
            priceConvention: sec2?.priceConvention ?? (sec2?.category === 'Bond' ? 'percent' : 'unit'),
            date: t.date,
            sharesSold: t.shares,
            priceBought: round4(buyPriceLocal),
            priceSold: round4(pricePerShare),
            grossEur: round2(grossEur),
            netEur: round2(netEur),
            costBasisEur: round2(costEurForTrade),
            pnlAbsEur: round2(pnlAbs),
            pnlPct: pnlPct !== null ? round4(pnlPct) : null,
            dividendsEur: round2(dividendsEur),
            pnlWithDividendsEur: round2(pnlWithDivAbs),
            pnlWithDividendsPct: pnlWithDivPct !== null ? round4(pnlWithDivPct) : null,
            positionClosed: closedAfter,
          });
        }
      }
    }
    // Backfill: any sell on a day flagged as closing the position should also
    // show as Closed (catches the first tranche of a same-day multi-sell).
    for (const t of trades) {
      if (closingDates.has(`${t.securityId}|${t.date}`)) t.positionClosed = true;
    }
    trades.sort((a, b) => b.date.localeCompare(a.date));

    // Per year aggregates
    const byYear = new Map<number, { gross: number; net: number; pnl: number; dividends: number; trades: number }>();
    for (const t of trades) {
      const y = Number(t.date.slice(0, 4));
      const cur = byYear.get(y) ?? { gross: 0, net: 0, pnl: 0, dividends: 0, trades: 0 };
      cur.gross += t.grossEur;
      cur.net += t.netEur;
      cur.pnl += t.pnlAbsEur;
      cur.dividends += t.dividendsEur;
      cur.trades += 1;
      byYear.set(y, cur);
    }
    const perYear: RealizedYearStat[] = Array.from(byYear.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([year, v]) => ({
        year,
        grossEur: round2(v.gross),
        netEur: round2(v.net),
        pnlEur: round2(v.pnl),
        dividendsEur: round2(v.dividends),
        pnlWithDividendsEur: round2(v.pnl + v.dividends),
        trades: v.trades,
      }));
    const totalPnl = trades.reduce((s, t) => s + t.pnlAbsEur, 0);
    const totalDividends = trades.reduce((s, t) => s + t.dividendsEur, 0);
    const totalCostBasis = trades.reduce((s, t) => s + t.costBasisEur, 0);
    // Cost-basis-weighted average P/L %. More meaningful than a plain mean of
    // pnlPct because it weights big trades over micro lots.
    const avgPnlPct = totalCostBasis > 0 ? totalPnl / totalCostBasis : null;
    const avgPnlWithDividendsPct = totalCostBasis > 0
      ? (totalPnl + totalDividends) / totalCostBasis
      : null;
    return {
      asOf: isoToday(),
      trades,
      perYear,
      totals: {
        grossEur: round2(trades.reduce((s, t) => s + t.grossEur, 0)),
        netEur: round2(trades.reduce((s, t) => s + t.netEur, 0)),
        pnlEur: round2(totalPnl),
        dividendsEur: round2(totalDividends),
        pnlWithDividendsEur: round2(totalPnl + totalDividends),
        costBasisEur: round2(totalCostBasis),
        avgPnlPct: avgPnlPct !== null ? round4(avgPnlPct) : null,
        avgPnlWithDividendsPct: avgPnlWithDividendsPct !== null ? round4(avgPnlWithDividendsPct) : null,
        trades: trades.length,
      },
    };
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
  /**
   * Set on the all-time row only. Period (cumulative) TWR before annualisation,
   * useful as a tooltip alongside the annualised `twr`.
   */
  twrCumulative?: number;
  /** Set on the all-time row only. Period (cumulative) benchmark TWR. */
  benchmarkTwrCumulative?: number;
  /** Set on the all-time row only. Length of the all-time period in years. */
  yearsSpan?: number;
}

export interface DividendYearStat {
  year: number;
  gross: number;
  net: number;
  taxes: number;
  /** Growth vs previous year's gross dividends, as a fraction (0.10 = +10%). null when no prior year. */
  growthPct: number | null;
}

export interface DividendMonthStat {
  month: number;
  gross: number;
  net: number;
  taxes: number;
}

export interface DividendSecurityStat {
  securityId: string;
  name: string;
  ticker?: string;
  isin?: string;
  currency: string;
  gross: number;
  net: number;
  taxes: number;
  /** Gross dividends collected in the trailing 12 months. */
  ttmGross: number;
  /** Lifetime BUY cost basis (EUR, fees included) — denominator for YoC-TTM. */
  cost: number;
  /** ttmGross / cost. null when cost == 0. */
  yieldOnCostTtm: number | null;
  /** Last-year / prior-year growth as a fraction. null when too little history. */
  growthYoY: number | null;
}

export interface DividendAnalytics {
  asOf: string;
  /** Year selected by the caller; null = ALL. */
  yearFilter: number | null;
  perYear: DividendYearStat[];
  /** 12 entries (Jan..Dec) when yearFilter is set, otherwise empty. */
  perMonth: DividendMonthStat[];
  perSecurity: DividendSecurityStat[];
  totals: {
    gross: number;
    net: number;
    ttmGross: number;
    ttmNet: number;
    /** TTM gross / cost basis of dividend-paying securities. */
    yieldOnCostTtm: number | null;
    /** Compound annual growth rate of yearly gross dividends. */
    cagr: number | null;
    coveredCost: number;
  };
}

export interface RealizedTrade {
  transactionId: string;
  securityId: string;
  name: string;
  ticker?: string;
  isin?: string;
  currency: string;
  priceConvention: 'unit' | 'percent';
  date: string;
  sharesSold: number;
  /**
   * Average purchase price per share for the lot being sold, in the security's
   * local currency. Uses the average-cost method (× 100 for percent bonds).
   */
  priceBought: number;
  /** Sale price per share in the security's local currency (× 100 for percent convention). */
  priceSold: number;
  /** Gross EUR proceeds (before fees and taxes). */
  grossEur: number;
  /** Net EUR proceeds (after fees and taxes). */
  netEur: number;
  /** Cost basis (avg-cost) attributed to the sold shares, in EUR. */
  costBasisEur: number;
  /** netEur - costBasisEur. Capital gain only (NOT including dividends/coupons). */
  pnlAbsEur: number;
  /** pnlAbsEur / costBasisEur. null when cost == 0. */
  pnlPct: number | null;
  /**
   * EUR dividends / coupons attributed to the shares being sold. Drawn pro-rata
   * from the running pool of dividends accumulated since the previous sell.
   */
  dividendsEur: number;
  /** pnlAbsEur + dividendsEur. */
  pnlWithDividendsEur: number;
  /** pnlWithDividendsEur / costBasisEur. null when cost == 0. */
  pnlWithDividendsPct: number | null;
  /** True when the SELL closed the position completely. */
  positionClosed: boolean;
}

export interface RealizedYearStat {
  year: number;
  grossEur: number;
  netEur: number;
  pnlEur: number;
  /** Dividends attributed to sells in this year. */
  dividendsEur: number;
  /** Capital gain + attributed dividends. */
  pnlWithDividendsEur: number;
  trades: number;
}

export interface RealizedAnalytics {
  asOf: string;
  trades: RealizedTrade[];
  perYear: RealizedYearStat[];
  totals: {
    grossEur: number;
    netEur: number;
    /** Capital gain only (no dividends). */
    pnlEur: number;
    /** Dividends/coupons attributed to all closed lots. */
    dividendsEur: number;
    /** Capital gain + dividends. */
    pnlWithDividendsEur: number;
    /** Sum of cost basis of all sold lots (EUR). Denominator for avg P/L %. */
    costBasisEur: number;
    /** Cost-basis-weighted average P/L percentage. null when no trades. */
    avgPnlPct: number | null;
    /** Same as avgPnlPct but including attributed dividends. */
    avgPnlWithDividendsPct: number | null;
    trades: number;
  };
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
function round4(n: number): number { return Math.round(n * 10000) / 10000; }

// Silence unused warnings if AssetCategory ever becomes unused after refactors.
export type _AssetCategory = AssetCategory;
