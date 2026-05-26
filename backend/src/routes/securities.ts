import { Router } from 'express';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import { getRepository } from '../data/index.js';
import { MarketDataService } from '../market/marketData.js';

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

securitiesRouter.get('/:symbol/history', async (req, res, next) => {
  try {
    const market = new MarketDataService(getRepository());
    const series = await market.getHistory(req.params.symbol, req.query.since as string | undefined);
    res.json(series);
  } catch (err) { next(err); }
});
