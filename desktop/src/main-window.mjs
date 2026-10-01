// @ts-check
import fs from "node:fs";
import { BrowserWindow, nativeTheme, screen } from "electron";
import { secureWebPreferences } from "./security.mjs";

/**
 * The main app window, with its size and position remembered between launches.
 * @typedef {{ x?: number, y?: number, width: number, height: number, maximized?: boolean, fullScreen?: boolean }} WindowState
 */

const DEFAULT_STATE = { width: 1280, height: 840 };
const MIN_SIZE = { width: 900, height: 600 };

/** @returns {WindowState} */
function loadState(/** @type {string} */ file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const state = {
      x: Number.isFinite(raw.x) ? raw.x : undefined,
      y: Number.isFinite(raw.y) ? raw.y : undefined,
      width: Math.max(MIN_SIZE.width, Number(raw.width) || DEFAULT_STATE.width),
      height: Math.max(MIN_SIZE.height, Number(raw.height) || DEFAULT_STATE.height),
      maximized: raw.maximized === true,
      fullScreen: raw.fullScreen === true,
    };
    // Only restore a position that is still (mostly) on a connected display.
    if (state.x !== undefined && state.y !== undefined) {
      const { x, y, width, height } = /** @type {{ x: number, y: number, width: number, height: number }} */ (state);
      const visible = screen.getAllDisplays().some(({ workArea: a }) => {
        const overlapW = Math.min(x + width, a.x + a.width) - Math.max(x, a.x);
        const overlapH = Math.min(y + height, a.y + a.height) - Math.max(y, a.y);
        return overlapW >= 200 && overlapH >= 120;
      });
      if (!visible) {
        state.x = undefined;
        state.y = undefined;
      }
    }
    return state;
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function saveState(/** @type {string} */ file, /** @type {BrowserWindow} */ win) {
  if (win.isDestroyed()) return;
  const bounds = win.getNormalBounds();
  /** @type {WindowState} */
  const state = { ...bounds, maximized: win.isMaximized(), fullScreen: win.isFullScreen() };
  try {
    fs.writeFileSync(file, JSON.stringify(state), { mode: 0o600 });
  } catch {
    // Not worth interrupting anything for.
  }
}

/**
 * @param {{ url: string, stateFile: string, onReadyToShow?: () => void }} options
 */
export function createMainWindow({ url, stateFile, onReadyToShow }) {
  const state = loadState(stateFile);
  const win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    show: false,
    title: "Harbour",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0a0d12" : "#f6f7f9",
    webPreferences: secureWebPreferences(),
  });
  if (state.maximized) win.maximize();
  if (state.fullScreen) win.setFullScreen(true);

  /** @type {NodeJS.Timeout | undefined} */
  let timer;
  const scheduleSave = () => {
    clearTimeout(timer);
    timer = setTimeout(() => saveState(stateFile, win), 500);
  };
  win.on("resize", scheduleSave);
  win.on("move", scheduleSave);
  win.on("close", () => {
    clearTimeout(timer);
    saveState(stateFile, win);
  });

  win.once("ready-to-show", () => {
    win.show();
    onReadyToShow?.();
  });
  void win.loadURL(url).catch(() => {
    // Load failures surface through did-fail-load; the caller decides what to do.
  });
  return win;
}
