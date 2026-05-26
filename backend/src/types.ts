// Domain types shared across the backend.

export type Currency = 'EUR' | 'USD' | string;

export type AssetCategory = 'Stock' | 'Bond' | 'ETF' | 'MutualFund' | 'Commodities' | 'Other';

/**
 * What the underlying asset *is*. Orthogonal to how it's held.
 *   - Stock: equity exposure (single name or basket)
 *   - Bond:  fixed income exposure (single issuance or basket)
 *   - Gold:  precious metal / commodity exposure
 *   - Other: cash, mixed, money market, etc.
 */
export type AssetClass = 'Stock' | 'Bond' | 'Gold' | 'Other';

/**
 * How the asset is held — the *wrapper*. A gold ETC has assetClass='Gold' but instrumentType='ETF'.
 */
export type InstrumentType = 'Stock' | 'ETF' | 'Bond' | 'MutualFund' | 'Other';

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  displayName?: string;
  createdAt: string;
}

export interface Security {
  id: string;
  ticker?: string;
  isin?: string;
  name: string;
  /** Legacy combined category (kept for backwards-compat). Prefer assetClass + instrumentType. */
  category: AssetCategory;
  currency: Currency;
  area?: string;
  sector?: string;
  issuer?: string;
  /** What the underlying is (Stock / Bond / Gold / Other). */
  assetClass?: AssetClass;
  /** How it's held (Stock / ETF / Bond / MutualFund / Other). */
  instrumentType?: InstrumentType;
  /**
   * Price quotation convention:
   *   - 'unit': price × shares = total in security currency (default).
   *   - 'percent': price is % of nominal (bonds).
   */
  priceConvention?: 'unit' | 'percent';
}

export function deriveAssetClass(sec: Pick<Security, 'assetClass' | 'category' | 'name'>): AssetClass {
  if (sec.assetClass) return sec.assetClass;
  if (sec.category === 'Bond') return 'Bond';
  if (sec.category === 'Commodities') return 'Gold';
  const lname = (sec.name ?? '').toLowerCase();
  if (/(gold|oro|bullion|silver|argento)/.test(lname)) return 'Gold';
  if (/(bond|obblig|treasury|aggregate|govern|corporate|cedola|euro corp)/.test(lname)) return 'Bond';
  if (sec.category === 'Stock' || sec.category === 'ETF' || sec.category === 'MutualFund') return 'Stock';
  return 'Other';
}

export function deriveInstrumentType(sec: Pick<Security, 'instrumentType' | 'category'>): InstrumentType {
  if (sec.instrumentType) return sec.instrumentType;
  if (sec.category === 'ETF') return 'ETF';
  if (sec.category === 'Bond') return 'Bond';
  if (sec.category === 'MutualFund') return 'MutualFund';
  if (sec.category === 'Stock') return 'Stock';
  if (sec.category === 'Commodities') return 'ETF';
  return 'Other';
}

export type TransactionType = 'BUY' | 'SELL';

export interface Transaction {
  id: string;
  userId: string;
  securityId: string;
  ticker?: string;
  isin?: string;
  securityName: string;
  category: AssetCategory;
  type: TransactionType;
  shares: number;
  grossAmount: number;
  pricePerShare: number;
  exchangeRate: number;
  fees: number;
  taxes: number;
  date: string;
  broker?: string;
  market?: string;
  notes?: string;
}

export interface Dividend {
  id: string;
  userId: string;
  securityId: string;
  securityName: string;
  category: AssetCategory;
  /** Net amount in EUR (after withholding tax). */
  amount: number;
  /** Withholding tax already paid (positive number). */
  taxes: number;
  date: string;
  notes?: string;
}

export interface PricePoint {
  date: string;
  close: number;
}

export interface PriceSeries {
  symbol: string;
  currency: string;
  updatedAt: string;
  points: PricePoint[];
}

export interface Holding {
  securityId: string;
  ticker?: string;
  isin?: string;
  name: string;
  category: AssetCategory;
  assetClass: AssetClass;
  instrumentType: InstrumentType;
  currency: Currency;
  priceConvention?: 'unit' | 'percent';
  shares: number;
  averageCost: number;
  costBasis: number;
  currentPrice?: number;
  /** Value in the security's local currency (price × shares, accounting for priceConvention). */
  currentValueLocal?: number;
  /** Value in EUR (after FX conversion). */
  currentValue?: number;
  /** FX rate from security currency to EUR used to compute currentValue. */
  fxRate?: number;
  unrealizedPnL?: number;
  unrealizedPnLPct?: number;
  realizedPnL: number;
  dividendsTotal: number;
}

