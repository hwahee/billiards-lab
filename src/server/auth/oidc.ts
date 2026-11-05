/**
 * Signing in through the member server — OpenID Connect, and only its
 * standard parts: discovery, the authorization code flow, RP-initiated
 * logout and front-channel logout. Nothing here knows which product the
 * member server runs on (CLAUDE.md).
 *
 * The id_token is read and dropped: this service keeps who signed in
 * (./session.ts), never a token.
 */
import { appearanceParams, type Appearance } from '@shared/domain/appearance';
import { s, toValidator } from '@shared/validation';

import type { ServerConfig } from '../config';
import type { Session } from './session';

type OidcConfig = NonNullable<ServerConfig['oidc']>;

/** Where the member server sends the browser back after a sign-in. */
const CALLBACK_PATH = '/api/auth/callback';
/** Every service asks for the same: who signed in, and their nickname. */
const SCOPE = 'openid profile';

/** The member server turned the sign-in down, or answered with something unusable. */
export class SignInError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SignInError';
  }
}

const discoveryValidator = toValidator(
  s.object({
    issuer: s.string(),
    authorization_endpoint: s.url(),
    token_endpoint: s.url(),
    end_session_endpoint: s.optional(s.url()),
  }),
);

const idTokenClaimsValidator = toValidator(
  s.object({
    iss: s.string(),
    sub: s.string().check(s.minLength(1)),
    aud: s.union([s.string(), s.array(s.string())]),
    exp: s.number(),
    name: s.optional(s.string()),
    sid: s.optional(s.string()),
  }),
);

/** Issuers compare exactly, give or take a trailing slash in configuration. */
const sameIssuer = (a: string, b: string) => a.replace(/\/$/, '') === b.replace(/\/$/, '');

export interface OidcClient {
  /**
   * Where to send the browser to sign in; `state` comes back on the callback.
   * `appearance` rides along so the member server's page looks like this one.
   */
  authorizationUrl(state: string, appearance?: Appearance): Promise<string>;
  /** Trades the callback's code for who signed in. Throws SignInError when refused. */
  signIn(code: string): Promise<Session>;
  /** Where to send the browser to sign out of every service, or null if the server has none. */
  logoutUrl(): Promise<string | null>;
  /** Whether a front-channel logout's `iss` names this member server. */
  isIssuer(iss: string): boolean;
}

export function createOidcClient(oidc: OidcConfig): OidcClient {
  const redirectUri = new URL(CALLBACK_PATH, oidc.publicUrl).href;

  // Discovered once, on first use; a failed attempt is retried next time.
  let discovery: Promise<ReturnType<typeof discoveryValidator.parse>> | null = null;
  const discover = () => {
    discovery ??= (async () => {
      const base = oidc.issuer.endsWith('/') ? oidc.issuer : `${oidc.issuer}/`;
      const response = await fetch(new URL('.well-known/openid-configuration', base));
      if (!response.ok) throw new Error(`OIDC discovery failed: HTTP ${response.status}`);
      const document = discoveryValidator.parse(await response.json());
      if (!sameIssuer(document.issuer, oidc.issuer)) {
        throw new Error(`OIDC discovery names issuer ${document.issuer}, not ${oidc.issuer}`);
      }
      return document;
    })().catch((error: unknown) => {
      discovery = null;
      throw error;
    });
    return discovery;
  };

  return {
    async authorizationUrl(state, appearance = {}) {
      const url = new URL((await discover()).authorization_endpoint);
      url.searchParams.set('client_id', oidc.clientId);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', SCOPE);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('state', state);
      for (const [name, value] of Object.entries(appearanceParams(appearance))) {
        url.searchParams.set(name, value);
      }
      return url.href;
    },

    async signIn(code) {
      const { token_endpoint } = await discover();
      const credentials = `${encodeURIComponent(oidc.clientId)}:${encodeURIComponent(oidc.clientSecret)}`;
      const response = await fetch(token_endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: `Basic ${Buffer.from(credentials).toString('base64')}`,
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
        }),
      });
      // A code used twice, expired, or for someone else: the sign-in starts over.
      if (!response.ok) throw new SignInError(`token endpoint answered HTTP ${response.status}`);
      const { id_token: idToken } = (await response.json()) as { id_token?: unknown };
      if (typeof idToken !== 'string') throw new SignInError('no id_token');

      // Straight from the token endpoint, so the connection vouches for the
      // issuer (OIDC Core 3.1.3.7, step 6); the claims are still checked.
      const [, payload = ''] = idToken.split('.');
      let decoded: unknown;
      try {
        decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      } catch {
        throw new SignInError('malformed id_token');
      }
      const parsed = idTokenClaimsValidator.safeParse(decoded);
      if (!parsed.ok) throw new SignInError('id_token is missing claims');
      const claims = parsed.value;
      const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      if (!sameIssuer(claims.iss, oidc.issuer))
        throw new SignInError('id_token from another issuer');
      if (!audiences.includes(oidc.clientId)) throw new SignInError('id_token for another service');
      if (claims.exp * 1000 <= Date.now()) throw new SignInError('id_token expired');

      return {
        userId: claims.sub,
        displayName: claims.name ?? claims.sub,
        sid: claims.sid ?? null,
      };
    },

    async logoutUrl() {
      return (await discover()).end_session_endpoint ?? null;
    },

    isIssuer: (iss) => sameIssuer(iss, oidc.issuer),
  };
}
