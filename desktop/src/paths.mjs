// @ts-check
import path from "node:path";
import { app } from "electron";

/**
 * Where things live.
 *
 * Data (kept across app updates), in the shell's userData folder,
 * `~/Library/Application Support/Harbour` on a Mac:
 *   database/        PostgreSQL cluster
 *   logs/            main.log, server.log, postgres.log (rotated)
 *   secrets.enc      generated keys, encrypted with the macOS Keychain
 *   harbour.env      optional user settings (see docs/DESKTOP.md)
 *   window-state.json
 *   session/         browser storage (cookies, cache)
 *
 * Program files (replaced by app updates), in the app bundle's Resources folder:
 *   server/ (Next.js standalone build), postgres/ (PostgreSQL 16), migrations/
 */
export function resolvePaths() {
  const dataDir = app.getPath("userData");
  const resourcesDir = app.isPackaged ? process.resourcesPath : path.resolve(import.meta.dirname, "..", "out", "resources");
  return {
    dataDir,
    logsDir: path.join(dataDir, "logs"),
    databaseDir: path.join(dataDir, "database"),
    userEnvFile: path.join(dataDir, "harbour.env"),
    windowStateFile: path.join(dataDir, "window-state.json"),
    resourcesDir,
    serverDir: path.join(resourcesDir, "server"),
    postgresDir: path.join(resourcesDir, "postgres"),
    migrationsDir: path.join(resourcesDir, "migrations"),
    linuxIcon: path.join(resourcesDir, "icon.png"),
  };
}

/** @typedef {ReturnType<typeof resolvePaths>} AppPaths */
