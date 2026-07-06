/**
 * Assembles the HTTP surface (API routes + WebSocket) as plain data, separate
 * from `Bun.serve` so integration tests can boot the exact same app on an
 * ephemeral port. The static client routes are added only by the real
 * entrypoint (src/server/index.ts).
 */
import type { Container } from './container';
import type { HttpDeps } from './http/respond';
import { billiardsRoutes } from './routes/billiards';
import { livenessRoute, readinessRoute, type AppState } from './routes/health';
import { todoCollectionRoutes, todoItemRoutes } from './routes/todos';

/** Server-side WebSocket topic that todo change events are published to. */
export const WS_TOPIC_TODOS = 'ws.todos';

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
        // Every socket joins the todos topic; index.ts bridges pub/sub →
        // server.publish, so this works across instances with the redis driver.
        ws.subscribe(WS_TOPIC_TODOS);
      },
      message() {
        // Inbound messages are not part of the protocol (yet).
      },
    },

    /** Fallback for anything no route matched (API-only mode, e.g. tests). */
    fetch: () => new Response('Not Found', { status: 404 }),
  };
}
