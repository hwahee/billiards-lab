/**
 * /api/auth — signing in and out through the member server (OIDC), and who
 * is signed in here.
 *
 * Mounted only with AUTH_DRIVER=oidc (see app.ts); with `none` these paths
 * answer the JSON 404 of the /api/* fallback. The browser comes to the
 * sign-in and sign-out paths by navigating, so they answer with redirects;
 * a sign-in that cannot finish lands on /sign-in-failed.
 */
import { appearanceFromParams } from '@shared/domain/appearance';
import type { User } from '@shared/domain/user';

import {
  clearSessionCookie,
  readSession,
  setSessionCookie,
  setSignInCookie,
  takeSignInCookie,
} from '../auth/session';
import type { Container } from '../container';
import { UnauthorizedError } from '../lib/errors';
import { apiRoute, json, type HttpDeps } from '../http/respond';

/** Plain-path routes (no `:params`), so their requests type as `BunRequest<string>`. */
type AuthRoutes = Record<
  string,
  Record<string, (req: Bun.BunRequest<string>) => Promise<Response>>
>;

/** Where a sign-in that cannot finish sends the browser (a client page). */
const SIGN_IN_FAILED = '/sign-in-failed';

/** A browser redirect. Built by hand: `Response.redirect` freezes its headers. */
function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

/**
 * A path on this service to come back to; anything else is home. Resolved the
 * way a browser resolves a Location, so `//x`, `/\x` or a tab after the first
 * slash cannot point at another site.
 */
function returnPath(value: string | null): string {
  if (!value?.startsWith('/')) return '/';
  const here = 'http://service.invalid';
  const url = new URL(value, here);
  return url.origin === here ? url.pathname + url.search + url.hash : '/';
}

export function authRoutes(container: Container, deps: HttpDeps): AuthRoutes {
  const { oidc } = container.config;
  if (!oidc) throw new Error('AUTH_DRIVER=oidc is not configured');
  const client = () => container.oidcClient();

  /** Runs a step the browser navigated to; anything going wrong lands on SIGN_IN_FAILED. */
  const navigation = async (step: string, run: () => Promise<Response>): Promise<Response> => {
    try {
      return await run();
    } catch (error) {
      deps.log.warn('sign-in step failed', { step, error: String(error) });
      return redirect(SIGN_IN_FAILED);
    }
  };

  return {
    '/api/auth/login': apiRoute<'/api/auth/login'>(
      {
        /**
         * GET ?returnTo=/path&theme&design&ui_locales → the member server's
         * sign-in, looking like the page it started on, then back to `returnTo`
         */
        GET: (req) =>
          navigation('login', async () => {
            const params = new URL(req.url).searchParams;
            const state = crypto.randomUUID();
            const returnTo = returnPath(params.get('returnTo'));
            setSignInCookie(req, oidc, { state, returnTo });
            return redirect(await client().authorizationUrl(state, appearanceFromParams(params)));
          }),
      },
      deps,
    ),

    '/api/auth/callback': apiRoute<'/api/auth/callback'>(
      {
        /** GET ?code&state (or ?error&state) — the member server's answer to a sign-in. */
        GET: (req) =>
          navigation('callback', async () => {
            const params = new URL(req.url).searchParams;
            const pending = takeSignInCookie(req, oidc);
            const code = params.get('code');
            // Turned down (`error`), expired, used twice, or not started from this browser.
            if (pending?.state !== params.get('state') || !code) {
              return redirect(SIGN_IN_FAILED);
            }
            setSessionCookie(req, oidc, await client().signIn(code));
            return redirect(pending.returnTo);
          }),
      },
      deps,
    ),

    '/api/auth/logout': apiRoute<'/api/auth/logout'>(
      {
        /**
         * GET → the member server, which confirms on its page and signs the
         * member out of every service (front-channel, below). This session is
         * left to that: cancelling there keeps the member signed in here too.
         */
        GET: (req) =>
          navigation('logout', async () => {
            const url = await client().logoutUrl();
            if (url) return redirect(url);
            // A member server without RP-initiated logout: sign out here at least.
            clearSessionCookie(req, oidc);
            return redirect('/');
          }),
      },
      deps,
    ),

    '/api/auth/frontchannel-logout': apiRoute<'/api/auth/frontchannel-logout'>(
      {
        /**
         * GET ?iss&sid — the member server, in a hidden frame on its sign-out
         * page, telling every service the member signed out. Only the session
         * it names ends here; a newer one stays.
         */
        GET: (req) => {
          const params = new URL(req.url).searchParams;
          const iss = params.get('iss');
          const sid = params.get('sid');
          const session = readSession(req, oidc);
          if (
            session &&
            (iss === null || client().isIssuer(iss)) &&
            (sid === null || session.sid === null || session.sid === sid)
          ) {
            clearSessionCookie(req, oidc);
          }
          return Promise.resolve(new Response(null, { headers: { 'cache-control': 'no-store' } }));
        },
      },
      deps,
    ),

    '/api/auth/me': apiRoute<'/api/auth/me'>(
      {
        /** GET /api/auth/me → User | 401 */
        GET: (_req, { caller }) => {
          if (caller.kind !== 'member') throw new UnauthorizedError();
          const me: User = { id: caller.userId, displayName: caller.displayName };
          return Promise.resolve(json(me));
        },
      },
      deps,
    ),
  };
}
