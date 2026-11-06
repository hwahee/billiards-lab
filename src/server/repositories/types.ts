/**
 * Persistence contracts.
 *
 * Services depend only on these interfaces; the concrete driver (Postgres via
 * Bun's built-in SQL client, or the in-memory implementation used by tests
 * and DB-less local hacking) is chosen by the container from configuration.
 * Swapping Postgres for another database means writing one new implementation
 * file — no service or route changes.
 */
import type { ChatMessage, ChatRoom } from '@shared/domain/chat';
import type { Todo, TodoListQuery } from '@shared/domain/todo';
import type { UtcIsoString } from '@shared/time';

/**
 * Opaque handle for "the connection this operation must run on".
 * Inside a `UnitOfWork.run` callback it represents the transaction; repository
 * methods called without a session use an implicit non-transactional one.
 */
export interface DbSession {
  readonly __dbSession: true;
}

/**
 * Transaction boundary. Everything executed with the provided session inside
 * `run` commits or rolls back atomically. Keeping this explicit at the
 * *service* layer makes transaction boundaries visible in business code:
 *
 *   await uow.run(async (tx) => {
 *     await todos.insert(todo, tx);
 *     await auditLogs.append(entry, tx);
 *   });
 */
export interface UnitOfWork {
  run<T>(fn: (session: DbSession) => Promise<T>): Promise<T>;
}

export interface TodoRepository {
  /**
   * Returns one page of todos plus the total row count for the same filter.
   *
   * N+1 note: the page and the total count are produced by ONE query
   * (`count(*) OVER ()` window function) instead of a per-page `SELECT` plus a
   * separate `SELECT count(*)`. Likewise, if todos ever get related rows
   * (tags, assignees, …), fetch them for the whole page with a single
   * `WHERE todo_id IN (…)` query and group in memory — never one query per row.
   */
  list(query: TodoListQuery, session?: DbSession): Promise<{ items: Todo[]; totalItems: number }>;
  findById(id: string, session?: DbSession): Promise<Todo | null>;
  insert(todo: Todo, session?: DbSession): Promise<void>;
  /** Full-row update by `todo.id`. */
  update(todo: Todo, session?: DbSession): Promise<void>;
  /** Returns `false` when no row matched. */
  deleteById(id: string, session?: DbSession): Promise<boolean>;
}

export interface ChatRoomRepository {
  findById(id: string, session?: DbSession): Promise<ChatRoom | null>;
  /** Creates the room, or gives the existing room with its id this policy. */
  upsert(room: ChatRoom, session?: DbSession): Promise<void>;
  /**
   * Takes the room's next message number (1, 2, 3, …), or `null` when there is
   * no such room. Call it in the transaction that inserts the message: the row
   * lock orders concurrent senders, and a rollback gives the number back.
   */
  nextSeq(roomId: string, session: DbSession): Promise<number | null>;
}

export interface ChatMessageRepository {
  insert(message: ChatMessage, session?: DbSession): Promise<void>;
  /**
   * The room's latest `limit` messages sent at or after `since` and numbered
   * after `afterSeq`, oldest first.
   */
  listLatest(
    roomId: string,
    options: { limit: number; since?: UtcIsoString; afterSeq?: number },
    session?: DbSession,
  ): Promise<ChatMessage[]>;
  /** Deletes every message older than its room's retention; returns how many. */
  deleteExpired(now: UtcIsoString, session?: DbSession): Promise<number>;
}

/** Append-only audit trail, written in the same transaction as the change. */
export interface AuditLogEntry {
  entityType: string;
  entityId: string;
  action: string;
  payload?: unknown;
  createdAt: UtcIsoString;
}

export interface AuditLogRepository {
  append(entry: AuditLogEntry, session?: DbSession): Promise<void>;
}
