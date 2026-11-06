/**
 * Error mapping of `apiRoute` for domain errors no current route throws yet
 * (so the API integration suite cannot reach them through HTTP).
 */
import { describe, expect, test } from 'bun:test';

import type { ApiErrorBody } from '@shared/api/errors';

import { loadServerConfig } from '../config';
import { UnauthorizedError } from '../lib/errors';
import { silentLogger } from '../lib/log';
import { apiRoute } from './respond';

const deps = {
  config: loadServerConfig({ DB_DRIVER: 'memory' }),
  log: silentLogger,
};

async function callThrowing(error: Error, headers: Record<string, string> = {}) {
  const route = apiRoute<'/test'>({ GET: () => Promise.reject(error) }, deps);
  const req = new Request('http://localhost/test', { headers }) as Bun.BunRequest<'/test'>;
  const response = await route.GET!(req);
  return { status: response.status, body: (await response.json()) as ApiErrorBody };
}

describe('apiRoute error mapping', () => {
  test('UnauthorizedError → 401 UNAUTHORIZED with a localized message', async () => {
    const en = await callThrowing(new UnauthorizedError());
    expect(en.status).toBe(401);
    expect(en.body.error.code).toBe('UNAUTHORIZED');
    expect(en.body.error.message).toBe('Please sign in to continue.');

    const ko = await callThrowing(new UnauthorizedError(), { 'accept-language': 'ko' });
    expect(ko.body.error.message).toBe('로그인이 필요합니다.');
  });
});
