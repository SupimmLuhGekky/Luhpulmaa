// @ts-check
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { OUT_DIR, PRODUCT_NAME, desktopPackage, formatBytes, packagedApp, run, step, target } from "./lib.mjs";

/**
 * Builds Harbour-<version>-<arch>.dmg with hdiutil (macOS only): the app plus an
 * /Applications shortcut for drag-to-install. Writes a .sha256 file next to it.
 * @param {string} appPath
 */
export async function makeDmg(appPath) {
  if (process.platform !== "darwin") throw new Error("DMGs can only be built on macOS.");
  const { arch } = target();
  const { version } = desktopPackage();
  const dmg = path.join(OUT_DIR, `${PRODUCT_NAME}-${version}-${arch}.dmg`);
  step(`Creating ${path.basename(dmg)}`);

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "harbour-dmg-"));
  try {
    // ditto keeps symlinks, permissions and code signatures intact.
    await run("ditto", [appPath, path.join(staging, `${PRODUCT_NAME}.app`)]);
    fs.symlinkSync("/Applications", path.join(staging, "Applications"));
    fs.rmSync(dmg, { force: true });
    // hdiutil occasionally fails with "Resource busy" on CI machines; retry a few times.
    for (let attempt = 1; ; attempt += 1) {
      try {
        await run("hdiutil", ["create", "-volname", PRODUCT_NAME, "-srcfolder", staging, "-fs", "HFS+", "-format", "ULMO", "-ov", dmg]);
        break;
      } catch (err) {
        if (attempt >= 4) throw err;
        console.info(`  hdiutil failed (attempt ${attempt}); retrying in ${attempt * 5}s`);
        await new Promise((r) => setTimeout(r, attempt * 5000));
      }
    }
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
  await run("hdiutil", ["verify", dmg]);
  const sha256 = crypto.createHash("sha256").update(fs.readFileSync(dmg)).digest("hex");
  fs.writeFileSync(`${dmg}.sha256`, `${sha256}  ${path.basename(dmg)}\n`);
  console.info(`  ${dmg} (${formatBytes(fs.statSync(dmg).size)}), sha256 ${sha256}`);
  return dmg;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await makeDmg(process.argv[2] ? path.resolve(process.argv[2]) : packagedApp().app);
}
