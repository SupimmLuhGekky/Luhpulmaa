// @ts-check
import fs from "node:fs";
import path from "node:path";
import { dirSize, findEnvFiles, formatBytes, packagedApp, step } from "./lib.mjs";

/**
 * Sanity checks on the packaged app (run after packaging and again in CI):
 *  - no .env* file from the build machine anywhere in the bundle
 *  - the web server, database, migrations and app code are all present
 * @param {string} [appPath] defaults to the app built on this machine
 */
export function checkBundle(appPath) {
  const app = appPath ?? packagedApp().app;
  const resources = app.endsWith(".app") ? path.join(app, "Contents", "Resources") : path.join(app, "resources");
  step(`Checking ${app}`);
  const problems = [];
  const envFiles = findEnvFiles(app);
  if (envFiles.length) problems.push(`.env files must not be bundled:\n    ${envFiles.join("\n    ")}`);
  for (const rel of ["app.asar", "server/server.js", "server/.next/BUILD_ID", "server/.next/static", "postgres/bin/postgres", "postgres/bin/initdb", "postgres/share/postgresql/postgres.bki", "migrations", "build-info.json"]) {
    if (!fs.existsSync(path.join(resources, rel))) problems.push(`missing ${rel}`);
  }
  if (problems.length) throw new Error(`Bundle check failed:\n  - ${problems.join("\n  - ")}`);
  console.info(`  ok: no .env files, all resources present, ${formatBytes(dirSize(app))} on disk`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    checkBundle(process.argv[2]);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
