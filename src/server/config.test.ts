import { describe, expect, test } from 'bun:test';

import { testOidcEnv } from './auth/fake-issuer';
import { loadServerConfig } from './config';

describe('loadServerConfig — AUTH_DRIVER', () => {
  test('defaults to none: sign-in is opt-in', () => {
    expect(loadServerConfig({ DB_DRIVER: 'memory' }).authDriver).toBe('none');
    expect(loadServerConfig({ DB_DRIVER: 'memory' }).oidc).toBeUndefined();
  });

  test('oidc: signing in through the member server, with this service registered there', () => {
    const config = loadServerConfig({ DB_DRIVER: 'memory', ...testOidcEnv() });
    expect(config.authDriver).toBe('oidc');
    expect(config.oidc).toMatchObject({
      clientId: 'test-service',
      publicUrl: 'http://service.test',
    });
  });

  test('oidc names every setting it is missing', () => {
    const { OIDC_CLIENT_SECRET: _secret, SESSION_SECRET: _session, ...partial } = testOidcEnv();
    expect(() => loadServerConfig({ DB_DRIVER: 'memory', ...partial })).toThrow(
      'OIDC_CLIENT_SECRET, SESSION_SECRET required when AUTH_DRIVER=oidc',
    );
  });

  test('a session secret too short to sign with is refused', () => {
    expect(() =>
      loadServerConfig({ DB_DRIVER: 'memory', ...testOidcEnv(), SESSION_SECRET: 'short' }),
    ).toThrow();
  });

  test('dev was removed — the message says where sign-in went', () => {
    expect(() => loadServerConfig({ DB_DRIVER: 'memory', AUTH_DRIVER: 'dev' })).toThrow(
      'AUTH_DRIVER=dev was removed',
    );
  });
});
