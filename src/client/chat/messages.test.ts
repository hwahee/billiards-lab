import { describe, expect, test } from 'bun:test';

import type { ChatMessage } from '@shared/domain/chat';
import type { UtcIsoString } from '@shared/time';

import { connectionsOf, mergeMessages, peopleIn } from './messages';

function message(seq: number, text = `#${seq}`): ChatMessage {
  return {
    roomId: 'room',
    seq,
    author: { kind: 'guest', guestId: 'a1b2c3' },
    text,
    createdAt: '2026-09-30T00:00:00.000Z' as UtcIsoString,
  };
}

const seqs = (messages: readonly ChatMessage[]) => messages.map((m) => m.seq);

describe('mergeMessages', () => {
  test('orders by seq and keeps each message once', () => {
    const merged = mergeMessages([message(1), message(3)], [message(3), message(2), message(4)]);
    expect(seqs(merged)).toEqual([1, 2, 3, 4]);
  });

  test('a history response that picks up right after `after` just extends the list', () => {
    const merged = mergeMessages([message(1), message(2)], [message(3), message(4)], { after: 2 });
    expect(seqs(merged)).toEqual([1, 2, 3, 4]);
  });

  test('a hole after `after` drops what came before it, but keeps what arrived live since', () => {
    // Held 1–2, missed 3–5 beyond the backlog, and 9 already arrived live.
    const merged = mergeMessages(
      [message(1), message(2), message(9)],
      [message(6), message(7), message(8)],
      {
        after: 2,
      },
    );
    expect(seqs(merged)).toEqual([6, 7, 8, 9]);
  });

  test('an empty catch-up, or only messages already held, returns the same list', () => {
    const held = [message(1), message(2)];
    expect(mergeMessages(held, [], { after: 2 })).toBe(held);
    expect(mergeMessages(held, [message(2)])).toBe(held);
  });

  test('keeps the held message objects rather than their copies', () => {
    const held = [message(1), message(3)];
    const merged = mergeMessages(held, [message(1), message(2)]);
    expect(seqs(merged)).toEqual([1, 2, 3]);
    expect(merged[0]).toBe(held[0]);
    expect(merged[2]).toBe(held[1]);
  });

  test('keeps only the latest 500', () => {
    const many = Array.from({ length: 600 }, (_, index) => message(index + 1));
    const merged = mergeMessages([], many);
    expect(merged).toHaveLength(500);
    expect(merged[0]?.seq).toBe(101);
  });
});

describe('peopleIn', () => {
  const alice = { kind: 'member', userId: 'alice', displayName: 'Alice' } as const;
  const guest = { kind: 'guest', guestId: 'a1b2c3' } as const;

  test('folds connections into one entry per person', () => {
    const connections = connectionsOf([
      { connectionId: 'c1', participant: alice },
      { connectionId: 'c2', participant: guest },
      { connectionId: 'c3', participant: alice },
    ]);
    expect(peopleIn(connections, [])).toEqual([alice, guest]);
  });

  test('returns the current list itself when the people are the same', () => {
    const current = [alice];
    const connections = connectionsOf([
      { connectionId: 'c1', participant: alice },
      { connectionId: 'c2', participant: alice },
    ]);
    expect(peopleIn(connections, current)).toBe(current);
  });
});
