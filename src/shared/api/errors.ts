/**
 * API error envelope — the single error shape every endpoint returns.
 *
 * Example:
 *   HTTP 400
 *   { "error": { "code": "VALIDATION_ERROR", "message": "…", "details": [ … ] } }
 *
 * `message` is localized (Accept-Language / ?lang=), `code` is stable and
 * machine-readable — clients must branch on `code`, never on `message`.
 */

export type ApiErrorCode =
  'VALIDATION_ERROR' | 'NOT_FOUND' | 'FORBIDDEN' | 'VERSION_MISMATCH' | 'INTERNAL_ERROR';

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    /** Optional structured detail, e.g. validation issues. */
    details?: unknown;
  };
}

export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const error: unknown = value.error;
  return (
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
  );
}
