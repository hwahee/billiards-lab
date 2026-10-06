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
    port: s._default(s.int().check(s.gte(0), s.lte(65535)), 3001),
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
  }),
);

export type ServerConfig = Infer<typeof configValidator>;

function numberOrUndefined(value: string | undefined): number | undefined {
  return value === undefined || value === '' ? undefined : Number(value);
}

export function loadServerConfig(
  env: Record<string, string | undefined> = process.env,
): ServerConfig {
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
  });

  if (config.dbDriver === 'postgres' && !config.databaseUrl) {
    throw new Error('DATABASE_URL is required when DB_DRIVER=postgres');
  }
  if (config.pubsubDriver === 'redis' && !config.redisUrl) {
    throw new Error('REDIS_URL is required when PUBSUB_DRIVER=redis');
  }
  return config;
}
