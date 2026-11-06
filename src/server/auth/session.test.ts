import { describe, expect, test } from 'bun:test';

import { loadServerConfig } from '../config';
import { UnauthorizedError } from '../lib/errors';
import { memberCookie, testOidcEnv } from './fake-issuer';
import { readCaller, readSession, requireMember } from './session';

const config = loadServerConfig({ DB_DRIVER: 'memory', ...testOidcEnv() });
const oidc = config.oidc!;
const withCookie = (cookie: string) => new Request('http://localhost/', { headers: { cookie } });

describe('readCaller', () => {
  test('AUTH_DRIVER=oidc: a session cookie this service signed makes the caller a member', () => {
    const cookie = memberCookie(config, { userId: 'alice', displayName: 'Alice', sid: 's1' });
    expect(readCaller(withCookie(`a=1; ${cookie}`), config)).toEqual({
      kind: 'member',
      userId: 'alice',
      displayName: 'Alice',
    });
    expect(readSession(withCookie(cookie), oidc)?.sid).toBe('s1');
  });

  test('AUTH_DRIVER=oidc: no cookie, a cleared one, or one not signed by us is a guest', () => {
    const forged = memberCookie(config, { userId: 'alice' }).replace(/\.[^.]+$/, '.forged');
    const otherService = memberCookie(
      loadServerConfig({ DB_DRIVER: 'memory', ...testOidcEnv(), SESSION_SECRET: 'y'.repeat(32) }),
      { userId: 'alice' },
    );
    for (const cookie of ['', 'session-test-service=', forged, otherService]) {
      expect(readCaller(withCookie(cookie), config)).toEqual({ kind: 'guest' });
    }
  });

  test('the cookie is named per service, so services on one host do not share it', () => {
    const elsewhere = loadServerConfig({
      DB_DRIVER: 'memory',
      ...testOidcEnv(),
      OIDC_CLIENT_ID: 'other-service',
    });
    expect(memberCookie(elsewhere, { userId: 'alice' })).toStartWith('session-other-service=');
    expect(readCaller(withCookie(memberCookie(elsewhere, { userId: 'alice' })), config)).toEqual({
      kind: 'guest',
    });
  });

  test('AUTH_DRIVER=none never trusts a session cookie, even a well-formed one', () => {
    const cookie = memberCookie(config, { userId: 'alice' });
    expect(readCaller(withCookie(cookie), loadServerConfig({ DB_DRIVER: 'memory' }))).toEqual({
      kind: 'anyone',
    });
  });
});

describe('requireMember', () => {
  test('lets members through and turns guests away', () => {
    expect(() =>
      requireMember({ kind: 'member', userId: 'alice', displayName: 'Alice' }),
    ).not.toThrow();
    expect(() => requireMember({ kind: 'guest' })).toThrow(UnauthorizedError);
  });

  test('without sign-in (AUTH_DRIVER=none) there is no one to turn away', () => {
    expect(() => requireMember({ kind: 'anyone' })).not.toThrow();
  });
});
