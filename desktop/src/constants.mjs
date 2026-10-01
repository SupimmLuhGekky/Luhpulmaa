// @ts-check
/** Values shared by the Harbour desktop shell. Nothing here is secret. */

export const APP_NAME = "Harbour";

/** GitHub repository that publishes the desktop releases (tags `desktop-v<version>`). */
export const GITHUB_REPO = "SupimmLuhGekky/Luhpulmaa";
export const RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases`;
export const RELEASE_TAG_PREFIX = "desktop-v";

/** The local web server prefers this port so the app keeps the same origin between launches. */
export const PREFERRED_SERVER_PORT = 47800;
export const LOOPBACK_HOST = "127.0.0.1";

/** First page the window opens. Signed-out users are redirected to /sign-in by the app. */
export const START_PATH = "/dashboard";

/** PostgreSQL major version bundled with this build. A cluster from another major version needs an upgrade path. */
export const POSTGRES_MAJOR = "16";
/** Bootstrap superuser, used only by the desktop shell to create the app role and database. */
export const DB_ADMIN_USER = "postgres";
/** Unprivileged role that owns the app's database; the web server connects as this role. */
export const DB_APP_USER = "harbour";
export const DB_NAME = "harbour";

/** Daily jobs run shortly after startup and then on this interval while the app is open. */
export const DAILY_JOBS_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const DAILY_JOBS_FIRST_RUN_DELAY_MS = 15 * 1000;

export const TIMEOUTS = {
  /** initdb on a cold disk; usually a few seconds. */
  initdbMs: 120_000,
  /** Database start, including crash recovery after an unclean shutdown. */
  postgresStartMs: 180_000,
  postgresStopMs: 30_000,
  /** Next.js server start until /api/health answers { ok: true }. */
  serverHealthMs: 90_000,
  serverStopMs: 10_000,
  /** Upper bound for the whole quit sequence so a stuck child can never block logout. */
  shutdownMs: 45_000,
  /** Whole smoke test, from launch to screenshot. */
  smokeTestMs: 300_000,
};
