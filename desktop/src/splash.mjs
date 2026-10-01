// @ts-check
import { BrowserWindow, nativeTheme } from "electron";
import { secureWebPreferences } from "./security.mjs";

/**
 * Small "Starting Harbour…" window shown while the database and server boot.
 * It is a self-contained data: URL page (no network, no scripts of its own).
 */

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="72" height="72" aria-hidden="true"><rect width="32" height="32" rx="9" fill="#0f766e"/><path d="M16 8.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Zm0 5v10.5" stroke="#fff" stroke-width="2" stroke-linecap="round" fill="none"/><path d="M9 18.5c0 3.6 3.1 5.5 7 5.5s7-1.9 7-5.5" stroke="#fff" stroke-width="2" stroke-linecap="round" fill="none"/><path d="M12.5 16.5h7" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>`;

const HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<title>Starting Harbour</title>
<style>
  :root { color-scheme: light dark; --bg: #f6f7f9; --fg: #111827; --muted: #6b7280; --track: #e5e7eb; --accent: #0f766e; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0a0d12; --fg: #f3f4f6; --muted: #9ca3af; --track: #1f2937; --accent: #2dd4bf; } }
  html, body { height: 100%; margin: 0; }
  body { background: var(--bg); color: var(--fg); font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; -webkit-app-region: drag; user-select: none; cursor: default; }
  h1 { font-size: 17px; font-weight: 600; margin: 6px 0 0; letter-spacing: -0.01em; }
  #status { color: var(--muted); min-height: 18px; text-align: center; padding: 0 24px; }
  .bar { width: 160px; height: 3px; border-radius: 3px; background: var(--track); overflow: hidden; margin-top: 4px; }
  .bar::after { content: ""; display: block; width: 40%; height: 100%; border-radius: 3px; background: var(--accent); animation: slide 1.2s ease-in-out infinite; }
  @keyframes slide { from { transform: translateX(-100%); } to { transform: translateX(250%); } }
  @media (prefers-reduced-motion: reduce) { .bar::after { animation: none; width: 100%; opacity: .5; } }
</style></head>
<body>${ICON}<h1>Starting Harbour…</h1><div id="status" role="status">Getting things ready</div><div class="bar" aria-hidden="true"></div></body></html>`;

export function createSplashWindow() {
  const win = new BrowserWindow({
    width: 360,
    height: 260,
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    center: true,
    title: "Starting Harbour",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0a0d12" : "#f6f7f9",
    webPreferences: { ...secureWebPreferences(), devTools: false },
  });
  win.once("ready-to-show", () => win.show());
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(HTML)}`);
  return win;
}

/** Updates the status line under the title. */
export function setSplashStatus(/** @type {BrowserWindow | null} */ win, /** @type {string} */ text) {
  if (!win || win.isDestroyed()) return;
  const code = `document.getElementById("status").textContent = ${JSON.stringify(text)};`;
  win.webContents.executeJavaScript(code).catch(() => {});
}
