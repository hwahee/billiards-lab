/**
 * Server entrypoint.
 *
 *   bun --watch src/server/index.ts   # development (client HMR included)
 *   bun dist/index.js                 # production (client bundled in)
 *
 * The HTML import below makes Bun bundle and serve the React client from this
 * same process: with `bun build --target bun` the built server artifact
 * CONTAINS the built client, so one deployable unit always ships matching
 * client and server code (see @shared/api/version for the skew handshake).
 */
import homepage from '../client/index.html';
import { bridgePubSubToWebSocket, buildApp } from './app';
import { loadServerConfig } from './config';
import { createContainer } from './container';
import type { AppState } from './routes/health';

// Policy: the server process itself lives in UTC; time-zone conversion only
// happens at the client boundary (@shared/time).
process.env.TZ = 'UTC';

const config = loadServerConfig();
const container = createContainer(config);
const { log } = container;
const state: AppState = { shuttingDown: false };

const stopHooks: (() => Promise<void>)[] = [];

// ── Web role ────────────────────────────────────────────────────────────────
if (config.serverRole === 'web' || config.serverRole === 'all') {
  const app = buildApp(container, state);

  const server = Bun.serve({
    port: config.port,
    development:
      config.appEnv === 'local'
        ? { hmr: true, console: true } // client HMR + browser console echo
        : false,
    routes: {
      ...app.routes,
      // SPA catch-all: every non-API path serves the client (index.html),
      // so client-side routes like /design-system deep-link correctly.
      '/*': homepage,
    },
    websocket: app.websocket,
  });

  // Bridge: pub/sub bus → WebSocket clients connected to THIS instance.
  // With PUBSUB_DRIVER=redis this fans out across all instances.
  const unsubscribe = await bridgePubSubToWebSocket(server, container);

  stopHooks.push(async () => {
    await unsubscribe();
    // Stop accepting new connections, then wait for in-flight requests to
    // finish (graceful; `server.stop(true)` would abort them instead).
    await server.stop();
  });

  log.info('server listening', { url: String(server.url), env: config.appEnv });
}

// ── Worker role ─────────────────────────────────────────────────────────────
if (config.serverRole === 'worker' || config.serverRole === 'all') {
  const { startWorker } = await import('./worker');
  const stopWorker = await startWorker(container);
  stopHooks.push(stopWorker);
}

// ── Graceful shutdown ───────────────────────────────────────────────────────
// On SIGTERM/SIGINT: flip readiness to 503 so the load balancer drains this
// instance, wait for the drain window, finish in-flight requests, then close
// every resource. A second signal force-exits.
let shutdownStarted = false;
async function shutdown(signal: string): Promise<void> {
  if (shutdownStarted) {
    log.warn('forced shutdown', { signal });
    process.exit(1);
  }
  shutdownStarted = true;
  state.shuttingDown = true;
  log.info('shutdown initiated', { signal, drainMs: config.shutdownDrainMs });

  await Bun.sleep(config.shutdownDrainMs);
  for (const stop of stopHooks) await stop();
  await container.dispose();

  log.info('shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
