// @ts-check
import { dialog, net } from "electron";
import { GITHUB_REPO, RELEASES_URL } from "./constants.mjs";
import { openExternalSafely } from "./security.mjs";
import { compareVersions, latestDesktopRelease } from "./versions.mjs";

/**
 * Update check: looks up the newest published GitHub release tagged `desktop-v<x.y.z>`
 * and, if it is newer than this app, offers to open its download page. Nothing is
 * downloaded or installed automatically.
 *
 * @typedef {import("./versions.mjs").GithubRelease} GithubRelease
 */

/**
 * @param {{ currentVersion: string, manual: boolean, parent: Electron.BrowserWindow | null, log: import("./logger.mjs").Logger }} options
 */
export async function checkForUpdates({ currentVersion, manual, parent, log }) {
  /** @type {{ version: string, url: string } | null} */
  let latest;
  try {
    const res = await net.fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=30`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": `Harbour-Desktop/${currentVersion}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    latest = latestDesktopRelease(/** @type {GithubRelease[]} */ (await res.json()));
  } catch (err) {
    log.warn(`Update check failed: ${err instanceof Error ? err.message : String(err)}`);
    if (manual) {
      await showBox(parent, {
        type: "warning",
        message: "Couldn’t check for updates",
        detail: "Harbour couldn’t reach GitHub. Check your internet connection, or look at the releases page yourself.",
        buttons: ["Open Releases Page", "OK"],
        defaultId: 1,
        cancelId: 1,
      }).then(({ response }) => response === 0 && openExternalSafely(RELEASES_URL, log));
    }
    return;
  }

  if (latest && compareVersions(latest.version, currentVersion) > 0) {
    log.info(`Update available: ${latest.version} (running ${currentVersion}).`);
    const { response } = await showBox(parent, {
      type: "info",
      message: `Harbour ${latest.version} is available`,
      detail:
        `You have version ${currentVersion}. Download the new version, quit Harbour, and replace the app in your Applications folder. ` +
        "Your data stays where it is and is upgraded the next time you open Harbour.",
      buttons: ["Open Download Page", "Later"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) openExternalSafely(latest.url, log);
    return;
  }
  log.info(`No update available (running ${currentVersion}${latest ? `, latest ${latest.version}` : ""}).`);
  if (manual) {
    await showBox(parent, { type: "info", message: "You’re up to date", detail: `Harbour ${currentVersion} is the newest version.`, buttons: ["OK"] });
  }
}

/**
 * @param {Electron.BrowserWindow | null} parent
 * @param {Electron.MessageBoxOptions} options
 */
function showBox(parent, options) {
  return parent && !parent.isDestroyed() ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options);
}
