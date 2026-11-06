/**
 * Server configuration — every environment-dependent value enters the process
 * here, validated once at boot. Switching local/development/production is a
 * pure configuration change (.env file or environment variables); no code
 * changes are ever required. Secrets are only ever read from the environment
 * and must never be committed (see .env.example).
 */
import { s, toValidator, type Infer } from '@shared/validation';

const configValidator = toValidator(
  s.object({
    appEnv: s._default(s.enum(['local', 'development', 'production']), 'local'),
    port: s._default(s.int().check(s.gte(0), s.lte(65535)), 3000),
    /** `memory` runs without any external service — used by tests and quick hacking. */
    dbDriver: s._default(s.enum(['postgres', 'memory']), 'postgres'),
    databaseUrl: s.optional(s.string().check(s.minLength(1))),
    /** Explicit CORS allowlist; empty means same-origin only. */
    corsOrigins: s._default(s.array(s.string().check(s.minLength(1))), []),
    /** Cross-instance pub/sub driver; switch to `redis` when scaling horizontally. */
    pubsubDriver: s._default(s.enum(['memory', 'redis']), 'memory'),
    redisUrl: s.optional(s.string().check(s.minLength(1))),
    /** `web` = HTTP only, `worker` = background jobs only, `all` = both. */
    serverRole: s._default(s.enum(['web', 'worker', 'all']), 'all'),
    shutdownDrainMs: s._default(s.int().check(s.gte(0), s.lte(60_000)), 3000),
    /**
     * How requests sign in: `none` = no sign-in at all (/api/auth is not
     * mounted), `oidc` = through the member server, which signs members in
     * for every service with OpenID Connect (CLAUDE.md).
     */
    authDriver: s._default(s.enum(['none', 'oidc']), 'none'),
    /** Present exactly when AUTH_DRIVER=oidc (see .env.example). */
    oidc: s.optional(
      s.object({
        /** The member server's issuer; its discovery document says the rest. */
        issuer: s.url(),
        /** This service's id at the member server: its subdomain, and its cookies' suffix. */
        clientId: s.string().check(s.minLength(1), s.maxLength(63), s.regex(/^[a-z0-9-]+$/)),
        clientSecret: s.string().check(s.minLength(1)),
        /** Where browsers reach this service; the sign-in callback lives under it. */
        publicUrl: s.url(),
        /** Signs the session cookie. Long and random, and never committed. */
        sessionSecret: s.string().check(s.minLength(32)),
      }),
    ),
  }),
);

export type ServerConfig = Infer<typeof configValidator>;

function numberOrUndefined(value: string | undefined): number | undefined {
  return value === undefined || value === '' ? undefined : Number(value);
}

/** What AUTH_DRIVER=oidc needs; values must match this service's entry on the member server. */
const OIDC_ENV = [
  'OIDC_ISSUER',
  'OIDC_CLIENT_ID',
  'OIDC_CLIENT_SECRET',
  'PUBLIC_URL',
  'SESSION_SECRET',
] as const;

export function loadServerConfig(
  env: Record<string, string | undefined> = process.env,
): ServerConfig {
  if (env.AUTH_DRIVER === 'dev') {
    throw new Error(
      'AUTH_DRIVER=dev was removed: members sign in through the member server (AUTH_DRIVER=oidc). See docs/upgrade-guides/2026-10-oidc-sign-in.md',
    );
  }
  const oidc = env.AUTH_DRIVER === 'oidc';
  if (oidc) {
    const missing = OIDC_ENV.filter((name) => !env[name]);
    if (missing.length > 0) {
      throw new Error(`${missing.join(', ')} required when AUTH_DRIVER=oidc`);
    }
  }

  const config = configValidator.parse({
    appEnv: env.APP_ENV,
    port: numberOrUndefined(env.PORT),
    dbDriver: env.DB_DRIVER,
    databaseUrl: env.DATABASE_URL,
    corsOrigins: (env.CORS_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    pubsubDriver: env.PUBSUB_DRIVER,
    redisUrl: env.REDIS_URL,
    serverRole: env.SERVER_ROLE,
    shutdownDrainMs: numberOrUndefined(env.SHUTDOWN_DRAIN_MS),
    authDriver: env.AUTH_DRIVER,
    oidc: oidc
      ? {
          issuer: env.OIDC_ISSUER,
          clientId: env.OIDC_CLIENT_ID,
          clientSecret: env.OIDC_CLIENT_SECRET,
          publicUrl: env.PUBLIC_URL,
          sessionSecret: env.SESSION_SECRET,
        }
      : undefined,
  });

  if (config.dbDriver === 'postgres' && !config.databaseUrl) {
    throw new Error('DATABASE_URL is required when DB_DRIVER=postgres');
  }
  if (config.pubsubDriver === 'redis' && !config.redisUrl) {
    throw new Error('REDIS_URL is required when PUBSUB_DRIVER=redis');
  }
  return config;
}
