import { beforeEach, describe, expect, test } from 'bun:test';

import type { ChatMessage, ChatParticipant, ChatRoomPolicy } from '@shared/domain/chat';
import { toUtcIso } from '@shared/time';
import { ValidationError } from '@shared/validation';

import { NotFoundError } from '../lib/errors';
import { createMemoryPubSub } from '../pubsub/memory';
import { CHANNELS, type PubSub } from '../pubsub/types';
import {
  createMemoryChatMessageRepository,
  createMemoryChatRoomRepository,
  createMemoryUnitOfWork,
  MemoryStore,
} from '../repositories/memory';
import type { ChatMessageRepository } from '../repositories/types';
import { ChatService } from './chat-service';

const MINUTE_MS = 60_000;
const ALICE: ChatParticipant = { kind: 'member', userId: 'alice', displayName: 'Alice' };
const GUEST: ChatParticipant = { kind: 'guest', guestId: 'a1b2c3' };
const KEEP_ALL: ChatRoomPolicy = { retentionMs: null, backlog: { maxCount: 100, maxAgeMs: null } };

let store: MemoryStore;
let events: PubSub;

function makeService(overrides: { messages?: ChatMessageRepository } = {}): ChatService {
  return new ChatService({
    rooms: createMemoryChatRoomRepository(store),
    messages: overrides.messages ?? createMemoryChatMessageRepository(store),
    uow: createMemoryUnitOfWork(store),
    events,
  });
}

/** Stores a message sent `minutesAgo` minutes ago, bypassing the service's clock. */
async function seedMessage(roomId: string, seq: number, minutesAgo: number): Promise<void> {
  store.chatRooms.get(roomId)!.lastSeq = seq;
  await createMemoryChatMessageRepository(store).insert({
    roomId,
    seq,
    author: GUEST,
    text: `message ${seq}`,
    createdAt: toUtcIso(new Date(Date.now() - minutesAgo * MINUTE_MS)),
  });
}

beforeEach(() => {
  store = new MemoryStore();
  events = createMemoryPubSub();
});

describe('ChatService.openRoom', () => {
  test('creates the room, and re-opening only replaces its policy', async () => {
    const chat = makeService();
    await chat.openRoom({ id: 'lobby', policy: KEEP_ALL });
    await chat.send('lobby', ALICE, 'hi');

    const shorter: ChatRoomPolicy = {
      retentionMs: MINUTE_MS,
      backlog: { maxCount: 5, maxAgeMs: null },
    };
    await chat.openRoom({ id: 'lobby', policy: shorter });

    expect((await chat.getRoom('lobby')).policy).toEqual(shorter);
    // The numbering carries on; the room was not recreated.
    expect((await chat.send('lobby', ALICE, 'again')).seq).toBe(2);
  });

  test('refuses a malformed id or policy', async () => {
    const chat = makeService();
    await expect(chat.openRoom({ id: 'Bad Id', policy: KEEP_ALL })).rejects.toBeInstanceOf(
      ValidationError,
    );
    for (const policy of [
      { retentionMs: 0, backlog: { maxCount: 10, maxAgeMs: null } },
      { retentionMs: null, backlog: { maxCount: 0, maxAgeMs: null } },
      { retentionMs: null, backlog: { maxCount: 10, maxAgeMs: -1 } },
    ]) {
      await expect(chat.openRoom({ id: 'room', policy })).rejects.toBeInstanceOf(ValidationError);
    }
  });

  test('an unknown room is NotFound', async () => {
    await expect(makeService().getRoom('nowhere')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('ChatService.send', () => {
  test('numbers messages per room, trims the text, and fans each out', async () => {
    const chat = makeService();
    await chat.openRoom({ id: 'a', policy: KEEP_ALL });
    await chat.openRoom({ id: 'b', policy: KEEP_ALL });
    const published: unknown[] = [];
    await events.subscribe(CHANNELS.chatMessages, (message) => published.push(message));

    const first = await chat.send('a', ALICE, '  hello  ');
    const second = await chat.send('a', GUEST, 'hey');
    const other = await chat.send('b', ALICE, 'elsewhere');
    await Bun.sleep(0); // memory bus delivers asynchronously

    expect([first.seq, second.seq, other.seq]).toEqual([1, 2, 1]);
    expect(first).toMatchObject({ roomId: 'a', author: ALICE, text: 'hello' });
    expect(first.createdAt).toMatch(/Z$/); // UTC
    expect(published).toEqual([first, second, other]);
  });

  test('to an unknown room: NotFound, and nothing is published', async () => {
    const published: unknown[] = [];
    await events.subscribe(CHANNELS.chatMessages, (message) => published.push(message));

    await expect(makeService().send('nowhere', ALICE, 'hi')).rejects.toBeInstanceOf(NotFoundError);
    await Bun.sleep(0);
    expect(published).toEqual([]);
  });

  test('a failed insert gives the number back (transaction rollback)', async () => {
    const failing: ChatMessageRepository = {
      ...createMemoryChatMessageRepository(store),
      insert: () => Promise.reject(new Error('db down')),
    };
    const chat = makeService({ messages: failing });
    await chat.openRoom({ id: 'a', policy: KEEP_ALL });

    await expect(chat.send('a', ALICE, 'lost')).rejects.toThrow('db down');
    expect(store.chatRooms.get('a')?.lastSeq).toBe(0);
  });
});

describe('ChatService.history', () => {
  test('returns the latest maxCount messages, oldest first', async () => {
    const chat = makeService();
    await chat.openRoom({
      id: 'a',
      policy: { ...KEEP_ALL, backlog: { maxCount: 2, maxAgeMs: null } },
    });
    for (const text of ['one', 'two', 'three']) await chat.send('a', ALICE, text);

    const history = await chat.history('a', {});
    expect(history.map((message) => message.text)).toEqual(['two', 'three']);
  });

  test('leaves out messages older than the backlog age', async () => {
    const chat = makeService();
    await chat.openRoom({
      id: 'a',
      policy: { retentionMs: null, backlog: { maxCount: 100, maxAgeMs: 10 * MINUTE_MS } },
    });
    await seedMessage('a', 1, 30);
    await seedMessage('a', 2, 5);

    expect((await chat.history('a', {})).map((message) => message.seq)).toEqual([2]);
  });

  test('never shows a message past retention, even before the worker deletes it', async () => {
    const chat = makeService();
    await chat.openRoom({
      id: 'a',
      policy: { retentionMs: 10 * MINUTE_MS, backlog: { maxCount: 100, maxAgeMs: null } },
    });
    await seedMessage('a', 1, 30);
    await seedMessage('a', 2, 5);

    expect((await chat.history('a', {})).map((message) => message.seq)).toEqual([2]);
  });

  test('with `after`, returns only the messages after that seq', async () => {
    const chat = makeService();
    await chat.openRoom({ id: 'a', policy: KEEP_ALL });
    for (const text of ['one', 'two', 'three']) await chat.send('a', ALICE, text);

    const missed = await chat.history('a', { after: 1 });
    expect(missed.map((message: ChatMessage) => message.seq)).toEqual([2, 3]);
    expect(await chat.history('a', { after: 3 })).toEqual([]);
  });

  test('of an unknown room is NotFound', async () => {
    await expect(makeService().history('nowhere', {})).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('ChatService.purgeExpired', () => {
  test('deletes only messages past their own room retention', async () => {
    const chat = makeService();
    await chat.openRoom({
      id: 'short',
      policy: { retentionMs: 10 * MINUTE_MS, backlog: { maxCount: 100, maxAgeMs: null } },
    });
    await chat.openRoom({ id: 'forever', policy: KEEP_ALL });
    await seedMessage('short', 1, 30);
    await seedMessage('short', 2, 5);
    await seedMessage('forever', 1, 60 * 24 * 365);

    expect(await chat.purgeExpired()).toBe(1);
    expect(store.chatMessages.get('short')?.map((message) => message.seq)).toEqual([2]);
    expect(store.chatMessages.get('forever')).toHaveLength(1);
  });
});

describe('ChatService.participantFor', () => {
  test('a member speaks under the nickname they signed in with', () => {
    const participant = makeService().participantFor(
      { kind: 'member', userId: 'alice', displayName: 'Alice' },
      'ffffff',
    );
    expect(participant).toEqual(ALICE);
  });

  test('a guest — or anyone, without sign-in — is their tab guest id', () => {
    const chat = makeService();
    expect(chat.participantFor({ kind: 'guest' }, 'a1b2c3')).toEqual(GUEST);
    expect(chat.participantFor({ kind: 'anyone' }, 'a1b2c3')).toEqual(GUEST);
  });

  test('a guest without a guest id is a validation error', () => {
    expect(() => makeService().participantFor({ kind: 'guest' }, undefined)).toThrow(
      ValidationError,
    );
  });
});
