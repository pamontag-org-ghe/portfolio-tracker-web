import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import { getRepository } from '../data/index.js';
import { importWorkbook } from '../importers/xlsxImporter.js';
import { PerformanceEngine } from '../portfolio/performanceEngine.js';
import { MarketDataService } from '../market/marketData.js';
import { HttpError } from '../middleware/error.js';
import { deterministicId, parseNumber, toIsoDate } from '../utils/ids.js';
import type { Transaction, AssetCategory } from '../types.js';

export const portfolioRouter = Router();
portfolioRouter.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

portfolioRouter.post('/import', upload.single('file'), async (req: AuthenticatedRequest, res, next) => {
  try {
    if (!req.file) throw new HttpError(400, 'No file uploaded (expected multipart field "file")');
    const repo = getRepository();
    const summary = await importWorkbook(req.file.buffer, req.userId!, repo);
    res.json(summary);
  } catch (err) { next(err); }
});

portfolioRouter.get('/holdings', async (req: AuthenticatedRequest, res, next) => {
  try {
    const engine = new PerformanceEngine(getRepository());
    const validRanges = ['1D', '1W', '1M', 'YTD', '1Y', '3Y', '5Y', 'ALL'] as const;
    const rawRange = typeof req.query.range === 'string' ? req.query.range : undefined;
    const range = rawRange && (validRanges as readonly string[]).includes(rawRange)
      ? rawRange as typeof validRanges[number]
      : undefined;
    const { holdings } = await engine.computeHoldings(req.userId!, range);
    res.json({ holdings });
  } catch (err) { next(err); }
});

portfolioRouter.get('/fx-rates', async (req: AuthenticatedRequest, res, next) => {
  try {
    const repo = getRepository();
    const engine = new PerformanceEngine(repo);
    const { holdings } = await engine.computeHoldings(req.userId!);
    const currencies = new Set<string>();
    for (const h of holdings) {
      if (h.shares > 0 && h.currency && h.currency !== 'EUR') currencies.add(h.currency);
    }
    const market = new MarketDataService(repo);
    const today = new Date().toISOString().slice(0, 10);
    const rates: Array<{ currency: string; rate: number | null; asOf: string | null }> = [];
    for (const cur of currencies) {
      const series = await market.getHistory(`${cur}EUR=X`);
      const lookup = MarketDataService.toLookup(series);
      const rate = lookup(today);
      const last = series.points[series.points.length - 1];
      rates.push({
        currency: cur,
        rate: rate ?? null,
        asOf: last?.date ?? null,
      });
    }
    rates.sort((a, b) => a.currency.localeCompare(b.currency));
    res.json({ base: 'EUR', rates });
  } catch (err) { next(err); }
});

portfolioRouter.get('/transactions', async (req: AuthenticatedRequest, res, next) => {
  try {
    const repo = getRepository();
    const transactions = await repo.transactions.listByUser(req.userId!);
    transactions.sort((a, b) => a.date.localeCompare(b.date));
    res.json({ transactions });
  } catch (err) { next(err); }
});

portfolioRouter.get('/dividends', async (req: AuthenticatedRequest, res, next) => {
  try {
    const repo = getRepository();
    const dividends = await repo.dividends.listByUser(req.userId!);
    dividends.sort((a, b) => a.date.localeCompare(b.date));
    res.json({ dividends });
  } catch (err) { next(err); }
});

const txSchema = z.object({
  securityId: z.string().optional(),
  ticker: z.string().optional(),
  isin: z.string().optional(),
  name: z.string().min(1),
  category: z.enum(['Stock', 'Bond', 'ETF', 'MutualFund', 'Commodities', 'Crypto', 'Other']).default('Other'),
  currency: z.string().default('EUR'),
  type: z.enum(['BUY', 'SELL']),
  shares: z.number().positive(),
  grossAmount: z.number().positive(),
  exchangeRate: z.number().positive().default(1),
  fees: z.number().nonnegative().default(0),
  taxes: z.number().nonnegative().default(0),
  date: z.string().min(10),
  broker: z.string().optional(),
  market: z.string().optional(),
  notes: z.string().optional(),
});

async function resolveOrCreateSecurity(input: z.infer<typeof txSchema>) {
  const repo = getRepository();
  if (input.securityId) {
    const found = await repo.securities.findById(input.securityId);
    if (found) return found;
  }
  if (input.isin) {
    const byIsin = await repo.securities.findByIsin(input.isin);
    if (byIsin) return byIsin;
  }
  if (input.ticker) {
    const byTicker = await repo.securities.findByTicker(input.ticker);
    if (byTicker) return byTicker;
  }
  const id = deterministicId('SEC', input.isin ?? '', input.ticker ?? '', input.name);
  return repo.securities.upsert({
    id,
    ticker: input.ticker,
    isin: input.isin,
    name: input.name,
    category: input.category as AssetCategory,
    currency: input.currency,
  });
}

portfolioRouter.post('/transactions', async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = txSchema.parse(req.body);
    const repo = getRepository();
    const sec = await resolveOrCreateSecurity(body);
    const date = toIsoDate(body.date);
    const id = deterministicId('TX', req.userId!, sec.id, body.type, date, body.shares, body.grossAmount);
    const convention = sec.priceConvention ?? (sec.category === 'Bond' ? 'percent' : 'unit');
    const unitPrice = convention === 'percent'
      ? (body.grossAmount / body.shares) * 100
      : body.grossAmount / body.shares;
    const tx: Transaction = {
      id,
      userId: req.userId!,
      securityId: sec.id,
      ticker: sec.ticker,
      isin: sec.isin,
      securityName: sec.name,
      category: sec.category,
      type: body.type,
      shares: body.shares,
      grossAmount: body.grossAmount,
      pricePerShare: unitPrice,
      exchangeRate: body.exchangeRate,
      fees: body.fees,
      taxes: body.taxes,
      date,
      broker: body.broker,
      market: body.market,
      notes: body.notes,
    };
    await repo.transactions.upsert(tx);
    res.status(201).json(tx);
  } catch (err) { next(err); }
});

portfolioRouter.put('/transactions/:id', async (req: AuthenticatedRequest, res, next) => {
  try {
    const repo = getRepository();
    const existing = await repo.transactions.findById(req.userId!, req.params.id);
    if (!existing) throw new HttpError(404, 'Transaction not found');
    const partial = req.body as Partial<Transaction>;
    const updated: Transaction = {
      ...existing,
      ...partial,
      id: existing.id,
      userId: existing.userId,
      shares: partial.shares !== undefined ? parseNumber(partial.shares) : existing.shares,
      grossAmount: partial.grossAmount !== undefined ? parseNumber(partial.grossAmount) : existing.grossAmount,
      exchangeRate: partial.exchangeRate !== undefined ? parseNumber(partial.exchangeRate, 1) : existing.exchangeRate,
      fees: partial.fees !== undefined ? parseNumber(partial.fees) : existing.fees,
      taxes: partial.taxes !== undefined ? parseNumber(partial.taxes) : existing.taxes,
    };
    const sec = await repo.securities.findById(existing.securityId);
    const convention = sec?.priceConvention ?? (existing.category === 'Bond' ? 'percent' : 'unit');
    updated.pricePerShare = updated.shares > 0
      ? (convention === 'percent' ? (updated.grossAmount / updated.shares) * 100 : updated.grossAmount / updated.shares)
      : 0;
    await repo.transactions.upsert(updated);
    res.json(updated);
  } catch (err) { next(err); }
});

portfolioRouter.delete('/transactions/:id', async (req: AuthenticatedRequest, res, next) => {
  try {
    const repo = getRepository();
    const ok = await repo.transactions.delete(req.userId!, req.params.id);
    if (!ok) throw new HttpError(404, 'Transaction not found');
    res.status(204).end();
  } catch (err) { next(err); }
});

const dividendSchema = z.object({
  securityId: z.string().optional(),
  ticker: z.string().optional(),
  isin: z.string().optional(),
  name: z.string().min(1),
  category: z.enum(['Stock', 'Bond', 'ETF', 'MutualFund', 'Commodities', 'Crypto', 'Other']).default('Other'),
  currency: z.string().default('EUR'),
  amount: z.number().positive(),
  taxes: z.number().nonnegative().default(0),
  date: z.string().min(10),
  notes: z.string().optional(),
});

portfolioRouter.post('/dividends', async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = dividendSchema.parse(req.body);
    const repo = getRepository();
    const sec = await resolveOrCreateSecurity({
      securityId: body.securityId,
      ticker: body.ticker,
      isin: body.isin,
      name: body.name,
      category: body.category,
      currency: body.currency,
      // Unused by resolveOrCreateSecurity but required by the txSchema shape.
      type: 'BUY',
      shares: 1,
      grossAmount: 1,
      exchangeRate: 1,
      fees: 0,
      taxes: 0,
      date: body.date,
    });
    const date = toIsoDate(body.date);
    const id = deterministicId('DV', req.userId!, sec.id, date, body.amount, body.taxes);
    const dividend = {
      id,
      userId: req.userId!,
      securityId: sec.id,
      securityName: sec.name,
      category: sec.category,
      amount: body.amount,
      taxes: body.taxes,
      date,
      notes: body.notes,
    };
    await repo.dividends.upsert(dividend);
    res.status(201).json(dividend);
  } catch (err) { next(err); }
});

portfolioRouter.delete('/dividends/:id', async (req: AuthenticatedRequest, res, next) => {
  try {
    const repo = getRepository();
    const ok = await repo.dividends.delete(req.userId!, req.params.id);
    if (!ok) throw new HttpError(404, 'Dividend not found');
    res.status(204).end();
  } catch (err) { next(err); }
});

portfolioRouter.get('/performance', async (req: AuthenticatedRequest, res, next) => {
  try {
    const engine = new PerformanceEngine(getRepository());
    const result = await engine.computePerformance(req.userId!);
    res.json(result);
  } catch (err) { next(err); }
});

portfolioRouter.get('/allocation', async (req: AuthenticatedRequest, res, next) => {
  try {
    const engine = new PerformanceEngine(getRepository());
    const result = await engine.allocation(req.userId!);
    res.json(result);
  } catch (err) { next(err); }
});

portfolioRouter.get('/yearly-performance', async (req: AuthenticatedRequest, res, next) => {
  try {
    const engine = new PerformanceEngine(getRepository());
    const result = await engine.yearlyPerformance(req.userId!);
    res.json({ years: result });
  } catch (err) { next(err); }
});
