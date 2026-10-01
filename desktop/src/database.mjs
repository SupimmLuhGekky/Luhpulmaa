// @ts-check
import pg from "pg";
import { DB_ADMIN_USER, DB_APP_USER, DB_NAME, LOOPBACK_HOST } from "./constants.mjs";
import { scramSha256Verifier } from "./scram.mjs";
import { registerSecret } from "./logger.mjs";

/**
 * @typedef {import("./secrets.mjs").Secrets} Secrets
 * @typedef {import("./logger.mjs").Logger} Logger
 */

/**
 * @param {{ port: number, user: string, password: string, database: string }} options
 */
export async function connect(options) {
  const client = new pg.Client({
    host: LOOPBACK_HOST,
    port: options.port,
    user: options.user,
    password: options.password,
    database: options.database,
    connectionTimeoutMillis: 10_000,
    application_name: "harbour-desktop",
  });
  await client.connect();
  return client;
}

/** SCRAM verifier for a password; also registered for log redaction. */
export function verifierFor(/** @type {string} */ password) {
  const verifier = scramSha256Verifier(password);
  registerSecret(verifier);
  return verifier;
}

/**
 * Makes sure the unprivileged app role and the app database exist. The web server
 * connects as that role, so SQL it runs can never use superuser-only features.
 * @param {{ port: number, secrets: Secrets, log: Logger, resetAppPassword?: boolean }} options
 */
export async function ensureAppDatabase({ port, secrets, log, resetAppPassword = false }) {
  const admin = await connect({ port, user: DB_ADMIN_USER, password: secrets.dbAdminPassword, database: "postgres" });
  try {
    const role = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [DB_APP_USER]);
    const ident = pg.escapeIdentifier(DB_APP_USER);
    if (role.rowCount === 0) {
      await admin.query(
        `CREATE ROLE ${ident} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${pg.escapeLiteral(verifierFor(secrets.dbPassword))}`,
      );
      log.info(`Created database role "${DB_APP_USER}".`);
    } else if (resetAppPassword) {
      await admin.query(`ALTER ROLE ${ident} WITH LOGIN PASSWORD ${pg.escapeLiteral(verifierFor(secrets.dbPassword))}`);
      log.info(`Updated the password of database role "${DB_APP_USER}".`);
    }
    const db = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [DB_NAME]);
    if (db.rowCount === 0) {
      await admin.query(
        `CREATE DATABASE ${pg.escapeIdentifier(DB_NAME)} WITH OWNER ${ident} TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`,
      );
      log.info(`Created database "${DB_NAME}".`);
    }
  } finally {
    await admin.end().catch(() => {});
  }
}

/** Connection string the web server uses (Prisma format). */
export function appDatabaseUrl(/** @type {number} */ port, /** @type {Secrets} */ secrets) {
  const url = `postgresql://${DB_APP_USER}:${encodeURIComponent(secrets.dbPassword)}@${LOOPBACK_HOST}:${port}/${DB_NAME}?schema=public`;
  registerSecret(url);
  return url;
}
