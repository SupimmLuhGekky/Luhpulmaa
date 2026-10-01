// @ts-check
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { safeStorage } from "electron";
import { registerSecret } from "./logger.mjs";

/**
 * Secrets generated on first launch with the OS CSPRNG:
 *  - authSecret       AUTH_SECRET for the web app's sessions
 *  - encryptionKey    ENCRYPTION_KEY (base64 of 32 bytes) for provider tokens at rest
 *  - cronSecret       CRON_SECRET for the daily-jobs endpoint
 *  - dbPassword       password of the app's database role
 *  - dbAdminPassword  password of the database superuser (used only by this shell)
 *
 * They are stored as JSON encrypted with Electron's safeStorage, whose key lives in the
 * macOS Keychain ("Harbour Safe Storage"). Only when no OS-backed store exists (for
 * example headless Linux CI) do they fall back to a file readable by the user alone.
 */

/**
 * @typedef {{
 *   version: 1,
 *   createdAt: string,
 *   authSecret: string,
 *   encryptionKey: string,
 *   cronSecret: string,
 *   dbPassword: string,
 *   dbAdminPassword: string,
 * }} Secrets
 * @typedef {"keychain" | "file"} SecretsStorage
 * @typedef {import("./logger.mjs").Logger} Logger
 */

const ENCRYPTED_FILE = "secrets.enc";
const PLAIN_FILE = "secrets.json";

export class SecretsError extends Error {
  /**
   * @param {"KEYCHAIN_UNAVAILABLE" | "KEYCHAIN_DENIED" | "SECRETS_CORRUPT" | "SECRETS_WRITE_FAILED"} code
   * @param {string} message
   * @param {{ cause?: unknown }} [options]
   */
  constructor(code, message, options) {
    super(message, options);
    this.name = "SecretsError";
    this.code = code;
  }
}

/** @returns {Secrets} */
export function generateSecrets() {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    authSecret: crypto.randomBytes(48).toString("base64url"),
    encryptionKey: crypto.randomBytes(32).toString("base64"),
    cronSecret: crypto.randomBytes(32).toString("base64url"),
    dbPassword: crypto.randomBytes(32).toString("base64url"),
    dbAdminPassword: crypto.randomBytes(32).toString("base64url"),
  };
}

/** @returns {Secrets} */
function validate(/** @type {unknown} */ value) {
  const v = /** @type {Record<string, unknown>} */ (value ?? {});
  const fields = ["authSecret", "encryptionKey", "cronSecret", "dbPassword", "dbAdminPassword"];
  const ok =
    v.version === 1 &&
    fields.every((f) => typeof v[f] === "string" && /** @type {string} */ (v[f]).length >= 32) &&
    Buffer.from(/** @type {string} */ (v.encryptionKey), "base64").length === 32;
  if (!ok) throw new SecretsError("SECRETS_CORRUPT", "The stored keys are incomplete or damaged.");
  return /** @type {Secrets} */ (value);
}

/** True when safeStorage is backed by a real OS secret store (not Chromium's hard-coded fallback key). */
export function keychainAvailable() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false;
    if (process.platform === "linux") {
      const backend = safeStorage.getSelectedStorageBackend();
      if (backend === "basic_text" || backend === "unknown") return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Writes a file atomically with owner-only permissions. */
function writePrivateFile(/** @type {string} */ file, /** @type {Buffer | string} */ data) {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    const fd = fs.openSync(tmp, "w", 0o600);
    try {
      fs.writeSync(fd, typeof data === "string" ? Buffer.from(data, "utf8") : data);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
    fs.chmodSync(file, 0o600);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw new SecretsError("SECRETS_WRITE_FAILED", `Could not save keys to ${path.basename(file)}.`, { cause: err });
  }
}

/** @returns {Buffer | null} */
function readIfExists(/** @type {string} */ file) {
  try {
    return fs.readFileSync(file);
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === "ENOENT") return null;
    throw err;
  }
}

/**
 * @param {string} dataDir
 * @param {Secrets} secrets
 * @param {Logger} log
 * @returns {SecretsStorage}
 */
function persist(dataDir, secrets, log) {
  const json = JSON.stringify(secrets);
  if (keychainAvailable()) {
    writePrivateFile(path.join(dataDir, ENCRYPTED_FILE), safeStorage.encryptString(json));
    return "keychain";
  }
  log.warn(
    `No OS keychain is available, so Harbour's keys are stored in ${PLAIN_FILE}, readable only by your user account. ` +
      "This is expected on headless Linux test machines; on a Mac the Keychain is used.",
  );
  writePrivateFile(path.join(dataDir, PLAIN_FILE), json);
  return "file";
}

function remember(/** @type {Secrets} */ secrets) {
  for (const value of [secrets.authSecret, secrets.encryptionKey, secrets.cronSecret, secrets.dbPassword, secrets.dbAdminPassword]) {
    registerSecret(value);
  }
  return secrets;
}

/**
 * Loads the stored secrets. Returns null when none have ever been created.
 * Never regenerates secrets that exist but cannot be read: doing so would lock the
 * app out of its own database and encrypted data.
 *
 * @param {string} dataDir
 * @param {Logger} log
 * @returns {{ secrets: Secrets, storage: SecretsStorage } | null}
 */
export function loadSecrets(dataDir, log) {
  const encrypted = readIfExists(path.join(dataDir, ENCRYPTED_FILE));
  if (encrypted) {
    if (!keychainAvailable()) {
      throw new SecretsError("KEYCHAIN_UNAVAILABLE", "The keychain that protects Harbour's keys is not available.");
    }
    let json;
    try {
      json = safeStorage.decryptString(encrypted);
    } catch (err) {
      throw new SecretsError("KEYCHAIN_DENIED", "Harbour's keys could not be unlocked with the keychain.", { cause: err });
    }
    let parsed;
    try {
      parsed = JSON.parse(json);
    } catch (err) {
      throw new SecretsError("SECRETS_CORRUPT", "The stored keys are damaged.", { cause: err });
    }
    return { secrets: remember(validate(parsed)), storage: "keychain" };
  }

  const plain = readIfExists(path.join(dataDir, PLAIN_FILE));
  if (plain) {
    let parsed;
    try {
      parsed = JSON.parse(plain.toString("utf8"));
    } catch (err) {
      throw new SecretsError("SECRETS_CORRUPT", "The stored keys are damaged.", { cause: err });
    }
    const secrets = remember(validate(parsed));
    if (keychainAvailable()) {
      // A keychain appeared since the keys were saved: move them into it.
      writePrivateFile(path.join(dataDir, ENCRYPTED_FILE), safeStorage.encryptString(JSON.stringify(secrets)));
      fs.rmSync(path.join(dataDir, PLAIN_FILE), { force: true });
      log.info("Moved Harbour's keys into the OS keychain.");
      return { secrets, storage: "keychain" };
    }
    log.warn(`No OS keychain is available; using the keys stored in ${PLAIN_FILE} (owner-only file).`);
    return { secrets, storage: "file" };
  }
  return null;
}

/**
 * Creates and stores a fresh set of secrets (first launch).
 * @param {string} dataDir
 * @param {Logger} log
 * @returns {{ secrets: Secrets, storage: SecretsStorage }}
 */
export function createSecrets(dataDir, log) {
  const secrets = remember(generateSecrets());
  const storage = persist(dataDir, secrets, log);
  log.info(`Generated new keys (stored in ${storage === "keychain" ? "the OS keychain" : PLAIN_FILE}).`);
  return { secrets, storage };
}

/**
 * Keeps unreadable key files for the record and creates new keys. Used only after the
 * user explicitly confirms "Create New Keys" when the keychain can no longer unlock them.
 * @param {string} dataDir
 * @param {Logger} log
 */
export function replaceUnreadableSecrets(dataDir, log) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  for (const name of [ENCRYPTED_FILE, PLAIN_FILE]) {
    const file = path.join(dataDir, name);
    if (fs.existsSync(file)) fs.renameSync(file, `${file}.unreadable-${stamp}`);
  }
  log.warn("Set aside keys that could no longer be unlocked and created new ones at the user's request.");
  return createSecrets(dataDir, log);
}
