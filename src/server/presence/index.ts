import type { ServerConfig } from '../config';
import { createMemoryPresenceStore } from './memory';
import { createRedisPresenceStore } from './redis';
import type { PresenceStore } from './types';

export { PRESENCE_REFRESH_MS, type PresenceEntry, type PresenceStore } from './types';

/** Follows PUBSUB_DRIVER: instances that share a bus share presence too. */
export function createPresenceStore(config: ServerConfig): PresenceStore {
  if (config.pubsubDriver === 'redis') {
    if (!config.redisUrl) throw new Error('REDIS_URL is required when PUBSUB_DRIVER=redis');
    return createRedisPresenceStore(config.redisUrl);
  }
  return createMemoryPresenceStore();
}
