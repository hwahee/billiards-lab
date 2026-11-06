/**
 * The gateway's presence bookkeeping, driven with stand-in sockets: the
 * orderings that are hard to provoke over real connections.
 */
import { afterEach, beforeEach, expect, test } from 'bun:test';

import type { ChatServerFrame } from '@shared/domain/chat';

import { testOidcEnv } from '../auth/fake-issuer';
import { loadServerConfig } from '../config';
import { createContainer, type Container } from '../container';
import { silentLogger } from '../lib/log';
import { createMemoryPresenceStore } from '../presence/memory';
import type { PresenceStore } from '../presence/types';
import { ChatGateway, type ChatSocketData } from './chat-gateway';

const ROOM = 'room';

let container: Container;
let stop: (() => Promise<void>) | undefined;

beforeEach(async () => {
  container = createContainer(loadServerConfig({ DB_DRIVER: 'memory', ...testOidcEnv() }), {
    log: silentLogger,
  });
  await container.chatService().openRoom({
    id: ROOM,
    policy: { retentionMs: null, backlog: { maxCount: 10, maxAgeMs: null } },
  });
});

afterEach(async () => {
  await stop?.();
  stop = undefined;
  await container.dispose();
});

async function startGateway(presence: PresenceStore): Promise<ChatGateway> {
  const gateway = new ChatGateway({
    config: container.config,
    chat: container.chatService(),
    presence,
    events: container.pubsub(),
    log: silentLogger,
    presenceRefreshMs: 10,
  });
  stop = await gateway.start();
  return gateway;
}

/** A stand-in for Bun's server socket that records what it is sent. */
function fakeSocket(gateway: ChatGateway, guestId: string) {
  const data = gateway.handshake(new Request(`http://test/ws/chat?guestId=${guestId}`));
  if (data instanceof Response) throw new Error('handshake refused');
  const frames: ChatServerFrame[] = [];
  const socket = {
    ws: {
      data,
      send: (text: string) => frames.push(JSON.parse(text) as ChatServerFrame),
      close: (code?: number) => (socket.closedWith = code),
    } as unknown as Bun.ServerWebSocket<ChatSocketData>,
    frames,
    closedWith: undefined as number | undefined,
    join: () => gateway.message(socket.ws, JSON.stringify({ type: 'join', roomId: ROOM })),
    leave: () => gateway.message(socket.ws, JSON.stringify({ type: 'leave', roomId: ROOM })),
  };
  return socket;
}

test('a change that races a snapshot is sent after it, not lost under it', async () => {
  const memory = createMemoryPresenceStore();
  let release!: () => void;
  const firstListHeld = new Promise<void>((resolve) => (release = resolve));
  let lists = 0;
  const gateway = await startGateway({
    ...memory,
    // The first joiner's snapshot read is slow; the second joins meanwhile.
    list: async (scope) => {
      if (lists++ === 0) await firstListHeld;
      return memory.list(scope);
    },
  });

  const first = fakeSocket(gateway, 'aaaaaa');
  const second = fakeSocket(gateway, 'bbbbbb');
  const firstJoining = first.join();
  await Bun.sleep(5);
  await second.join();
  await Bun.sleep(5);
  release();
  await firstJoining;
  await Bun.sleep(5);

  const snapshotAt = first.frames.findIndex((frame) => frame.type === 'presence');
  const secondArrivedAt = first.frames.findIndex(
    (frame) =>
      frame.type === 'presence-add' && frame.entry.connectionId === second.ws.data.connectionId,
  );
  expect(snapshotAt).toBeGreaterThanOrEqual(0);
  expect(secondArrivedAt).toBeGreaterThan(snapshotAt);
});

test('connections that expired in a room are announced as departures', async () => {
  const memory = createMemoryPresenceStore();
  const expired = ['crashed-instance-connection'];
  const gateway = await startGateway({
    ...memory,
    sweep: () => Promise.resolve(expired.splice(0)),
  });

  const socket = fakeSocket(gateway, 'aaaaaa');
  await socket.join();
  await Bun.sleep(30); // a few heartbeats

  expect(socket.frames).toContainEqual({
    type: 'presence-remove',
    roomId: ROOM,
    connectionId: 'crashed-instance-connection',
  });
});

test('a leave right behind a join is carried out after it: nobody is left in the room', async () => {
  const presence = createMemoryPresenceStore();
  const gateway = await startGateway(presence);

  // A page that mounts and unmounts at once (React re-running an effect).
  const socket = fakeSocket(gateway, 'aaaaaa');
  const joining = socket.join();
  const leaving = socket.leave();
  await Promise.all([joining, leaving]);

  expect(await presence.list(ROOM)).toEqual([]);
  expect(socket.ws.data.rooms.size).toBe(0);
});

test('joining twice at once joins once, with one snapshot', async () => {
  const gateway = await startGateway(createMemoryPresenceStore());

  const socket = fakeSocket(gateway, 'aaaaaa');
  await Promise.all([socket.join(), socket.join()]);

  expect(socket.frames.filter((frame) => frame.type === 'joined')).toHaveLength(2);
  expect(socket.frames.filter((frame) => frame.type === 'presence')).toHaveLength(1);
});

test('a socket closed while joining leaves nothing behind', async () => {
  const presence = createMemoryPresenceStore();
  const gateway = await startGateway(presence);

  const socket = fakeSocket(gateway, 'aaaaaa');
  const joining = socket.join();
  await gateway.close(socket.ws);
  await joining;

  expect(await presence.list(ROOM)).toEqual([]);
});

test('a join that fails closes the socket, so the client reconnects and tries again', async () => {
  const memory = createMemoryPresenceStore();
  const gateway = await startGateway({
    ...memory,
    join: () => Promise.reject(new Error('presence is down')),
  });

  const socket = fakeSocket(gateway, 'aaaaaa');
  await socket.join();

  expect(socket.closedWith).toBe(1011);
  expect(socket.frames.some((frame) => frame.type === 'joined')).toBe(false);
});
