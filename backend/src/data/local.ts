import { promises as fs } from 'fs';
import path from 'path';
import type {
  User, Security, Transaction, Dividend, PriceSeries,
} from '../types.js';
import type {
  Repository, UserRepository, SecurityRepository,
  TransactionRepository, DividendRepository, PriceCacheRepository,
} from './repository.js';

type Collection = 'users' | 'securities' | 'transactions' | 'dividends' | 'priceCache';

class JsonStore {
  private cache = new Map<Collection, unknown[]>();
  /** One serial write chain per collection so we never race on .tmp / rename. */
  private writeChains = new Map<Collection, Promise<void>>();
  /** When true, mutations only update the cache; flush deferred until commit(). */
  private batching = false;
  private dirty = new Set<Collection>();

  constructor(private readonly dir: string) {}

  private file(name: Collection): string {
    return path.join(this.dir, `${name}.json`);
  }

  async init(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const cols: Collection[] = ['users', 'securities', 'transactions', 'dividends', 'priceCache'];
    for (const c of cols) {
      try {
        const raw = await fs.readFile(this.file(c), 'utf8');
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) throw new Error(`Expected array in ${c}.json`);
        this.cache.set(c, parsed);
      } catch (err) {
        // Only create an empty file if the file actually does not exist; never
        // overwrite a file that exists but failed to parse — that would lose data.
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          this.cache.set(c, []);
          await this.scheduleFlush(c);
        } else {
          // eslint-disable-next-line no-console
          console.error(`[data] Failed to load ${c}.json (${(err as Error).message}); aborting startup to avoid data loss.`);
          throw err;
        }
      }
    }
  }

  read<T>(name: Collection): T[] {
    return (this.cache.get(name) ?? []) as T[];
  }

  async write<T>(name: Collection, items: T[]): Promise<void> {
    this.cache.set(name, items as unknown[]);
    if (this.batching) {
      this.dirty.add(name);
      return;
    }
    return this.scheduleFlush(name);
  }

  /**
   * Run `fn` with disk writes coalesced into a single flush per collection at the end.
   * Useful for bulk operations like xlsx import.
   */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const wasBatching = this.batching;
    this.batching = true;
    try {
      const result = await fn();
      if (!wasBatching) {
        const flushes = Array.from(this.dirty).map((c) => this.scheduleFlush(c));
        this.dirty.clear();
        await Promise.all(flushes);
      }
      return result;
    } finally {
      this.batching = wasBatching;
    }
  }

  /** Queue a flush after any in-flight write for the same collection. */
  private scheduleFlush(name: Collection): Promise<void> {
    const previous = this.writeChains.get(name) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => this.flushNow(name));
    this.writeChains.set(name, next);
    return next;
  }

  /** Atomically write the current cache snapshot to disk, retrying on Windows EPERM. */
  private async flushNow(name: Collection): Promise<void> {
    const items = this.cache.get(name) ?? [];
    const finalPath = this.file(name);
    const payload = JSON.stringify(items, null, 2);

    // Use a unique tmp suffix so parallel processes don't collide.
    const tmp = `${finalPath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, payload);

    const maxAttempts = 6;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        await fs.rename(tmp, finalPath);
        return;
      } catch (err) {
        lastErr = err;
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'EPERM' || code === 'EBUSY' || code === 'EEXIST') {
          // Common on Windows when AV scanners briefly hold the destination.
          await new Promise((r) => setTimeout(r, 25 * (attempt + 1) * (attempt + 1)));
          continue;
        }
        break;
      }
    }
    // Last-resort fallback: write the file in place (loses atomicity but recovers).
    try {
      await fs.writeFile(finalPath, payload);
      await fs.unlink(tmp).catch(() => undefined);
      // eslint-disable-next-line no-console
      console.warn(`[data] rename for ${name}.json failed after ${maxAttempts} attempts; wrote directly. (${(lastErr as Error).message})`);
      return;
    } catch (fallbackErr) {
      await fs.unlink(tmp).catch(() => undefined);
      throw fallbackErr;
    }
  }
}

class LocalUserRepository implements UserRepository {
  constructor(private store: JsonStore) {}
  async findByEmail(email: string) {
    return this.store.read<User>('users').find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null;
  }
  async findById(id: string) {
    return this.store.read<User>('users').find((u) => u.id === id) ?? null;
  }
  async create(user: User) {
    const all = this.store.read<User>('users');
    if (all.some((u) => u.email.toLowerCase() === user.email.toLowerCase())) {
      throw new Error('User already exists');
    }
    all.push(user);
    await this.store.write('users', all);
    return user;
  }
}

class LocalSecurityRepository implements SecurityRepository {
  constructor(private store: JsonStore) {}
  async list() { return this.store.read<Security>('securities'); }
  async findById(id: string) { return (await this.list()).find((s) => s.id === id) ?? null; }
  async findByIsin(isin: string) { return (await this.list()).find((s) => s.isin === isin) ?? null; }
  async findByTicker(ticker: string) { return (await this.list()).find((s) => s.ticker === ticker) ?? null; }
  async upsert(security: Security) {
    const all = await this.list();
    const idx = all.findIndex((s) => s.id === security.id);
    if (idx >= 0) all[idx] = security; else all.push(security);
    await this.store.write('securities', all);
    return security;
  }
}

class LocalTransactionRepository implements TransactionRepository {
  constructor(private store: JsonStore) {}
  async listByUser(userId: string) {
    return this.store.read<Transaction>('transactions').filter((t) => t.userId === userId);
  }
  async findById(userId: string, id: string) {
    return this.store.read<Transaction>('transactions').find((t) => t.id === id && t.userId === userId) ?? null;
  }
  async upsert(transaction: Transaction) {
    const all = this.store.read<Transaction>('transactions');
    const idx = all.findIndex((t) => t.id === transaction.id);
    if (idx >= 0) all[idx] = transaction; else all.push(transaction);
    await this.store.write('transactions', all);
    return transaction;
  }
  async delete(userId: string, id: string) {
    const all = this.store.read<Transaction>('transactions');
    const next = all.filter((t) => !(t.id === id && t.userId === userId));
    if (next.length === all.length) return false;
    await this.store.write('transactions', next);
    return true;
  }
}

class LocalDividendRepository implements DividendRepository {
  constructor(private store: JsonStore) {}
  async listByUser(userId: string) {
    return this.store.read<Dividend>('dividends').filter((d) => d.userId === userId);
  }
  async upsert(dividend: Dividend) {
    const all = this.store.read<Dividend>('dividends');
    const idx = all.findIndex((d) => d.id === dividend.id);
    if (idx >= 0) all[idx] = dividend; else all.push(dividend);
    await this.store.write('dividends', all);
    return dividend;
  }
  async delete(userId: string, id: string) {
    const all = this.store.read<Dividend>('dividends');
    const next = all.filter((d) => !(d.id === id && d.userId === userId));
    if (next.length === all.length) return false;
    await this.store.write('dividends', next);
    return true;
  }
}

class LocalPriceCacheRepository implements PriceCacheRepository {
  constructor(private store: JsonStore) {}
  async get(symbol: string) {
    return this.store.read<PriceSeries>('priceCache').find((p) => p.symbol === symbol) ?? null;
  }
  async put(series: PriceSeries) {
    const all = this.store.read<PriceSeries>('priceCache');
    const idx = all.findIndex((p) => p.symbol === series.symbol);
    if (idx >= 0) all[idx] = series; else all.push(series);
    await this.store.write('priceCache', all);
  }
}

export class LocalRepository implements Repository {
  users: UserRepository;
  securities: SecurityRepository;
  transactions: TransactionRepository;
  dividends: DividendRepository;
  priceCache: PriceCacheRepository;
  private store: JsonStore;

  constructor(dataDir: string) {
    this.store = new JsonStore(dataDir);
    this.users = new LocalUserRepository(this.store);
    this.securities = new LocalSecurityRepository(this.store);
    this.transactions = new LocalTransactionRepository(this.store);
    this.dividends = new LocalDividendRepository(this.store);
    this.priceCache = new LocalPriceCacheRepository(this.store);
  }

  async init() { await this.store.init(); }

  /** Coalesce writes during a bulk operation. */
  transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.store.transaction(fn);
  }
}
