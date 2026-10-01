// @ts-check
import fs from "node:fs";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { DESKTOP_DIR, ICON_DIR, step } from "./lib.mjs";

/**
 * Renders assets/icon.svg into the macOS .icns (PNG-encoded entries for every size
 * Finder and the Dock ask for) and a PNG for Linux windows.
 */

/** ICNS entry types and their pixel sizes (all PNG-encoded). */
const ICNS_ENTRIES = /** @type {const} */ ([
  ["icp4", 16],
  ["icp5", 32],
  ["icp6", 64],
  ["ic07", 128],
  ["ic08", 256],
  ["ic09", 512],
  ["ic10", 1024],
  ["ic11", 32],
  ["ic12", 64],
  ["ic13", 256],
  ["ic14", 512],
]);

/** @param {string} svg @param {number} size */
function render(svg, size) {
  return Buffer.from(new Resvg(svg, { fitTo: { mode: "width", value: size }, background: "rgba(0,0,0,0)" }).render().asPng());
}

/** Builds an .icns file from PNG entries. */
export function buildIcns(/** @type {Array<[string, Buffer]>} */ entries) {
  const chunks = entries.map(([type, png]) => {
    const header = Buffer.alloc(8);
    header.write(type, 0, 4, "ascii");
    header.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([header, png]);
  });
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(8);
  header.write("icns", 0, 4, "ascii");
  header.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([header, body]);
}

export function makeIcons() {
  step("Rendering the app icon");
  const svg = fs.readFileSync(path.join(DESKTOP_DIR, "assets", "icon.svg"), "utf8");
  fs.mkdirSync(ICON_DIR, { recursive: true });
  /** @type {Map<number, Buffer>} */
  const cache = new Map();
  const png = (/** @type {number} */ size) => {
    if (!cache.has(size)) cache.set(size, render(svg, size));
    return /** @type {Buffer} */ (cache.get(size));
  };
  const icns = buildIcns(ICNS_ENTRIES.map(([type, size]) => [type, png(size)]));
  fs.writeFileSync(path.join(ICON_DIR, "Harbour.icns"), icns);
  fs.writeFileSync(path.join(ICON_DIR, "icon.png"), png(512));
  console.info(`  Harbour.icns (${ICNS_ENTRIES.length} sizes, ${Math.round(icns.length / 1024)} KB) and icon.png`);
}

if (import.meta.url === `file://${process.argv[1]}`) makeIcons();
