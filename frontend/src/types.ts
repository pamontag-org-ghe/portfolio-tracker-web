export type AssetCategory = 'Stock' | 'Bond' | 'ETF' | 'MutualFund' | 'Commodities' | 'Other';
export type AssetClass = 'Stock' | 'Bond' | 'Gold' | 'Other';
export type InstrumentType = 'Stock' | 'ETF' | 'Bond' | 'MutualFund' | 'Other';
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
}
