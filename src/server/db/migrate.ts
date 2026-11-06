/**
 * SQL-file migration runner (Flyway-style, zero dependencies).
 *
 * - Migrations are plain SQL files in ./migrations, named `NNNN_name.sql`,
 *   applied in lexicographic order and recorded in `schema_migrations`.
 * - Schema history therefore lives in git; a fresh clone reaches the latest
 *   schema with a single `bun run db:setup`.
 * - A Postgres advisory lock makes concurrent runs safe (e.g. several
 *   instances starting at once during a rolling deploy).
 * - A migration is known by its number alone, so two files sharing a number,
 *   or a file whose number was recorded under another name, stop the run
 *   instead of being skipped in silence (`planMigrations`). That is what a
 *   project started from this boilerplate hits when an upstream update brings
 *   a number it already used — the fix is renumbering the incoming file.
 */
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { SQL } from 'bun';

const MIGRATION_LOCK_KEY = 727_274; // arbitrary app-wide advisory lock id

export interface AppliedMigration {
  version: string;
  name: string;
}

/**
 * The migrations still to apply, in order: the files whose number is not
 * recorded yet. Throws when a number is ambiguous — two files share it, or it
 * was recorded under a different name — since applying either or skipping
 * both would silently leave the schema wrong.
 */
export function planMigrations(
  files: readonly string[],
  applied: ReadonlyMap<string, string>,
): (AppliedMigration & { file: string })[] {
  const byVersion = new Map<string, string>();
  const pending: (AppliedMigration & { file: string })[] = [];
  for (const file of [...files].filter((f) => /^\d+_.+\.sql$/.test(f)).sort()) {
    const [version = ''] = file.split('_', 1);
    const name = file.replace(/\.sql$/, '');
    const other = byVersion.get(version);
    if (other !== undefined) {
      throw new Error(
        `Migrations ${other}.sql and ${file} share the number ${version}. Renumber the newer one to the next free number.`,
      );
    }
    byVersion.set(version, name);
    const recorded = applied.get(version);
    if (recorded === undefined) pending.push({ version, name, file });
    else if (recorded !== name) {
      throw new Error(
        `Migration ${version} is recorded as "${recorded}" but the file is ${file}. If ${file} is new (e.g. from an upstream update), renumber it to the next free number.`,
      );
    }
  }
  return pending;
}

export async function migrate(sql: SQL, migrationsDir: string): Promise<AppliedMigration[]> {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     text PRIMARY KEY,
      name        text NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `;

  await sql`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})`;
  try {
    const appliedRows = await sql<{ version: string; name: string }[]>`
      SELECT version, name FROM schema_migrations
    `;
    const applied = new Map(appliedRows.map((row) => [row.version, row.name]));

    const newlyApplied: AppliedMigration[] = [];
    for (const { version, name, file } of planMigrations(await readdir(migrationsDir), applied)) {
      const body = await Bun.file(join(migrationsDir, file)).text();
      // Each migration runs in its own transaction: it fully applies or not at all.
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`INSERT INTO schema_migrations (version, name) VALUES (${version}, ${name})`;
      });
      newlyApplied.push({ version, name });
    }
    return newlyApplied;
  } finally {
    await sql`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`;
  }
}
