import { beforeEach, describe, expect, test } from 'bun:test';

import type {
  ChatHistory,
  ChatMessage,
  ChatServerFrame,
  SendChatMessageInput,
} from '@shared/domain/chat';
import type { UtcIsoString } from '@shared/time';

import type { ChatConnection, RoomListener } from './chat-connection';
import { ChatRoom } from './chat-room';

function message(seq: number): ChatMessage {
  return {
    roomId: 'room',
    seq,
    author: { kind: 'guest', guestId: 'a1b2c3' },
    text: `#${seq}`,
    createdAt: '2026-09-30T00:00:00.000Z' as UtcIsoString,
  };
}

/** Stands in for the socket: tests push frames and drops through `listener`. */
class FakeConnection {
  listener: RoomListener | undefined;
  stopped = 0;
  watch(_roomId: string, listener: RoomListener) {
    this.listener = listener;
    return () => {
      this.stopped += 1;
      this.listener = undefined;
    };
  }
  frame(frame: ChatServerFrame) {
    this.listener?.onFrame(frame);
  }
}

let connection: FakeConnection;
let historyCalls: { after?: number }[];
let historyReply: ChatMessage[];
let sent: SendChatMessageInput[];
let room: ChatRoom;
/** Notifications the room scheduled — run by `flush()`, standing in for the next frame. */
let scheduled: (() => void)[];
const flush = () => {
  for (const run of scheduled.splice(0)) run();
};

beforeEach(() => {
  connection = new FakeConnection();
  historyCalls = [];
  historyReply = [];
  sent = [];
  scheduled = [];
  room = new ChatRoom('room', {
    connection: connection as unknown as ChatConnection,
    api: {
      history: (_roomId, query = {}): Promise<ChatHistory> => {
        historyCalls.push(query);
        return Promise.resolve({ items: historyReply });
      },
      send: (_roomId, input) => {
        sent.push(input);
        return Promise.resolve(message(99));
      },
    },
    guestId: () => 'a1b2c3',
    schedule: (run) => scheduled.push(run),
  });
});

const ALICE = { kind: 'member', userId: 'alice', displayName: 'Alice' } as const;
const GUEST = { kind: 'guest', guestId: 'a1b2c3' } as const;

/** Lets the pending history fetch settle. */
const settle = () => Bun.sleep(0);

describe('ChatRoom', () => {
  test('watches while subscribed, and catches up with the backlog once joined', async () => {
    room.subscribe(() => undefined);
    expect(connection.listener).toBeDefined();
    expect(room.getSnapshot().status).toBe('connecting');

    historyReply = [message(1), message(2)];
    connection.frame({ type: 'joined', roomId: 'room' });
    await settle();

    expect(historyCalls).toEqual([{}]);
    expect(room.getSnapshot()).toMatchObject({ status: 'live' });
    expect(room.getSnapshot().messages.map((m) => m.seq)).toEqual([1, 2]);
  });

  test('live messages, presence, and a missing room update the state', async () => {
    room.subscribe(() => undefined);
    connection.frame({ type: 'joined', roomId: 'room' });
    await settle();

    connection.frame({ type: 'message', message: message(1) });
    connection.frame({
      type: 'presence',
      roomId: 'room',
      entries: [{ connectionId: 'c1', participant: GUEST }],
    });
    expect(room.getSnapshot().messages.map((m) => m.seq)).toEqual([1]);
    expect(room.getSnapshot().participants).toEqual([GUEST]);

    connection.frame({ type: 'error', roomId: 'room', code: 'NOT_FOUND' });
    expect(room.getSnapshot().status).toBe('unavailable');
  });

  test('after a drop, it catches up only on what came after the last message held', async () => {
    room.subscribe(() => undefined);
    historyReply = [message(1), message(2)];
    connection.frame({ type: 'joined', roomId: 'room' });
    await settle();

    connection.listener?.onDisconnect();
    expect(room.getSnapshot().status).toBe('reconnecting');

    historyReply = [message(3)];
    connection.frame({ type: 'joined', roomId: 'room' });
    await settle();
    expect(historyCalls.at(-1)).toEqual({ after: 2 });
    expect(room.getSnapshot()).toMatchObject({ status: 'live' });
    expect(room.getSnapshot().messages.map((m) => m.seq)).toEqual([1, 2, 3]);
  });

  test('a message racing ahead of `joined` does not cut the backlog short', async () => {
    room.subscribe(() => undefined);
    connection.frame({ type: 'message', message: message(10) });

    historyReply = [message(8), message(9), message(10)];
    connection.frame({ type: 'joined', roomId: 'room' });
    await settle();

    expect(historyCalls).toEqual([{}]);
    expect(room.getSnapshot().messages.map((m) => m.seq)).toEqual([8, 9, 10]);
  });

  test('coming back after every subscriber left catches up from where it was', async () => {
    const leave = room.subscribe(() => undefined);
    historyReply = [message(1), message(2)];
    connection.frame({ type: 'joined', roomId: 'room' });
    await settle();
    leave();

    room.subscribe(() => undefined);
    expect(room.getSnapshot().status).toBe('connecting');
    historyReply = [message(3)];
    connection.frame({ type: 'joined', roomId: 'room' });
    await settle();
    expect(historyCalls.at(-1)).toEqual({ after: 2 });
    expect(room.getSnapshot().messages.map((m) => m.seq)).toEqual([1, 2, 3]);
  });

  test('sends as this tab guest and shows the stored message right away', async () => {
    room.subscribe(() => undefined);
    await room.send('hello');
    expect(sent).toEqual([{ text: 'hello', guestId: 'a1b2c3' }]);
    expect(room.getSnapshot().messages.map((m) => m.seq)).toEqual([99]);
  });

  test('presence: a snapshot, then changes — one entry per person, however many tabs', () => {
    room.subscribe(() => undefined);
    connection.frame({
      type: 'presence',
      roomId: 'room',
      entries: [
        { connectionId: 'alice-tab-1', participant: ALICE },
        { connectionId: 'guest-tab', participant: GUEST },
      ],
    });
    const people = room.getSnapshot().participants;
    expect(people).toEqual([ALICE, GUEST]);

    // Alice opening and closing another tab is not news.
    connection.frame({
      type: 'presence-add',
      roomId: 'room',
      entry: { connectionId: 'alice-tab-2', participant: ALICE },
    });
    connection.frame({ type: 'presence-remove', roomId: 'room', connectionId: 'alice-tab-1' });
    expect(room.getSnapshot().participants).toBe(people);

    connection.frame({ type: 'presence-remove', roomId: 'room', connectionId: 'alice-tab-2' });
    expect(room.getSnapshot().participants).toEqual([GUEST]);
  });

  test('tells subscribers once per frame, however many frames arrived', () => {
    let changes = 0;
    room.subscribe(() => (changes += 1));
    for (const seq of [1, 2, 3]) connection.frame({ type: 'message', message: message(seq) });
    expect(changes).toBe(0);
    flush();
    expect(changes).toBe(1);
    expect(room.getSnapshot().messages.map((m) => m.seq)).toEqual([1, 2, 3]);
  });

  test('a message it already holds changes nothing, not even identities', () => {
    let changes = 0;
    room.subscribe(() => (changes += 1));
    connection.frame({ type: 'message', message: message(1) });
    flush();
    const messages = room.getSnapshot().messages;

    // Our own send comes back twice: as the POST answer and over the socket.
    connection.frame({ type: 'message', message: message(1) });
    flush();
    expect(room.getSnapshot().messages).toBe(messages);
    expect(changes).toBe(1);
  });

  test('notifies subscribers, and stops watching after the last one leaves', () => {
    let changes = 0;
    const first = room.subscribe(() => (changes += 1));
    const second = room.subscribe(() => undefined);
    connection.frame({ type: 'message', message: message(1) });
    flush();
    expect(changes).toBe(1);

    first();
    expect(connection.stopped).toBe(0);
    second();
    expect(connection.stopped).toBe(1);
  });
});
