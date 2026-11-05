/**
 * Chat domain — the shared contract between server and client: rooms,
 * messages, who is in a room, and the frames of the `/ws/chat` socket.
 *
 * A room knows nothing about the feature it is attached to (the home page, a
 * game, an inquiry). That feature picks the room's id and policy when it opens
 * the room on the server (`ChatService.openRoom`), and its UI talks to the
 * room through the client chat core (src/client/chat). Everything in between —
 * storing, numbering, live delivery, presence — is the same for every room.
 */
import type { UtcIsoString } from '../time';
import { s, toValidator, type Infer } from '../validation';

/**
 * A room id: lowercase letters, digits, `.`, `_`, `-` (1–100 chars). The
 * attaching feature namespaces its rooms with a dot, e.g. `inquiry.42`.
 */
const roomIdSchema = s.string().check(s.regex(/^[a-z0-9][a-z0-9._-]{0,99}$/));

/**
 * A guest's handle: 6 hex characters the browser tab picks for itself (kept in
 * `sessionStorage`). It only names the guest in the room — the server never
 * treats it as proof of who someone is.
 */
const guestIdSchema = s.string().check(s.regex(/^[0-9a-f]{6}$/));

/** The attaching feature's say in how its room behaves. */
export interface ChatRoomPolicy {
  /** How long a message is kept, in ms. `null` keeps it for as long as the room exists. */
  retentionMs: number | null;
  /**
   * What a visitor sees right after joining: the latest `maxCount` messages,
   * none older than `maxAgeMs` (`null` = no age limit).
   */
  backlog: { maxCount: number; maxAgeMs: number | null };
}

export interface ChatRoom {
  id: string;
  policy: ChatRoomPolicy;
}

const durationMsSchema = s.nullable(s.int().check(s.gt(0)));

/**
 * A room as a feature opens it (`ChatService.openRoom`) — checked so that a
 * bad policy fails at boot, the same way on every persistence driver.
 */
export const chatRoomValidator = toValidator(
  s.strictObject({
    id: roomIdSchema,
    policy: s.strictObject({
      retentionMs: durationMsSchema,
      backlog: s.strictObject({
        maxCount: s.int().check(s.gte(1), s.lte(1000)),
        maxAgeMs: durationMsSchema,
      }),
    }),
  }),
);

/**
 * Someone in a room: a signed-in member, or a guest named by their tab's
 * handle (also every visitor when the server runs with `AUTH_DRIVER=none`).
 */
export type ChatParticipant =
  { kind: 'member'; userId: string; displayName: string } | { kind: 'guest'; guestId: string };

/** One key per person: a member with two tabs open is still one participant. */
export function participantKey(participant: ChatParticipant): string {
  return participant.kind === 'member'
    ? `member:${participant.userId}`
    : `guest:${participant.guestId}`;
}

export interface ChatMessage {
  roomId: string;
  /** 1, 2, 3, … within the room — orders messages and shows a client what it missed. */
  seq: number;
  author: ChatParticipant;
  text: string;
  /** UTC — converted to the viewer's time zone only at the client boundary. */
  createdAt: UtcIsoString;
}

/** Body of `POST /api/chat/rooms/:roomId/messages`. Strict: unknown fields are rejected. */
export const sendChatMessageValidator = toValidator(
  s.strictObject({
    text: s.string().check(
      s.minLength(1),
      s.maxLength(1000),
      s.refine((value) => value.trim().length > 0, { message: 'Text must not be blank' }),
    ),
    /** Required from a visitor who is not signed in; ignored for a member. */
    guestId: s.optional(guestIdSchema),
  }),
);
export type SendChatMessageInput = Infer<typeof sendChatMessageValidator>;

/**
 * Query of `GET /api/chat/rooms/:roomId/messages`. Not the page/pageSize list
 * convention: messages keep arriving, so offsets would shift under the reader.
 * A client that already holds messages asks only for those after its last `seq`.
 */
export const chatHistoryQueryValidator = toValidator(
  s.object({
    after: s.optional(s.int().check(s.gte(0))),
  }),
);
export type ChatHistoryQuery = Infer<typeof chatHistoryQueryValidator>;

/** Response of `GET /api/chat/rooms/:roomId/messages`: oldest first. */
export interface ChatHistory {
  items: ChatMessage[];
}

export const guestIdValidator = toValidator(guestIdSchema);

// ── The /ws/chat socket ─────────────────────────────────────────────────────

export const CHAT_SOCKET_PATH = '/ws/chat';

/** Client → server: which rooms this socket wants to hear from. */
export const chatClientFrameValidator = toValidator(
  s.discriminatedUnion('type', [
    s.strictObject({ type: s.literal('join'), roomId: roomIdSchema }),
    s.strictObject({ type: s.literal('leave'), roomId: roomIdSchema }),
  ]),
);
export type ChatClientFrame = Infer<typeof chatClientFrameValidator>;

/**
 * One open connection in a room. Presence travels per connection — a person
 * with two tabs open has two — and clients fold it into one entry per person
 * (`participantKey`), so nobody has to know whether a leaving tab was the
 * person's last.
 */
export interface ChatPresenceEntry {
  connectionId: string;
  participant: ChatParticipant;
}

/**
 * Server → client. Presence is a snapshot for the joiner, then changes only:
 * resending the whole list to everyone on every arrival would grow with the
 * cube of the room's size.
 */
export type ChatServerFrame =
  /** The socket now receives the room's messages; fetch the history from here on. */
  | { type: 'joined'; roomId: string }
  | { type: 'message'; message: ChatMessage }
  /** Who is in the room, sent once to the socket that just joined; changes follow. */
  | { type: 'presence'; roomId: string; entries: ChatPresenceEntry[] }
  | { type: 'presence-add'; roomId: string; entry: ChatPresenceEntry }
  | { type: 'presence-remove'; roomId: string; connectionId: string }
  /** Joining failed: there is no room with this id. */
  | { type: 'error'; roomId: string; code: 'NOT_FOUND' };
