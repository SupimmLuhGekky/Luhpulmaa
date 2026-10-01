// @ts-check
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LOOPBACK_HOST, POSTGRES_MAJOR, TIMEOUTS } from "./constants.mjs";
import { describeError } from "./logger.mjs";
import { sleep } from "./net-utils.mjs";

/**
 * Runs the bundled PostgreSQL 16 server for one user:
 *  - cluster in <data>/database, created with initdb (scram-sha-256, UTF8, C locale, page checksums)
 *  - listens on 127.0.0.1 only, on a port chosen per launch, with Unix sockets disabled
 *  - started directly (no shell, no pg_ctl) and stopped with a "fast" shutdown on quit
 *  - a postmaster.pid left behind by a crash is resolved before starting
 *
 * @typedef {import("./logger.mjs").Logger} Logger
 */

export class PostgresError extends Error {
  /**
   * @param {"RUNNING_AS_ROOT" | "INITDB_FAILED" | "VERSION_MISMATCH" | "START_FAILED" | "PORT_IN_USE" | "ALREADY_RUNNING" | "NOT_INSTALLED" | "BLOCKED_BY_MACOS"} code
   * @param {string} message
   * @param {{ cause?: unknown }} [options]
   */
  constructor(code, message, options) {
    super(message, options);
    this.name = "PostgresError";
    this.code = code;
  }
}

/** Environment for the database processes: nothing from the user's shell leaks in. */
function postgresEnv() {
  return {
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    HOME: os.homedir(),
    TMPDIR: os.tmpdir(),
    LANG: "C",
    LC_ALL: "C",
    TZ: "UTC",
  };
}

/**
 * macOS kills a program at launch (SIGKILL, or a refused spawn) when Gatekeeper or code
 * signing rejects it, for example a quarantined copy of the app that was never approved.
 * @param {string} file
 * @param {{ signal?: NodeJS.Signals | null, error?: unknown }} outcome
 * @returns {PostgresError | null}
 */
function blockedByMacOS(file, { signal, error }) {
  if (process.platform !== "darwin") return null;
  const code = /** @type {NodeJS.ErrnoException | undefined} */ (error)?.code;
  if (signal !== "SIGKILL" && code !== "EPERM" && code !== "EACCES") return null;
  return new PostgresError("BLOCKED_BY_MACOS", `macOS stopped the bundled database program "${path.basename(file)}" from running.`, { cause: error });
}

/** @returns {boolean} */
function isAlive(/** @type {number} */ pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return /** @type {NodeJS.ErrnoException} */ (err).code === "EPERM";
  }
}

/** Full command line of a process, or null if it cannot be read. */
function commandLineOf(/** @type {number} */ pid) {
  return /** @type {Promise<string | null>} */ (
    new Promise((resolve) => {
      execFile("/bin/ps", ["-ww", "-p", String(pid), "-o", "command="], { timeout: 5000 }, (err, stdout) => {
        resolve(err ? null : stdout.trim() || null);
      });
    })
  );
}

export class LocalPostgres {
  /**
   * @param {{ installDir: string, dataDir: string, log: Logger }} options
   */
  constructor(options) {
    this.installDir = options.installDir;
    this.dataDir = options.dataDir;
    this.log = options.log;
    /** @type {import("node:child_process").ChildProcess | null} */
    this.child = null;
    /** @type {Promise<number | null> | null} */
    this.exited = null;
    this.port = 0;
    this.stopping = false;
    /** @type {((code: number | null) => void) | null} */
    this.onUnexpectedExit = null;
  }

  bin(/** @type {string} */ name) {
    return path.join(this.installDir, "bin", name);
  }

  get pidFile() {
    return path.join(this.dataDir, "postmaster.pid");
  }

  assertRunnable() {
    if (typeof process.getuid === "function" && process.getuid() === 0) {
      throw new PostgresError("RUNNING_AS_ROOT", "PostgreSQL refuses to run as root. Open Harbour as a normal user.");
    }
    for (const name of ["postgres", "initdb"]) {
      if (!fs.existsSync(this.bin(name))) throw new PostgresError("NOT_INSTALLED", `The bundled database program "${name}" is missing.`);
    }
  }

  /** True once initdb has completed for this data directory. */
  isInitialized() {
    return fs.existsSync(path.join(this.dataDir, "PG_VERSION"));
  }

  checkVersion() {
    const version = fs.readFileSync(path.join(this.dataDir, "PG_VERSION"), "utf8").trim();
    if (version !== POSTGRES_MAJOR) {
      throw new PostgresError(
        "VERSION_MISMATCH",
        `Your data was created with PostgreSQL ${version}, but this version of Harbour includes PostgreSQL ${POSTGRES_MAJOR}.`,
      );
    }
  }

  /**
   * Creates the cluster. The superuser's password is given as a SCRAM verifier so the
   * plaintext never touches disk. A half-created directory from an earlier failed
   * attempt is set aside (never deleted).
   * @param {{ adminUser: string, adminPasswordVerifier: string }} options
   */
  async initCluster(options) {
    if (fs.existsSync(this.dataDir) && fs.readdirSync(this.dataDir).length > 0) {
      const aside = `${this.dataDir}.incomplete-${new Date().toISOString().replace(/[:.]/g, "-")}`;
      this.log.warn(`Database folder exists but was never fully created; moving it to ${path.basename(aside)}.`);
      fs.renameSync(this.dataDir, aside);
    }
    fs.mkdirSync(path.dirname(this.dataDir), { recursive: true });
    const pwfile = path.join(path.dirname(this.dataDir), `.initdb-${process.pid}.pw`);
    fs.writeFileSync(pwfile, `${options.adminPasswordVerifier}\n`, { mode: 0o600 });
    try {
      const args = [
        "--pgdata", this.dataDir,
        "--username", options.adminUser,
        `--pwfile=${pwfile}`,
        "--auth=scram-sha-256",
        "--encoding=UTF8",
        "--locale=C",
        "--data-checksums",
        "--no-instructions",
      ];
      this.log.info("Creating the database cluster (initdb).");
      const code = await this.run(this.bin("initdb"), args, TIMEOUTS.initdbMs);
      if (code !== 0) throw new PostgresError("INITDB_FAILED", `initdb exited with code ${code}. See postgres.log.`);
      this.log.info("Database cluster created.");
    } finally {
      fs.rmSync(pwfile, { force: true });
    }
  }

  /**
   * Runs a short-lived database program, logging its output to postgres.log.
   * @param {string} file
   * @param {string[]} args
   * @param {number} timeoutMs
   * @param {string} [stdin]
   * @returns {Promise<number | null>}
   */
  run(file, args, timeoutMs, stdin) {
    return new Promise((resolve, reject) => {
      const child = spawn(file, args, { env: postgresEnv(), stdio: ["pipe", "pipe", "pipe"] });
      this.log.postgres.pipe(child.stdout);
      this.log.postgres.pipe(child.stderr);
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        reject(new PostgresError("START_FAILED", `${path.basename(file)} did not finish within ${Math.round(timeoutMs / 1000)}s.`));
      }, timeoutMs);
      child.on("error", (err) => {
        clearTimeout(timer);
        reject(blockedByMacOS(file, { error: err }) ?? err);
      });
      child.on("exit", (code, signal) => {
        clearTimeout(timer);
        const blocked = timedOut ? null : blockedByMacOS(file, { signal });
        if (blocked) reject(blocked);
        else resolve(code);
      });
      child.stdin.on("error", () => {}); // the program may exit before reading its input
      child.stdin.end(stdin ?? "");
    });
  }

  /**
   * Sets new role passwords in single-user mode (no network, no authentication).
   * Used only when the user chose to create new keys because the old ones could not be unlocked.
   * @param {Array<{ role: string, verifier: string }>} roles
   */
  async resetPasswords(roles) {
    await this.resolveStaleLock();
    const sql = roles.map(({ role, verifier }) => `ALTER ROLE "${role.replace(/"/g, '""')}" WITH LOGIN PASSWORD '${verifier.replace(/'/g, "''")}';`).join("\n");
    this.log.info(`Resetting database passwords for ${roles.map((r) => r.role).join(", ")} (single-user mode).`);
    const code = await this.run(this.bin("postgres"), ["--single", "-D", this.dataDir, "-c", "timezone=UTC", "postgres"], TIMEOUTS.postgresStartMs, `${sql}\n`);
    if (code !== 0) throw new PostgresError("START_FAILED", `Resetting database passwords failed (exit code ${code}).`);
  }

  /**
   * Handles a postmaster.pid left by a previous session that did not shut down cleanly.
   * - process still alive and it is our postgres for this data dir: shut it down cleanly
   * - process gone, or the PID now belongs to something else: remove the stale lock file
   */
  async resolveStaleLock() {
    let content;
    try {
      content = fs.readFileSync(this.pidFile, "utf8");
    } catch {
      return;
    }
    const pid = Number.parseInt(content.split("\n")[0] ?? "", 10);
    if (!Number.isInteger(pid) || pid <= 0 || !isAlive(pid)) {
      this.log.warn("Removing a stale database lock file left by a previous session.");
      fs.rmSync(this.pidFile, { force: true });
      return;
    }
    const command = await commandLineOf(pid);
    // Match on the data directory, not the binary path: the app may have been moved or updated since.
    if (command && /\bpostgres\b/.test(command) && command.includes(this.dataDir)) {
      this.log.warn(`A database server from a previous session is still running (pid ${pid}); shutting it down cleanly.`);
      process.kill(pid, "SIGINT");
      const deadline = Date.now() + TIMEOUTS.postgresStopMs * 2;
      while (isAlive(pid) && Date.now() < deadline) await sleep(200);
      if (isAlive(pid)) {
        throw new PostgresError("ALREADY_RUNNING", "A database server from a previous session is still running and did not stop.");
      }
      fs.rmSync(this.pidFile, { force: true });
      return;
    }
    // The PID was reused by an unrelated process. PostgreSQL's own shared-memory interlock
    // still refuses to start if any old server process were actually alive.
    this.log.warn(`The database lock file names pid ${pid}, which is not Harbour's database; removing the stale lock file.`);
    fs.rmSync(this.pidFile, { force: true });
  }

  /**
   * Starts the server on 127.0.0.1:<port> and resolves once it accepts connections.
   * @param {number} port
   */
  async start(port) {
    this.checkVersion();
    await this.resolveStaleLock();
    this.port = port;
    this.stopping = false;
    const args = [
      "-D", this.dataDir,
      "-c", `port=${port}`,
      "-c", `listen_addresses=${LOOPBACK_HOST}`,
      "-c", "unix_socket_directories=",
      "-c", "timezone=UTC",
      "-c", "log_timezone=UTC",
      "-c", "password_encryption=scram-sha-256",
      "-c", "huge_pages=off",
    ];
    this.log.info(`Starting the database on ${LOOPBACK_HOST}:${port}.`);
    /** @type {string[]} */
    const recent = [];
    /** @type {{ signal?: NodeJS.Signals | null, error?: unknown }} */
    const outcome = {};
    const child = spawn(this.bin("postgres"), args, { env: postgresEnv(), stdio: ["ignore", "pipe", "pipe"], detached: true });
    this.child = child;
    const remember = (/** @type {string} */ line) => {
      recent.push(line);
      if (recent.length > 40) recent.shift();
    };
    this.log.postgres.pipe(child.stdout, remember);
    this.log.postgres.pipe(child.stderr, remember);
    this.exited = new Promise((resolve) => {
      child.once("error", (err) => {
        this.log.error("Could not launch the database server", err);
        outcome.error = err;
        resolve(null);
      });
      child.once("exit", (code, signal) => {
        outcome.signal = signal;
        this.log.info(`Database server exited (code ${code ?? "none"}${signal ? `, signal ${signal}` : ""}).`);
        resolve(code);
        if (!this.stopping) this.onUnexpectedExit?.(code);
      });
    });

    const deadline = Date.now() + TIMEOUTS.postgresStartMs;
    let exitedEarly = false;
    void this.exited.then(() => {
      exitedEarly = true;
    });
    while (Date.now() < deadline) {
      if (exitedEarly) {
        const blocked = blockedByMacOS(this.bin("postgres"), outcome);
        if (blocked) throw blocked;
        const portInUse = recent.some((l) => /could not bind|Address already in use/i.test(l));
        throw new PostgresError(
          portInUse ? "PORT_IN_USE" : "START_FAILED",
          portInUse ? `Port ${port} is already in use.` : `The database server stopped during startup.\n${recent.slice(-8).join("\n")}`,
        );
      }
      if (this.readyStatus(child.pid)) {
        this.log.info("Database is accepting connections.");
        return;
      }
      await sleep(150);
    }
    await this.stop();
    throw new PostgresError("START_FAILED", `The database did not become ready within ${Math.round(TIMEOUTS.postgresStartMs / 1000)}s.`);
  }

  /** True when postmaster.pid belongs to our child and reports "ready" (what pg_ctl -w waits for). */
  readyStatus(/** @type {number | undefined} */ pid) {
    try {
      const lines = fs.readFileSync(this.pidFile, "utf8").split("\n");
      return Number.parseInt(lines[0] ?? "", 10) === pid && (lines[7] ?? "").trim() === "ready";
    } catch {
      return false;
    }
  }

  /** Fast shutdown (SIGINT): ends sessions, writes a checkpoint, exits cleanly. Escalates only if stuck. */
  async stop() {
    const child = this.child;
    if (!child || !this.exited) return { clean: true };
    this.stopping = true;
    if (child.exitCode !== null || child.signalCode !== null) return { clean: child.exitCode === 0 };
    this.log.info("Stopping the database (fast shutdown).");
    child.kill("SIGINT");
    const timeout = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(() => resolve("timeout"), ms));
    let result = await Promise.race([this.exited, timeout(TIMEOUTS.postgresStopMs)]);
    if (result === "timeout") {
      this.log.warn("Database did not stop in time; requesting an immediate shutdown (it will recover on next start).");
      child.kill("SIGQUIT");
      result = await Promise.race([this.exited, timeout(5000)]);
      if (result === "timeout") {
        child.kill("SIGKILL");
        result = await this.exited;
      }
      return { clean: false };
    }
    return { clean: result === 0 };
  }
}

/** Logs and swallows errors from best-effort cleanup steps. */
export async function bestEffort(/** @type {Logger} */ log, /** @type {string} */ what, /** @type {() => Promise<unknown>} */ fn) {
  try {
    await fn();
  } catch (err) {
    log.warn(`${what} failed: ${describeError(err)}`);
  }
}
