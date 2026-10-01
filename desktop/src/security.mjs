// @ts-check
import { app, session, shell } from "electron";

/**
 * Renderer hardening. Pages only ever come from the local Harbour server (or the
 * splash data: page); they get no Node.js access, run sandboxed and context-isolated,
 * may not navigate away from the app's origin, and every permission request is denied.
 *
 * @typedef {import("./logger.mjs").Logger} Logger
 */

/** @returns {Electron.WebPreferences} */
export function secureWebPreferences() {
  return {
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webviewTag: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
    navigateOnDragDrop: false,
    safeDialogs: true,
    // macOS uses the system spell checker; elsewhere Chromium would download dictionaries from Google.
    spellcheck: process.platform === "darwin",
    devTools: !app.isPackaged,
  };
}

/** @type {string | null} */
let appOrigin = null;

/** Sets the only origin windows may show (http://127.0.0.1:<port>). */
export function setAppOrigin(/** @type {string} */ origin) {
  appOrigin = new URL(origin).origin;
}

export function isAppUrl(/** @type {string} */ url) {
  try {
    return appOrigin !== null && new URL(url).origin === appOrigin;
  } catch {
    return false;
  }
}

/**
 * Next.js normalises 127.0.0.1 to "localhost" when it builds absolute URLs (for example
 * the redirects in middleware), which would move the window to a different origin with
 * a different cookie jar. Maps such loopback aliases of the app's own server (same
 * scheme and port) back to the app's exact origin; returns null for anything else.
 */
export function toAppUrl(/** @type {string} */ url) {
  if (appOrigin === null) return null;
  try {
    const target = new URL(url);
    const origin = new URL(appOrigin);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname);
    if (!loopback || target.protocol !== origin.protocol || target.port !== origin.port) return null;
    return `${appOrigin}${target.pathname}${target.search}${target.hash}`;
  } catch {
    return null;
  }
}

/** Opens http(s) and mailto links in the user's default apps; ignores anything else. */
export function openExternalSafely(/** @type {string} */ url, /** @type {Logger | null} */ log) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (["https:", "http:", "mailto:"].includes(parsed.protocol)) {
    void shell.openExternal(parsed.toString()).catch((err) => log?.warn(`Could not open a link externally: ${String(err)}`));
  } else {
    log?.warn(`Blocked opening a ${parsed.protocol} link.`);
  }
}

/**
 * Installs app-wide guards. Call once, before the app is ready (permission handlers are
 * attached to the default session as soon as it exists, before any window is created).
 * @param {Logger} log
 */
export function installSecurityGuards(log) {
  void app.whenReady().then(() => {
    const ses = session.defaultSession;
    ses.setPermissionRequestHandler((_wc, permission, callback) => {
      log.info(`Denied a "${permission}" permission request.`);
      callback(false);
    });
    ses.setPermissionCheckHandler(() => false);
    ses.setDevicePermissionHandler(() => false);
    ses.setDisplayMediaRequestHandler((_request, callback) => callback({}));

    // Keep redirects issued by the app's server on the app's exact origin (see toAppUrl).
    ses.webRequest.onHeadersReceived((details, callback) => {
      const headers = details.responseHeaders;
      if (!headers || !isAppUrl(details.url)) return callback({});
      let changed = false;
      for (const name of Object.keys(headers)) {
        if (name.toLowerCase() !== "location") continue;
        headers[name] = (headers[name] ?? []).map((value) => {
          const fixed = toAppUrl(value);
          if (fixed === null || fixed === value) return value;
          changed = true;
          return fixed;
        });
      }
      callback(changed ? { responseHeaders: headers } : {});
    });
  });

  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-attach-webview", (event) => event.preventDefault());

    // Same-origin pop-ups open as hardened app windows; everything else goes to the default browser.
    contents.setWindowOpenHandler(({ url }) => {
      if (isAppUrl(url)) {
        return { action: "allow", overrideBrowserWindowOptions: { webPreferences: secureWebPreferences() } };
      }
      openExternalSafely(url, log);
      return { action: "deny" };
    });

    // Links and scripts in the page may only navigate within the app; other http(s)
    // links open in the default browser.
    contents.on("will-navigate", (details) => {
      if (isAppUrl(details.url)) return;
      details.preventDefault();
      const alias = toAppUrl(details.url);
      if (alias) void contents.loadURL(alias);
      else openExternalSafely(details.url, log);
    });

    // Server-side redirects of the top-level page must stay on the app's origin too.
    // (Frames, such as a bank's connection widget, are governed by the app's CSP instead.)
    contents.on("will-redirect", (details) => {
      if (!details.isMainFrame || isAppUrl(details.url)) return;
      details.preventDefault();
      const alias = toAppUrl(details.url);
      if (alias) {
        void contents.loadURL(alias);
        return;
      }
      log.warn("Blocked a redirect away from Harbour; opening it in the default browser instead.");
      openExternalSafely(details.url, log);
    });
  });
}
