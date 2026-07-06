/**
 * Assembles the HTTP surface (API routes + WebSocket) as plain data, separate
 * from `Bun.serve` so integration tests can boot the exact same app on an
 * ephemeral port. The static client routes are added only by the real
 * entrypoint (src/server/index.ts).
 */
import { wsSubscriptionValidator, type BilliardsLiveMessage } from '@shared/billiards/room';

import type { Container } from './container';
import type { HttpDeps } from './http/respond';
import { CHANNELS } from './pubsub';
import { billiardsRoutes } from './routes/billiards';
import { livenessRoute, readinessRoute, type AppState } from './routes/health';
import { todoCollectionRoutes, todoItemRoutes } from './routes/todos';

/** Server-side WebSocket topic that todo change events are published to. */
const WS_TOPIC_TODOS = 'ws.todos';
/** Server-side WebSocket topic streaming billiards room snapshots (opt-in per socket). */
const WS_TOPIC_BILLIARDS = 'ws.billiards';

export function buildApp(container: Container, state: AppState) {
  const deps: HttpDeps = { config: container.config, log: container.log };

  return {
    routes: {
      '/api/health/live': livenessRoute(),
      '/api/health/ready': readinessRoute(container, state),
      '/api/todos': todoCollectionRoutes(container, deps),
      '/api/todos/:id': todoItemRoutes(container, deps),
      '/api/billiards': billiardsRoutes(container, deps),
      /** WebSocket endpoint: pushes `{action, todoId}` on every todo change. */
      '/ws': (req: Bun.BunRequest<'/ws'>, server: Bun.Server<undefined>) =>
        server.upgrade(req)
          ? undefined
          : new Response('WebSocket upgrade required', { status: 426 }),
    },

    websocket: {
      open(ws: Bun.ServerWebSocket<undefined>) {
        // Every socket joins the todos topic; the pub/sub → server.publish
        // bridge below makes this work across instances (redis driver).
        // The billiards feed streams at ~25 Hz during a shot, so it is
        // strictly opt-in via a subscribe message.
        ws.subscribe(WS_TOPIC_TODOS);
      },
      message(ws: Bun.ServerWebSocket<undefined>, raw: string | Buffer) {
        let payload: unknown;
        try {
          payload = JSON.parse(String(raw));
        } catch {
          return; // not part of the protocol — ignore
        }
        const parsed = wsSubscriptionValidator.safeParse(payload);
        if (!parsed.ok) return;
        if (parsed.value.type === 'subscribe') ws.subscribe(WS_TOPIC_BILLIARDS);
        else ws.unsubscribe(WS_TOPIC_BILLIARDS);
      },
    },

    /** Fallback for anything no route matched (API-only mode, e.g. tests). */
    fetch: () => new Response('Not Found', { status: 404 }),
  };
}

/**
 * Bridges the pub/sub bus onto this instance's WebSocket topics. With the
 * redis driver the bus crosses instances, so a room update computed anywhere
 * reaches sockets connected everywhere. Returns an unsubscribe-all cleanup.
 */
export async function bridgePubSubToWebSocket(
  server: Bun.Server<undefined>,
  container: Container,
): Promise<() => Promise<void>> {
  const unsubscribes = [
    await container
      .pubsub()
      .subscribe(CHANNELS.todosChanged, (message) =>
        server.publish(WS_TOPIC_TODOS, JSON.stringify(message)),
      ),
    await container.pubsub().subscribe(CHANNELS.billiardsUpdated, (message) => {
      const frame: BilliardsLiveMessage = {
        channel: 'billiards',
        snapshot: message as BilliardsLiveMessage['snapshot'],
      };
      server.publish(WS_TOPIC_BILLIARDS, JSON.stringify(frame));
    }),
  ];
  return async () => {
    for (const unsubscribe of unsubscribes) await unsubscribe();
  };
}
