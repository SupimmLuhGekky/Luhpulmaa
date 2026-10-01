// @ts-check
import crypto from "node:crypto";

/**
 * Password reset without email (Harbour → Reset Password…).
 *
 * The Mac app can't send email, so the shell does what the web app's
 * requestPasswordReset does before it emails a link (lib/auth/service.ts, issueToken):
 * it creates a PASSWORD_RESET verification token and opens the link itself. The web
 * app's /reset-password page then consumes the token, sets the new password, signs
 * the account out everywhere and writes the audit entry, exactly as for an emailed link.
 *
 * Mirrors of the web app's rules (keep in sync):
 *  - token: 32 random bytes, base64url (lib/security/tokens.ts generateToken)
 *  - stored: SHA-256 hex of the token string, never the token (hashToken)
 *  - lifetime: 1 hour (lib/auth/constants.ts PASSWORD_RESET_TTL_MS)
 *  - only the newest unused token of a type is valid for a user (issueToken)
 *
 * Tables and columns are Prisma's (prisma/migrations): "users", "verification_tokens".
 * Prisma stores DateTime in `timestamp(3)` columns as UTC, so times are converted to
 * UTC in SQL and never depend on the Mac's time zone.
 *
 * @typedef {{ query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> }} Queryable
 * @typedef {{ id: string, email: string, firstName: string, lastName: string }} ResettableUser
 */

export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
export const SESSION_COOKIE = "harbour_session";

/** SHA-256 hex digest of a token string, as the web app stores it. */
export function hashToken(/** @type {string} */ token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Accounts whose password can be reset: everyone except the shared demo account.
 * @param {Queryable} client
 * @returns {Promise<ResettableUser[]>}
 */
export async function listResettableUsers(client) {
  const { rows } = await client.query(
    `SELECT "id", "email", "firstName", "lastName" FROM "users" WHERE NOT "isDemo" ORDER BY lower("email")`,
  );
  return rows.map((r) => ({ id: String(r.id), email: String(r.email), firstName: String(r.firstName), lastName: String(r.lastName) }));
}

/**
 * Creates a password reset token for a user: in one transaction, deletes the user's
 * unused PASSWORD_RESET tokens and inserts the new one. Returns the token itself, which
 * exists nowhere else (the database keeps only its hash). Callers must never log it.
 * @param {Queryable} client
 * @param {string} userId
 * @param {{ now?: number }} [options]
 * @returns {Promise<{ token: string, expiresAt: Date }>}
 */
export async function mintPasswordResetToken(client, userId, options = {}) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date((options.now ?? Date.now()) + PASSWORD_RESET_TTL_MS);
  await client.query("BEGIN");
  try {
    await client.query(`DELETE FROM "verification_tokens" WHERE "userId" = $1 AND "type" = 'PASSWORD_RESET' AND "usedAt" IS NULL`, [userId]);
    await client.query(
      `INSERT INTO "verification_tokens" ("id", "userId", "type", "tokenHash", "expiresAt", "createdAt", "updatedAt")
       VALUES ($1, $2, 'PASSWORD_RESET', $3, ($4::timestamptz AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))`,
      [crypto.randomUUID(), userId, hashToken(token), expiresAt.toISOString()],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  }
  return { token, expiresAt };
}

/** At most this many accounts are offered as buttons in the account picker. */
export const MAX_ACCOUNT_BUTTONS = 12;

/**
 * Asks whose password to reset, with native dialogs (`ask` shows one and resolves to
 * the clicked button): no account → says so; one → asks to confirm it by email; several →
 * one button per account. Resolves to the chosen account, or null when there is none or
 * the person cancels.
 * @param {ResettableUser[]} users
 * @param {(options: Electron.MessageBoxOptions) => Promise<{ response: number }>} ask
 * @returns {Promise<ResettableUser | null>}
 */
export async function chooseAccount(users, ask) {
  const explain = "Harbour signs its window out, then opens a page where you choose a new password. The link works once and expires in an hour.";
  if (users.length === 0) {
    await ask({
      type: "info",
      message: "There’s no account on this Mac yet.",
      detail: "To create one, choose Create an account on the sign-in page.",
      buttons: ["OK"],
    });
    return null;
  }
  if (users.length === 1) {
    const [user] = /** @type {[ResettableUser]} */ (users);
    const { response } = await ask({
      type: "question",
      message: `Reset the password for ${user.email}?`,
      detail: explain,
      buttons: ["Reset Password…", "Cancel"],
      defaultId: 0,
      cancelId: 1,
    });
    return response === 0 ? user : null;
  }
  const offered = users.slice(0, MAX_ACCOUNT_BUTTONS);
  const { response } = await ask({
    type: "question",
    message: "Which account’s password do you want to reset?",
    detail: explain + (users.length > offered.length ? `\n\nShowing the first ${offered.length} of ${users.length} accounts.` : ""),
    buttons: [...offered.map((u) => u.email), "Cancel"],
    defaultId: 0,
    cancelId: offered.length,
  });
  return offered[response] ?? null;
}

/** The web app's page that consumes a reset token. */
export function resetPasswordUrl(/** @type {string} */ baseUrl, /** @type {string} */ token) {
  return `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;
}

/**
 * Signs the app window out (what the web app's destroyCurrentSession does): deletes the
 * session behind the window's cookie and the cookie itself. After a reset the page sends
 * people to sign in, which would otherwise bounce whoever is still signed in (for example
 * the demo account) straight back to their dashboard.
 * @param {{ client: Queryable, cookies: Electron.Cookies, baseUrl: string }} options
 * @returns {Promise<boolean>} whether a session was signed out
 */
export async function signOutWindow({ client, cookies, baseUrl }) {
  const [cookie] = await cookies.get({ url: baseUrl, name: SESSION_COOKIE });
  if (!cookie) return false;
  await client.query(`DELETE FROM "sessions" WHERE "tokenHash" = $1`, [hashToken(cookie.value)]);
  await cookies.remove(baseUrl, SESSION_COOKIE);
  return true;
}
