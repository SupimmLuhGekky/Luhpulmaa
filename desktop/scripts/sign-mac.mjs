// @ts-check
import fs from "node:fs";
import path from "node:path";
import { packagedApp, run, step, walk } from "./lib.mjs";

/**
 * Ad-hoc code signing, inside-out (macOS only).
 *
 * Apple Silicon refuses to run unsigned code, and packaging changes Electron's original
 * signature, so every Mach-O file is re-signed with an ad-hoc identity ("-"):
 *   1. every loose Mach-O file (PostgreSQL binaries and dylibs, Prisma's query engine,
 *      native Node modules, Electron's helpers and libraries), deepest first
 *   2. every nested bundle (frameworks, helper apps), deepest first
 *   3. the app itself, which seals everything above
 * then verifies with `codesign --verify --deep --strict`.
 *
 * Ad-hoc signing does not identify a developer, so Gatekeeper still asks the user to
 * confirm the first launch (see docs/DESKTOP.md). No hardened runtime: it would require
 * notarization-style entitlements and buys nothing without a Developer ID.
 */

const MACHO_MAGIC = new Set([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca]);
const BUNDLE_EXT = /\.(app|framework|xpc|appex|bundle)$/;

function isMachO(/** @type {string} */ file) {
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(4);
    if (fs.readSync(fd, buf, 0, 4, 0) < 4) return false;
    return MACHO_MAGIC.has(buf.readUInt32BE(0));
  } finally {
    fs.closeSync(fd);
  }
}

const depth = (/** @type {string} */ p) => p.split(path.sep).length;

/** @param {string} target */
async function adHocSign(target) {
  await run("codesign", ["--force", "--sign", "-", "--timestamp=none", target], { capture: true });
}

/** @param {string} appPath */
export async function signApp(appPath) {
  if (process.platform !== "darwin") throw new Error("Code signing runs on macOS only.");
  step(`Ad-hoc signing ${appPath} (inside-out)`);
  // Extended attributes such as Finder info make codesign fail ("detritus not allowed").
  await run("xattr", ["-cr", appPath]);

  /** @type {string[]} */
  const files = [];
  /** @type {string[]} */
  const bundles = [];
  for (const { path: p, entry } of walk(appPath)) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory() && BUNDLE_EXT.test(entry.name)) bundles.push(p);
    else if (entry.isFile() && isMachO(p)) files.push(p);
  }
  const ordered = [...files.map((p) => ({ p, bundle: false })), ...bundles.map((p) => ({ p, bundle: true }))].sort(
    (a, b) => depth(b.p) - depth(a.p) || Number(a.bundle) - Number(b.bundle),
  );
  for (const { p } of ordered) await adHocSign(p);
  await adHocSign(appPath);
  console.info(`  signed ${files.length} Mach-O files, ${bundles.length} nested bundles and the app`);

  step("Verifying signatures");
  await run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
  // --deep only descends into nested bundles; check loose binaries (e.g. in Resources) as well.
  for (const file of files) await run("codesign", ["--verify", "--strict", file], { capture: true });
  console.info(`  all ${files.length} loose Mach-O files verify`);
  await run("codesign", ["--display", "--verbose=2", appPath]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await signApp(process.argv[2] ? path.resolve(process.argv[2]) : packagedApp().app);
}
