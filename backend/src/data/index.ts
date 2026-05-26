import { config } from '../config.js';
import { LocalRepository } from './local.js';
import { CosmosRepository } from './cosmos.js';
import type { Repository } from './repository.js';

let repository: Repository | null = null;

export async function initRepository(): Promise<Repository> {
  if (repository) return repository;
  if (config.storageDriver === 'cosmos') {
    if (!config.cosmos.endpoint || !config.cosmos.key) {
      throw new Error('COSMOS_ENDPOINT and COSMOS_KEY required when STORAGE_DRIVER=cosmos');
    }
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
