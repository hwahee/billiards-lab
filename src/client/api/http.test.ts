import { describe, expect, test } from 'bun:test';

import { ApiRequestError, isRetryableError } from './http';

const apiError = (status: number) => new ApiRequestError(status, 'UNKNOWN', `HTTP ${status}`);

describe('isRetryableError', () => {
  test('a 4xx is final — retrying a 401/404/400 cannot change the answer', () => {
    for (const status of [400, 401, 404, 409])
      expect(isRetryableError(apiError(status))).toBe(false);
  });

  test('timing-related 4xx (408, 429) are retried', () => {
    expect(isRetryableError(apiError(408))).toBe(true);
    expect(isRetryableError(apiError(429))).toBe(true);
  });

  test('server faults and network failures are retried', () => {
    expect(isRetryableError(apiError(500))).toBe(true);
    expect(isRetryableError(apiError(503))).toBe(true);
    expect(isRetryableError(new TypeError('Failed to fetch'))).toBe(true);
  });
});
