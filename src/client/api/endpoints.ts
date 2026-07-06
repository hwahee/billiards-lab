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
import type { BilliardsCommand, BilliardsRoomSnapshot } from '@shared/billiards/room';
import type { CreateTodoInput, Todo, TodoListQuery, UpdateTodoInput } from '@shared/domain/todo';

import { apiFetch } from './http';

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

export const billiardsApi = {
  /**
   * `GET /api/billiards`
   *
   * The server-authoritative billiards room snapshot: variant, phase,
   * generation, physics params, sim speed and the full game state (balls,
   * clock, collision log). Used for the initial load and for polling while a
   * shot is in flight.
   */
  snapshot(): Promise<BilliardsRoomSnapshot> {
    return apiFetch('/api/billiards');
  },

  /**
   * `POST /api/billiards`
   *
   * Applies one `BilliardsCommand` (strike / reset / variant / params /
   * simSpeed / togglePause / stepOnce / placeBall / settleIntoTray) and
   * returns the updated snapshot. Commands illegal in the current phase are
   * no-ops server-side — the response is still the authoritative state.
   * - Errors: 400 `VALIDATION_ERROR` for malformed commands.
   */
  command(command: BilliardsCommand): Promise<BilliardsRoomSnapshot> {
    return apiFetch('/api/billiards', { method: 'POST', body: command });
  },
};
