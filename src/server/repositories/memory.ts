/**
 * In-memory implementations of the persistence contracts.
 *
 * Used by the test suite (tests run with a single command, no external
 * services) and by DB-less local hacking (`DB_DRIVER=memory`). Semantics
 * mirror the Postgres implementation: same sorting, same filtering, same
 * pagination and snapshot-based transaction rollback.
 *
 * Limitation (documented on purpose): the snapshot/restore transaction model
 * is process-local and not safe for concurrent interleaved transactions —
 * fine for tests and local development, never used in production.
 */
import type { ChatMessage, ChatRoom } from '@shared/domain/chat';
import type { Todo, TodoListQuery } from '@shared/domain/todo';

import type {
  AuditLogEntry,
  AuditLogRepository,
  ChatMessageRepository,
  ChatRoomRepository,
  DbSession,
  TodoRepository,
  UnitOfWork,
} from './types';

/** Every table the store holds, i.e. its data fields. */
type MemoryTables = Omit<MemoryStore, 'snapshot' | 'restore'>;

export class MemoryStore {
  todos = new Map<string, Todo>();
  auditLogs: AuditLogEntry[] = [];
  chatRooms = new Map<string, { room: ChatRoom; lastSeq: number }>();
  /** Per room, in `seq` order. */
  chatMessages = new Map<string, ChatMessage[]>();

  /**
   * Deep copy of every table. Deliberately not a per-table list: a table added
   * above is covered by transaction rollback without touching this method, so
   * it can never be the one table a failed transaction forgets to undo.
   */
  snapshot(): MemoryTables {
    return structuredClone({ ...this });
  }

  restore(snapshot: MemoryTables): void {
    Object.assign(this, snapshot);
  }
}

const MEMORY_SESSION: DbSession = { __dbSession: true };

export function createMemoryUnitOfWork(store: MemoryStore): UnitOfWork {
  return {
    async run<T>(fn: (session: DbSession) => Promise<T>): Promise<T> {
      const snapshot = store.snapshot();
      try {
        return await fn(MEMORY_SESSION);
      } catch (error) {
        store.restore(snapshot); // "rollback"
        throw error;
      }
    },
  };
}

function compareTodos(a: Todo, b: Todo, query: TodoListQuery): number {
  const direction = query.sortOrder === 'asc' ? 1 : -1;
  const primary =
    query.sortBy === 'title'
      ? a.title.localeCompare(b.title)
      : a.createdAt.localeCompare(b.createdAt);
  if (primary !== 0) return primary * direction;
  // Stable tiebreak on id, matching the SQL `ORDER BY …, id ASC`.
  return a.id.localeCompare(b.id);
}

export function createMemoryTodoRepository(store: MemoryStore): TodoRepository {
  return {
    async list(query) {
      let items = [...store.todos.values()];
      if (query.status) items = items.filter((todo) => todo.status === query.status);
      if (query.q) {
        const needle = query.q.toLowerCase();
        items = items.filter((todo) => todo.title.toLowerCase().includes(needle));
      }
      items.sort((a, b) => compareTodos(a, b, query));
      const offset = (query.page - 1) * query.pageSize;
      return Promise.resolve({
        items: items.slice(offset, offset + query.pageSize).map((todo) => ({ ...todo })),
        totalItems: items.length,
      });
    },

    async findById(id) {
      const todo = store.todos.get(id);
      return Promise.resolve(todo ? { ...todo } : null);
    },

    async insert(todo) {
      store.todos.set(todo.id, { ...todo });
      return Promise.resolve();
    },

    async update(todo) {
      store.todos.set(todo.id, { ...todo });
      return Promise.resolve();
    },

    async deleteById(id) {
      return Promise.resolve(store.todos.delete(id));
    },
  };
}

export function createMemoryAuditLogRepository(store: MemoryStore): AuditLogRepository {
  return {
    async append(entry) {
      store.auditLogs.push({ ...entry });
      return Promise.resolve();
    },
  };
}

export function createMemoryChatRoomRepository(store: MemoryStore): ChatRoomRepository {
  return {
    async findById(id) {
      const stored = store.chatRooms.get(id);
      return Promise.resolve(stored ? structuredClone(stored.room) : null);
    },

    async upsert(room) {
      const lastSeq = store.chatRooms.get(room.id)?.lastSeq ?? 0;
      store.chatRooms.set(room.id, { room: structuredClone(room), lastSeq });
      return Promise.resolve();
    },

    async nextSeq(roomId) {
      const stored = store.chatRooms.get(roomId);
      if (!stored) return Promise.resolve(null);
      stored.lastSeq += 1;
      return Promise.resolve(stored.lastSeq);
    },
  };
}

export function createMemoryChatMessageRepository(store: MemoryStore): ChatMessageRepository {
  return {
    async insert(message) {
      const messages = store.chatMessages.get(message.roomId) ?? [];
      messages.push(structuredClone(message));
      store.chatMessages.set(message.roomId, messages);
      return Promise.resolve();
    },

    async listLatest(roomId, { limit, since, afterSeq = 0 }) {
      const matching = (store.chatMessages.get(roomId) ?? []).filter(
        (message) => message.seq > afterSeq && (since === undefined || message.createdAt >= since),
      );
      return Promise.resolve(structuredClone(matching.slice(-limit)));
    },

    async deleteExpired(now) {
      let deleted = 0;
      for (const [roomId, messages] of store.chatMessages) {
        const retentionMs = store.chatRooms.get(roomId)?.room.policy.retentionMs ?? null;
        if (retentionMs === null) continue;
        const cutoff = new Date(Date.parse(now) - retentionMs).toISOString();
        const kept = messages.filter((message) => message.createdAt >= cutoff);
        deleted += messages.length - kept.length;
        store.chatMessages.set(roomId, kept);
      }
      return Promise.resolve(deleted);
    },
  };
}
