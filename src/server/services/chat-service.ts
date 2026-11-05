/**
 * Chat business logic — rooms, messages and who wrote them. Pure of HTTP and
 * socket concerns (live delivery is src/server/realtime/chat-gateway.ts),
 * unit-tested against the in-memory repositories.
 *
 * Attaching chat to a feature, server side, is one call: open the feature's
 * room with the policy it needs before anyone joins, e.g.
 *
 *   await container.chatService().openRoom({
 *     id: `inquiry.${inquiry.id}`,
 *     policy: { retentionMs: null, backlog: { maxCount: 200, maxAgeMs: null } },
 *   });
 */
import {
  chatRoomValidator,
  type ChatHistoryQuery,
  type ChatMessage,
  type ChatParticipant,
  type ChatRoom,
} from '@shared/domain/chat';
import { nowUtc, toUtcIso } from '@shared/time';
import { ValidationError } from '@shared/validation';

import type { Caller } from '../auth/session';
import { NotFoundError } from '../lib/errors';
import { CHANNELS, type PubSub } from '../pubsub';
import type { ChatMessageRepository, ChatRoomRepository, UnitOfWork } from '../repositories/types';

interface ChatServiceDeps {
  rooms: ChatRoomRepository;
  messages: ChatMessageRepository;
  uow: UnitOfWork;
  events: PubSub;
}

export class ChatService {
  constructor(private readonly deps: ChatServiceDeps) {}

  /** Creates the room, or gives the existing one this policy — safe to call on every boot. */
  async openRoom(room: ChatRoom): Promise<ChatRoom> {
    const checked = chatRoomValidator.parse(room);
    await this.deps.rooms.upsert(checked);
    return checked;
  }

  async getRoom(roomId: string): Promise<ChatRoom> {
    const room = await this.deps.rooms.findById(roomId);
    if (!room) throw new NotFoundError('chat room', roomId);
    return room;
  }

  /**
   * What a visitor sees on joining: the room's backlog — its latest messages,
   * capped by count and age. With `after`, only the messages after that `seq`
   * within the same window. Never anything past the room's retention, even if
   * the worker has not deleted it yet.
   */
  async history(roomId: string, query: ChatHistoryQuery): Promise<ChatMessage[]> {
    const { policy } = await this.getRoom(roomId);
    const windows = [policy.backlog.maxAgeMs, policy.retentionMs].filter(
      (ms): ms is number => ms !== null,
    );
    const since =
      windows.length > 0 ? toUtcIso(new Date(Date.now() - Math.min(...windows))) : undefined;
    return this.deps.messages.listLatest(roomId, {
      limit: policy.backlog.maxCount,
      since,
      afterSeq: query.after,
    });
  }

  /**
   * Who is speaking: a member under the nickname they signed in with, anyone
   * else as the guest their tab says they are.
   */
  participantFor(caller: Caller, guestId: string | undefined): ChatParticipant {
    if (caller.kind === 'member') {
      return { kind: 'member', userId: caller.userId, displayName: caller.displayName };
    }
    if (guestId === undefined) {
      throw new ValidationError([
        { path: 'guestId', message: 'Required when not signed in', code: 'required' },
      ]);
    }
    return { kind: 'guest', guestId };
  }

  /** Stores the message as the room's next one and fans it out to every instance. */
  async send(roomId: string, author: ChatParticipant, text: string): Promise<ChatMessage> {
    // ── Transaction boundary: taking the number + storing the message are atomic. ──
    const message = await this.deps.uow.run(async (tx) => {
      const seq = await this.deps.rooms.nextSeq(roomId, tx);
      if (seq === null) throw new NotFoundError('chat room', roomId);
      const stored: ChatMessage = { roomId, seq, author, text: text.trim(), createdAt: nowUtc() };
      await this.deps.messages.insert(stored, tx);
      return stored;
    });
    // No audit entry on purpose: the audit trail would keep every message
    // past its room's retention.

    // Every instance forwards it to the room's sockets it holds (chat-gateway.ts).
    await this.deps.events.publish(CHANNELS.chatMessages, message);
    return message;
  }

  /** Deletes the messages past their room's retention; run periodically by the worker role. */
  async purgeExpired(): Promise<number> {
    return this.deps.messages.deleteExpired(nowUtc());
  }
}
