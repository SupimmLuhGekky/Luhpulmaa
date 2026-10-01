// @ts-check
import os from "node:os";
import { DB_ADMIN_USER, DB_APP_USER, DB_NAME, LOOPBACK_HOST, PREFERRED_SERVER_PORT } from "./constants.mjs";
import { appDatabaseUrl, connect, ensureAppDatabase, verifierFor } from "./database.mjs";
import { applyMigrations, readMigrations } from "./migrate.mjs";
import { getFreePort, isPortFree } from "./net-utils.mjs";
import { LocalPostgres, PostgresError } from "./postgres.mjs";
import { createSecrets, loadSecrets, replaceUnreadableSecrets } from "./secrets.mjs";
import { NextServer, ServerError } from "./server.mjs";
import { readUserEnv } from "./userenv.mjs";

/**
 * Boot sequence:
 *   1. keys: load from the Keychain, or generate on first launch
 *   2. database: initdb on first launch, then start PostgreSQL on a free loopback port
 *   3. app role + database, then pending migrations (Prisma-compatible bookkeeping)
 *   4. web server: Next.js standalone in a utility process on 127.0.0.1:47800 (or a free port)
 *   5. wait for GET /api/health → { ok: true }
 *
 * Components are recorded in `components` as soon as they start, so the caller can stop
 * whatever is running if a later step fails or the user quits mid-boot.
 *
 * @typedef {import("./paths.mjs").AppPaths} AppPaths
 * @typedef {import("./logger.mjs").Logger} Logger
 * @typedef {import("./secrets.mjs").Secrets} Secrets
 * @typedef {{ postgres: LocalPostgres | null, server: NextServer | null }} Components
 */

export class BootAborted extends Error {
  constructor() {
    super("Startup was cancelled because Harbour is quitting.");
    this.name = "BootAborted";
  }
}

/**
 * @param {{
 *   paths: AppPaths,
 *   log: Logger,
 *   components: Components,
 *   onStatus: (text: string) => void,
 *   signal: AbortSignal,
 *   replaceKeys?: boolean,
 * }} ctx
 * @returns {Promise<{ secrets: Secrets, baseUrl: string, firstLaunch: boolean }>}
 */
export async function boot(ctx) {
  const { paths, log, components, onStatus, signal } = ctx;
  const checkpoint = () => {
    if (signal.aborted) throw new BootAborted();
  };

  // 1. Keys
  onStatus("Unlocking your data…");
  const postgres = new LocalPostgres({ installDir: paths.postgresDir, dataDir: paths.databaseDir, log });
  postgres.assertRunnable();
  const clusterExists = postgres.isInitialized();
  let created = false;
  let loaded = ctx.replaceKeys ? null : loadSecrets(paths.dataDir, log);
  if (ctx.replaceKeys) {
    loaded = replaceUnreadableSecrets(paths.dataDir, log);
    created = true;
  } else if (!loaded) {
    loaded = createSecrets(paths.dataDir, log);
    created = true;
    if (clusterExists) log.warn("Keys were missing but a database exists; creating new keys and resetting the database passwords.");
  }
  const { secrets } = loaded;
  const resetPasswords = created && clusterExists;
  checkpoint();

  // 2. Database cluster
  if (!clusterExists) {
    onStatus("Setting up Harbour for the first time…");
    await postgres.initCluster({ adminUser: DB_ADMIN_USER, adminPasswordVerifier: verifierFor(secrets.dbAdminPassword) });
  } else if (resetPasswords) {
    onStatus("Updating your database keys…");
    postgres.checkVersion();
    await postgres.resetPasswords([{ role: DB_ADMIN_USER, verifier: verifierFor(secrets.dbAdminPassword) }]);
  }
  checkpoint();

  onStatus("Starting the database…");
  components.postgres = postgres;
  let dbPort = 0;
  for (let attempt = 1; ; attempt += 1) {
    dbPort = await getFreePort();
    try {
      await postgres.start(dbPort);
      break;
    } catch (err) {
      if (err instanceof PostgresError && err.code === "PORT_IN_USE" && attempt < 3) {
        log.warn(`Database port ${dbPort} was taken; retrying with another port.`);
        continue;
      }
      throw err;
    }
  }
  checkpoint();

  // 3. Role, database and migrations
  onStatus("Checking your database…");
  await ensureAppDatabase({ port: dbPort, secrets, log, resetAppPassword: resetPasswords });
  const migrations = readMigrations(paths.migrationsDir);
  const client = await connect({ port: dbPort, user: DB_APP_USER, password: secrets.dbPassword, database: DB_NAME });
  try {
    const { applied } = await applyMigrations({ client, migrations, log });
    log.info(applied.length ? `Database upgraded (${applied.length} migration(s)).` : `Database is up to date (${migrations.length} migration(s)).`);
  } finally {
    await client.end().catch(() => {});
  }
  checkpoint();

  // 4–5. Web server
  onStatus("Starting Harbour…");
  const userEnv = readUserEnv(paths.userEnvFile, log);
  const databaseUrl = appDatabaseUrl(dbPort, secrets);
  for (let attempt = 1; ; attempt += 1) {
    const port = attempt === 1 && (await isPortFree(PREFERRED_SERVER_PORT)) ? PREFERRED_SERVER_PORT : await getFreePort();
    if (port !== PREFERRED_SERVER_PORT) log.warn(`Port ${PREFERRED_SERVER_PORT} is busy; using ${port} instead.`);
    const server = new NextServer({ serverDir: paths.serverDir, port, log, env: serverEnv({ port, databaseUrl, secrets, userEnv }) });
    components.server = server;
    try {
      await server.start();
      return { secrets, baseUrl: server.baseUrl, firstLaunch: !clusterExists };
    } catch (err) {
      if (err instanceof ServerError && err.code === "PORT_IN_USE" && attempt < 3) {
        log.warn(`Web server port ${port} was taken; retrying with another port.`);
        continue;
      }
      throw err;
    }
  }
}

/**
 * Environment of the web server process. Built from scratch: the user's shell
 * environment is not inherited, and harbour.env can only add allow-listed keys.
 * @param {{ port: number, databaseUrl: string, secrets: Secrets, userEnv: Record<string, string> }} options
 * @returns {Record<string, string>}
 */
export function serverEnv({ port, databaseUrl, secrets, userEnv }) {
  /** @type {Record<string, string>} */
  const passthrough = {};
  for (const key of ["LANG", "LC_ALL", "TZ"]) {
    const value = process.env[key];
    if (value) passthrough[key] = value;
  }
  return {
    ...userEnv,
    ...passthrough,
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    HOME: os.homedir(),
    TMPDIR: os.tmpdir(),
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    HOSTNAME: LOOPBACK_HOST,
    PORT: String(port),
    APP_URL: `http://${LOOPBACK_HOST}:${port}`,
    DATABASE_URL: databaseUrl,
    AUTH_SECRET: secrets.authSecret,
    ENCRYPTION_KEY: secrets.encryptionKey,
    CRON_SECRET: secrets.cronSecret,
    DEMO_MODE: "true",
    HARBOUR_DESKTOP: "true",
  };
}
