/**
 * ═══════════════════════════════════════════════════════════════════════════
 * API CATALOG — every server endpoint the client uses, in ONE place.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Conventions (shared with the server, see src/shared/api):
 *   - List endpoints take `page`, `pageSize`, `sortBy`, `sortOrder` plus
 *     endpoint-specific flat filter params, and return the `Page<T>` envelope.
 *   - Errors always arrive as `{ error: { code, message, details? } }` and are
 *     surfaced as `ApiRequestError` (src/client/api/http.ts).
 *   - All timestamps are UTC ISO strings; format them for display with
 *     `formatUtcInTimeZone` (@shared/time) — never re-interpret on the client.
 *
 * Adding an endpoint? Define it here with a doc comment like the ones below;
 * components must import from this module (or the query hooks built on it in
 * ./queries.ts), never call `fetch` directly.
 */
import type { Page } from '@shared/api/pagination';
import { appearanceParams, type Appearance } from '@shared/domain/appearance';
import type {
  ChatHistory,
  ChatHistoryQuery,
  ChatMessage,
  SendChatMessageInput,
} from '@shared/domain/chat';
import type { Sitemap } from '@shared/domain/sitemap';
import type { CreateTodoInput, Todo, TodoListQuery, UpdateTodoInput } from '@shared/domain/todo';
import type { User } from '@shared/domain/user';

import { ApiRequestError, apiFetch } from './http';

/** The client may send a partial list query; the server applies the defaults. */
export type TodoListQueryInput = Partial<TodoListQuery>;

export const todosApi = {
  /**
   * `GET /api/todos`
   *
   * Paginated todo list.
   * - Filters: `status` ('open' | 'done'), `q` (case-insensitive title search)
   * - Sort:    `sortBy` ('createdAt' | 'title') + `sortOrder` ('asc' | 'desc')
   * - Returns: `Page<Todo>` — `items`, `page`, `pageSize`, `totalItems`,
   *            `totalPages`, `hasNextPage`
   */
  list(query: TodoListQueryInput = {}): Promise<Page<Todo>> {
    return apiFetch('/api/todos', { searchParams: query });
  },

  /**
   * `GET /api/todos/:id`
   *
   * Single todo by id.
   * - Errors: 404 `NOT_FOUND` when the id does not exist.
   */
  get(id: string): Promise<Todo> {
    return apiFetch(`/api/todos/${id}`);
  },

  /**
   * `POST /api/todos`
   *
   * Creates a todo (status starts as 'open').
   * - Body:   `{ title: string }` — 1–200 chars, not blank.
   * - Errors: 400 `VALIDATION_ERROR` with issue details.
   * - Returns 201 with the created `Todo`.
   */
  create(input: CreateTodoInput): Promise<Todo> {
    return apiFetch('/api/todos', { method: 'POST', body: input });
  },

  /**
   * `PATCH /api/todos/:id`
   *
   * Partial update; at least one of `title` / `status` must be present.
   * - Errors: 400 `VALIDATION_ERROR`, 404 `NOT_FOUND`.
   * - Returns the updated `Todo`.
   */
  update(id: string, patch: UpdateTodoInput): Promise<Todo> {
    return apiFetch(`/api/todos/${id}`, { method: 'PATCH', body: patch });
  },

  /**
   * `DELETE /api/todos/:id`
   *
   * Deletes a todo.
   * - Errors: 404 `NOT_FOUND`.
   * - Returns 204 (void).
   */
  remove(id: string): Promise<void> {
    return apiFetch(`/api/todos/${id}`, { method: 'DELETE' });
  },
};

/**
 * Sign-in. Members sign in and out on the member server (CLAUDE.md): the
 * browser navigates there and back, so signing in and out are addresses to
 * go to, not calls. The session then travels as an httpOnly cookie the
 * browser sends on its own (same-origin) — no call here handles a token.
 *
 * These endpoints exist only when the server runs with `AUTH_DRIVER=oidc`;
 * otherwise every one of them answers 404 `NOT_FOUND`.
 */
export const authApi = {
  /**
   * `GET /api/auth/login?returnTo=&theme=&design=&ui_locales=` — navigate here
   * (full page) to sign in.
   *
   * Goes to the member server's sign-in page, which looks the way
   * `appearance` says (@shared/domain/appearance), and comes back to
   * `returnTo` (a path on this site) signed in. A sign-in that cannot finish
   * — turned down, expired, or used twice — lands on `/sign-in-failed` instead.
   */
  signInUrl(returnTo: string, appearance: Appearance): string {
    return `/api/auth/login?${new URLSearchParams({ returnTo, ...appearanceParams(appearance) })}`;
  },

  /**
   * `GET /api/auth/logout` — navigate here (full page) to sign out.
   *
   * The member server asks to confirm, signs the member out of every service,
   * and ends on its own signed-out page.
   */
  signOutUrl: '/api/auth/logout',

  /**
   * `GET /api/auth/me`
   *
   * The signed-in user.
   * - Returns `null` when signed out (the server's 401 `UNAUTHORIZED`).
   */
  async me(): Promise<User | null> {
    try {
      return await apiFetch<User>('/api/auth/me');
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === 'UNAUTHORIZED') return null;
      throw error;
    }
  },
};

/**
 * Chat rooms — the HTTP half: catching up and sending. New messages and who
 * is in a room arrive over the `/ws/chat` socket instead, which the chat core
 * (src/client/chat) manages; features use its hooks (`useChatRoomState`, `useChatRoomActions`) rather than
 * calling these directly.
 */
export const chatApi = {
  /**
   * `GET /api/chat/rooms/:roomId/messages`
   *
   * The room's backlog, oldest first: its latest messages, as many and as far
   * back as the room's policy allows. Not the page/pageSize convention —
   * messages keep arriving, so the cursor is a message number.
   * - Query:  `after` — only messages with a higher `seq` (catching up after a reconnect).
   * - Errors: 400 `VALIDATION_ERROR`, 404 `NOT_FOUND` for an unknown room.
   * - Returns `{ items: ChatMessage[] }`.
   */
  history(roomId: string, query: ChatHistoryQuery = {}): Promise<ChatHistory> {
    return apiFetch(`/api/chat/rooms/${encodeURIComponent(roomId)}/messages`, {
      searchParams: query,
    });
  },

  /**
   * `POST /api/chat/rooms/:roomId/messages`
   *
   * Sends a message; everyone in the room receives it over `/ws/chat`. Open to
   * guests, who name themselves with their tab's guest id.
   * - Body:   `{ text: string, guestId?: string }` — text 1–1000 chars, not
   *           blank; `guestId` (6 hex chars) required when not signed in.
   * - Errors: 400 `VALIDATION_ERROR`, 404 `NOT_FOUND`.
   * - Returns 201 with the stored `ChatMessage` (`seq` = the room's next number).
   */
  send(roomId: string, input: SendChatMessageInput): Promise<ChatMessage> {
    return apiFetch(`/api/chat/rooms/${encodeURIComponent(roomId)}/messages`, {
      method: 'POST',
      body: input,
    });
  },
};

export const sitemapApi = {
  /**
   * `GET /sitemap.json`
   *
   * The service directory rendered by the footer's "Other Services" column.
   * Served straight from `public/sitemap.json`, so the list changes with a
   * data edit — no client code involved.
   * - Errors: 404 `NOT_FOUND` when the file is absent (the footer then just
   *   renders without that column).
   * - Returns: `Sitemap` — `{ services: [{ name, url, description? }] }`
   */
  get(): Promise<Sitemap> {
    return apiFetch('/sitemap.json');
  },
};
