import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { authRouter } from './routes/auth.js';
import { portfolioRouter } from './routes/portfolio.js';
import { securitiesRouter } from './routes/securities.js';
import { errorHandler } from './middleware/error.js';
import { initRepository } from './data/index.js';

export async function createApp() {
  await initRepository();

  const app = express();
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        if (config.corsOrigins.includes('*') || config.corsOrigins.includes(origin)) {
          return cb(null, true);
        }
        return cb(new Error(`Origin ${origin} not allowed by CORS`));
      },
      credentials: true,
    })
  );
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', driver: config.storageDriver });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/portfolio', portfolioRouter);
  app.use('/api/securities', securitiesRouter);

  app.use(errorHandler);
  return app;
}
