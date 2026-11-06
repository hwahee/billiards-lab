/**
 * Request identity — the one place "who is calling" enters the server, and
 * where what each kind of caller may do is enforced.
 *
 * AUTH_DRIVER decides how a request proves who it is:
 *   - `none` — sign-in does not exist; cookies are ignored even if sent.
 *   - `oidc` — the member server signed the member in (./oidc.ts) and this
 *              service keeps who that was in its own session cookie, signed
 *              with SESSION_SECRET so nobody can write one by hand. The
 *              cookie holds who signed in — never a token (CLAUDE.md).
 *
 * Routes and services only ever read `ctx.caller` (src/server/http/context.ts).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import { s, toValidator } from '@shared/validation';

import type { ServerConfig } from '../config';
import { UnauthorizedError } from '../lib/errors';

type OidcConfig = NonNullable<ServerConfig['oidc']>;

/**
 * Who is calling:
 *   - `member` — signed in.
 *   - `guest`  — sign-in exists but this request is not signed in.
 *   - `anyone` — AUTH_DRIVER=none: sign-in does not exist, so there is no
 *                member/guest split to enforce.
 */
export type Caller =
  { kind: 'member'; userId: string; displayName: string } | { kind: 'guest' } | { kind: 'anyone' };

/** A member's sign-in, as this service keeps it. */
export interface Session {
  userId: string;
  displayName: string;
  /** The member server's session it came from — a front-channel logout names it. */
  sid: string | null;
}

/** A sign-in on its way through the member server: checked when it comes back. */
export interface PendingSignIn {
  state: string;
  /** Where on this service to land afterwards (a path, never another site). */
  returnTo: string;
}

const sessionValidator = toValidator(
  s.strictObject({
    userId: s.string().check(s.minLength(1)),
    displayName: s.string(),
    sid: s.nullable(s.string()),
  }),
);
const pendingSignInValidator = toValidator(
  s.strictObject({ state: s.string().check(s.minLength(1)), returnTo: s.string() }),
);

/**
 * Cookie names carry the service id: on localhost every service shares one
 * cookie jar (ports don't separate cookies), and a member signs in to each
 * service separately.
 */
const sessionCookieName = (oidc: OidcConfig) => `session-${oidc.clientId}`;
const signInCookieName = (oidc: OidcConfig) => `sign-in-${oidc.clientId}`;

/** `payload.mac`; the purpose is part of the MAC, so one cookie can't pass for the other. */
function sign(purpose: string, value: unknown, secret: string): string {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${payload}.${mac(purpose, payload, secret).toString('base64url')}`;
}

function mac(purpose: string, payload: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(`${purpose}.${payload}`).digest();
}

/** The signed value, or null when it is missing, malformed or not signed by us. */
function unsign(purpose: string, token: string | null, secret: string): unknown {
  if (!token) return null;
  const [payload = '', given = ''] = token.split('.');
  const expected = mac(purpose, payload, secret);
  const actual = Buffer.from(given, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown;
  } catch {
    return null;
  }
}

function cookieFrom(req: Request, name: string): string | null {
  const header = req.headers.get('cookie');
  return header ? new Bun.CookieMap(header).get(name) : null;
}

const cookieOptions = (oidc: OidcConfig) => ({
  httpOnly: true, // page scripts never see it
  sameSite: 'lax' as const,
  secure: new URL(oidc.publicUrl).protocol === 'https:',
});

/** The session this request carries, or null (none, or not one we signed). */
export function readSession(req: Request, oidc: OidcConfig): Session | null {
  const value = unsign('session', cookieFrom(req, sessionCookieName(oidc)), oidc.sessionSecret);
  const parsed = sessionValidator.safeParse(value);
  return parsed.ok ? parsed.value : null;
}

export function readCaller(
  req: Request,
  config: Pick<ServerConfig, 'authDriver' | 'oidc'>,
): Caller {
  if (config.authDriver === 'none' || !config.oidc) return { kind: 'anyone' };
  const session = readSession(req, config.oidc);
  return session
    ? { kind: 'member', userId: session.userId, displayName: session.displayName }
    : { kind: 'guest' };
}

/**
 * Guards an action whose result still means something after the visitor
 * leaves (a saved todo, a setting): members only (CLAUDE.md). Actions that
 * only mean something while the visitor is here stay open to guests.
 * Throws UnauthorizedError (→ 401) for a guest.
 */
export function requireMember(caller: Caller): void {
  if (caller.kind === 'guest') throw new UnauthorizedError();
}

/** Signs the response's browser in for as long as the browser stays open. */
export function setSessionCookie(req: Bun.BunRequest, oidc: OidcConfig, session: Session): void {
  req.cookies.set(sessionCookieName(oidc), sign('session', session, oidc.sessionSecret), {
    ...cookieOptions(oidc),
    path: '/',
  });
}

export function clearSessionCookie(req: Bun.BunRequest, oidc: OidcConfig): void {
  req.cookies.delete({ name: sessionCookieName(oidc), path: '/' });
}

/** A `Cookie` header value carrying `session` — what a signed-in browser sends (tests). */
export function sessionCookieHeader(oidc: OidcConfig, session: Session): string {
  return `${sessionCookieName(oidc)}=${sign('session', session, oidc.sessionSecret)}`;
}

const SIGN_IN_PATH = '/api/auth';
/** A sign-in that is not back within this long starts over. */
const SIGN_IN_MAX_AGE_S = 10 * 60;

export function setSignInCookie(req: Bun.BunRequest, oidc: OidcConfig, pending: PendingSignIn) {
  req.cookies.set(signInCookieName(oidc), sign('sign-in', pending, oidc.sessionSecret), {
    ...cookieOptions(oidc),
    path: SIGN_IN_PATH,
    maxAge: SIGN_IN_MAX_AGE_S,
  });
}

/** The pending sign-in, used up: it is cleared whether or not it checks out. */
export function takeSignInCookie(req: Bun.BunRequest, oidc: OidcConfig): PendingSignIn | null {
  const value = unsign('sign-in', cookieFrom(req, signInCookieName(oidc)), oidc.sessionSecret);
  req.cookies.delete({ name: signInCookieName(oidc), path: SIGN_IN_PATH });
  const parsed = pendingSignInValidator.safeParse(value);
  return parsed.ok ? parsed.value : null;
}
