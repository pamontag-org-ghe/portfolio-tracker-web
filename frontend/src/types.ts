export type AssetCategory = 'Stock' | 'Bond' | 'ETF' | 'MutualFund' | 'Commodities' | 'Crypto' | 'Other';
export type AssetClass = 'Stock' | 'Bond' | 'Gold' | 'Crypto' | 'Other';
export type InstrumentType = 'Stock' | 'ETF' | 'Bond' | 'MutualFund' | 'Crypto' | 'Other';
export type TimeRange = '1D' | '1W' | '1M' | 'YTD' | '1Y' | '3Y' | '5Y' | 'ALL';

export interface Holding {
  securityId: string;
  ticker?: string;
  isin?: string;
  name: string;
  category: AssetCategory;
  assetClass: AssetClass;
  instrumentType: InstrumentType;
  currency: string;
  priceConvention?: 'unit' | 'percent';
  shares: number;
  averageCost: number;
  costBasis: number;
  currentPrice?: number;
  currentValueLocal?: number;
  currentValue?: number;
  fxRate?: number;
  unrealizedPnL?: number;
  unrealizedPnLPct?: number;
  realizedPnL: number;
  dividendsTotal: number;
  /** Range-scoped P/L in EUR. Present when the dashboard requested holdings for a specific time range. */
  rangePnL?: number;
  /** Range P/L expressed as a percentage of capital exposed (startValue + buys during range). */
  rangePnLPct?: number;
  /** EUR value of the position at the beginning of the requested range. */
  rangeStartValue?: number;
  /** Sum of buys (cost incl. fees) during the requested range, in EUR. */
  rangeBuys?: number;
  /** Sum of sell proceeds (net of fees and taxes) during the requested range, in EUR. */
  rangeSells?: number;
  /** Dividends paid during the requested range, in EUR. */
  rangeDividends?: number;
  /** ISO date of the latest price datapoint used to value this holding. */
  priceAsOf?: string;
  /** ISO datetime when the price series was last refreshed from the upstream source. */
  priceFetchedAt?: string;
  /** ISO date of the latest FX rate used to convert to EUR. */
  fxAsOf?: string;
  /** ISO datetime when the FX series was last refreshed. */
  fxFetchedAt?: string;
}

export interface HoldingsResponse {
  holdings: Holding[];
  asOf: {
    latestPriceFetchedAt: string | null;
    oldestPriceFetchedAt: string | null;
  };
}

export interface FxRatesResponse {
  base: string;
  rates: Array<{ currency: string; rate: number | null; asOf: string | null }>;
}

export interface Transaction {
  id: string;
  userId: string;
  securityId: string;
  ticker?: string;
  isin?: string;
  securityName: string;
  category: AssetCategory;
  type: 'BUY' | 'SELL';
  shares: number;
  grossAmount: number;
  pricePerShare: number;
  exchangeRate: number;
  fees: number;
  taxes: number;
  date: string;
  broker?: string;
  notes?: string;
}

export interface PerformancePoint {
  date: string;
  portfolioValue: number;
  benchmarkValue: number;
  invested: number;
  portfolioTwrIndex: number;
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

export interface ImportSummary {
  securities: { created: number; updated: number; skipped: number };
  transactions: { created: number; updated: number; skipped: number };
  dividends: { created: number; updated: number; skipped: number };
  warnings: string[];
  errors: string[];
}

export interface AllocationResponse {
  byAssetClass: Record<string, number>;
  byInstrumentType: Record<string, number>;
  bySecurity: Record<string, number>;
  byCategory: Record<string, number>;
  byCurrency: Record<string, number>;
}

export interface Dividend {
  id: string;
  userId: string;
  securityId: string;
  securityName: string;
  category: AssetCategory;
  amount: number;
  taxes: number;
  date: string;
  notes?: string;
}

export interface YearlyPerformance {
  year: number;
  startDate: string;
  endDate: string;
  startValue: number;
  endValue: number;
  invested: number;
  buys: number;
  sells: number;
  dividendsGross: number;
  dividendsNet: number;
  dividendsTaxes: number;
  capitalGainsTaxes: number;
  taxesPaid: number;
  transactionCosts: number;
  valueChange: number;
  grossYield: number;
  netYield: number;
  twr: number;
  mwr: number | null;
  benchmarkTwr: number;
  /** All-time row only: cumulative (period) TWR before annualisation. */
  twrCumulative?: number;
  /** All-time row only: cumulative (period) benchmark TWR. */
  benchmarkTwrCumulative?: number;
  /** All-time row only: length of the period in years (e.g. 5.42). */
  yearsSpan?: number;
}

export interface YearlyPerformanceResponse {
  years: YearlyPerformance[];
  allTime: YearlyPerformance | null;
}

export interface DividendYearStat {
  year: number;
  gross: number;
  net: number;
  taxes: number;
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
  ttmGross: number;
  cost: number;
  yieldOnCostTtm: number | null;
  growthYoY: number | null;
}

export interface DividendAnalytics {
  asOf: string;
  yearFilter: number | null;
  perYear: DividendYearStat[];
  perMonth: DividendMonthStat[];
  perSecurity: DividendSecurityStat[];
  totals: {
    gross: number;
    net: number;
    ttmGross: number;
    ttmNet: number;
    yieldOnCostTtm: number | null;
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
  /** Average cost per share for the sold lot (security currency, ×100 for percent bonds). */
  priceBought: number;
  priceSold: number;
  grossEur: number;
  netEur: number;
  costBasisEur: number;
  /** Capital gain only (excludes dividends). */
  pnlAbsEur: number;
  pnlPct: number | null;
  /** Dividends/coupons attributed to the sold shares (EUR). */
  dividendsEur: number;
  /** pnlAbsEur + dividendsEur. */
  pnlWithDividendsEur: number;
  pnlWithDividendsPct: number | null;
  positionClosed: boolean;
}

export interface RealizedYearStat {
  year: number;
  grossEur: number;
  netEur: number;
  pnlEur: number;
  dividendsEur: number;
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
    pnlEur: number;
    dividendsEur: number;
    pnlWithDividendsEur: number;
    costBasisEur: number;
    avgPnlPct: number | null;
    avgPnlWithDividendsPct: number | null;
    trades: number;
  };
}
