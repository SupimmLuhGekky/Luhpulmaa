// @ts-check
import fs from "node:fs";
import path from "node:path";

/**
 * Plain-text log files in <data>/logs with size-based rotation.
 *
 * Secrets never belong in logs: callers must not log env values, and every line is
 * additionally scrubbed of registered secret values and of credentials embedded in
 * connection URLs before it is written anywhere.
 */

const MAX_BYTES = 5 * 1024 * 1024;
const KEEP_ROTATED = 3;

/** @type {Set<string>} */
const secretValues = new Set();

/** Registers a value that must never appear in any log output. */
export function registerSecret(/** @type {string | undefined} */ value) {
  if (typeof value === "string" && value.length >= 8) secretValues.add(value);
}

/** Removes registered secrets and URL credentials from a line of text. */
export function redact(/** @type {string} */ text) {
  let out = text;
  for (const secret of secretValues) {
    if (out.includes(secret)) out = out.split(secret).join("[redacted]");
  }
  return out.replace(/\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/gi, "$1[redacted]@");
}

export class LogFile {
  /**
   * @param {string} dir
   * @param {string} name file name without extension
   * @param {{ mirror?: NodeJS.WritableStream | null }} [options]
   */
  constructor(dir, name, options = {}) {
    this.dir = dir;
    this.name = name;
    this.file = path.join(dir, `${name}.log`);
    this.mirror = options.mirror ?? null;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.size = 0;
    try {
      this.size = fs.statSync(this.file).size;
    } catch {
      this.size = 0;
    }
    if (this.size > MAX_BYTES) this.rotate();
  }

  rotate() {
    try {
      for (let i = KEEP_ROTATED - 1; i >= 1; i -= 1) {
        const from = path.join(this.dir, `${this.name}.${i}.log`);
        if (fs.existsSync(from)) fs.renameSync(from, path.join(this.dir, `${this.name}.${i + 1}.log`));
      }
      if (fs.existsSync(this.file)) fs.renameSync(this.file, path.join(this.dir, `${this.name}.1.log`));
    } catch {
      // Rotation is best effort; keep appending to the current file if it fails.
    }
    this.size = 0;
  }

  /** Appends text (one or more lines). Writes are synchronous so nothing is lost if the app exits right after. */
  write(/** @type {string} */ text) {
    const clean = redact(text.endsWith("\n") ? text : `${text}\n`);
    try {
      fs.appendFileSync(this.file, clean, { mode: 0o600 });
      this.size += Buffer.byteLength(clean);
      if (this.size > MAX_BYTES) this.rotate();
    } catch {
      // A full or read-only disk must not crash the app because of logging.
    }
    if (this.mirror) {
      try {
        this.mirror.write(`[${this.name}] ${clean}`);
      } catch {
        // The terminal may be gone (for example when launched from Finder).
      }
    }
  }

  /**
   * Copies a child process stream into this log, line by line.
   * @param {NodeJS.ReadableStream | null | undefined} stream
   * @param {(line: string) => void} [onLine]
   */
  pipe(stream, onLine) {
    if (!stream) return;
    let pending = "";
    stream.on("data", (/** @type {Buffer | string} */ chunk) => {
      pending += chunk.toString();
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) {
        this.write(`${new Date().toISOString()} ${line}`);
        onLine?.(line);
      }
    });
    stream.on("end", () => {
      if (pending) this.write(`${new Date().toISOString()} ${pending}`);
      pending = "";
    });
  }
}

/** @typedef {{ info: (msg: string) => void, warn: (msg: string) => void, error: (msg: string, err?: unknown) => void, dir: string, main: LogFile, server: LogFile, postgres: LogFile }} Logger */

/**
 * @param {string} logsDir
 * @param {{ mirrorToStdout?: boolean }} [options]
 * @returns {Logger}
 */
export function createLogger(logsDir, options = {}) {
  const mirror = options.mirrorToStdout ? process.stdout : null;
  const main = new LogFile(logsDir, "main", { mirror });
  const server = new LogFile(logsDir, "server", { mirror });
  const postgres = new LogFile(logsDir, "postgres", { mirror });
  /** @param {string} level @param {string} msg */
  const line = (level, msg) => main.write(`${new Date().toISOString()} [${level}] ${msg}`);
  return {
    dir: logsDir,
    main,
    server,
    postgres,
    info: (msg) => line("info", msg),
    warn: (msg) => line("warn", msg),
    error: (msg, err) => line("error", err === undefined ? msg : `${msg}: ${describeError(err)}`),
  };
}

/** One-line description of an error, including its cause chain, for the log. */
export function describeError(/** @type {unknown} */ err) {
  if (!(err instanceof Error)) return String(err);
  const parts = [];
  /** @type {unknown} */
  let current = err;
  for (let depth = 0; current instanceof Error && depth < 4; depth += 1) {
    const code = /** @type {{ code?: unknown }} */ (current).code;
    parts.push(`${current.name}${code ? ` [${String(code)}]` : ""}: ${current.message}`);
    current = current.cause;
  }
  const stack = err.stack?.split("\n").slice(1, 6).join("\n") ?? "";
  return `${parts.join(" <- ")}${stack ? `\n${stack}` : ""}`;
}
