import { config } from '../config.js';
import { LocalRepository } from './local.js';
import { CosmosRepository } from './cosmos.js';
import type { Repository } from './repository.js';

let repository: Repository | null = null;

export async function initRepository(): Promise<Repository> {
  if (repository) return repository;
  if (config.storageDriver === 'cosmos') {
    if (!config.cosmos.endpoint) {
      throw new Error('COSMOS_ENDPOINT is required when STORAGE_DRIVER=cosmos');
    }
    // COSMOS_KEY is optional: when unset the client falls back to
    // DefaultAzureCredential (managed identity in Azure / az login locally).
    repository = new CosmosRepository(config.cosmos);
  } else {
    repository = new LocalRepository(config.dataDir);
  }
  await repository.init();
  return repository;
}

export function getRepository(): Repository {
  if (!repository) throw new Error('Repository not initialised. Call initRepository() first.');
  return repository;
}
