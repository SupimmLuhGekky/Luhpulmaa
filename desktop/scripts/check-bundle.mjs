// @ts-check
import fs from "node:fs";
import path from "node:path";
import { binaryArchs, dirSize, findEnvFiles, formatBytes, packagedApp, step, target, walk } from "./lib.mjs";

/**
 * Sanity checks on the packaged app (run after packaging and again in CI):
 *  - no .env* file from the build machine anywhere in the bundle
 *  - the web server, database, migrations and app code are all present
 *  - every native binary runs natively on this architecture (on a Mac, an Intel-only
 *    binary in the Apple silicon app would need Rosetta)
 * @param {string} [appPath] defaults to the app built on this machine
 */
export function checkBundle(appPath) {
  const app = appPath ?? packagedApp().app;
  const { arch } = target();
  const resources = app.endsWith(".app") ? path.join(app, "Contents", "Resources") : path.join(app, "resources");
  step(`Checking ${app}`);
  const problems = [];
  const envFiles = findEnvFiles(app);
  if (envFiles.length) problems.push(`.env files must not be bundled:\n    ${envFiles.join("\n    ")}`);
  for (const rel of ["app.asar", "server/server.js", "server/.next/BUILD_ID", "server/.next/static", "postgres/bin/postgres", "postgres/bin/initdb", "postgres/share/postgresql/postgres.bki", "migrations", "build-info.json"]) {
    if (!fs.existsSync(path.join(resources, rel))) problems.push(`missing ${rel}`);
  }
  let binaries = 0;
  const foreign = [];
  for (const { path: p, entry } of walk(app)) {
    if (!entry.isFile()) continue;
    const archs = binaryArchs(p);
    if (!archs) continue;
    binaries += 1;
    if (!archs.includes(arch)) foreign.push(`${path.relative(app, p)} (${archs.join(", ")})`);
  }
  if (foreign.length) problems.push(`native binaries without ${arch} code:\n    ${foreign.join("\n    ")}`);
  if (problems.length) throw new Error(`Bundle check failed:\n  - ${problems.join("\n  - ")}`);
  console.info(`  ok: no .env files, all resources present, ${binaries} native binaries all ${arch}, ${formatBytes(dirSize(app))} on disk`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    checkBundle(process.argv[2]);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
