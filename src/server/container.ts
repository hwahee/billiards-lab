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
import { createOidcClient, type OidcClient } from './auth/oidc';
import type { ServerConfig } from './config';
import { createPostgresDb, createPostgresUnitOfWork, type PostgresDb } from './db/postgres';
import { createLogger, type Logger } from './lib/log';
import { createPresenceStore, type PresenceStore } from './presence';
import { CHANNELS, createPubSub, type PubSub } from './pubsub';
import { ChatGateway } from './realtime/chat-gateway';
import {
  createMemoryAuditLogRepository,
  createMemoryChatMessageRepository,
  createMemoryChatRoomRepository,
  createMemoryTodoRepository,
  createMemoryUnitOfWork,
  MemoryStore,
} from './repositories/memory';
import {
  createPostgresAuditLogRepository,
  createPostgresChatMessageRepository,
  createPostgresChatRoomRepository,
  createPostgresTodoRepository,
} from './repositories/postgres';
import type {
  AuditLogRepository,
  ChatMessageRepository,
  ChatRoomRepository,
  TodoRepository,
  UnitOfWork,
} from './repositories/types';
import { BilliardsRoomService } from './services/billiards/room-service';
import { ChatService } from './services/chat-service';
import { TodoService } from './services/todo-service';

export interface Container {
  readonly config: ServerConfig;
  readonly log: Logger;
  todoService(): TodoService;
  billiardsRoom(): BilliardsRoomService;
  /** Signs members in through the member server; only with AUTH_DRIVER=oidc. */
  oidcClient(): OidcClient;
  chatService(): ChatService;
  /** This process's chat sockets — one per process, like everything here. */
  chatGateway(): ChatGateway;
  pubsub(): PubSub;
  /** Health probe: is the persistence layer reachable? */
  dbPing(): Promise<boolean>;
  /** Closes every held resource (DB pool, pub/sub and presence connections). */
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
  presence?: PresenceStore;
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
  const chatRoomRepository = lazy<ChatRoomRepository>(() =>
    config.dbDriver === 'postgres'
      ? createPostgresChatRoomRepository(postgres())
      : createMemoryChatRoomRepository(memoryStore()),
  );
  const chatMessageRepository = lazy<ChatMessageRepository>(() =>
    config.dbDriver === 'postgres'
      ? createPostgresChatMessageRepository(postgres())
      : createMemoryChatMessageRepository(memoryStore()),
  );
  const unitOfWork = lazy<UnitOfWork>(() =>
    config.dbDriver === 'postgres'
      ? createPostgresUnitOfWork(postgres())
      : createMemoryUnitOfWork(memoryStore()),
  );

  const pubsub = lazy<PubSub>(() => overrides.pubsub ?? createPubSub(config));
  const presence = lazy<PresenceStore>(() => overrides.presence ?? createPresenceStore(config));

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

  const oidcClient = lazy<OidcClient>(() => {
    if (!config.oidc) throw new Error('AUTH_DRIVER=oidc is not configured');
    return createOidcClient(config.oidc);
  });

  const chatService = lazy(
    () =>
      new ChatService({
        rooms: chatRoomRepository(),
        messages: chatMessageRepository(),
        uow: unitOfWork(),
        events: pubsub(),
      }),
  );

  const chatGateway = lazy(
    () =>
      new ChatGateway({
        config,
        chat: chatService(),
        presence: presence(),
        events: pubsub(),
        log,
      }),
  );

  return {
    config,
    log,
    todoService,
    billiardsRoom,
    oidcClient,
    chatService,
    chatGateway,
    pubsub,
    async dbPing() {
      if (config.dbDriver === 'memory') return true;
      return postgres().ping();
    },
    async dispose() {
      if (billiardsRoomCreated) billiardsRoom().dispose();
      await pubsub().close();
      await presence().close();
      if (postgresCreated) await postgres().close();
    },
  };
}
