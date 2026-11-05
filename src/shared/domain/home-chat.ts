/**
 * The one chat room the home page carries — an example of a feature attaching
 * chat: it only picks a room id and a policy. The server opens the room at
 * boot (src/server/index.ts); the page joins it by id.
 */
import type { ChatRoom } from './chat';

const HOUR_MS = 60 * 60 * 1000;

export const HOME_CHAT_ROOM: ChatRoom = {
  id: 'home',
  policy: {
    // A lobby: yesterday's small talk is not worth keeping.
    retentionMs: 24 * HOUR_MS,
    backlog: { maxCount: 50, maxAgeMs: HOUR_MS },
  },
};
