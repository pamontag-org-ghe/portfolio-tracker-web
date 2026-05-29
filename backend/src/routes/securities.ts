import { Router } from 'express';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import { getRepository } from '../data/index.js';
import { MarketDataService } from '../market/marketData.js';
import { lookupBondByIsin } from '../market/bondData.js';

export const securitiesRouter = Router();
securitiesRouter.use(requireAuth);

securitiesRouter.get('/', async (_req: AuthenticatedRequest, res, next) => {
  try {
    const repo = getRepository();
    const securities = await repo.securities.list();
    securities.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ securities });
  } catch (err) { next(err); }
});

const YAHOO_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

interface YahooQuoteResult {
  symbol?: string;
  shortName?: string;
  longName?: string;
  currency?: string;
  quoteType?: string;
  exchange?: string;
}

async function fetchYahooJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': YAHOO_UA, Accept: 'application/json,text/plain,*/*' },
    });
    if (!res.ok) return null;
    const text = await res.text();
    try { return JSON.parse(text) as T; } catch { return null; }
  } catch { return null; }
}

async function lookupTicker(ticker: string) {
  const sym = ticker.trim();
  if (!sym) return { ok: false as const, reason: 'empty' };
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(sym)}`;
  const json = await fetchYahooJson<{ quoteResponse?: { result?: YahooQuoteResult[] } }>(url);
  const result = json?.quoteResponse?.result?.[0];
  if (!result || !result.symbol) {
    return { ok: false as const, reason: 'not_found' };
  }
  return {
    ok: true as const,
    symbol: result.symbol,
    name: result.longName ?? result.shortName,
    currency: result.currency,
    exchange: result.exchange,
    quoteType: result.quoteType,
  };
}

interface YahooSearchQuote {
  symbol?: string;
  shortname?: string;
  longname?: string;
  exchange?: string;
  quoteType?: string;
}

async function lookupIsin(isin: string) {
  const code = isin.trim().toUpperCase();
  if (!code) return { ok: false as const, reason: 'empty' };
  // Sanity check: ISINs are 12 alphanumeric characters.
  if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(code)) {
    return { ok: false as const, reason: 'invalid_format' };
  }
  // Try our cached bonds reference list first — covers Italian / EuroTLX bonds
  // where Yahoo often doesn't index by ISIN.
  const bond = await lookupBondByIsin(code);
  if (bond) {
    return {
      ok: true as const,
      name: bond.description,
      currency: bond.currency,
      source: 'bonds_list' as const,
      isBond: true,
    };
  }
  // Fallback: Yahoo search by ISIN — returns matching equities/ETFs.
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(code)}&quotesCount=1&newsCount=0`;
  const json = await fetchYahooJson<{ quotes?: YahooSearchQuote[] }>(url);
  const quote = json?.quotes?.[0];
  if (!quote || !quote.symbol) {
    return { ok: false as const, reason: 'not_found' };
  }
  return {
    ok: true as const,
    name: quote.longname ?? quote.shortname,
    symbol: quote.symbol,
    source: 'yahoo' as const,
    quoteType: quote.quoteType,
  };
}

securitiesRouter.get('/lookup', async (req: AuthenticatedRequest, res, next) => {
  try {
    const ticker = typeof req.query.ticker === 'string' ? req.query.ticker : '';
    const isin = typeof req.query.isin === 'string' ? req.query.isin : '';
    const [tickerResult, isinResult] = await Promise.all([
      ticker ? lookupTicker(ticker) : Promise.resolve(null),
      isin ? lookupIsin(isin) : Promise.resolve(null),
    ]);
    res.json({ ticker: tickerResult, isin: isinResult });
  } catch (err) { next(err); }
});

securitiesRouter.get('/:symbol/history', async (req, res, next) => {
  try {
    const market = new MarketDataService(getRepository());
    const series = await market.getHistory(req.params.symbol, req.query.since as string | undefined);
    res.json(series);
  } catch (err) { next(err); }
});
