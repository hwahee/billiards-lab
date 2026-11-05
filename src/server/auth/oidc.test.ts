import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { startFakeIssuer } from './fake-issuer';
import { createOidcClient, SignInError, type OidcClient } from './oidc';

let issuer: ReturnType<typeof startFakeIssuer>;
let client: OidcClient;

beforeAll(() => {
  issuer = startFakeIssuer();
  const { oidc } = issuer.config();
  if (!oidc) throw new Error('expected oidc settings');
  client = createOidcClient(oidc);
});

afterAll(async () => {
  await issuer.stop();
});

describe('OidcClient', () => {
  test('sends the browser to the issuer for this service, coming back to the callback', async () => {
    const url = new URL(await client.authorizationUrl('state-123'));
    expect(url.origin + url.pathname).toBe(`${issuer.url}/oauth2/auth`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'test-service',
      response_type: 'code',
      scope: 'openid profile',
      redirect_uri: 'http://service.test/api/auth/callback',
      state: 'state-123',
    });
  });

  test("asks the issuer's pages to look like this one: theme, design, ui_locales", async () => {
    const url = new URL(
      await client.authorizationUrl('state-123', { theme: 'dark', design: 'office', locale: 'ko' }),
    );
    expect(url.searchParams.get('state')).toBe('state-123');
    expect(url.searchParams.get('theme')).toBe('dark');
    expect(url.searchParams.get('design')).toBe('office');
    expect(url.searchParams.get('ui_locales')).toBe('ko');
  });

  test('trades a code for who signed in: sub, name, and the issuer session', async () => {
    const code = issuer.issueCode({ sub: 'alice', name: '앨리스', sid: 'sid-1' });
    expect(await client.signIn(code)).toEqual({
      userId: 'alice',
      displayName: '앨리스',
      sid: 'sid-1',
    });
  });

  test('without a name the id stands in; without sid the session names none', async () => {
    expect(await client.signIn(issuer.issueCode({ sub: 'bob' }))).toEqual({
      userId: 'bob',
      displayName: 'bob',
      sid: null,
    });
  });

  test('a code used twice is turned down', async () => {
    const code = issuer.issueCode({ sub: 'alice' });
    await client.signIn(code);
    await expect(client.signIn(code)).rejects.toBeInstanceOf(SignInError);
  });

  test('an id_token for another service, from another issuer, or expired is turned down', async () => {
    for (const claims of [
      { aud: ['another-service'] },
      { iss: 'http://elsewhere.test' },
      { exp: Math.floor(Date.now() / 1000) - 1 },
    ]) {
      await expect(client.signIn(issuer.issueCode({ sub: 'alice', ...claims }))).rejects.toThrow(
        SignInError,
      );
    }
  });

  test('signing out goes to the issuer, and only that issuer may say who signed out', async () => {
    expect(await client.logoutUrl()).toBe(`${issuer.url}/oauth2/sessions/logout`);
    expect(client.isIssuer(issuer.url)).toBe(true);
    expect(client.isIssuer(`${issuer.url}/`)).toBe(true);
    expect(client.isIssuer('http://elsewhere.test')).toBe(false);
  });

  test('discovery must name the configured issuer (a trailing slash aside)', async () => {
    const { oidc } = issuer.config({ OIDC_ISSUER: `${issuer.url}/` });
    if (!oidc) throw new Error('expected oidc settings');
    expect(await createOidcClient(oidc).authorizationUrl('s')).toStartWith(issuer.url);

    // Same server, other name: its discovery document names `localhost`.
    const renamed = createOidcClient({
      ...oidc,
      issuer: issuer.url.replace('localhost', '127.0.0.1'),
    });
    await expect(renamed.authorizationUrl('s')).rejects.toThrow('OIDC discovery names issuer');
  });

  test('an unreachable issuer fails the step, and is tried again next time', async () => {
    const { oidc } = issuer.config();
    if (!oidc) throw new Error('expected oidc settings');
    const down = createOidcClient({ ...oidc, issuer: 'http://127.0.0.1:1' });
    await expect(down.authorizationUrl('s')).rejects.toThrow();
    await expect(down.authorizationUrl('s')).rejects.toThrow();
  });
});
