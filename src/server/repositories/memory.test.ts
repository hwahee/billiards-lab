import { describe, expect, test } from 'bun:test';

import { listTodosQueryValidator, type Todo } from '@shared/domain/todo';
import type { UtcIsoString } from '@shared/time';

import {
  createMemoryAuditLogRepository,
  createMemoryTodoRepository,
  createMemoryUnitOfWork,
  MemoryStore,
} from './memory';

function makeTodo(overrides: Partial<Todo> & Pick<Todo, 'id' | 'title'>): Todo {
  return {
    status: 'open',
    createdAt: '2026-01-01T00:00:00.000Z' as UtcIsoString,
    updatedAt: '2026-01-01T00:00:00.000Z' as UtcIsoString,
    ...overrides,
  };
}

function seededStore(): MemoryStore {
  const store = new MemoryStore();
  store.todos.set(
    '1',
    makeTodo({ id: '1', title: 'Alpha', createdAt: '2026-01-01T00:00:00.000Z' as UtcIsoString }),
  );
  store.todos.set(
    '2',
    makeTodo({
      id: '2',
      title: 'bravo',
      status: 'done',
      createdAt: '2026-01-02T00:00:00.000Z' as UtcIsoString,
    }),
  );
  store.todos.set(
    '3',
    makeTodo({ id: '3', title: 'Charlie', createdAt: '2026-01-03T00:00:00.000Z' as UtcIsoString }),
  );
  return store;
}

const query = (input: Record<string, unknown> = {}) => listTodosQueryValidator.parse(input);

describe('memory todo repository — list', () => {
  test('sorts by createdAt desc by default', async () => {
    const repo = createMemoryTodoRepository(seededStore());
    const { items, totalItems } = await repo.list(query());
    expect(items.map((todo) => todo.id)).toEqual(['3', '2', '1']);
    expect(totalItems).toBe(3);
  });

  test('filters by status', async () => {
    const repo = createMemoryTodoRepository(seededStore());
    const { items } = await repo.list(query({ status: 'done' }));
    expect(items.map((todo) => todo.id)).toEqual(['2']);
  });

  test('filters by q, case-insensitively', async () => {
    const repo = createMemoryTodoRepository(seededStore());
    const { items } = await repo.list(query({ q: 'BRA' }));
    expect(items.map((todo) => todo.title)).toEqual(['bravo']);
  });

  test('sorts by title ascending', async () => {
    const repo = createMemoryTodoRepository(seededStore());
    const { items } = await repo.list(query({ sortBy: 'title', sortOrder: 'asc' }));
    expect(items.map((todo) => todo.title)).toEqual(['Alpha', 'bravo', 'Charlie']);
  });

  test('paginates with a stable total count', async () => {
    const repo = createMemoryTodoRepository(seededStore());
    const first = await repo.list(query({ pageSize: 2 }));
    const second = await repo.list(query({ page: 2, pageSize: 2 }));
    expect(first.items.length).toBe(2);
    expect(second.items.length).toBe(1);
    expect(first.totalItems).toBe(3);
    expect(second.totalItems).toBe(3);
  });
});

describe('memory unit of work', () => {
  test('commits mutations when the callback succeeds', async () => {
    const store = new MemoryStore();
    const repo = createMemoryTodoRepository(store);
    const uow = createMemoryUnitOfWork(store);

    await uow.run(async (tx) => {
      await repo.insert(makeTodo({ id: 'a', title: 'kept' }), tx);
    });
    expect(store.todos.has('a')).toBe(true);
  });

  test('rolls every mutation back when the callback throws', async () => {
    const store = seededStore();
    const repo = createMemoryTodoRepository(store);
    const uow = createMemoryUnitOfWork(store);

    await expect(
      uow.run(async (tx) => {
        await repo.insert(makeTodo({ id: 'x', title: 'doomed' }), tx);
        await repo.deleteById('1', tx);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(store.todos.has('x')).toBe(false);
    expect(store.todos.has('1')).toBe(true);
  });

  test('rollback covers every table, not only todos', async () => {
    const store = seededStore();
    const auditLogs = createMemoryAuditLogRepository(store);
    const uow = createMemoryUnitOfWork(store);

    await expect(
      uow.run(async (tx) => {
        await auditLogs.append(
          {
            entityType: 'todo',
            entityId: '1',
            action: 'todo.deleted',
            createdAt: '2026-01-04T00:00:00.000Z' as UtcIsoString,
          },
          tx,
        );
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(store.auditLogs).toEqual([]);
  });

  test('a rolled-back transaction cannot leak mutations through shared row objects', async () => {
    const store = seededStore();
    const uow = createMemoryUnitOfWork(store);

    await expect(
      uow.run(() => {
        store.todos.get('1')!.title = 'mutated in place';
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(store.todos.get('1')?.title).toBe('Alpha');
  });
});
