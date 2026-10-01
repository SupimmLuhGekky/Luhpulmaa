// @ts-check
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { LOOPBACK_HOST, PREFERRED_SERVER_PORT } from "../src/constants.mjs";
import { DESKTOP_DIR, REPO_ROOT, RESOURCES_DIR, desktopPackage, dirSize, findEnvFiles, formatBytes, run, step, target, walk } from "./lib.mjs";

/**
 * Assembles everything the app bundle carries besides Electron itself, in out/resources:
 *   server/      Next.js standalone output + .next/static + public
 *   postgres/    PostgreSQL 16 for this platform (bin, lib, share)
 *   migrations/  prisma/migrations/<name>/migration.sql
 *   build-info.json
 */

const PRISMA_ENGINE = {
  "darwin-arm64": /^libquery_engine-darwin-arm64\.dylib\.node$/,
  "darwin-x64": /^libquery_engine-darwin\.dylib\.node$/,
  "linux-x64": /^libquery_engine-.+\.so\.node$/,
  "linux-arm64": /^libquery_engine-.+\.so\.node$/,
};

/** @param {{ skipNext?: boolean }} [options] */
export async function assemble(options = {}) {
  const { platform, arch } = target();
  const { version, electronVersion } = desktopPackage();

  if (!options.skipNext) {
    step("Building the web app (Next.js standalone, HARBOUR_DESKTOP=1)");
    await run("npm", ["run", "build"], { env: nextBuildEnv() });
  }
  const standalone = path.join(REPO_ROOT, ".next", "standalone");
  if (!fs.existsSync(path.join(standalone, "server.js"))) {
    throw new Error("No standalone build found at .next/standalone. Run the build with HARBOUR_DESKTOP=1 (npm run desktop:build).");
  }

  step("Assembling resources");
  fs.rmSync(RESOURCES_DIR, { recursive: true, force: true });
  fs.mkdirSync(RESOURCES_DIR, { recursive: true });

  // Web server
  const serverDir = path.join(RESOURCES_DIR, "server");
  fs.cpSync(standalone, serverDir, { recursive: true, verbatimSymlinks: true });
  fs.cpSync(path.join(REPO_ROOT, ".next", "static"), path.join(serverDir, ".next", "static"), { recursive: true });
  if (fs.existsSync(path.join(REPO_ROOT, "public"))) fs.cpSync(path.join(REPO_ROOT, "public"), path.join(serverDir, "public"), { recursive: true });
  fs.rmSync(path.join(serverDir, ".next", "cache"), { recursive: true, force: true });
  // Next copies .env files from the build machine into the standalone folder; they must never ship.
  for (const file of findEnvFiles(serverDir)) {
    fs.rmSync(file, { recursive: true, force: true });
    console.info(`  removed ${path.relative(RESOURCES_DIR, file)}`);
  }
  const engineDir = path.join(serverDir, "node_modules", ".prisma", "client");
  const enginePattern = PRISMA_ENGINE[/** @type {keyof typeof PRISMA_ENGINE} */ (`${platform}-${arch}`)];
  const engines = fs.existsSync(engineDir) ? fs.readdirSync(engineDir).filter((f) => enginePattern.test(f)) : [];
  if (!engines.length) throw new Error(`The Prisma query engine for ${platform}-${arch} is missing from the standalone build (${engineDir}).`);
  console.info(`  server: ${formatBytes(dirSize(serverDir))} (Prisma engine ${engines.join(", ")})`);

  // PostgreSQL
  const pgPackage = path.join(DESKTOP_DIR, "node_modules", "@embedded-postgres", `${platform}-${arch}`);
  if (!fs.existsSync(path.join(pgPackage, "native", "bin", "postgres"))) {
    throw new Error(`@embedded-postgres/${platform}-${arch} is not installed. Run \`npm ci --prefix desktop\` on a ${platform}-${arch} machine.`);
  }
  const pgDir = path.join(RESOURCES_DIR, "postgres");
  fs.cpSync(path.join(pgPackage, "native"), pgDir, { recursive: true, verbatimSymlinks: true });
  restoreSymlinks(pgPackage, pgDir);
  // Development files (headers, static libraries, extension build system) are not needed at runtime.
  for (const rel of ["include", "lib/pkgconfig", "lib/postgresql/pgxs", "pg-symlinks.json"]) fs.rmSync(path.join(pgDir, rel), { recursive: true, force: true });
  for (const { path: p, entry } of walk(path.join(pgDir, "lib"))) {
    if (entry.isFile() && p.endsWith(".a")) fs.rmSync(p);
  }
  if (platform === "darwin") thinUniversalBinaries(pgDir, arch);
  const pgVersion = execFileSync(path.join(pgDir, "bin", "postgres"), ["--version"], { encoding: "utf8" }).trim();
  if (!/\(PostgreSQL\) 16\./.test(pgVersion)) throw new Error(`Unexpected PostgreSQL version: ${pgVersion}`);
  console.info(`  postgres: ${pgVersion}, ${formatBytes(dirSize(pgDir))}`);

  // Migrations
  const migrationsSrc = path.join(REPO_ROOT, "prisma", "migrations");
  const migrationsDir = path.join(RESOURCES_DIR, "migrations");
  let count = 0;
  for (const entry of fs.readdirSync(migrationsSrc, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const sql = path.join(migrationsSrc, entry.name, "migration.sql");
    if (!fs.existsSync(sql)) throw new Error(`prisma/migrations/${entry.name} has no migration.sql`);
    fs.mkdirSync(path.join(migrationsDir, entry.name), { recursive: true });
    fs.copyFileSync(sql, path.join(migrationsDir, entry.name, "migration.sql"));
    count += 1;
  }
  console.info(`  migrations: ${count}`);

  // Build info (shown in logs; contains nothing secret)
  const commit = process.env.GITHUB_SHA ?? safeGit(["rev-parse", "HEAD"]);
  const info = { version, commit, builtAt: new Date().toISOString(), platform, arch, electron: electronVersion, postgres: pgVersion };
  fs.writeFileSync(path.join(RESOURCES_DIR, "build-info.json"), `${JSON.stringify(info, null, 2)}\n`);

  const leftovers = findEnvFiles(RESOURCES_DIR);
  if (leftovers.length) throw new Error(`.env files found in the assembled resources: ${leftovers.join(", ")}`);
  console.info(`  total: ${formatBytes(dirSize(RESOURCES_DIR))}`);
}

/**
 * Environment for `next build`. Prerendering static pages runs app code that validates the
 * server environment, but the real values only exist on the user's Mac (created on first
 * launch). So the build gets throwaway values: random keys that live only for this build
 * and a database address nothing listens on. Values that shape prerendered pages match the
 * desktop runtime (HARBOUR_DESKTOP and DEMO_MODE on). Explicit values also win over any
 * .env file on the build machine. None of this reaches the bundle: Next.js inlines only
 * NEXT_PUBLIC_* variables, and .env files are stripped from the output.
 * @returns {NodeJS.ProcessEnv}
 */
function nextBuildEnv() {
  return {
    ...process.env,
    HARBOUR_DESKTOP: "1",
    NEXT_TELEMETRY_DISABLED: "1",
    DATABASE_URL: `postgresql://harbour-build@${LOOPBACK_HOST}:9/harbour-build`,
    AUTH_SECRET: crypto.randomBytes(48).toString("base64url"),
    ENCRYPTION_KEY: crypto.randomBytes(32).toString("base64"),
    APP_URL: `http://${LOOPBACK_HOST}:${PREFERRED_SERVER_PORT}`,
    DEMO_MODE: "true",
  };
}

/**
 * npm tarballs cannot hold symlinks, so the package lists them in pg-symlinks.json
 * (normally recreated by its postinstall script). Recreate any that are missing.
 * @param {string} pgPackage
 * @param {string} pgDir
 */
function restoreSymlinks(pgPackage, pgDir) {
  const listFile = path.join(pgPackage, "native", "pg-symlinks.json");
  if (!fs.existsSync(listFile)) return;
  /** @type {Array<{ source: string, target: string }>} */
  const links = JSON.parse(fs.readFileSync(listFile, "utf8"));
  for (const { source, target: linkPath } of links) {
    const from = path.join(pgDir, path.relative("native", source));
    const link = path.join(pgDir, path.relative("native", linkPath));
    if (!fs.existsSync(from)) continue;
    try {
      fs.lstatSync(link);
      continue;
    } catch {
      fs.symlinkSync(path.relative(path.dirname(link), from), link);
    }
  }
}

/** The macOS PostgreSQL binaries are universal; keep only this architecture to halve their size. */
function thinUniversalBinaries(/** @type {string} */ dir, /** @type {string} */ arch) {
  const lipoArch = arch === "x64" ? "x86_64" : "arm64";
  let thinned = 0;
  for (const { path: p, entry } of walk(dir)) {
    if (!entry.isFile()) continue;
    const fd = fs.openSync(p, "r");
    const magic = Buffer.alloc(4);
    fs.readSync(fd, magic, 0, 4, 0);
    fs.closeSync(fd);
    if (magic.readUInt32BE(0) !== 0xcafebabe) continue;
    const archs = execFileSync("lipo", ["-archs", p], { encoding: "utf8" }).trim().split(/\s+/);
    if (!archs.includes(lipoArch) || archs.length < 2) continue;
    const mode = fs.statSync(p).mode;
    execFileSync("lipo", [p, "-thin", lipoArch, "-output", `${p}.thin`]);
    fs.renameSync(`${p}.thin`, p);
    fs.chmodSync(p, mode);
    thinned += 1;
  }
  console.info(`  thinned ${thinned} universal binaries to ${lipoArch}`);
}

/** @param {string[]} args */
function safeGit(args) {
  try {
    return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await assemble({ skipNext: process.argv.includes("--skip-next") });
}
