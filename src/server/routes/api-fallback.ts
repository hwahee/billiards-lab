/**
 * /api/* fallback — any API path or method no route handles gets the JSON
 * 404 envelope.
 *
 * Without it the SPA catch-all (`/*` in index.ts) answers instead: an unknown
 * API path, or a known path called with a method it does not define, would
 * come back as `200 index.html`, which the client decodes as a *successful*
 * empty response. Bun matches exact and `:param` routes before this wildcard,
 * and falls through to it when a matched route lacks the request's method.
 */
import { NotFoundError } from '../lib/errors';
import { apiRoute, type ApiHandler, type HttpDeps } from '../http/respond';

export function apiFallbackRoutes(deps: HttpDeps) {
  const notFound: ApiHandler<'/api/*'> = (req) =>
    Promise.reject(new NotFoundError('route', `${req.method} ${new URL(req.url).pathname}`));

  return apiRoute<'/api/*'>(
    { GET: notFound, POST: notFound, PATCH: notFound, PUT: notFound, DELETE: notFound },
    deps,
  );
}
