/**
 * Composition root — a tiny, typed service container.
 *
 * Everything resolved through the container is a per-process SINGLETON:
 * the factory runs once (lazily, on first access) and the instance is
 * memoized. When a future service must be a singleton (a scheduler, a cache,
 * a metrics registry, …), register it here the same way — consumers never
 * construct services themselves.
 *
 * The container also owns driver selection (postgres vs memory persistence,
 * memory vs redis pub/sub), so swapping infrastructure is invisible to
 * services and routes.
 */
import type { ServerConfig } from './config';
import { createPostgresDb, createPostgresUnitOfWork, type PostgresDb } from './db/postgres';
import { createLogger, type Logger } from './lib/log';
import { CHANNELS, createPubSub, type PubSub } from './pubsub';
import {
  createMemoryAuditLogRepository,
  createMemoryTodoRepository,
  createMemoryUnitOfWork,
  MemoryStore,
} from './repositories/memory';
import {
  createPostgresAuditLogRepository,
  createPostgresTodoRepository,
} from './repositories/postgres';
import type { AuditLogRepository, TodoRepository, UnitOfWork } from './repositories/types';
import { BilliardsRoomService } from './services/billiards/room-service';
import { TodoService } from './services/todo-service';

export interface Container {
  readonly config: ServerConfig;
  readonly log: Logger;
  todoService(): TodoService;
  billiardsRoom(): BilliardsRoomService;
  pubsub(): PubSub;
  /** Health probe: is the persistence layer reachable? */
  dbPing(): Promise<boolean>;
  /** Closes every held resource (DB pool, pub/sub connections). */
  dispose(): Promise<void>;
}

/** Memoizes a factory — the singleton primitive used for every service. */
function lazy<T>(factory: () => T): () => T {
  let created = false;
  let value: T;
  return () => {
    if (!created) {
      value = factory();
      created = true;
    }
    return value;
  };
}

export interface ContainerOverrides {
  log?: Logger;
  pubsub?: PubSub;
}

export function createContainer(
  config: ServerConfig,
  overrides: ContainerOverrides = {},
): Container {
  const log = overrides.log ?? createLogger('app');

  // Persistence wiring, chosen once from configuration.
  let postgresCreated = false;
  const postgres = lazy<PostgresDb>(() => {
    if (!config.databaseUrl) throw new Error('DATABASE_URL is not configured');
    postgresCreated = true;
    return createPostgresDb(config.databaseUrl);
  });
  const memoryStore = lazy(() => new MemoryStore());

  const todoRepository = lazy<TodoRepository>(() =>
    config.dbDriver === 'postgres'
      ? createPostgresTodoRepository(postgres())
      : createMemoryTodoRepository(memoryStore()),
  );
  const auditLogRepository = lazy<AuditLogRepository>(() =>
    config.dbDriver === 'postgres'
      ? createPostgresAuditLogRepository(postgres())
      : createMemoryAuditLogRepository(memoryStore()),
  );
  const unitOfWork = lazy<UnitOfWork>(() =>
    config.dbDriver === 'postgres'
      ? createPostgresUnitOfWork(postgres())
      : createMemoryUnitOfWork(memoryStore()),
  );

  const pubsub = lazy<PubSub>(() => overrides.pubsub ?? createPubSub(config));

  const todoService = lazy(
    () =>
      new TodoService({
        todos: todoRepository(),
        auditLogs: auditLogRepository(),
        uow: unitOfWork(),
        events: pubsub(),
      }),
  );

  let billiardsRoomCreated = false;
  const billiardsRoom = lazy(() => {
    billiardsRoomCreated = true;
    return new BilliardsRoomService({
      // Every room update goes onto the bus; the /ws bridge fans it out to
      // subscribed sockets (on every instance, with the redis driver).
      onUpdate: (snapshot) => void pubsub().publish(CHANNELS.billiardsUpdated, snapshot),
    });
  });

  return {
    config,
    log,
    todoService,
    billiardsRoom,
    pubsub,
    async dbPing() {
      if (config.dbDriver === 'memory') return true;
      return postgres().ping();
    },
    async dispose() {
      if (billiardsRoomCreated) billiardsRoom().dispose();
      await pubsub().close();
      if (postgresCreated) await postgres().close();
    },
  };
}
