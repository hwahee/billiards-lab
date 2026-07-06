/**
 * Route plumbing shared by every API endpoint:
 *
 *   - JSON responses
 *   - the repo-wide error envelope (@shared/api/errors), localized
 *   - deployment-version handshake (@shared/api/version)
 *   - CORS preflight + response headers
 *   - mapping of domain errors (ValidationError, NotFoundError) to HTTP
 */
import type { ApiErrorBody, ApiErrorCode } from '@shared/api/errors';
import { APP_VERSION, VERSION_HEADER } from '@shared/api/version';
import type { MessageKey } from '@shared/i18n';
import { ValidationError } from '@shared/validation';

import type { ServerConfig } from '../config';
import { ForbiddenError, NotFoundError } from '../lib/errors';
import type { Logger } from '../lib/log';
import { createRequestContext, type RequestContext } from './context';
import { corsHeaders, preflightResponse } from './cors';

export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', ...init.headers },
  });
}

const ERROR_MESSAGE_KEYS: Record<ApiErrorCode, MessageKey> = {
  VALIDATION_ERROR: 'error.validation',
  NOT_FOUND: 'error.notFound',
  FORBIDDEN: 'error.forbidden',
  VERSION_MISMATCH: 'error.versionMismatch',
  INTERNAL_ERROR: 'error.internal',
};

function errorResponse(
  status: number,
  code: ApiErrorCode,
  ctx: RequestContext,
  details?: unknown,
): Response {
  const body: ApiErrorBody = {
    error: {
      code,
      message: ctx.t(ERROR_MESSAGE_KEYS[code]),
      ...(details === undefined ? {} : { details }),
    },
  };
  return json(body, { status });
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export type ApiHandler<P extends string> = (
  req: Bun.BunRequest<P>,
  ctx: RequestContext,
) => Promise<Response>;

export interface HttpDeps {
  config: ServerConfig;
  log: Logger;
}

/**
 * Wraps a set of method handlers into a Bun `routes` entry with the shared
 * middleware behavior applied (preflight, version check, error mapping,
 * CORS response headers).
 */
export function apiRoute<P extends string>(
  handlers: Partial<Record<Method, ApiHandler<P>>>,
  deps: HttpDeps,
): Record<string, (req: Bun.BunRequest<P>) => Promise<Response>> {
  const wrap =
    (handler: ApiHandler<P>) =>
    async (req: Bun.BunRequest<P>): Promise<Response> => {
      const ctx = createRequestContext(req);
      let response: Response;
      try {
        response = checkVersion(req, ctx) ?? (await handler(req, ctx));
      } catch (error) {
        response = mapError(error, ctx, deps.log);
      }
      // Append CORS headers for allowed cross-origin callers.
      for (const [name, value] of Object.entries(corsHeaders(req, deps.config.corsOrigins))) {
        response.headers.set(name, value);
      }
      return response;
    };

  const route: Record<string, (req: Bun.BunRequest<P>) => Promise<Response>> = {
    OPTIONS: (req) => Promise.resolve(preflightResponse(req, deps.config.corsOrigins)),
  };
  for (const [method, handler] of Object.entries(handlers)) {
    route[method] = wrap(handler);
  }
  return route;
}

/**
 * Deployment-version handshake: reject clients built from a different bundle
 * than this server (rolling-deploy skew). See @shared/api/version.
 */
function checkVersion(req: Request, ctx: RequestContext): Response | undefined {
  const clientVersion = req.headers.get(VERSION_HEADER);
  if (clientVersion !== null && clientVersion !== APP_VERSION) {
    return errorResponse(409, 'VERSION_MISMATCH', ctx, {
      client: clientVersion,
      server: APP_VERSION,
    });
  }
  return undefined;
}

function mapError(error: unknown, ctx: RequestContext, log: Logger): Response {
  if (error instanceof ValidationError) {
    return errorResponse(400, 'VALIDATION_ERROR', ctx, error.issues);
  }
  if (error instanceof SyntaxError) {
    // Malformed JSON body is the caller's problem, not a server fault.
    return errorResponse(400, 'VALIDATION_ERROR', ctx, [
      { path: '', message: 'Request body is not valid JSON', code: 'invalid_json' },
    ]);
  }
  if (error instanceof NotFoundError) {
    return errorResponse(404, 'NOT_FOUND', ctx, { resource: error.resource, id: error.id });
  }
  if (error instanceof ForbiddenError) {
    return errorResponse(403, 'FORBIDDEN', ctx, { reason: error.reason });
  }
  log.error('unhandled error in api handler', {
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  });
  return errorResponse(500, 'INTERNAL_ERROR', ctx);
}
