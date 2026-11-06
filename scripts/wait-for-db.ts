/** Blocks until Postgres accepts connections (used by `bun run db:setup`). */
import { SQL } from 'bun';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required (copy .env.example to .env first).');
  process.exit(1);
}

const DEADLINE_MS = 30_000;
/**
 * Rejected credentials never fix themselves by waiting. A container still
 * initializing refuses connections instead, so this means another Postgres
 * answered — usually one already published on the same host port.
 */
const AUTH_FAILURES = new Set(['28P01', '28000']);

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

const started = Date.now();

while (true) {
  const sql = new SQL(databaseUrl);
  try {
    await sql`SELECT 1`;
    await sql.close();
    console.log('Database is ready.');
    break;
  } catch (error) {
    await sql.close().catch(() => undefined);
    if (AUTH_FAILURES.has((error as { errno?: unknown }).errno as string)) {
      console.error(`The database refused the credentials in DATABASE_URL: ${describe(error)}`);
      console.error(
        'If another Postgres already uses that port, publish this one on a free port: set POSTGRES_PORT and the port in DATABASE_URL in .env, then run `bun run db:setup` again.',
      );
      process.exit(1);
    }
    if (Date.now() - started > DEADLINE_MS) {
      console.error(`Timed out waiting for the database. Last error: ${describe(error)}`);
      process.exit(1);
    }
    await Bun.sleep(500);
  }
}
