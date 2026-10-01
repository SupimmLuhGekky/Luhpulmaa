// @ts-check
import { app, Menu, shell } from "electron";
import { RELEASES_URL } from "./constants.mjs";

/**
 * Standard macOS menu bar. Edit uses Electron's roles so copy, paste, undo and
 * select-all work in every text field.
 * @param {{ dataDir: string, logsDir: string, onCheckForUpdates: () => void, onResetPassword: () => void }} options
 */
export function installMenu({ dataDir, logsDir, onCheckForUpdates, onResetPassword }) {
  const isMac = process.platform === "darwin";
  const isDev = !app.isPackaged;

  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [
    ...(isMac
      ? [
          /** @type {Electron.MenuItemConstructorOptions} */ ({
            label: app.name,
            submenu: [
              { role: "about" },
              { label: "Check for Updates…", click: onCheckForUpdates },
              { type: "separator" },
              // The Mac app can't email reset links; this opens one directly (see password-reset-flow.mjs).
              { label: "Reset Password…", click: onResetPassword },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          }),
        ]
      : []),
    {
      label: "File",
      submenu: [isMac ? { role: "close" } : { role: "quit" }],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        ...(isDev ? [/** @type {Electron.MenuItemConstructorOptions} */ ({ role: "toggleDevTools" })] : []),
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        // Cmd+= is what most people press for "zoom in" on a US keyboard.
        { role: "zoomIn", accelerator: "CommandOrControl+=", visible: false },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        { label: "Open Data Folder", click: () => void shell.openPath(dataDir) },
        { label: "Open Logs Folder", click: () => void shell.openPath(logsDir) },
        { type: "separator" },
        { label: "Harbour Releases", click: () => void shell.openExternal(RELEASES_URL) },
        ...(isMac
          ? []
          : /** @type {Electron.MenuItemConstructorOptions[]} */ ([
              { label: "Reset Password…", click: onResetPassword },
              { label: "Check for Updates…", click: onCheckForUpdates },
            ])),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
