// @ts-check
import fs from "node:fs";

/**
 * Optional user configuration: <data>/harbour.env, in KEY=VALUE (dotenv) format.
 * Only the keys below are passed to the web server; everything the app needs to run
 * (database, secrets, URLs) is managed by the desktop shell and cannot be overridden.
 */
export const USER_ENV_ALLOWED = /^(BANKING_PROVIDER|ANTHROPIC_API_KEY|FLINKS_[A-Z0-9_]+|PLAID_[A-Z0-9_]+|ENABLE_[A-Z0-9_]+)$/;

/**
 * Parses dotenv-style text. Supports comments, blank lines, an optional `export ` prefix,
 * and single- or double-quoted values (double quotes understand \n, \r, \t, \" and \\).
 * @param {string} text
 * @returns {{ entries: Array<[string, string]>, invalidLines: number[] }}
 */
export function parseEnvText(text) {
  /** @type {Array<[string, string]>} */
  const entries = [];
  /** @type {number[]} */
  const invalidLines = [];
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) {
      invalidLines.push(index + 1);
      return;
    }
    const key = /** @type {string} */ (match[1]);
    let value = /** @type {string} */ (match[2]);
    if (value.startsWith('"')) {
      const end = findClosingQuote(value);
      if (end < 0) {
        invalidLines.push(index + 1);
        return;
      }
      value = value
        .slice(1, end)
        .replace(/\\(["\\nrt])/g, (_m, c) => ({ n: "\n", r: "\r", t: "\t" })[/** @type {"n" | "r" | "t"} */ (c)] ?? c);
    } else if (value.startsWith("'")) {
      const end = value.indexOf("'", 1);
      if (end < 0) {
        invalidLines.push(index + 1);
        return;
      }
      value = value.slice(1, end);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    entries.push([key, value]);
  });
  return { entries, invalidLines };
}

function findClosingQuote(/** @type {string} */ value) {
  for (let i = 1; i < value.length; i += 1) {
    if (value[i] === "\\") i += 1;
    else if (value[i] === '"') return i;
  }
  return -1;
}

/**
 * Keeps only allowed keys (later lines win). Returns the env to pass and the names of
 * ignored keys so they can be logged; values are never logged.
 * @param {Array<[string, string]>} entries
 */
export function filterUserEnv(entries) {
  /** @type {Record<string, string>} */
  const env = {};
  /** @type {Set<string>} */
  const ignored = new Set();
  for (const [key, value] of entries) {
    if (USER_ENV_ALLOWED.test(key)) env[key] = value;
    else ignored.add(key);
  }
  return { env, ignoredKeys: [...ignored] };
}

/**
 * Reads harbour.env if it exists. Problems are logged and never stop the app.
 * @param {string} file
 * @param {import("./logger.mjs").Logger} log
 * @returns {Record<string, string>}
 */
export function readUserEnv(file, log) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code !== "ENOENT") log.warn(`Could not read harbour.env: ${String(err)}`);
    return {};
  }
  try {
    const mode = fs.statSync(file).mode & 0o777;
    if (mode & 0o077) log.warn("harbour.env can be read by other users on this Mac; consider `chmod 600` since it may contain API keys.");
  } catch {
    // Permissions are advisory only.
  }
  const { entries, invalidLines } = parseEnvText(text);
  if (invalidLines.length) log.warn(`harbour.env: ignored unparseable line(s) ${invalidLines.join(", ")}.`);
  const { env, ignoredKeys } = filterUserEnv(entries);
  if (ignoredKeys.length) log.warn(`harbour.env: ignored keys that the desktop app does not allow: ${ignoredKeys.join(", ")}.`);
  const keys = Object.keys(env);
  log.info(keys.length ? `harbour.env: passing ${keys.join(", ")} to the server.` : "harbour.env: no allowed keys set.");
  return env;
}
