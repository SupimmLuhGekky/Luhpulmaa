// @ts-check
import { RELEASE_TAG_PREFIX, RELEASES_URL } from "./constants.mjs";

/**
 * Version helpers for the update check (no Electron imports, so they are unit-testable).
 * @typedef {{ tag_name: string, html_url: string, draft?: boolean, prerelease?: boolean, name?: string | null }} GithubRelease
 */

/** Parses "1.2.3" (optionally with a "-pre" suffix) into comparable parts, or null. */
export function parseVersion(/** @type {string} */ value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value.trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), pre: match[4] ?? null };
}

/** Negative if a < b, 0 if equal, positive if a > b. A pre-release sorts before its release. */
export function compareVersions(/** @type {string} */ a, /** @type {string} */ b) {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (!va || !vb) return 0;
  for (const key of /** @type {const} */ (["major", "minor", "patch"])) {
    if (va[key] !== vb[key]) return va[key] - vb[key];
  }
  if (va.pre === vb.pre) return 0;
  if (va.pre === null) return 1;
  if (vb.pre === null) return -1;
  return va.pre < vb.pre ? -1 : 1;
}

/**
 * Newest non-draft, non-prerelease desktop release from a GitHub releases list.
 * @param {GithubRelease[]} releases
 * @returns {{ version: string, url: string } | null}
 */
export function latestDesktopRelease(releases) {
  /** @type {{ version: string, url: string } | null} */
  let best = null;
  for (const release of releases) {
    if (release.draft || release.prerelease || typeof release.tag_name !== "string") continue;
    if (!release.tag_name.startsWith(RELEASE_TAG_PREFIX)) continue;
    const version = release.tag_name.slice(RELEASE_TAG_PREFIX.length);
    if (!parseVersion(version) || parseVersion(version)?.pre) continue;
    if (!best || compareVersions(version, best.version) > 0) {
      const url = typeof release.html_url === "string" && release.html_url.startsWith(`${RELEASES_URL}/`) ? release.html_url : RELEASES_URL;
      best = { version, url };
    }
  }
  return best;
}
