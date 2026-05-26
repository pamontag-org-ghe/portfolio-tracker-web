import type { User, Security, Transaction, Dividend, PriceSeries } from '../types.js';

export interface UserRepository {
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  create(user: User): Promise<User>;
}

export interface SecurityRepository {
  list(): Promise<Security[]>;
  findById(id: string): Promise<Security | null>;
  findByIsin(isin: string): Promise<Security | null>;
  findByTicker(ticker: string): Promise<Security | null>;
  upsert(security: Security): Promise<Security>;
}

export interface TransactionRepository {
  listByUser(userId: string): Promise<Transaction[]>;
  findById(userId: string, id: string): Promise<Transaction | null>;
  upsert(transaction: Transaction): Promise<Transaction>;
  delete(userId: string, id: string): Promise<boolean>;
}

export interface DividendRepository {
  listByUser(userId: string): Promise<Dividend[]>;
  upsert(dividend: Dividend): Promise<Dividend>;
  delete(userId: string, id: string): Promise<boolean>;
}

export interface PriceCacheRepository {
  get(symbol: string): Promise<PriceSeries | null>;
  put(series: PriceSeries): Promise<void>;
}

export interface Repository {
  users: UserRepository;
  securities: SecurityRepository;
  transactions: TransactionRepository;
  dividends: DividendRepository;
  priceCache: PriceCacheRepository;
  init(): Promise<void>;
  /**
   * Coalesce multiple mutations into a single durable write per collection.
   * On the local JSON driver this avoids re-writing each file 150+ times during
   * an xlsx import (which on Windows leads to occasional EPERM on rename).
   * Cosmos DB implements this as a no-op since every upsert is already its own request.
   */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}
