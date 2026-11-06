import { describe, expect, test } from 'bun:test';

import {
  chatClientFrameValidator,
  guestIdValidator,
  participantKey,
  sendChatMessageValidator,
} from './chat';

describe('chat contract', () => {
  test('a message needs non-blank text of at most 1000 characters', () => {
    expect(sendChatMessageValidator.safeParse({ text: 'hi' }).ok).toBe(true);
    expect(sendChatMessageValidator.safeParse({ text: '   ' }).ok).toBe(false);
    expect(sendChatMessageValidator.safeParse({ text: 'x'.repeat(1001) }).ok).toBe(false);
    expect(sendChatMessageValidator.safeParse({ text: 'hi', extra: 1 }).ok).toBe(false);
  });

  test('a guest id is six lowercase hex characters', () => {
    expect(guestIdValidator.safeParse('a1b2c3').ok).toBe(true);
    for (const id of ['A1B2C3', 'a1b2c', 'a1b2c3d', 'zzzzzz', null]) {
      expect(guestIdValidator.safeParse(id).ok).toBe(false);
    }
  });

  test('socket frames name a well-formed room', () => {
    expect(chatClientFrameValidator.safeParse({ type: 'join', roomId: 'inquiry.42' }).ok).toBe(
      true,
    );
    expect(chatClientFrameValidator.safeParse({ type: 'leave', roomId: 'home' }).ok).toBe(true);
    expect(chatClientFrameValidator.safeParse({ type: 'join', roomId: 'Has Space' }).ok).toBe(
      false,
    );
    expect(chatClientFrameValidator.safeParse({ type: 'send', roomId: 'home' }).ok).toBe(false);
  });

  test('one key per person: a member by user id, a guest by guest id', () => {
    expect(participantKey({ kind: 'member', userId: 'alice', displayName: 'Alice' })).toBe(
      'member:alice',
    );
    expect(participantKey({ kind: 'guest', guestId: 'a1b2c3' })).toBe('guest:a1b2c3');
  });
});
