import { CosmosClient, Container, Database } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';
import type {
  User, Security, Transaction, Dividend, PriceSeries,
} from '../types.js';
import type {
  Repository, UserRepository, SecurityRepository,
  TransactionRepository, DividendRepository, PriceCacheRepository,
} from './repository.js';

interface CosmosConfig {
  endpoint: string;
  /** Optional. When empty, the client authenticates via DefaultAzureCredential (managed identity in Azure, az/VS Code login locally). */
  key?: string;
  database: string;
}

type Containers = {
  users: Container;
  securities: Container;
  transactions: Container;
  dividends: Container;
  priceCache: Container;
};

async function ensureContainer(db: Database, id: string, partitionKey: string): Promise<Container> {
  const { container } = await db.containers.createIfNotExists({
    id,
    partitionKey: { paths: [partitionKey] },
  });
  return container;
}

export class CosmosRepository implements Repository {
  users!: UserRepository;
  securities!: SecurityRepository;
  transactions!: TransactionRepository;
  dividends!: DividendRepository;
  priceCache!: PriceCacheRepository;

  private client: CosmosClient;
  private db!: Database;
  private containers!: Containers;

  constructor(private readonly cfg: CosmosConfig) {
    if (cfg.key && cfg.key.trim() !== '') {
      // Local development / Cosmos emulator: key-based auth.
      this.client = new CosmosClient({ endpoint: cfg.endpoint, key: cfg.key });
    } else {
      // Production / cloud: AAD via the App Service's managed identity.
      // Requires the "Cosmos DB Built-in Data Contributor" SQL role assignment
      // on the target account (see infra/main.bicep).
      this.client = new CosmosClient({
        endpoint: cfg.endpoint,
        aadCredentials: new DefaultAzureCredential(),
      });
    }
  }

  async init() {
    const { database } = await this.client.databases.createIfNotExists({ id: this.cfg.database });
    this.db = database;
    this.containers = {
      users: await ensureContainer(database, 'users', '/id'),
      securities: await ensureContainer(database, 'securities', '/id'),
      transactions: await ensureContainer(database, 'transactions', '/userId'),
      dividends: await ensureContainer(database, 'dividends', '/userId'),
      priceCache: await ensureContainer(database, 'priceCache', '/symbol'),
    };

    this.users = {
      findByEmail: async (email) => {
        const { resources } = await this.containers.users.items
          .query<User>({ query: 'SELECT * FROM c WHERE LOWER(c.email)=@e', parameters: [{ name: '@e', value: email.toLowerCase() }] })
          .fetchAll();
        return resources[0] ?? null;
      },
      findById: async (id) => {
        try {
          const { resource } = await this.containers.users.item(id, id).read<User>();
          return resource ?? null;
        } catch { return null; }
      },
      create: async (user) => {
        const { resource } = await this.containers.users.items.create(user);
        return resource as unknown as User;
      },
    };

    this.securities = {
      list: async () => {
        const { resources } = await this.containers.securities.items.readAll<Security>().fetchAll();
        return resources;
      },
      findById: async (id) => {
        try {
          const { resource } = await this.containers.securities.item(id, id).read<Security>();
          return resource ?? null;
        } catch { return null; }
      },
      findByIsin: async (isin) => {
        const { resources } = await this.containers.securities.items
          .query<Security>({ query: 'SELECT * FROM c WHERE c.isin=@i', parameters: [{ name: '@i', value: isin }] })
          .fetchAll();
        return resources[0] ?? null;
      },
      findByTicker: async (ticker) => {
        const { resources } = await this.containers.securities.items
          .query<Security>({ query: 'SELECT * FROM c WHERE c.ticker=@t', parameters: [{ name: '@t', value: ticker }] })
          .fetchAll();
        return resources[0] ?? null;
      },
      upsert: async (security) => {
        const { resource } = await this.containers.securities.items.upsert(security);
        return resource as unknown as Security;
      },
    };

    this.transactions = {
      listByUser: async (userId) => {
        const { resources } = await this.containers.transactions.items
          .query<Transaction>({
            query: 'SELECT * FROM c WHERE c.userId=@u',
            parameters: [{ name: '@u', value: userId }],
          }, { partitionKey: userId })
          .fetchAll();
        return resources;
      },
      findById: async (userId, id) => {
        try {
          const { resource } = await this.containers.transactions.item(id, userId).read<Transaction>();
          return resource ?? null;
        } catch { return null; }
      },
      upsert: async (tx) => {
        const { resource } = await this.containers.transactions.items.upsert(tx);
        return resource as unknown as Transaction;
      },
      delete: async (userId, id) => {
        try {
          await this.containers.transactions.item(id, userId).delete();
          return true;
        } catch { return false; }
      },
    };

    this.dividends = {
      listByUser: async (userId) => {
        const { resources } = await this.containers.dividends.items
          .query<Dividend>({
            query: 'SELECT * FROM c WHERE c.userId=@u',
            parameters: [{ name: '@u', value: userId }],
          }, { partitionKey: userId })
          .fetchAll();
        return resources;
      },
      upsert: async (d) => {
        const { resource } = await this.containers.dividends.items.upsert(d);
        return resource as unknown as Dividend;
      },
      delete: async (userId, id) => {
        try {
          await this.containers.dividends.item(id, userId).delete();
          return true;
        } catch { return false; }
      },
    };

    this.priceCache = {
      get: async (symbol) => {
        try {
          const { resource } = await this.containers.priceCache.item(symbol, symbol).read<PriceSeries>();
          return resource ?? null;
        } catch { return null; }
      },
      put: async (series) => {
        await this.containers.priceCache.items.upsert({ id: series.symbol, ...series });
      },
    };
  }

  /** Cosmos DB has no equivalent batch semantics here; just run the function. */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}
