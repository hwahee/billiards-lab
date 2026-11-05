import { RedisClient } from 'bun';

import { PRESENCE_TTL_MS, type PresenceEntry, type PresenceStore } from './types';

/** Stored per connection: who it is, and until when it counts as present. */
interface StoredEntry {
  info: unknown;
  expiresAt: number;
}

/**
 * Redis presence via Bun's built-in client: one hash per scope
 * (`presence:<scope>`), one field per connection. Each field carries its own
 * expiry, because a hash field cannot expire by itself; `list` skips expired
 * fields and `sweep` deletes them. The hash as a whole expires once nobody
 * refreshes it, so an abandoned scope does not linger.
 */
export function createRedisPresenceStore(
  redisUrl: string,
  { ttlMs = PRESENCE_TTL_MS }: { ttlMs?: number } = {},
): PresenceStore {
  const client = new RedisClient(redisUrl);
  const keyOf = (scope: string) => `presence:${scope}`;

  async function write({ scope, connectionId, info }: PresenceEntry): Promise<void> {
    const stored: StoredEntry = { info: info ?? null, expiresAt: Date.now() + ttlMs };
    await client.hset(keyOf(scope), { [connectionId]: JSON.stringify(stored) });
    await client.pexpire(keyOf(scope), ttlMs);
  }

  /** Every field of the scope, split into live entries and expired connection ids. */
  async function read(scope: string) {
    const fields = (await client.hgetall(keyOf(scope))) ?? {};
    const now = Date.now();
    const present: Omit<PresenceEntry, 'scope'>[] = [];
    const expired: string[] = [];
    for (const [connectionId, value] of Object.entries(fields)) {
      const entry = parse(value);
      if (entry && entry.expiresAt > now) present.push({ connectionId, info: entry.info });
      else expired.push(connectionId);
    }
    return { present, expired };
  }

  function parse(value: string): StoredEntry | null {
    try {
      const parsed = JSON.parse(value) as Partial<StoredEntry>;
      return typeof parsed.expiresAt === 'number' ? (parsed as StoredEntry) : null;
    } catch {
      return null;
    }
  }

  return {
    join: write,

    async leave(scope, connectionId) {
      await client.hdel(keyOf(scope), connectionId);
    },

    async list(scope) {
      return (await read(scope)).present;
    },

    async refresh(entries) {
      await Promise.all(entries.map(write));
    },

    async sweep(scope) {
      const { expired } = await read(scope);
      // One HDEL per field: its count says whether this call was the one that deleted it.
      const deleted = await Promise.all(
        expired.map(async (connectionId) => (await client.hdel(keyOf(scope), connectionId)) === 1),
      );
      return expired.filter((_, index) => deleted[index]);
    },

    async close() {
      client.close();
      return Promise.resolve();
    },
  };
}
