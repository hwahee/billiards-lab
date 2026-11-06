/**
 * A stand-in member server for tests: an OIDC issuer on an ephemeral port
 * with discovery and a token endpoint that trades each code it handed out
 * once — enough to drive ./oidc.ts and /api/auth without a real one.
 */
import { loadServerConfig, type ServerConfig } from '../config';
import { sessionCookieHeader, type Session } from './session';

/** AUTH_DRIVER=oidc settings for tests; the issuer need not be running unless a test signs in. */
export function testOidcEnv(issuer = 'http://issuer.test'): Record<string, string> {
  return {
    AUTH_DRIVER: 'oidc',
    OIDC_ISSUER: issuer,
    OIDC_CLIENT_ID: 'test-service',
    OIDC_CLIENT_SECRET: 'test-client-secret',
    PUBLIC_URL: 'http://service.test',
    SESSION_SECRET: 'test-session-secret-at-least-32-chars',
  };
}

/** The `Cookie` header of a browser signed in to the service `config` describes. */
export function memberCookie(
  config: ServerConfig,
  session: Partial<Session> & { userId: string },
): string {
  if (!config.oidc) throw new Error('memberCookie needs AUTH_DRIVER=oidc');
  return sessionCookieHeader(config.oidc, {
    displayName: session.userId,
    sid: null,
    ...session,
  });
}

interface FakeIssuer {
  /** The issuer URL, as the discovery document names it. */
  url: string;
  /** Settings for a service registered with this issuer. */
  config(overrides?: Record<string, string>): ServerConfig;
  /** A code the token endpoint trades for an id_token with these claims — once. */
  issueCode(claims: { sub: string } & Record<string, unknown>): string;
  stop(): Promise<void>;
}

const base64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

export function startFakeIssuer(): FakeIssuer {
  const env = testOidcEnv();
  const codes = new Map<string, Record<string, unknown>>();
  let url = '';

  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname === '/.well-known/openid-configuration') {
        return Response.json({
          issuer: url,
          authorization_endpoint: `${url}/oauth2/auth`,
          token_endpoint: `${url}/oauth2/token`,
          end_session_endpoint: `${url}/oauth2/sessions/logout`,
        });
      }
      if (pathname === '/oauth2/token' && req.method === 'POST') {
        const expected = `Basic ${Buffer.from(`${env.OIDC_CLIENT_ID}:${env.OIDC_CLIENT_SECRET}`).toString('base64')}`;
        if (req.headers.get('authorization') !== expected) {
          return Response.json({ error: 'invalid_client' }, { status: 401 });
        }
        const form = new URLSearchParams(await req.text());
        const claims = codes.get(form.get('code') ?? '');
        if (!claims || form.get('grant_type') !== 'authorization_code') {
          return Response.json({ error: 'invalid_grant' }, { status: 400 });
        }
        codes.delete(form.get('code') ?? '');
        const idToken = `${base64url({ alg: 'RS256' })}.${base64url(claims)}.signature`;
        return Response.json({ id_token: idToken, access_token: 'opaque', token_type: 'bearer' });
      }
      return new Response('not found', { status: 404 });
    },
  });
  url = String(server.url).replace(/\/$/, '');

  return {
    url,
    config: (overrides = {}) =>
      loadServerConfig({ DB_DRIVER: 'memory', ...testOidcEnv(url), ...overrides }),
    issueCode(claims) {
      const code = crypto.randomUUID();
      codes.set(code, {
        iss: url,
        aud: [env.OIDC_CLIENT_ID],
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        ...claims,
      });
      return code;
    },
    stop: () => server.stop(true),
  };
}
