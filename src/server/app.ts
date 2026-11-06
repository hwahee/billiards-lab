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
import type { ChatSocketData } from './realtime/chat-gateway';
import { apiFallbackRoutes } from './routes/api-fallback';
import { authRoutes } from './routes/auth';
import { billiardsRoutes } from './routes/billiards';
import { chatMessageRoutes } from './routes/chat';
import { livenessRoute, readinessRoute, type AppState } from './routes/health';
import { sitemapRoute } from './routes/sitemap';
import { todoCollectionRoutes, todoItemRoutes } from './routes/todos';

/** Server-side WebSocket topic that todo change events are published to. */
const WS_TOPIC_TODOS = 'ws.todos';
/** Server-side WebSocket topic streaming billiards room snapshots (opt-in per socket). */
const WS_TOPIC_BILLIARDS = 'ws.billiards';

/** What each socket carries — which endpoint it was opened on decides the rest. */
export type SocketData = { kind: 'todos' } | ChatSocketData;

function isChatSocket(
  ws: Bun.ServerWebSocket<SocketData>,
): ws is Bun.ServerWebSocket<ChatSocketData> {
  return ws.data.kind === 'chat';
}

export function buildApp(container: Container, state: AppState) {
  const deps: HttpDeps = { config: container.config, log: container.log };

  return {
    routes: {
      '/api/health/live': livenessRoute(),
      '/api/health/ready': readinessRoute(container, state),
      '/api/todos': todoCollectionRoutes(container, deps),
      '/api/todos/:id': todoItemRoutes(container, deps),
      '/api/billiards': billiardsRoutes(container, deps),
      '/api/chat/rooms/:roomId/messages': chatMessageRoutes(container, deps),
      ...(container.config.authDriver === 'oidc' ? authRoutes(container, deps) : {}),
      /** Unknown API paths/methods → JSON 404, never the SPA's index.html. */
      '/api/*': apiFallbackRoutes(deps),
      /**
       * Public service directory (NOT the crawler's sitemap.xml). Lives
       * outside /api because it is a static, cacheable document rather than
       * part of the application API.
       */
      '/sitemap.json': sitemapRoute(deps),
      /** WebSocket endpoint: pushes `{action, todoId}` on every todo change. */
      '/ws': (req: Bun.BunRequest<'/ws'>, server: Bun.Server<SocketData>) =>
        server.upgrade(req, { data: { kind: 'todos' } })
          ? undefined
          : new Response('WebSocket upgrade required', { status: 426 }),
      /** Chat WebSocket endpoint — see src/server/realtime/chat-gateway.ts. */
      '/ws/chat': (req: Bun.BunRequest<'/ws/chat'>, server: Bun.Server<SocketData>) => {
        const data = container.chatGateway().handshake(req);
        if (data instanceof Response) return data;
        return server.upgrade(req, { data })
          ? undefined
          : new Response('WebSocket upgrade required', { status: 426 });
      },
    },

    websocket: {
      open(ws: Bun.ServerWebSocket<SocketData>) {
        // Every todos socket joins the todos topic; the pub/sub → server.publish
        // bridge below makes this work across instances (redis driver).
        // The billiards feed rides the same socket but streams at ~25 Hz
        // during a shot, so it is strictly opt-in via a subscribe message.
        // Chat sockets join rooms by asking (see the chat gateway).
        if (ws.data.kind === 'todos') ws.subscribe(WS_TOPIC_TODOS);
      },
      message(ws: Bun.ServerWebSocket<SocketData>, raw: string | Buffer) {
        if (isChatSocket(ws)) {
          void container.chatGateway().message(ws, raw);
          return;
        }
        // On a todos socket the only inbound protocol is the billiards opt-in.
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
      close(ws: Bun.ServerWebSocket<SocketData>) {
        if (isChatSocket(ws)) void container.chatGateway().close(ws);
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
  server: Bun.Server<SocketData>,
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
