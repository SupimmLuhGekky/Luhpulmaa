// @ts-check
import fs from "node:fs";
import path from "node:path";
import { app, dialog, nativeImage, session, shell } from "electron";
import { BootAborted, boot } from "./boot.mjs";
import { APP_NAME, START_PATH, TIMEOUTS } from "./constants.mjs";
import { scheduleDailyJobs } from "./daily-jobs.mjs";
import { createLogger, describeError } from "./logger.mjs";
import { createMainWindow } from "./main-window.mjs";
import { installMenu } from "./menu.mjs";
import { MigrationError } from "./migrate.mjs";
import { localGet, sleep } from "./net-utils.mjs";
import { createPasswordResetFlow } from "./password-reset-flow.mjs";
import { resolvePaths } from "./paths.mjs";
import { PostgresError, bestEffort } from "./postgres.mjs";
import { SecretsError } from "./secrets.mjs";
import { installSecurityGuards, setAppOrigin } from "./security.mjs";
import { ServerError } from "./server.mjs";
import { createSplashWindow, setSplashStatus } from "./splash.mjs";
import { checkForUpdates } from "./updates.mjs";

/**
 * Harbour desktop shell (Electron main process).
 *
 * Flags:
 *   --smoke-test=<file.png>  boot everything, wait for the sign-in page, check /api/health,
 *                            save a screenshot of the window and quit (exit 0 on success).
 *                            Also tries the demo sign-in (second screenshot), the daily jobs
 *                            endpoint and, on a brand-new data folder, the Reset Password…
 *                            flow; those are reported but never fail the test.
 *   --data-dir=<dir>         use another data folder (testing)
 */

/** @param {string[]} argv */
function parseFlags(argv) {
  /** @type {{ smokeTest: string | null, dataDir: string | null }} */
  const flags = { smokeTest: null, dataDir: null };
  for (const arg of argv.slice(1)) {
    const [name, ...rest] = arg.split("=");
    const value = rest.join("=");
    if (name === "--smoke-test" && value) flags.smokeTest = path.resolve(value);
    if (name === "--data-dir" && value) flags.dataDir = path.resolve(value);
  }
  return flags;
}

const flags = parseFlags(process.argv);
const smoke = flags.smokeTest !== null;

/** Writes straight to the terminal (synchronously, so nothing is lost on exit). */
function say(/** @type {string} */ text) {
  try {
    fs.writeSync(smoke ? 1 : 2, `${text}\n`);
  } catch {
    // No terminal attached.
  }
}

// Paths must be settled before the app is ready and before taking the single-instance lock.
app.setName(APP_NAME);
if (flags.dataDir) app.setPath("userData", flags.dataDir);
else if (!app.isPackaged) app.setPath("userData", path.join(app.getPath("appData"), `${APP_NAME} Development`));
app.setPath("sessionData", path.join(app.getPath("userData"), "session"));

if (!app.requestSingleInstanceLock()) {
  if (smoke) say("[smoke] FAILED: another Harbour instance is already running with this data folder.");
  app.exit(smoke ? 1 : 0);
} else {
  run();
}

function run() {
  app.enableSandbox();
  const paths = resolvePaths();
  fs.mkdirSync(paths.dataDir, { recursive: true, mode: 0o700 });
  const log = createLogger(paths.logsDir, { mirrorToStdout: smoke || !app.isPackaged });
  log.info(
    `${APP_NAME} ${app.getVersion()} starting (Electron ${process.versions.electron}, Node ${process.versions.node}, ` +
      `${process.platform}-${process.arch}${app.isPackaged ? "" : ", development"}${smoke ? ", smoke test" : ""}).`,
  );
  installSecurityGuards(log);

  // A stray exception must never go unnoticed: log it, and fail the smoke test.
  process.on("uncaughtException", (err) => {
    log.error("Uncaught exception in the main process", err);
    if (smoke) {
      say(`[smoke] FAILED: uncaught exception: ${err instanceof Error ? err.message : String(err)}`);
      void exitWith(1);
    }
  });
  process.on("unhandledRejection", (reason) => {
    log.error("Unhandled promise rejection in the main process", reason);
    if (smoke) {
      say(`[smoke] FAILED: unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
      void exitWith(1);
    }
  });

  /** @type {import("./boot.mjs").Components} */
  const components = { postgres: null, server: null };
  const abort = new AbortController();
  /** @type {import("electron").BrowserWindow | null} */
  let splash = null;
  /** @type {import("electron").BrowserWindow | null} */
  let mainWindow = null;
  /** @type {string | null} */
  let baseUrl = null;
  /** @type {Promise<unknown> | null} */
  let bootPromise = null;
  /** @type {ReturnType<typeof scheduleDailyJobs> | null} */
  let dailyJobs = null;
  /**
   * What the shell needs to reach the running app (set once start-up has finished).
   * @type {import("./password-reset-flow.mjs").RunningApp | null}
   */
  let running = null;
  /** @type {"no" | "pending" | "done"} */
  let quitting = "no";
  /** @type {Promise<{ databaseClean: boolean }> | null} */
  let shutdownPromise = null;

  /** Stops the web server, then the database. Safe to call more than once. */
  function shutdown() {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      abort.abort();
      dailyJobs?.stop();
      if (bootPromise) await Promise.race([bootPromise.catch(() => {}), sleep(TIMEOUTS.initdbMs)]);
      await bestEffort(log, "Stopping the web server", async () => components.server?.stop());
      let databaseClean = true;
      await bestEffort(log, "Stopping the database", async () => {
        const result = await components.postgres?.stop();
        databaseClean = result?.clean ?? true;
      });
      log.info(`Shutdown complete${databaseClean ? "" : " (the database did not stop cleanly and will recover on next launch)"}.`);
      return { databaseClean };
    })();
    const limit = sleep(TIMEOUTS.shutdownMs).then(() => {
      log.warn("Shutdown took too long; exiting anyway.");
      return { databaseClean: false };
    });
    return Promise.race([shutdownPromise, limit]);
  }

  async function exitWith(/** @type {number} */ code) {
    quitting = "pending";
    await shutdown();
    quitting = "done";
    app.exit(code);
  }

  app.on("before-quit", (event) => {
    if (quitting === "done") return;
    event.preventDefault();
    if (quitting === "pending") return;
    quitting = "pending";
    log.info("Quitting.");
    void shutdown().finally(() => {
      quitting = "done";
      app.quit();
    });
  });
  for (const signal of /** @type {const} */ (["SIGINT", "SIGTERM", "SIGHUP"])) {
    process.on(signal, () => {
      log.info(`Received ${signal}.`);
      app.quit();
    });
  }

  app.on("second-instance", () => showMainWindow());
  app.on("activate", () => showMainWindow());
  app.on("window-all-closed", () => {
    // macOS convention: the app keeps running (Dock icon) until the user quits it.
    if (process.platform !== "darwin") app.quit();
  });
  app.on("child-process-gone", (_e, details) => {
    log.warn(`Child process gone: ${details.type}${details.name ? ` (${details.name})` : ""}, reason ${details.reason}, exit code ${details.exitCode}.`);
  });
  app.on("render-process-gone", (_e, _wc, details) => log.warn(`Renderer gone: ${details.reason} (exit code ${details.exitCode}).`));

  function showMainWindow() {
    if (!baseUrl || quitting !== "no") return;
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      return;
    }
    openMainWindow();
  }

  function openMainWindow(/** @type {string | undefined} */ url = undefined) {
    if (!baseUrl) return null;
    const win = createMainWindow({
      url: url ?? `${baseUrl}${START_PATH}`,
      stateFile: paths.windowStateFile,
      onReadyToShow: () => {
        if (splash && !splash.isDestroyed()) splash.close();
        splash = null;
      },
    });
    if (process.platform === "linux" && fs.existsSync(paths.linuxIcon)) win.setIcon(nativeImage.createFromPath(paths.linuxIcon));
    win.webContents.on("did-fail-load", (_e, code, description, url, isMainFrame) => {
      if (isMainFrame) log.warn(`Page failed to load (${code} ${description}): ${safePath(url)}`);
    });
    win.on("closed", () => {
      if (mainWindow === win) mainWindow = null;
    });
    mainWindow = win;
    return win;
  }

  /** Shows a page of the app in the main window, opening the window if it was closed. */
  async function showUrl(/** @type {string} */ url) {
    const existing = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    if (!existing) {
      // A new window shows itself once the page is ready.
      const win = openMainWindow(url);
      if (!win) throw new Error("Harbour isn’t ready yet.");
      return win;
    }
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    await existing.loadURL(url);
    return existing;
  }

  const passwordReset = createPasswordResetFlow({
    log,
    runningApp: () => (quitting === "no" ? running : null),
    showUrl,
    parentWindow: () => mainWindow,
  });

  app.whenReady().then(async () => {
    installMenu({
      dataDir: paths.dataDir,
      logsDir: paths.logsDir,
      onCheckForUpdates: () => void checkForUpdates({ currentVersion: app.getVersion(), manual: true, parent: mainWindow, log }),
      onResetPassword: () => void passwordReset.run(),
    });
    app.setAboutPanelOptions({
      applicationName: APP_NAME,
      applicationVersion: app.getVersion(),
      copyright: "Your money data stays on this Mac.",
    });

    splash = createSplashWindow();
    const onStatus = (/** @type {string} */ text) => {
      log.info(`Status: ${text}`);
      setSplashStatus(splash, text);
    };

    let result;
    try {
      bootPromise = bootWithRecovery(onStatus);
      result = /** @type {Awaited<ReturnType<typeof boot>>} */ (await bootPromise);
    } catch (err) {
      await startupFailed(err);
      return;
    }

    baseUrl = result.baseUrl;
    setAppOrigin(baseUrl);
    log.info(`${APP_NAME} is ready at ${baseUrl}${result.firstLaunch ? " (first launch)" : ""}.`);
    if (components.server) components.server.onUnexpectedExit = (code) => void stoppedUnexpectedly(`The Harbour server stopped unexpectedly (code ${code}).`);
    if (components.postgres) components.postgres.onUnexpectedExit = (code) => void stoppedUnexpectedly(`The Harbour database stopped unexpectedly (code ${code}).`);
    if (components.postgres) running = { baseUrl, dbPort: components.postgres.port, dbPassword: result.secrets.dbPassword };
    openMainWindow();
    dailyJobs = scheduleDailyJobs({ baseUrl, cronSecret: result.secrets.cronSecret, log });

    if (smoke) {
      void smokeTest(/** @type {string} */ (flags.smokeTest), result.firstLaunch);
    } else {
      setTimeout(() => void checkForUpdates({ currentVersion: app.getVersion(), manual: false, parent: mainWindow, log }), 5000);
    }
  });

  /**
   * Runs the boot sequence; if the stored keys cannot be unlocked, asks the user what to do.
   * @param {(text: string) => void} onStatus
   * @param {boolean} [replaceKeys]
   * @returns {Promise<Awaited<ReturnType<typeof boot>>>}
   */
  async function bootWithRecovery(onStatus, replaceKeys = false) {
    try {
      return await boot({ paths, log, components, onStatus, signal: abort.signal, replaceKeys });
    } catch (err) {
      if (!(err instanceof SecretsError) || err.code === "SECRETS_WRITE_FAILED" || smoke) throw err;
      log.error("Could not unlock the stored keys", err);
      const choice = await askAboutKeys(err);
      if (choice === "replace") return bootWithRecovery(onStatus, true);
      if (choice === "retry") {
        // The keychain's answer is cached for the life of the process, so ask again from a fresh one.
        log.info("Restarting to ask the keychain again.");
        app.relaunch();
      }
      throw new BootAborted();
    }
  }

  /** @param {SecretsError} err @returns {Promise<"retry" | "replace" | "quit">} */
  async function askAboutKeys(err) {
    const denied = err.code === "KEYCHAIN_DENIED" || err.code === "KEYCHAIN_UNAVAILABLE";
    const { response } = await dialog.showMessageBox({
      type: "warning",
      message: denied ? "Harbour couldn’t unlock its keys" : "Harbour’s keys are damaged",
      detail:
        (denied
          ? "Harbour keeps the keys that protect your data in your Mac’s keychain, and macOS didn’t allow access. " +
            "If you clicked Deny, choose Try Again and then Always Allow.\n\n"
          : "") +
        "If the keys can’t be recovered, Harbour can create new ones. Your accounts, budgets and transactions stay, " +
        "but you’ll need to sign in again and reconnect any bank connections.",
      buttons: ["Try Again", "Create New Keys…", "Quit"],
      defaultId: 0,
      cancelId: 2,
    });
    if (response === 0) return "retry";
    if (response === 2) return "quit";
    const confirm = await dialog.showMessageBox({
      type: "warning",
      message: "Create new keys?",
      detail: "Sign-in sessions and saved bank connections will stop working and need to be set up again. Your financial data is kept.",
      buttons: ["Create New Keys", "Cancel"],
      defaultId: 1,
      cancelId: 1,
    });
    return confirm.response === 0 ? "replace" : askAboutKeys(err);
  }

  /** @param {unknown} err */
  async function startupFailed(err) {
    // Mark the app as quitting first, so closing the splash can't trigger a second quit sequence.
    const alreadyQuitting = quitting !== "no";
    quitting = "pending";
    if (splash && !splash.isDestroyed()) splash.close();
    splash = null;
    if (err instanceof BootAborted || alreadyQuitting) {
      log.info("Startup cancelled.");
      await exitWith(smoke ? 1 : 0);
      return;
    }
    log.error("Startup failed", err);
    if (smoke) {
      say(`[smoke] FAILED: startup failed: ${describeError(err).split("\n")[0]}`);
      await exitWith(1);
      return;
    }
    await shutdown();
    const { response } = await dialog.showMessageBox({
      type: "error",
      message: "Harbour couldn’t start",
      detail: `${friendlyMessage(err)}\n\nThe logs folder has the details; include them if you ask for help.`,
      buttons: ["Open Logs Folder", "Quit"],
      defaultId: 1,
      cancelId: 1,
    });
    if (response === 0) await shell.openPath(paths.logsDir);
    quitting = "done";
    app.exit(1);
  }

  let reportedFatal = false;
  /** @param {string} message */
  async function stoppedUnexpectedly(message) {
    if (quitting !== "no" || reportedFatal) return;
    reportedFatal = true;
    log.error(message);
    if (smoke) {
      say(`[smoke] FAILED: ${message}`);
      await exitWith(1);
      return;
    }
    const { response } = await dialog.showMessageBox({
      type: "error",
      message,
      detail: "Your data is safe. Restart Harbour to continue; the logs folder has details.",
      buttons: ["Restart Harbour", "Open Logs Folder", "Quit"],
      defaultId: 0,
      cancelId: 2,
    });
    if (response === 1) await shell.openPath(paths.logsDir);
    if (response === 0) app.relaunch();
    await exitWith(response === 0 ? 0 : 1);
  }

  /**
   * @param {string} screenshotPath
   * @param {boolean} firstLaunch
   */
  async function smokeTest(screenshotPath, firstLaunch) {
    const watchdog = setTimeout(() => {
      say(`[smoke] FAILED: timed out after ${TIMEOUTS.smokeTestMs / 1000}s.`);
      void exitWith(1);
    }, TIMEOUTS.smokeTestMs);
    try {
      const win = mainWindow;
      if (!win) throw new Error("the main window was not created");
      const page = await waitForSignInPage(win, 90_000);
      const health = await localGet(`${baseUrl}/api/health`);
      if (health.status !== 200 || JSON.parse(health.body)?.ok !== true) throw new Error(`/api/health answered ${health.status} ${health.body}`);
      const signIn = await localGet(`${baseUrl}/sign-in`);
      if (!String(signIn.headers["content-security-policy"] ?? "").includes("default-src 'self'")) throw new Error("the sign-in page has no Content-Security-Policy");
      await sleep(1000);
      const image = await win.webContents.capturePage();
      if (image.isEmpty()) throw new Error("the window screenshot is empty");
      fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
      fs.writeFileSync(screenshotPath, image.toPNG());
      const { width, height } = image.getSize();
      const colours = sampledColours(image);
      const heading = await pageHeading(win);
      log.info(`Smoke test: sign-in page loaded (${page}, heading "${heading}"), health ok, screenshot ${width}x${height} saved (${colours} colours sampled).`);
      say(`[smoke] sign-in page: heading "${heading}", screenshot ${width}x${height}, ${colours} colours sampled`);
      if (colours <= 2) throw new Error("the window screenshot is blank");
      // Informational end-to-end check (never fails the test): demo sign-in exercises the
      // database, a server action's origin check and the Secure session cookie on 127.0.0.1.
      const demo = await tryDemoSignIn(win, screenshotPath);
      log.info(`Smoke test: demo sign-in ${demo}.`);
      say(`[smoke] demo sign-in: ${demo}`);
      // Also informational: the daily jobs endpoint accepts the shell's CRON_SECRET.
      const cron = await Promise.race([dailyJobs?.runNow() ?? Promise.resolve("not scheduled"), sleep(120_000).then(() => "still running after 120s")]);
      log.info(`Smoke test: daily jobs ${cron}.`);
      say(`[smoke] daily jobs (/api/cron/daily): ${cron}`);
      // Informational too: the Reset Password… menu path, end to end, with a throwaway account.
      // Only on a brand-new data folder, so it never touches anyone's real accounts.
      const reset = !firstLaunch
        ? "skipped (runs only on a brand-new data folder)"
        : running
          ? await passwordReset.smokeCheck(running)
          : "skipped (database not running)";
      log.info(`Smoke test: password reset ${reset}.`);
      say(`[smoke] password reset (menu flow): ${reset}`);
      clearTimeout(watchdog);
      const { databaseClean } = await shutdown();
      if (!databaseClean) throw new Error("the database did not shut down cleanly");
      say(`[smoke] PASSED: ${page} loaded, /api/health ok, screenshot ${width}x${height} saved to ${screenshotPath}`);
      quitting = "done";
      app.exit(0);
    } catch (err) {
      clearTimeout(watchdog);
      log.error("Smoke test failed", err);
      say(`[smoke] FAILED: ${err instanceof Error ? err.message : String(err)}`);
      await exitWith(1);
    }
  }

  /**
   * Clicks the sign-in page's demo button and waits for a session cookie; then signs the
   * window out again (clears cookies) so the next launch starts at the sign-in page.
   * @param {import("electron").BrowserWindow} win
   * @param {string} screenshotPath
   * @returns {Promise<string>}
   */
  async function tryDemoSignIn(win, screenshotPath) {
    const ses = session.defaultSession;
    try {
      const clicked = await win.webContents.executeJavaScript(
        `(() => { const b = [...document.querySelectorAll("button")].find((el) => /demo/i.test(el.textContent || "")); if (!b) return false; b.click(); return true; })()`,
      );
      if (!clicked) return "skipped (no demo button on the sign-in page)";
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        const [cookie] = await ses.cookies.get({ url: /** @type {string} */ (baseUrl), name: "harbour_session" });
        const at = safePath(win.webContents.getURL());
        if (cookie && !at.startsWith("/sign-in") && !win.webContents.isLoading()) {
          await sleep(1500);
          const image = await win.webContents.capturePage();
          const file = screenshotPath.replace(/\.png$/i, "") + "-signed-in.png";
          if (!image.isEmpty()) fs.writeFileSync(file, image.toPNG());
          return (
            `ok (session cookie secure=${cookie.secure}, httpOnly=${cookie.httpOnly}, sameSite=${cookie.sameSite}; ` +
            `window at ${at}, heading "${await pageHeading(win)}", ${sampledColours(image)} colours sampled)`
          );
        }
        await sleep(500);
      }
      return `no session cookie after 120s (window at ${safePath(win.webContents.getURL())})`;
    } catch (err) {
      return `error: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      await ses.clearStorageData({ origin: /** @type {string} */ (baseUrl), storages: ["cookies"] }).catch(() => {});
    }
  }

  /**
   * @param {import("electron").BrowserWindow} win
   * @param {number} timeoutMs
   */
  async function waitForSignInPage(win, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (win.isDestroyed()) throw new Error("the window was closed");
      const url = win.webContents.getURL();
      if (url && !win.webContents.isLoading() && new URL(url).pathname === "/sign-in") {
        const ready = await win.webContents
          .executeJavaScript(`document.readyState === "complete" && !!document.querySelector('input[type="password"]')`)
          .catch(() => false);
        if (ready) return safePath(url);
      }
      await sleep(250);
    }
    throw new Error(`the sign-in page did not appear (window is at ${safePath(win.webContents.getURL()) || "nothing"})`);
  }
}

/** The .app bundle this process runs from (macOS), for instructions shown to the user. */
function appBundlePath() {
  return process.platform === "darwin" ? path.resolve(process.execPath, "..", "..", "..") : path.dirname(process.execPath);
}

/**
 * Number of distinct colours in a 40×40 grid of pixels from a screenshot; a blank or
 * unpainted window has one or two.
 * @param {Electron.NativeImage} image
 */
function sampledColours(image) {
  const { width, height } = image.getSize();
  const bitmap = image.toBitmap();
  const colours = new Set();
  const stepX = Math.max(1, Math.floor(width / 40));
  const stepY = Math.max(1, Math.floor(height / 40));
  for (let y = 0; y < height; y += stepY) {
    for (let x = 0; x < width; x += stepX) {
      const i = (y * width + x) * 4;
      if (i + 4 <= bitmap.length) colours.add(bitmap.readUInt32LE(i));
    }
  }
  return colours.size;
}

/** The page's main heading, for smoke-test logs (demo data only, never personal data). */
async function pageHeading(/** @type {import("electron").BrowserWindow} */ win) {
  const text = await win.webContents
    .executeJavaScript(`(document.querySelector("h1") || document.querySelector("h2"))?.textContent ?? ""`)
    .catch(() => "");
  return String(text).replace(/\s+/g, " ").trim().slice(0, 80);
}

/** Path and query of a URL, for logs, with token-like query values hidden. */
function safePath(/** @type {string} */ url) {
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) {
      if (/token|secret|password|code/i.test(key)) u.searchParams.set(key, "redacted");
    }
    return `${u.pathname}${u.search}`;
  } catch {
    return "";
  }
}

/** Short, non-technical explanation for the error dialog. */
function friendlyMessage(/** @type {unknown} */ err) {
  const code = /** @type {{ code?: string }} */ (err ?? {}).code;
  if (code === "ENOSPC" || /ENOSPC|No space left/i.test(String(err))) return "Your Mac’s disk is full. Free up some space and open Harbour again.";
  if (err instanceof PostgresError) {
    switch (err.code) {
      case "RUNNING_AS_ROOT":
        return "Harbour can’t run as the root user. Open it from your normal account.";
      case "VERSION_MISMATCH":
        return `${err.message} Install a Harbour version that matches your data, or ask for help upgrading it. Your data has not been changed.`;
      case "ALREADY_RUNNING":
        return "Harbour’s database from an earlier session is still running. Restart your Mac and open Harbour again.";
      case "NOT_INSTALLED":
        return "Part of Harbour is missing. Download Harbour again and replace the app.";
      case "BLOCKED_BY_MACOS":
        return (
          "macOS stopped Harbour’s database program from opening. Open System Settings → Privacy & Security and, if it mentions " +
          "Harbour or “postgres”, click Open Anyway. If it doesn’t, quit Harbour, run this command in Terminal, then open Harbour again:\n\n" +
          `xattr -dr com.apple.quarantine "${appBundlePath()}"`
        );
      default:
        return "Harbour’s database didn’t start.";
    }
  }
  if (err instanceof MigrationError) return "Harbour couldn’t update your database for this version. Nothing was changed; your data is as it was.";
  if (err instanceof ServerError) return err.code === "NOT_INSTALLED" ? "Part of Harbour is missing. Download Harbour again and replace the app." : "Harbour’s server didn’t start.";
  if (err instanceof SecretsError) return "Harbour couldn’t read or save the keys that protect your data.";
  return "Something went wrong while starting Harbour.";
}
