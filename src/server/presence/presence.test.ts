/**
 * The presence contract, run against every driver: memory always, Redis only
 * when REDIS_URL points at a server (e.g. `docker compose --profile redis up -d`).
 */
import { afterEach, describe, expect, test } from 'bun:test';

import { createMemoryPresenceStore } from './memory';
import { createRedisPresenceStore } from './redis';
import type { PresenceStore } from './types';

const redisUrl = process.env.REDIS_URL;

const drivers: [string, (() => PresenceStore) | undefined][] = [
  ['memory', createMemoryPresenceStore],
  ['redis', redisUrl ? () => createRedisPresenceStore(redisUrl) : undefined],
];

const opened: PresenceStore[] = [];
// A fresh scope per test keeps runs against a shared Redis apart.
const scope = () => `test.${crypto.randomUUID()}`;

afterEach(async () => {
  for (const store of opened.splice(0)) await store.close();
});

for (const [name, create] of drivers) {
  describe.skipIf(!create)(`presence (${name})`, () => {
    const open = () => {
      const store = create!();
      opened.push(store);
      return store;
    };

    test('lists who joined, by connection, until they leave', async () => {
      const store = open();
      const room = scope();
      await store.join({ scope: room, connectionId: 'c1', info: { name: 'alice' } });
      await store.join({ scope: room, connectionId: 'c2', info: { name: 'bob' } });
      const listed = await store.list(room);
      expect(listed).toHaveLength(2);
      expect(listed).toContainEqual({ connectionId: 'c1', info: { name: 'alice' } });
      expect(listed).toContainEqual({ connectionId: 'c2', info: { name: 'bob' } });

      await store.leave(room, 'c1');
      expect(await store.list(room)).toEqual([{ connectionId: 'c2', info: { name: 'bob' } }]);
    });

    test('scopes are independent', async () => {
      const store = open();
      const [a, b] = [scope(), scope()];
      await store.join({ scope: a, connectionId: 'c1', info: 'in a' });
      expect(await store.list(b)).toEqual([]);
    });

    test('leaving twice, or a connection never joined, is harmless', async () => {
      const store = open();
      const room = scope();
      await store.leave(room, 'nobody');
      await store.join({ scope: room, connectionId: 'c1', info: 1 });
      await store.leave(room, 'c1');
      await store.leave(room, 'c1');
      expect(await store.list(room)).toEqual([]);
    });

    test('refreshing keeps entries listed; a sweep with nothing expired deletes nothing', async () => {
      const store = open();
      const room = scope();
      const entry = { scope: room, connectionId: 'c1', info: 'still here' };
      await store.join(entry);
      await store.refresh([entry]);
      expect(await store.sweep(room)).toEqual([]);
      expect(await store.list(room)).toEqual([{ connectionId: 'c1', info: 'still here' }]);
    });
  });
}

describe.skipIf(!redisUrl)('presence (redis) expiry', () => {
  test('an entry nobody refreshes expires, and exactly one sweep reports it', async () => {
    const short = () => {
      const store = createRedisPresenceStore(redisUrl!, { ttlMs: 50 });
      opened.push(store);
      return store;
    };
    const [a, b] = [short(), short()];
    const room = scope();
    await a.join({ scope: room, connectionId: 'crashed', info: 'gone' });
    await a.join({ scope: room, connectionId: 'alive', info: 'here' });
    await Bun.sleep(30);
    await a.refresh([{ scope: room, connectionId: 'alive', info: 'here' }]);
    await Bun.sleep(40);

    expect(await a.list(room)).toEqual([{ connectionId: 'alive', info: 'here' }]);
    // Two instances sweeping at once: the departure is announced once.
    const [first, second] = await Promise.all([a.sweep(room), b.sweep(room)]);
    expect([...first, ...second]).toEqual(['crashed']);
  });
});
