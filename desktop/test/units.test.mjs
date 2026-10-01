// @ts-check
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { redact, registerSecret } from "../src/logger.mjs";
import { CREATE_MIGRATIONS_TABLE, applyMigrations, checksumOf, readMigrations } from "../src/migrate.mjs";
import { scramSha256Verifier } from "../src/scram.mjs";
import { filterUserEnv, parseEnvText } from "../src/userenv.mjs";
import { compareVersions, latestDesktopRelease } from "../src/versions.mjs";

test("harbour.env parsing: comments, export, quotes, inline comments", () => {
  const { entries, invalidLines } = parseEnvText(
    [
      "# comment",
      "",
      "BANKING_PROVIDER=plaid",
      "export PLAID_CLIENT_ID = abc123 # trailing comment",
      'PLAID_SECRET="s3cr#et \\"quoted\\" \\n"',
      "ANTHROPIC_API_KEY='sk-ant-x#y'",
      "not a valid line",
      'BROKEN="unterminated',
    ].join("\n"),
  );
  assert.deepEqual(entries, [
    ["BANKING_PROVIDER", "plaid"],
    ["PLAID_CLIENT_ID", "abc123"],
    ["PLAID_SECRET", 's3cr#et "quoted" \n'],
    ["ANTHROPIC_API_KEY", "sk-ant-x#y"],
  ]);
  assert.deepEqual(invalidLines, [7, 8]);
});

test("harbour.env allow-list keeps only provider, AI and feature-flag keys", () => {
  const { env, ignoredKeys } = filterUserEnv([
    ["BANKING_PROVIDER", "flinks"],
    ["FLINKS_CUSTOMER_ID", "1"],
    ["PLAID_ENV", "sandbox"],
    ["ENABLE_AI_ASSISTANT", "true"],
    ["ANTHROPIC_API_KEY", "k"],
    ["DATABASE_URL", "postgres://evil"],
    ["AUTH_SECRET", "x"],
    ["APP_URL", "http://evil"],
    ["NODE_OPTIONS", "--require x"],
    ["DEMO_MODE", "false"],
  ]);
  assert.deepEqual(Object.keys(env).sort(), ["ANTHROPIC_API_KEY", "BANKING_PROVIDER", "ENABLE_AI_ASSISTANT", "FLINKS_CUSTOMER_ID", "PLAID_ENV"]);
  assert.deepEqual(ignoredKeys.sort(), ["APP_URL", "AUTH_SECRET", "DATABASE_URL", "DEMO_MODE", "NODE_OPTIONS"]);
});

test("version comparison and release selection", () => {
  assert.ok(compareVersions("0.2.0", "0.1.9") > 0);
  assert.ok(compareVersions("1.0.0", "1.0.0-beta.1") > 0);
  assert.equal(compareVersions("1.2.3", "v1.2.3"), 0);
  const latest = latestDesktopRelease([
    { tag_name: "v9.9.9", html_url: "https://github.com/SupimmLuhGekky/Luhpulmaa/releases/tag/v9.9.9" },
    { tag_name: "desktop-v0.3.0", html_url: "https://github.com/SupimmLuhGekky/Luhpulmaa/releases/tag/desktop-v0.3.0", draft: true },
    { tag_name: "desktop-v0.2.1", html_url: "https://github.com/SupimmLuhGekky/Luhpulmaa/releases/tag/desktop-v0.2.1" },
    { tag_name: "desktop-v0.4.0-beta.1", html_url: "https://github.com/SupimmLuhGekky/Luhpulmaa/releases/tag/desktop-v0.4.0-beta.1" },
    { tag_name: "desktop-v0.2.0", html_url: "https://evil.example/releases" },
  ]);
  assert.deepEqual(latest, { version: "0.2.1", url: "https://github.com/SupimmLuhGekky/Luhpulmaa/releases/tag/desktop-v0.2.1" });
  assert.equal(latestDesktopRelease([]), null);
});

test("SCRAM-SHA-256 verifier matches the RFC 7677 test vector", () => {
  // RFC 7677 §3: password "pencil", salt W22ZaJ0SNY7soEsUEjb6gQ==, 4096 iterations.
  const verifier = scramSha256Verifier("pencil", { salt: Buffer.from("W22ZaJ0SNY7soEsUEjb6gQ==", "base64"), iterations: 4096 });
  const [, keys] = verifier.split("$").slice(1);
  const [storedKey, serverKey] = /** @type {string} */ (keys).split(":");
  // ServerSignature from the RFC proves ServerKey; StoredKey = H(ClientKey) is checked via the ClientProof.
  const authMessage =
    "n=user,r=rOprNGfwEbeRWgbNEkqO,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096,c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0";
  const serverSignature = crypto.createHmac("sha256", Buffer.from(/** @type {string} */ (serverKey), "base64")).update(authMessage).digest("base64");
  assert.equal(serverSignature, "6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=");
  const clientSignature = crypto.createHmac("sha256", Buffer.from(/** @type {string} */ (storedKey), "base64")).update(authMessage).digest();
  const clientProof = Buffer.from("dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=", "base64");
  const clientKey = Buffer.from(clientSignature.map((b, i) => b ^ /** @type {number} */ (clientProof[i])));
  assert.equal(crypto.createHash("sha256").update(clientKey).digest("base64"), storedKey);
  assert.match(verifier, /^SCRAM-SHA-256\$4096:W22ZaJ0SNY7soEsUEjb6gQ==\$[A-Za-z0-9+/=]{44}:[A-Za-z0-9+/=]{44}$/);
});

test("log redaction removes registered secrets and URL credentials", () => {
  registerSecret("super-secret-value-123");
  assert.equal(redact("token super-secret-value-123 here"), "token [redacted] here");
  assert.equal(redact("postgresql://harbour:p%40ss@127.0.0.1:5432/harbour"), "postgresql://harbour:[redacted]@127.0.0.1:5432/harbour");
  assert.equal(redact("nothing to hide"), "nothing to hide");
});

test("migrations: Prisma-compatible bookkeeping, idempotent, atomic on failure", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harbour-migrations-"));
  for (const [name, sql] of [
    ["20260101000000_b", "CREATE TABLE b (id int);"],
    ["20250101000000_a", "CREATE TABLE a (id int);"],
  ]) {
    fs.mkdirSync(path.join(dir, name));
    fs.writeFileSync(path.join(dir, name, "migration.sql"), sql);
  }
  const migrations = readMigrations(dir);
  assert.deepEqual(
    migrations.map((m) => m.name),
    ["20250101000000_a", "20260101000000_b"],
  );
  assert.equal(migrations[0]?.checksum, crypto.createHash("sha256").update("CREATE TABLE a (id int);").digest("hex"));
  assert.equal(checksumOf("x").length, 64);

  /** Minimal in-memory stand-in for a pg client. */
  function fakeClient(/** @type {{ failOn?: string }} */ options = {}) {
    /** @type {any[]} */
    const table = [];
    /** @type {string[]} */
    const log = [];
    /** @type {any[] | null} */
    let tx = null;
    return {
      log,
      table,
      async query(/** @type {string} */ text, /** @type {unknown[]} */ values = []) {
        log.push(text.split("\n")[0] ?? "");
        if (text === "BEGIN") tx = [];
        else if (text === "COMMIT") {
          table.push(...(tx ?? []));
          tx = null;
        }
        else if (text === "ROLLBACK") tx = null;
        else if (text.startsWith('INSERT INTO "_prisma_migrations"'))
          tx?.push({ id: values[0], checksum: values[1], migration_name: values[2], finished_at: null, rolled_back_at: null });
        else if (text.startsWith('UPDATE "_prisma_migrations"')) {
          const row = tx?.find((r) => r.id === values[0]);
          if (row) row.finished_at = new Date();
        } else if (text.startsWith('SELECT "id"')) return { rows: [...table] };
        else if (options.failOn && text.includes(options.failOn)) throw new Error("syntax error");
        return { rows: [] };
      },
    };
  }

  const client = fakeClient();
  const messages = { info: () => {}, warn: () => {} };
  const first = await applyMigrations({ client, migrations, log: messages });
  assert.deepEqual(first.applied, ["20250101000000_a", "20260101000000_b"]);
  assert.ok(client.log.includes(CREATE_MIGRATIONS_TABLE.split("\n")[0] ?? ""));
  assert.ok(client.log[0]?.startsWith("SELECT pg_advisory_lock"));
  assert.equal(client.table.length, 2);
  const second = await applyMigrations({ client, migrations, log: messages });
  assert.deepEqual(second.applied, []);

  const failing = fakeClient({ failOn: "CREATE TABLE b" });
  await assert.rejects(applyMigrations({ client: failing, migrations, log: messages }), /Migration 20260101000000_b failed/);
  assert.deepEqual(
    failing.table.map((r) => r.migration_name),
    ["20250101000000_a"],
  );
  assert.ok(failing.log.includes("ROLLBACK"));
  fs.rmSync(dir, { recursive: true, force: true });
});
