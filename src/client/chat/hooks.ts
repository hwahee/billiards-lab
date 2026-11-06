/**
 * React binding of the chat core — how a feature attaches chat on the client:
 *
 *   const messages = useChatRoomState('inquiry.42', (room) => room.messages);
 *   const people = useChatRoomState('inquiry.42', (room) => room.participants);
 *   const { send, isMine } = useChatRoomActions('inquiry.42');
 *
 * Each component subscribes to the slice it draws and re-renders only when
 * that slice changes: typing a message redraws the input, not the log; a
 * person arriving redraws the participant list, not the messages. How it is
 * drawn is the feature's own (the home page's box is one example,
 * src/client/pages/home-chat.tsx); joining, catching up, live delivery,
 * presence and reconnecting are all here, the same for every room.
 */
import {
  CHAT_SOCKET_PATH,
  participantKey,
  type ChatMessage,
  type ChatParticipant,
} from '@shared/domain/chat';
import { useEffect, useMemo, useSyncExternalStore } from 'react';

import { chatApi } from '../api/endpoints';
import { ApiRequestError } from '../api/http';
import { useMe } from '../api/queries';
import { ChatConnection } from './chat-connection';
import { ChatRoom, type ChatRoomState } from './chat-room';
import { tabGuestId } from './guest-id';

function socketUrl(): string {
  const url = new URL(CHAT_SOCKET_PATH, window.location.href);
  url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  // Always sent; the server ignores it for a signed-in member.
  url.searchParams.set('guestId', tabGuestId());
  return String(url);
}

// One socket per tab, one store per room — shared by every component on the page.
let connection: ChatConnection | undefined;
const rooms = new Map<string, ChatRoom>();

function roomFor(roomId: string): ChatRoom {
  connection ??= new ChatConnection(socketUrl);
  let room = rooms.get(roomId);
  if (!room) {
    room = new ChatRoom(roomId, { connection, api: chatApi, guestId: tabGuestId });
    rooms.set(roomId, room);
  }
  return room;
}

/**
 * Who this tab speaks as, as a participant key. `undefined` while that is not
 * known yet; with `AUTH_DRIVER=none` (no `me` at all) everyone is a guest.
 */
function useSelfKey(): string | undefined {
  const me = useMe();
  let self: ChatParticipant | undefined;
  if (me.isSuccess) {
    self = me.data
      ? { kind: 'member', userId: me.data.id, displayName: me.data.displayName }
      : { kind: 'guest', guestId: tabGuestId() };
  } else if (me.error instanceof ApiRequestError && me.error.code === 'NOT_FOUND') {
    self = { kind: 'guest', guestId: tabGuestId() };
  }
  return self && participantKey(self);
}

/** Who the chat socket was opened as (a participant key); `undefined` until first known. */
let socketIdentity: string | undefined;

/**
 * The server reads who we are when the socket opens: after a sign-in or
 * sign-out, open a new one so presence and authorship follow.
 */
function useSocketFollowsSignIn(): void {
  const identity = useSelfKey();
  useEffect(() => {
    if (identity === undefined) return;
    if (socketIdentity !== undefined && socketIdentity !== identity) connection?.reconnect();
    socketIdentity = identity;
  }, [identity]);
}

/**
 * One slice of a room, watched for as long as the component is mounted.
 * `select` must return a piece of the state or a plain value
 * (`room => room.messages`, `room => room.participants.length`) — never a new
 * array or object, which would look like a change every time.
 */
export function useChatRoomState<T>(roomId: string, select: (room: ChatRoomState) => T): T {
  const room = roomFor(roomId);
  useSocketFollowsSignIn();
  return useSyncExternalStore(room.subscribe, () => select(room.getSnapshot()));
}

/** Plain functions, safe to pass around or destructure. */
export interface ChatRoomActions {
  /** Sends a message; rejects with `ApiRequestError` (localized `message`) on failure. */
  send: (text: string) => Promise<ChatMessage>;
  /** Whether this tab's visitor wrote the message (for "my message" styling). */
  isMine: (message: ChatMessage) => boolean;
}

/**
 * Acting in a room. Subscribes to nothing: it re-renders only on a sign-in or
 * sign-out. The `useMemo` stays hand-written: this is a .ts file, which the
 * React Compiler never sees, and callers rely on `isMine` keeping its
 * identity (compiled components redraw every row when it changes).
 */
export function useChatRoomActions(roomId: string): ChatRoomActions {
  const room = roomFor(roomId);
  const selfKey = useSelfKey();
  return useMemo(
    () => ({
      send: (text) => room.send(text),
      isMine: (message) => selfKey !== undefined && participantKey(message.author) === selfKey,
    }),
    [room, selfKey],
  );
}
