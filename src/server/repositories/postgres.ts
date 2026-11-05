/**
 * Postgres implementations of the persistence contracts.
 *
 * Column mapping: snake_case in SQL ⇄ camelCase in the domain. Timestamps are
 * `timestamptz` and always read/written as UTC (`UtcIsoString`).
 */
import type { ChatMessage, ChatParticipant, ChatRoom } from '@shared/domain/chat';
import type { Todo, TodoListQuery, TodoStatus } from '@shared/domain/todo';
import { toUtcIso } from '@shared/time';

import { sessionSql, type PostgresDb } from '../db/postgres';
import type {
  AuditLogEntry,
  AuditLogRepository,
  ChatMessageRepository,
  ChatRoomRepository,
  DbSession,
  TodoRepository,
} from './types';

interface TodoRow {
  id: string;
  title: string;
  status: TodoStatus;
  created_at: Date;
  updated_at: Date;
}

function rowToTodo(row: TodoRow): Todo {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    createdAt: toUtcIso(row.created_at),
    updatedAt: toUtcIso(row.updated_at),
  };
}

/** Whitelist mapping of API sort fields to real columns — never interpolate user input. */
const SORT_COLUMNS: Record<TodoListQuery['sortBy'], string> = {
  createdAt: 'created_at',
  title: 'title',
};

export function createPostgresTodoRepository(db: PostgresDb): TodoRepository {
  return {
    async list(query, session) {
      const sql = sessionSql(db, session);

      // Dynamic-but-safe query construction: the WHERE clause is built from
      // validated filters with positional parameters; ORDER BY only ever uses
      // whitelisted identifiers from SORT_COLUMNS.
      const where: string[] = [];
      const params: unknown[] = [];
      if (query.status) {
        params.push(query.status);
        where.push(`status = $${params.length}`);
      }
      if (query.q) {
        params.push(`%${query.q}%`);
        where.push(`title ILIKE $${params.length}`);
      }
      const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
      const direction = query.sortOrder === 'asc' ? 'ASC' : 'DESC';

      params.push(query.pageSize, (query.page - 1) * query.pageSize);
      // N+1 avoidance: rows and the filtered total come back in ONE round trip
      // via the count(*) window function (see TodoRepository.list docs).
      const rows = await sql.unsafe<(TodoRow & { total_items: string | number })[]>(
        `SELECT id, title, status, created_at, updated_at, count(*) OVER () AS total_items
           FROM todos
           ${whereClause}
          ORDER BY ${SORT_COLUMNS[query.sortBy]} ${direction}, id ASC
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );

      const first = rows[0];
      return {
        items: rows.map(rowToTodo),
        totalItems: first ? Number(first.total_items) : 0,
      };
    },

    async findById(id, session) {
      const sql = sessionSql(db, session);
      const rows = await sql<TodoRow[]>`
        SELECT id, title, status, created_at, updated_at FROM todos WHERE id = ${id}
      `;
      const row = rows[0];
      return row ? rowToTodo(row) : null;
    },

    async insert(todo, session) {
      const sql = sessionSql(db, session);
      await sql`
        INSERT INTO todos (id, title, status, created_at, updated_at)
        VALUES (${todo.id}, ${todo.title}, ${todo.status}, ${todo.createdAt}, ${todo.updatedAt})
      `;
    },

    async update(todo, session) {
      const sql = sessionSql(db, session);
      await sql`
        UPDATE todos
           SET title = ${todo.title},
               status = ${todo.status},
               updated_at = ${todo.updatedAt}
         WHERE id = ${todo.id}
      `;
    },

    async deleteById(id, session) {
      const sql = sessionSql(db, session);
      const rows = await sql<{ id: string }[]>`
        DELETE FROM todos WHERE id = ${id} RETURNING id
      `;
      return rows.length > 0;
    },
  };
}

export function createPostgresAuditLogRepository(db: PostgresDb): AuditLogRepository {
  return {
    async append(entry: AuditLogEntry, session?: DbSession) {
      const sql = sessionSql(db, session);
      await sql`
        INSERT INTO audit_logs (entity_type, entity_id, action, payload, created_at)
        VALUES (
          ${entry.entityType},
          ${entry.entityId},
          ${entry.action},
          ${entry.payload === undefined ? null : JSON.stringify(entry.payload)}::jsonb,
          ${entry.createdAt}
        )
      `;
    },
  };
}

/** `bigint` columns arrive as strings; they hold millisecond counts and sequence numbers. */
type BigintColumn = string | number;

function toNumberOrNull(value: BigintColumn | null): number | null {
  return value === null ? null : Number(value);
}

interface ChatRoomRow {
  id: string;
  retention_ms: BigintColumn | null;
  backlog_max_count: number;
  backlog_max_age_ms: BigintColumn | null;
}

export function createPostgresChatRoomRepository(db: PostgresDb): ChatRoomRepository {
  return {
    async findById(id, session) {
      const sql = sessionSql(db, session);
      const rows = await sql<ChatRoomRow[]>`
        SELECT id, retention_ms, backlog_max_count, backlog_max_age_ms
          FROM chat_rooms
         WHERE id = ${id}
      `;
      const row = rows[0];
      return row
        ? {
            id: row.id,
            policy: {
              retentionMs: toNumberOrNull(row.retention_ms),
              backlog: {
                maxCount: row.backlog_max_count,
                maxAgeMs: toNumberOrNull(row.backlog_max_age_ms),
              },
            },
          }
        : null;
    },

    async upsert(room: ChatRoom, session) {
      const sql = sessionSql(db, session);
      const { retentionMs, backlog } = room.policy;
      await sql`
        INSERT INTO chat_rooms (id, retention_ms, backlog_max_count, backlog_max_age_ms)
        VALUES (${room.id}, ${retentionMs}, ${backlog.maxCount}, ${backlog.maxAgeMs})
        ON CONFLICT (id) DO UPDATE
           SET retention_ms = EXCLUDED.retention_ms,
               backlog_max_count = EXCLUDED.backlog_max_count,
               backlog_max_age_ms = EXCLUDED.backlog_max_age_ms
      `;
    },

    async nextSeq(roomId, session) {
      const sql = sessionSql(db, session);
      const rows = await sql<{ last_seq: BigintColumn }[]>`
        UPDATE chat_rooms SET last_seq = last_seq + 1 WHERE id = ${roomId} RETURNING last_seq
      `;
      const row = rows[0];
      return row ? Number(row.last_seq) : null;
    },
  };
}

interface ChatMessageRow {
  room_id: string;
  seq: BigintColumn;
  author_kind: ChatParticipant['kind'];
  author_id: string;
  author_name: string | null;
  body: string;
  created_at: Date;
}

function rowToChatMessage(row: ChatMessageRow): ChatMessage {
  return {
    roomId: row.room_id,
    seq: Number(row.seq),
    author:
      row.author_kind === 'member'
        ? { kind: 'member', userId: row.author_id, displayName: row.author_name ?? row.author_id }
        : { kind: 'guest', guestId: row.author_id },
    text: row.body,
    createdAt: toUtcIso(row.created_at),
  };
}

export function createPostgresChatMessageRepository(db: PostgresDb): ChatMessageRepository {
  return {
    async insert(message, session) {
      const sql = sessionSql(db, session);
      const { author } = message;
      const [authorId, authorName] =
        author.kind === 'member' ? [author.userId, author.displayName] : [author.guestId, null];
      await sql`
        INSERT INTO chat_messages (room_id, seq, author_kind, author_id, author_name, body, created_at)
        VALUES (
          ${message.roomId},
          ${message.seq},
          ${author.kind},
          ${authorId},
          ${authorName},
          ${message.text},
          ${message.createdAt}
        )
      `;
    },

    async listLatest(roomId, { limit, since, afterSeq = 0 }, session) {
      const sql = sessionSql(db, session);
      // Newest `limit` rows by the primary key (room_id, seq), turned back to oldest first.
      const rows = await sql<ChatMessageRow[]>`
        SELECT * FROM (
          SELECT room_id, seq, author_kind, author_id, author_name, body, created_at
            FROM chat_messages
           WHERE room_id = ${roomId}
             AND seq > ${afterSeq}
             AND (${since ?? null}::timestamptz IS NULL OR created_at >= ${since ?? null}::timestamptz)
           ORDER BY seq DESC
           LIMIT ${limit}
        ) latest
        ORDER BY seq ASC
      `;
      return rows.map(rowToChatMessage);
    },

    async deleteExpired(now, session) {
      const sql = sessionSql(db, session);
      const rows = await sql<{ deleted: number }[]>`
        WITH deleted AS (
          DELETE FROM chat_messages m
           USING chat_rooms r
           WHERE m.room_id = r.id
             AND r.retention_ms IS NOT NULL
             AND m.created_at < ${now}::timestamptz - r.retention_ms * interval '1 millisecond'
          RETURNING 1
        )
        SELECT count(*)::int AS deleted FROM deleted
      `;
      return rows[0]?.deleted ?? 0;
    },
  };
}
