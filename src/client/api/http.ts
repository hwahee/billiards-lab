/**
 * The one HTTP transport used by every API call.
 *
 * Responsibilities:
 *   - JSON encoding/decoding against same-origin `/api/*`
 *   - sending the build-version header (deployment-skew handshake — see
 *     @shared/api/version): on 409 VERSION_MISMATCH the page reloads once to
 *     pick up assets matching the newly deployed server
 *   - sending Accept-Language so API error messages arrive localized
 *   - normalizing every failure into a typed `ApiRequestError`
 */
import { isApiErrorBody, type ApiErrorCode } from '@shared/api/errors';
import { APP_VERSION, VERSION_HEADER } from '@shared/api/version';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode | 'UNKNOWN',
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

/**
 * Whether retrying a failed request could change the outcome. A 4xx is the
 * server's settled answer about *this* request (a 401 for a signed-out user,
 * a 404, a validation error), so retrying it only delays showing that answer;
 * 408 and 429 are the exceptions because they are about timing. Anything
 * else — 5xx, a network failure — may well succeed on a second try.
 */
export function isRetryableError(error: unknown): boolean {
  if (!(error instanceof ApiRequestError)) return true;
  const { status } = error;
  if (status === 408 || status === 429) return true;
  return status < 400 || status >= 500;
}

interface ApiFetchOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Appended to the URL; `undefined` values are dropped. */
  searchParams?: Record<string, string | number | undefined>;
}

function reloadOnceForNewVersion(): void {
  const key = `app.reloaded-for.${APP_VERSION}`;
  if (sessionStorage.getItem(key)) return; // avoid a reload loop
  sessionStorage.setItem(key, '1');
  window.location.reload();
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const url = new URL(path, window.location.origin);
  for (const [name, value] of Object.entries(options.searchParams ?? {})) {
    if (value !== undefined) url.searchParams.set(name, String(value));
  }

  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      accept: 'application/json',
      'accept-language': document.documentElement.lang || 'en',
      [VERSION_HEADER]: APP_VERSION,
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });

  if (response.status === 204) return undefined as T;

  const payload: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    if (isApiErrorBody(payload)) {
      if (payload.error.code === 'VERSION_MISMATCH') reloadOnceForNewVersion();
      throw new ApiRequestError(
        response.status,
        payload.error.code,
        payload.error.message,
        payload.error.details,
      );
    }
    throw new ApiRequestError(response.status, 'UNKNOWN', `HTTP ${response.status}`);
  }

  return payload as T;
}
