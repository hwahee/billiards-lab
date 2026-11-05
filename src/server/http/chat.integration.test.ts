/**
 * Chat integration tests: the real app booted on an ephemeral port with the
 * in-memory drivers, the chat gateway forwarding the bus to real WebSockets —
 * history and sending over HTTP, joining, live messages and presence over
 * /ws/chat.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';

import {
  participantKey,
  type ChatClientFrame,
  type ChatHistory,
  type ChatMessage,
  type ChatParticipant,
  type ChatServerFrame,
} from '@shared/domain/chat';

import { buildApp, type SocketData } from '../app';
import { memberCookie as signedInCookie, testOidcEnv } from '../auth/fake-issuer';
import { loadServerConfig } from '../config';
import { createContainer, type Container } from '../container';
import { silentLogger } from '../lib/log';

const GUEST_ID = 'a1b2c3';

let container: Container;
let server: Bun.Server<SocketData>;
let stopChat: () => Promise<void>;
let baseUrl: string;
let memberCookie: string;
/** A fresh room per test keeps numbering and presence independent. */
let roomId: string;
const sockets: TestSocket[] = [];

beforeAll(async () => {
  const config = loadServerConfig({
    APP_ENV: 'local',
    DB_DRIVER: 'memory',
    PUBSUB_DRIVER: 'memory',
    ...testOidcEnv(),
  });
  container = createContainer(config, { log: silentLogger });
  server = Bun.serve({ port: 0, ...buildApp(container, { shuttingDown: false }) });
  stopChat = await container.chatGateway().start();
  baseUrl = String(server.url).replace(/\/$/, '');
  memberCookie = signedInCookie(config, { userId: 'alice', displayName: 'Alice' });
});

afterAll(async () => {
  for (const socket of sockets) socket.close();
  await stopChat();
  await server.stop(true);
  await container.dispose();
});

beforeEach(async () => {
  roomId = `test.${crypto.randomUUID()}`;
  await container.chatService().openRoom({
    id: roomId,
    policy: { retentionMs: null, backlog: { maxCount: 3, maxAgeMs: null } },
  });
});

async function api<T = unknown>(
  method: string,
  path: string,
  options: { body?: unknown; cookie?: string } = {},
): Promise<{ status: number; body: T; headers: Headers }> {
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: (text ? JSON.parse(text) : undefined) as T,
    headers: response.headers,
  };
}

const messagesPath = () => `/api/chat/rooms/${roomId}/messages`;

/** Bun's WebSocket also takes headers; the DOM typing this project compiles with does not say so. */
type BunWebSocket = new (url: URL, options: { headers: Record<string, string> }) => WebSocket;

/**
 * A /ws/chat client that buffers frames so tests can wait for the one they
 * expect, and keeps who is in the room from the presence snapshot + changes.
 */
class TestSocket {
  private readonly frames: ChatServerFrame[] = [];
  private readonly waiters = new Set<() => void>();
  /** Open connections in the joined room, as presence frames describe them. */
  private readonly connections = new Map<string, ChatParticipant>();

  private constructor(private readonly ws: WebSocket) {
    ws.onmessage = (event) => {
      const frame = JSON.parse(String(event.data)) as ChatServerFrame;
      if (frame.type === 'presence') {
        this.connections.clear();
        for (const entry of frame.entries)
          this.connections.set(entry.connectionId, entry.participant);
      } else if (frame.type === 'presence-add') {
        this.connections.set(frame.entry.connectionId, frame.entry.participant);
      } else if (frame.type === 'presence-remove') {
        this.connections.delete(frame.connectionId);
      } else {
        this.frames.push(frame);
      }
      for (const wake of this.waiters) wake();
    };
  }

  /** One entry per person, as a client shows them. */
  private people(): ChatParticipant[] {
    const people = new Map<string, ChatParticipant>();
    for (const participant of this.connections.values()) {
      people.set(participantKey(participant), participant);
    }
    return [...people.values()];
  }

  static async open(as: { guestId?: string; cookie?: string }): Promise<TestSocket> {
    const url = new URL('/ws/chat', baseUrl.replace(/^http/, 'ws'));
    if (as.guestId) url.searchParams.set('guestId', as.guestId);
    const ws = new (WebSocket as unknown as BunWebSocket)(url, {
      headers: as.cookie ? { cookie: as.cookie } : {},
    });
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    const socket = new TestSocket(ws);
    sockets.push(socket);
    return socket;
  }

  send(frame: ChatClientFrame): void {
    this.ws.send(JSON.stringify(frame));
  }

  /** Resolves with (and consumes) the first frame, buffered or upcoming, that matches. */
  async next(matches: (frame: ChatServerFrame) => boolean): Promise<ChatServerFrame> {
    return this.until(() => {
      const index = this.frames.findIndex(matches);
      return index >= 0 ? this.frames.splice(index, 1)[0] : undefined;
    });
  }

  private async until<T>(found: () => T | undefined): Promise<T> {
    const deadline = Date.now() + 2000;
    for (;;) {
      const value = found();
      if (value !== undefined) return value;
      if (Date.now() > deadline) throw new Error('timed out waiting on the chat socket');
      await new Promise<void>((resolve) => {
        const wake = () => {
          this.waiters.delete(wake);
          resolve();
        };
        this.waiters.add(wake);
        setTimeout(wake, 50);
      });
    }
  }

  async join(id = roomId): Promise<void> {
    this.send({ type: 'join', roomId: id });
    await this.next((frame) => frame.type === 'joined' && frame.roomId === id);
  }

  /** Waits until presence lists exactly `count` people, and returns them. */
  async presence(count: number): Promise<ChatParticipant[]> {
    return this.until(() => {
      const people = this.people();
      return people.length === count ? people : undefined;
    });
  }

  close(): void {
    this.ws.close();
  }
}

describe('chat over HTTP', () => {
  test('a guest sends under their tab guest id', async () => {
    const { status, body } = await api<ChatMessage>('POST', messagesPath(), {
      body: { text: 'hello', guestId: GUEST_ID },
    });
    expect(status).toBe(201);
    expect(body).toMatchObject({
      roomId,
      seq: 1,
      text: 'hello',
      author: { kind: 'guest', guestId: GUEST_ID },
    });
  });

  test('a member sends under their display name; a guest id is ignored', async () => {
    const { status, body } = await api<ChatMessage>('POST', messagesPath(), {
      body: { text: 'hi', guestId: GUEST_ID },
      cookie: memberCookie,
    });
    expect(status).toBe(201);
    expect(body.author).toEqual({ kind: 'member', userId: 'alice', displayName: 'Alice' });
  });

  test('a guest without a guest id, or a blank text, is 400', async () => {
    const noId = await api<{ error: { code: string } }>('POST', messagesPath(), {
      body: { text: 'hello' },
    });
    expect(noId.status).toBe(400);
    expect(noId.body.error.code).toBe('VALIDATION_ERROR');

    const blank = await api('POST', messagesPath(), { body: { text: '   ', guestId: GUEST_ID } });
    expect(blank.status).toBe(400);
  });

  test('an unknown room is 404 for reading and sending', async () => {
    const path = '/api/chat/rooms/nowhere/messages';
    expect((await api('GET', path)).status).toBe(404);
    const sent = await api<{ error: { code: string } }>('POST', path, {
      body: { text: 'hello', guestId: GUEST_ID },
    });
    expect(sent.status).toBe(404);
    expect(sent.body.error.code).toBe('NOT_FOUND');
  });

  test('history is the backlog, oldest first; `after` returns only what came later', async () => {
    for (const text of ['one', 'two', 'three', 'four']) {
      await api('POST', messagesPath(), { body: { text, guestId: GUEST_ID } });
    }

    const backlog = await api<ChatHistory>('GET', messagesPath());
    expect(backlog.status).toBe(200);
    expect(backlog.body.items.map((message) => message.text)).toEqual(['two', 'three', 'four']);

    const missed = await api<ChatHistory>('GET', `${messagesPath()}?after=3`);
    expect(missed.body.items.map((message) => message.seq)).toEqual([4]);

    expect((await api('GET', `${messagesPath()}?after=abc`)).status).toBe(400);
  });
});

describe('chat over /ws/chat', () => {
  test('a guest socket without a guest id is refused', async () => {
    const response = await fetch(`${baseUrl}/ws/chat`);
    expect(response.status).toBe(400);
  });

  test('joined sockets get every new message live', async () => {
    const guest = await TestSocket.open({ guestId: GUEST_ID });
    const member = await TestSocket.open({ cookie: memberCookie });
    await guest.join();
    await member.join();

    const sent = await api<ChatMessage>('POST', messagesPath(), {
      body: { text: 'live!', guestId: GUEST_ID },
    });

    for (const socket of [guest, member]) {
      const frame = await socket.next((candidate) => candidate.type === 'message');
      expect(frame).toEqual({ type: 'message', message: sent.body });
    }
  });

  test('a socket only hears the rooms it joined', async () => {
    const socket = await TestSocket.open({ guestId: GUEST_ID });
    await socket.join();
    const otherRoom = `test.${crypto.randomUUID()}`;
    await container.chatService().openRoom({
      id: otherRoom,
      policy: { retentionMs: null, backlog: { maxCount: 3, maxAgeMs: null } },
    });

    await api('POST', `/api/chat/rooms/${otherRoom}/messages`, {
      body: { text: 'elsewhere', guestId: GUEST_ID },
    });
    await api('POST', messagesPath(), { body: { text: 'here', guestId: GUEST_ID } });

    const frame = await socket.next((candidate) => candidate.type === 'message');
    expect(frame.type === 'message' && frame.message.text).toBe('here');
  });

  test('presence lists everyone in the room, once per person, and follows departures', async () => {
    const guest = await TestSocket.open({ guestId: GUEST_ID });
    await guest.join();
    expect(await guest.presence(1)).toEqual([{ kind: 'guest', guestId: GUEST_ID }]);

    // One member, two tabs: still one person.
    const tab1 = await TestSocket.open({ cookie: memberCookie });
    const tab2 = await TestSocket.open({ cookie: memberCookie });
    await tab1.join();
    await tab2.join();
    const everyone = await guest.presence(2);
    expect(everyone).toContainEqual({ kind: 'guest', guestId: GUEST_ID });
    expect(everyone).toContainEqual({ kind: 'member', userId: 'alice', displayName: 'Alice' });
    // A late joiner learns who was already there from its snapshot.
    expect(await tab2.presence(2)).toHaveLength(2);

    tab1.close();
    tab2.send({ type: 'leave', roomId });
    expect(await guest.presence(1)).toEqual([{ kind: 'guest', guestId: GUEST_ID }]);
  });

  test('joining an unknown room answers NOT_FOUND', async () => {
    const socket = await TestSocket.open({ guestId: GUEST_ID });
    socket.send({ type: 'join', roomId: 'nowhere' });
    expect(await socket.next((frame) => frame.type === 'error')).toEqual({
      type: 'error',
      roomId: 'nowhere',
      code: 'NOT_FOUND',
    });
  });
});
