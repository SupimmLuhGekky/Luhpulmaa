// @ts-check
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  MAX_ACCOUNT_BUTTONS,
  PASSWORD_RESET_TTL_MS,
  SESSION_COOKIE,
  chooseAccount,
  hashToken,
  listResettableUsers,
  mintPasswordResetToken,
  resetPasswordUrl,
  signOutWindow,
} from "../src/password-reset.mjs";

/**
 * @typedef {{ id: string, userId: string, type: string, tokenHash: string, expiresAt: Date, usedAt: Date | null }} TokenRow
 */

/**
 * In-memory stand-in for the "verification_tokens" table behind a pg client, with
 * transactions. Records every statement and its parameters.
 * @param {TokenRow[]} rows
 * @param {{ failOnInsert?: boolean }} [options]
 */
function fakeDatabase(rows, options = {}) {
  /** @type {TokenRow[]} */
  let table = rows.map((r) => ({ ...r }));
  /** @type {TokenRow[] | null} */
  let tx = null;
  /** @type {Array<{ text: string, values: unknown[] }>} */
  const statements = [];
  const current = () => tx ?? table;
  return {
    statements,
    rows: () => table,
    /** @param {string} text @param {unknown[]} [values] */
    async query(text, values = []) {
      statements.push({ text, values });
      if (text === "BEGIN") tx = table.map((r) => ({ ...r }));
      else if (text === "COMMIT") {
        table = tx ?? table;
        tx = null;
      } else if (text === "ROLLBACK") tx = null;
      else if (text.startsWith('DELETE FROM "verification_tokens"')) {
        assert.match(text, /"type" = 'PASSWORD_RESET' AND "usedAt" IS NULL/);
        tx = current().filter((r) => !(r.userId === values[0] && r.type === "PASSWORD_RESET" && r.usedAt === null));
      } else if (text.startsWith('INSERT INTO "verification_tokens"')) {
        if (options.failOnInsert) throw new Error("duplicate key value violates unique constraint");
        const type = /VALUES \(\$1, \$2, '([A-Z_]+)'/.exec(text)?.[1] ?? "?";
        current().push({
          id: String(values[0]),
          userId: String(values[1]),
          type,
          tokenHash: String(values[2]),
          expiresAt: new Date(String(values[3])),
          usedAt: null,
        });
      } else throw new Error(`unexpected statement: ${text}`);
      return { rows: [] };
    },
  };
}

const USER_A = "6f1f8f2e-7b7e-4a37-9d2e-4f3c2a1b0c01";
const USER_B = "0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c02";

test("reset tokens use the web app's format: 32 random bytes as base64url, stored as a SHA-256 hex hash", async () => {
  const db = fakeDatabase([]);
  const now = Date.UTC(2026, 9, 1, 12, 0, 0);
  const { token } = await mintPasswordResetToken(db, USER_A, { now });

  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(token, "base64url").length, 32);
  const [row] = db.rows();
  assert.ok(row);
  assert.equal(row.tokenHash, crypto.createHash("sha256").update(token).digest("hex"));
  assert.equal(row.tokenHash, hashToken(token));
  assert.match(row.tokenHash, /^[0-9a-f]{64}$/);
  assert.equal(row.type, "PASSWORD_RESET");
  assert.equal(row.userId, USER_A);
  assert.equal(row.usedAt, null);
  assert.match(row.id, /^[0-9a-f-]{36}$/);
  // The token itself never goes to the database, only its hash.
  assert.ok(db.statements.every((s) => !s.values.includes(token) && !s.text.includes(token)));
  // Two tokens are never the same.
  const second = await mintPasswordResetToken(db, USER_A, { now });
  assert.notEqual(second.token, token);
});

test("reset tokens expire one hour after they are made, stored as UTC like Prisma", async () => {
  const db = fakeDatabase([]);
  const now = Date.UTC(2026, 9, 1, 23, 30, 0);
  const { expiresAt } = await mintPasswordResetToken(db, USER_A, { now });
  assert.equal(PASSWORD_RESET_TTL_MS, 60 * 60 * 1000);
  assert.equal(expiresAt.getTime(), now + 60 * 60 * 1000);
  const insert = db.statements.find((s) => s.text.startsWith('INSERT INTO "verification_tokens"'));
  assert.ok(insert);
  // Sent as an absolute UTC instant and converted to UTC wall time in SQL, so the Mac's
  // time zone can't shift it (Prisma reads timestamp(3) columns as UTC).
  assert.equal(insert.values[3], "2026-10-02T00:30:00.000Z");
  assert.match(insert.text, /\$4::timestamptz AT TIME ZONE 'UTC'/);
  assert.equal(db.rows()[0]?.expiresAt.toISOString(), "2026-10-02T00:30:00.000Z");
});

test("only the newest unused reset token of a user stays live; other tokens are untouched", async () => {
  const db = fakeDatabase([
    { id: "used", userId: USER_A, type: "PASSWORD_RESET", tokenHash: "a".repeat(64), expiresAt: new Date(0), usedAt: new Date(0) },
    { id: "verify", userId: USER_A, type: "EMAIL_VERIFICATION", tokenHash: "b".repeat(64), expiresAt: new Date(0), usedAt: null },
    { id: "other-user", userId: USER_B, type: "PASSWORD_RESET", tokenHash: "c".repeat(64), expiresAt: new Date(0), usedAt: null },
  ]);
  const first = await mintPasswordResetToken(db, USER_A);
  const second = await mintPasswordResetToken(db, USER_A);

  const live = db.rows().filter((r) => r.userId === USER_A && r.type === "PASSWORD_RESET" && r.usedAt === null);
  assert.equal(live.length, 1);
  assert.equal(live[0]?.tokenHash, hashToken(second.token));
  assert.ok(!db.rows().some((r) => r.tokenHash === hashToken(first.token)));
  assert.deepEqual(
    db
      .rows()
      .map((r) => r.id)
      .filter((id) => ["used", "verify", "other-user"].includes(id))
      .sort(),
    ["other-user", "used", "verify"],
  );
  // Delete and insert happen in one transaction.
  assert.deepEqual(
    db.statements.slice(0, 4).map((s) => s.text.split(" ")[0]),
    ["BEGIN", "DELETE", "INSERT", "COMMIT"],
  );
});

test("a failed insert rolls back, so the previous link keeps working", async () => {
  const existing = { id: "old", userId: USER_A, type: "PASSWORD_RESET", tokenHash: "d".repeat(64), expiresAt: new Date(0), usedAt: null };
  const db = fakeDatabase([existing], { failOnInsert: true });
  await assert.rejects(mintPasswordResetToken(db, USER_A), /duplicate key/);
  assert.deepEqual(db.rows(), [existing]);
  assert.equal(db.statements.at(-1)?.text, "ROLLBACK");
});

test("reset links point at the web app's /reset-password page", () => {
  const token = crypto.randomBytes(32).toString("base64url");
  const url = resetPasswordUrl("http://127.0.0.1:47800", token);
  assert.equal(url, `http://127.0.0.1:47800/reset-password?token=${token}`);
  assert.equal(new URL(url).searchParams.get("token"), token);
});

test("the account list leaves out the demo account", async () => {
  /** @type {string[]} */
  const seen = [];
  const client = {
    /** @param {string} text */
    async query(text) {
      seen.push(text);
      return { rows: [{ id: USER_A, email: "sam@example.com", firstName: "Sam", lastName: "Lee" }] };
    },
  };
  const users = await listResettableUsers(client);
  assert.deepEqual(users, [{ id: USER_A, email: "sam@example.com", firstName: "Sam", lastName: "Lee" }]);
  assert.match(seen[0] ?? "", /FROM "users" WHERE NOT "isDemo"/);
});

/**
 * Stand-in for the native dialog: records what it was asked and clicks the given button.
 * @param {(options: Electron.MessageBoxOptions) => number} click
 */
function fakeDialog(click) {
  /** @type {Electron.MessageBoxOptions[]} */
  const shown = [];
  return {
    shown,
    /** @param {Electron.MessageBoxOptions} options */
    ask: async (options) => {
      shown.push(options);
      return { response: click(options) };
    },
  };
}

/** @param {number} n */
const someUsers = (n) =>
  Array.from({ length: n }, (_, i) => ({ id: crypto.randomUUID(), email: `person${i + 1}@example.com`, firstName: "Pat", lastName: `Number ${i + 1}` }));

test("account picker: no account says so and resets nothing", async () => {
  const dialog = fakeDialog(() => 0);
  assert.equal(await chooseAccount([], dialog.ask), null);
  assert.equal(dialog.shown.length, 1);
  assert.equal(dialog.shown[0]?.message, "There’s no account on this Mac yet.");
  assert.deepEqual(dialog.shown[0]?.buttons, ["OK"]);
});

test("account picker: one account is confirmed by its email", async () => {
  const [user] = someUsers(1);
  const confirm = fakeDialog(() => 0);
  assert.equal(await chooseAccount([user], confirm.ask), user);
  assert.equal(confirm.shown[0]?.message, `Reset the password for ${user?.email}?`);
  assert.equal(confirm.shown[0]?.cancelId, 1);
  const cancel = fakeDialog((options) => /** @type {number} */ (options.cancelId));
  assert.equal(await chooseAccount([user], cancel.ask), null);
});

test("account picker: several accounts get one button each, plus Cancel", async () => {
  const users = someUsers(3);
  const pickSecond = fakeDialog(() => 1);
  assert.equal(await chooseAccount(users, pickSecond.ask), users[1]);
  assert.deepEqual(pickSecond.shown[0]?.buttons, [...users.map((u) => u.email), "Cancel"]);
  const cancel = fakeDialog((options) => /** @type {number} */ (options.cancelId));
  assert.equal(await chooseAccount(users, cancel.ask), null);

  const many = someUsers(MAX_ACCOUNT_BUTTONS + 3);
  const last = fakeDialog(() => MAX_ACCOUNT_BUTTONS - 1);
  assert.equal(await chooseAccount(many, last.ask), many[MAX_ACCOUNT_BUTTONS - 1]);
  assert.equal(last.shown[0]?.buttons?.length, MAX_ACCOUNT_BUTTONS + 1);
  assert.match(String(last.shown[0]?.detail), new RegExp(`first ${MAX_ACCOUNT_BUTTONS} of ${MAX_ACCOUNT_BUTTONS + 3} accounts`));
});

test("signing the window out deletes its session (by token hash) and its cookie", async () => {
  /** @type {Array<{ text: string, values: unknown[] }>} */
  const statements = [];
  const client = {
    /** @param {string} text @param {unknown[]} [values] */
    async query(text, values = []) {
      statements.push({ text, values });
      return { rows: [] };
    },
  };
  /** @type {string[]} */
  const removed = [];
  const cookieValue = crypto.randomBytes(32).toString("base64url");
  const cookies = /** @type {Electron.Cookies} */ (
    /** @type {unknown} */ ({
      /** @param {{ name?: string }} filter */
      get: async (filter) => (filter.name === SESSION_COOKIE ? [{ name: SESSION_COOKIE, value: cookieValue }] : []),
      /** @param {string} _url @param {string} name */
      remove: async (_url, name) => void removed.push(name),
    })
  );
  assert.equal(await signOutWindow({ client, cookies, baseUrl: "http://127.0.0.1:47800" }), true);
  assert.deepEqual(statements, [{ text: 'DELETE FROM "sessions" WHERE "tokenHash" = $1', values: [hashToken(cookieValue)] }]);
  assert.deepEqual(removed, [SESSION_COOKIE]);

  const empty = /** @type {Electron.Cookies} */ (/** @type {unknown} */ ({ get: async () => [], remove: async () => {} }));
  assert.equal(await signOutWindow({ client, cookies: empty, baseUrl: "http://127.0.0.1:47800" }), false);
  assert.equal(statements.length, 1);
});

test("the shell's SQL matches the tables and columns in prisma/migrations", () => {
  const dir = path.resolve(import.meta.dirname, "..", "..", "prisma", "migrations");
  const sql = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .map((name) => fs.readFileSync(path.join(dir, name, "migration.sql"), "utf8"))
    .join("\n");
  /** @type {Record<string, string[]>} */
  const used = {
    users: ["id", "email", "passwordHash", "firstName", "lastName", "isDemo", "updatedAt"],
    verification_tokens: ["id", "userId", "type", "tokenHash", "expiresAt", "usedAt", "createdAt", "updatedAt"],
    sessions: ["tokenHash"],
    audit_logs: ["userId", "action"],
  };
  for (const [table, columns] of Object.entries(used)) {
    const create = new RegExp(`CREATE TABLE "${table}" \\(([\\s\\S]*?)\\n\\);`).exec(sql);
    assert.ok(create, `prisma/migrations creates table "${table}"`);
    for (const column of columns) {
      assert.match(create[1] ?? "", new RegExp(`\\n\\s+"${column}" `), `"${table}"."${column}" exists`);
      assert.doesNotMatch(sql, new RegExp(`ALTER TABLE "${table}"[^;]*(DROP|RENAME) COLUMN "${column}"`), `"${table}"."${column}" is not dropped or renamed`);
    }
  }
  assert.match(sql, /CREATE TYPE "VerificationTokenType" AS ENUM \([^)]*'PASSWORD_RESET'/);
});
