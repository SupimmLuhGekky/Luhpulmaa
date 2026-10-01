// @ts-check
import crypto from "node:crypto";
import { dialog, session } from "electron";
import { DB_APP_USER, DB_NAME } from "./constants.mjs";
import { connect } from "./database.mjs";
import { registerSecret } from "./logger.mjs";
import { sleep } from "./net-utils.mjs";
import { SESSION_COOKIE, chooseAccount, hashToken, listResettableUsers, mintPasswordResetToken, resetPasswordUrl, signOutWindow } from "./password-reset.mjs";

/**
 * The Harbour → Reset Password… menu command: pick an account, then open the web app's
 * reset page with a fresh one-time link (see password-reset.mjs for the token rules).
 *
 * @typedef {import("./logger.mjs").Logger} Logger
 * @typedef {import("./password-reset.mjs").ResettableUser} ResettableUser
 * @typedef {{ baseUrl: string, dbPort: number, dbPassword: string }} RunningApp
 * @typedef {{
 *   log: Logger,
 *   runningApp: () => RunningApp | null,
 *   showUrl: (url: string) => Promise<Electron.BrowserWindow>,
 *   parentWindow: () => Electron.BrowserWindow | null,
 * }} FlowOptions
 */

/** @param {FlowOptions} options */
export function createPasswordResetFlow({ log, runningApp, showUrl, parentWindow }) {
  /**
   * @template T
   * @param {RunningApp} running
   * @param {(client: import("pg").Client) => Promise<T>} fn
   * @returns {Promise<T>}
   */
  async function withDatabase(running, fn) {
    const client = await connect({ port: running.dbPort, user: DB_APP_USER, password: running.dbPassword, database: DB_NAME });
    try {
      return await fn(client);
    } finally {
      await client.end().catch(() => {});
    }
  }

  /**
   * Shows a dialog as a sheet on the window when it's on screen; otherwise (window closed,
   * hidden or minimized, where a sheet would be invisible) as a free-standing dialog.
   * @param {Electron.MessageBoxOptions} options
   */
  function ask(options) {
    const parent = parentWindow();
    const onScreen = parent && !parent.isDestroyed() && parent.isVisible() && !parent.isMinimized();
    return onScreen ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options);
  }

  /**
   * Signs the window out, creates the link and opens it. The token is registered for
   * log redaction and never written anywhere else.
   * @param {RunningApp} running
   * @param {ResettableUser} user
   * @returns {Promise<{ win: Electron.BrowserWindow, signedOut: boolean }>}
   */
  async function openResetPage(running, user) {
    const { token, signedOut } = await withDatabase(running, async (client) => {
      const signedOutWindow = await signOutWindow({ client, cookies: session.defaultSession.cookies, baseUrl: running.baseUrl });
      const minted = await mintPasswordResetToken(client, user.id);
      return { token: minted.token, signedOut: signedOutWindow };
    });
    registerSecret(token);
    log.info(`Created a password reset link, valid for 1 hour${signedOut ? " (signed the window out first)" : ""}.`);
    const win = await showUrl(resetPasswordUrl(running.baseUrl, token));
    return { win, signedOut };
  }

  /** Set while the menu command runs, so a second click doesn't stack another dialog. */
  let busy = false;

  /** Menu command. */
  async function run() {
    if (busy) return;
    busy = true;
    try {
      const running = runningApp();
      if (!running) {
        await ask({ type: "info", message: "Harbour is still starting.", detail: "Try again in a moment.", buttons: ["OK"] });
        return;
      }
      try {
        const users = await withDatabase(running, listResettableUsers);
        const user = await chooseAccount(users, ask);
        if (user) await openResetPage(running, user);
      } catch (err) {
        log.error("Password reset failed", err);
        await ask({
          type: "error",
          message: "Harbour couldn’t start the password reset.",
          detail: "Try again. If it keeps happening, the logs folder (Help → Open Logs Folder) has the details.",
          buttons: ["OK"],
        });
      }
    } finally {
      busy = false;
    }
  }

  /**
   * Smoke-test check of the whole path, run only on a brand-new data folder: creates a
   * throwaway account and signs the window in as it, resets its password through the real
   * page with a shell-made link, checks the database, and deletes the account again.
   * Never fails the smoke test.
   * @param {RunningApp} running
   * @returns {Promise<string>}
   */
  async function smokeCheck(running) {
    const user = {
      id: crypto.randomUUID(),
      email: `smoke-test-${crypto.randomBytes(4).toString("hex")}@harbour.invalid`,
      firstName: "Smoke",
      lastName: "Test",
    };
    // Generated, used once and discarded; neither appears in logs.
    const newPassword = `Smoke-${crypto.randomBytes(12).toString("base64url")}-9a`;
    const sessionToken = crypto.randomBytes(32).toString("base64url");
    registerSecret(newPassword);
    registerSecret(sessionToken);
    let created = false;
    try {
      await withDatabase(running, (client) =>
        client.query(
          `INSERT INTO "users" ("id", "email", "passwordHash", "firstName", "lastName", "updatedAt")
           VALUES ($1, $2, '!', $3, $4, (now() AT TIME ZONE 'UTC'))`,
          [user.id, user.email, user.firstName, user.lastName],
        ),
      );
      created = true;
      // Sign the window in as that account (as the web app's createSession does), so the
      // check also covers signing the window out before the reset page opens.
      await withDatabase(running, (client) =>
        client.query(
          `INSERT INTO "sessions" ("id", "userId", "tokenHash", "expiresAt", "updatedAt")
           VALUES ($1, $2, $3, (now() AT TIME ZONE 'UTC') + interval '1 hour', (now() AT TIME ZONE 'UTC'))`,
          [crypto.randomUUID(), user.id, hashToken(sessionToken)],
        ),
      );
      await session.defaultSession.cookies.set({
        url: running.baseUrl,
        name: SESSION_COOKIE,
        value: sessionToken,
        path: "/",
        secure: true,
        httpOnly: true,
        sameSite: "lax",
        expirationDate: Math.floor(Date.now() / 1000) + 3600,
      });

      const { win, signedOut } = await openResetPage(running, user);
      const [leftCookie] = await session.defaultSession.cookies.get({ url: running.baseUrl, name: SESSION_COOKIE });
      const leftSessions = await withDatabase(running, (client) =>
        client.query(`SELECT count(*)::int AS n FROM "sessions" WHERE "tokenHash" = $1`, [hashToken(sessionToken)]),
      );
      if (!signedOut || leftCookie || leftSessions.rows[0]?.n !== 0) {
        return `error: the window wasn't signed out first (signed out=${signedOut}, cookie left=${Boolean(leftCookie)}, session rows left=${leftSessions.rows[0]?.n})`;
      }

      const deadline = Date.now() + 60_000;
      let submitted = false;
      while (!submitted && Date.now() < deadline) {
        submitted = await win.webContents
          .executeJavaScript(
            `(() => {
              const inputs = [...document.querySelectorAll('input[type="password"]')];
              const button = document.querySelector('button[type="submit"]');
              if (location.pathname !== "/reset-password" || inputs.length < 2 || !button || document.readyState !== "complete") return false;
              const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
              for (const input of inputs) {
                setValue.call(input, ${JSON.stringify(newPassword)});
                input.dispatchEvent(new Event("input", { bubbles: true }));
              }
              button.click();
              return true;
            })()`,
          )
          .catch(() => false);
        if (!submitted) await sleep(250);
      }
      if (!submitted) return "error: the reset page's form did not appear";

      /** @type {{ used: boolean, changed: boolean, audited: boolean }} */
      let state = { used: false, changed: false, audited: false };
      while (Date.now() < deadline) {
        state = await withDatabase(running, async (client) => {
          const token = await client.query(`SELECT count(*)::int AS n FROM "verification_tokens" WHERE "userId" = $1 AND "type" = 'PASSWORD_RESET' AND "usedAt" IS NOT NULL`, [user.id]);
          const account = await client.query(`SELECT "passwordHash" <> '!' AS changed FROM "users" WHERE "id" = $1`, [user.id]);
          const audit = await client.query(`SELECT count(*)::int AS n FROM "audit_logs" WHERE "userId" = $1 AND "action" = 'auth.password_reset'`, [user.id]);
          return { used: token.rows[0]?.n > 0, changed: account.rows[0]?.changed === true, audited: audit.rows[0]?.n > 0 };
        });
        if (state.used && state.changed && state.audited) break;
        await sleep(500);
      }
      if (!(state.used && state.changed && state.audited)) {
        return `error: after submitting, token used=${state.used}, password changed=${state.changed}, audit entry=${state.audited}`;
      }
      const confirmation = await win.webContents
        .executeJavaScript(`document.body.innerText.includes("Password updated")`)
        .catch(() => false);
      return `ok (window signed out first; shell-made link accepted by /reset-password: token used, password changed, audit entry written${confirmation ? ", page confirmed" : ""})`;
    } catch (err) {
      return `error: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      if (created) {
        await withDatabase(running, async (client) => {
          await client.query(`DELETE FROM "audit_logs" WHERE "userId" = $1`, [user.id]);
          await client.query(`DELETE FROM "users" WHERE "id" = $1`, [user.id]);
        }).catch((err) => log.warn(`Smoke test: could not remove the throwaway account: ${err instanceof Error ? err.message : String(err)}`));
      }
      await session.defaultSession.clearStorageData({ origin: running.baseUrl, storages: ["cookies"] }).catch(() => {});
    }
  }

  return { run, smokeCheck };
}
