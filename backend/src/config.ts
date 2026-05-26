import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';

const env = process.env;

// Resolve paths relative to the backend module location (where this file lives),
// not the current working directory. This keeps "./.data" stable regardless of
// where the process is launched from.
const here = path.dirname(fileURLToPath(import.meta.url));
// In dev (tsx) `here` is `<root>/backend/src`; in production (compiled) it's `<root>/backend/dist`.
const backendRoot = path.resolve(here, '..');

function resolveStorage(envValue: string | undefined, defaultRelative: string): string {
  const raw = envValue && envValue.trim() !== '' ? envValue : defaultRelative;
  return path.isAbsolute(raw) ? raw : path.resolve(backendRoot, raw);
}

export const config = {
  port: parseInt(env.PORT ?? '4000', 10),
  nodeEnv: env.NODE_ENV ?? 'development',
  jwtSecret: env.JWT_SECRET ?? 'dev-only-change-me',
  storageDriver: (env.STORAGE_DRIVER ?? 'local') as 'local' | 'cosmos',
  cosmos: {
    endpoint: env.COSMOS_ENDPOINT ?? '',
    key: env.COSMOS_KEY ?? '',
    database: env.COSMOS_DATABASE ?? 'portfolio-tracker',
  },
  corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  dataDir: resolveStorage(env.DATA_DIR, '.data'),
  cacheDir: resolveStorage(env.CACHE_DIR, '.cache'),
  backendRoot,
};

if (config.nodeEnv === 'production' && config.jwtSecret === 'dev-only-change-me') {
  // eslint-disable-next-line no-console
  console.warn('[config] JWT_SECRET is using the default value in production. Set JWT_SECRET!');
}

