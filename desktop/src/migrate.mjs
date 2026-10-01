// @ts-check
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Applies prisma/migrations/<name>/migration.sql in order, recording them in the same
 * `_prisma_migrations` table (and checksum format) as `prisma migrate deploy`, so either
 * tool can take over from the other. Each migration runs in a transaction together with
 * its bookkeeping row, so a failure leaves the database exactly as it was before.
 *
 * @typedef {{ name: string, sql: string, checksum: string }} Migration
 * @typedef {{ query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> }} Queryable
 */

/** Advisory lock key used by Prisma Migrate, so concurrent runs of either tool serialise. */
export const PRISMA_MIGRATE_LOCK = 72707369;

export const CREATE_MIGRATIONS_TABLE = `CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id"                    VARCHAR(36) PRIMARY KEY NOT NULL,
    "checksum"              VARCHAR(64) NOT NULL,
    "finished_at"           TIMESTAMPTZ,
    "migration_name"        VARCHAR(255) NOT NULL,
    "logs"                  TEXT,
    "rolled_back_at"        TIMESTAMPTZ,
    "started_at"            TIMESTAMPTZ NOT NULL DEFAULT now(),
    "applied_steps_count"   INTEGER NOT NULL DEFAULT 0
)`;

export class MigrationError extends Error {
  /**
   * @param {string} message
   * @param {{ cause?: unknown, migration?: string }} [options]
   */
  constructor(message, options) {
    super(message, options);
    this.name = "MigrationError";
    this.migration = options?.migration;
  }
}

/** sha256 of the file's bytes, lower-case hex: the checksum Prisma stores. */
export function checksumOf(/** @type {Buffer | string} */ content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Reads migrations from a prisma/migrations-style folder, sorted by directory name.
 * @param {string} dir
 * @returns {Migration[]}
 */
export function readMigrations(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => {
      const file = path.join(dir, name, "migration.sql");
      if (!fs.existsSync(file)) throw new MigrationError(`Migration ${name} has no migration.sql.`, { migration: name });
      const bytes = fs.readFileSync(file);
      return { name, sql: bytes.toString("utf8"), checksum: checksumOf(bytes) };
    });
}

/**
 * @param {{ client: Queryable, migrations: Migration[], log: { info: (m: string) => void, warn: (m: string) => void } }} options
 * @returns {Promise<{ applied: string[] }>}
 */
export async function applyMigrations({ client, migrations, log }) {
  /** @type {string[]} */
  const applied = [];
  await client.query("SELECT pg_advisory_lock($1)", [PRISMA_MIGRATE_LOCK]);
  try {
    await client.query(CREATE_MIGRATIONS_TABLE);
    const { rows } = await client.query(
      'SELECT "id", "checksum", "migration_name", "finished_at", "rolled_back_at" FROM "_prisma_migrations" ORDER BY "started_at" ASC',
    );
    const known = new Set(migrations.map((m) => m.name));
    const unknown = [...new Set(rows.filter((r) => r.rolled_back_at === null && !known.has(r.migration_name)).map((r) => r.migration_name))];
    if (unknown.length) {
      log.warn(`The database has migrations this version of Harbour does not know (${unknown.join(", ")}); was a newer version used before?`);
    }

    for (const migration of migrations) {
      const attempts = rows.filter((r) => r.migration_name === migration.name && r.rolled_back_at === null);
      const done = attempts.find((r) => r.finished_at !== null);
      if (done) {
        if (done.checksum !== migration.checksum) log.warn(`Migration ${migration.name} was modified after it was applied (checksum differs).`);
        continue;
      }
      if (attempts.length) {
        throw new MigrationError(
          `Migration ${migration.name} failed in an earlier run and was not resolved. ` +
            "Resolve it with `prisma migrate resolve` before starting Harbour.",
          { migration: migration.name },
        );
      }
      const id = crypto.randomUUID();
      await client.query("BEGIN");
      try {
        await client.query(
          'INSERT INTO "_prisma_migrations" ("id", "checksum", "migration_name", "started_at", "applied_steps_count") VALUES ($1, $2, $3, now(), 0)',
          [id, migration.checksum, migration.name],
        );
        // No parameters: sent as one simple-protocol query, exactly like Prisma runs migration scripts.
        await client.query(migration.sql);
        await client.query('UPDATE "_prisma_migrations" SET "finished_at" = now(), "applied_steps_count" = 1 WHERE "id" = $1', [id]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw new MigrationError(`Migration ${migration.name} failed: ${err instanceof Error ? err.message : String(err)}`, {
          cause: err,
          migration: migration.name,
        });
      }
      applied.push(migration.name);
      log.info(`Applied database migration ${migration.name}.`);
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [PRISMA_MIGRATE_LOCK]).catch(() => {});
  }
  return { applied };
}
