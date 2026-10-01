// @ts-check
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** Shared helpers for the desktop build scripts. */

export const DESKTOP_DIR = path.resolve(import.meta.dirname, "..");
export const REPO_ROOT = path.resolve(DESKTOP_DIR, "..");
export const OUT_DIR = path.join(DESKTOP_DIR, "out");
export const RESOURCES_DIR = path.join(OUT_DIR, "resources");
export const ICON_DIR = path.join(OUT_DIR, "icon");
export const PACKAGE_DIR = path.join(OUT_DIR, "package");
export const PRODUCT_NAME = "Harbour";
export const BUNDLE_ID = "io.github.supimmluhgekky.harbour";

/** @returns {{ version: string, electronVersion: string }} */
export function desktopPackage() {
  const pkg = JSON.parse(fs.readFileSync(path.join(DESKTOP_DIR, "package.json"), "utf8"));
  const electronPkg = JSON.parse(fs.readFileSync(path.join(DESKTOP_DIR, "node_modules", "electron", "package.json"), "utf8"));
  return { version: pkg.version, electronVersion: electronPkg.version };
}

/**
 * Build target: always the machine we are on (each CI runner builds its own architecture).
 * @returns {{ platform: "darwin" | "linux", arch: "arm64" | "x64" }}
 */
export function target() {
  const { platform, arch } = process;
  if ((platform !== "darwin" && platform !== "linux") || (arch !== "arm64" && arch !== "x64")) {
    throw new Error(`Unsupported build platform ${platform}-${arch}.`);
  }
  return { platform, arch };
}

/** Path of the packaged app for the current target. */
export function packagedApp() {
  const { platform, arch } = target();
  const dir = path.join(PACKAGE_DIR, `${PRODUCT_NAME}-${platform}-${arch}`);
  if (platform === "darwin") {
    const app = path.join(dir, `${PRODUCT_NAME}.app`);
    return { dir, app, resources: path.join(app, "Contents", "Resources"), executable: path.join(app, "Contents", "MacOS", PRODUCT_NAME) };
  }
  return { dir, app: dir, resources: path.join(dir, "resources"), executable: path.join(dir, PRODUCT_NAME) };
}

export function step(/** @type {string} */ message) {
  console.info(`\n▸ ${message}`);
}

/**
 * Runs a command; rejects on a non-zero exit. Output is streamed, or with `capture`
 * collected quietly and included in the error if the command fails.
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, capture?: boolean }} [options]
 * @returns {Promise<string>}
 */
export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? REPO_ROOT,
      env: options.env ?? process.env,
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let out = "";
    let err = "";
    child.stdout?.on("data", (d) => (out += d.toString()));
    child.stderr?.on("data", (d) => (err += d.toString()));
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve(out);
      else reject(new Error(`${command} ${args.join(" ")} failed (${signal ?? `exit code ${code}`})${err ? `:\n${err.trim()}` : ""}`));
    });
  });
}

/**
 * Lists files under dir (not following symlinks).
 * @param {string} dir
 * @returns {Generator<{ path: string, entry: fs.Dirent }>}
 */
export function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    yield { path: full, entry };
    if (entry.isDirectory()) yield* walk(full);
  }
}

/** Total size in bytes of the files under dir (symlinks counted as links). */
export function dirSize(/** @type {string} */ dir) {
  let total = 0;
  for (const { path: p, entry } of walk(dir)) {
    if (entry.isFile()) total += fs.statSync(p).size;
  }
  return total;
}

export function formatBytes(/** @type {number} */ bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Finds files whose name starts with ".env" (never allowed in the bundle). */
export function findEnvFiles(/** @type {string} */ dir) {
  const found = [];
  for (const { path: p, entry } of walk(dir)) {
    if (entry.name.startsWith(".env")) found.push(p);
  }
  return found;
}
