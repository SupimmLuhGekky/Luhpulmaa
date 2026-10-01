// @ts-check
import fs from "node:fs";
import path from "node:path";
import { utilityProcess } from "electron";
import { TIMEOUTS } from "./constants.mjs";
import { localGet, sleep } from "./net-utils.mjs";

/**
 * Runs the Next.js standalone server (resources/server/server.js) in an Electron
 * utility process: Electron's own Node.js runtime, no system Node needed, and the
 * process lives and dies with the app.
 *
 * @typedef {import("./logger.mjs").Logger} Logger
 */

export class ServerError extends Error {
  /**
   * @param {"NOT_INSTALLED" | "EXITED" | "PORT_IN_USE" | "HEALTH_TIMEOUT"} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = "ServerError";
    this.code = code;
  }
}

export class NextServer {
  /**
   * @param {{ serverDir: string, env: Record<string, string>, port: number, log: Logger }} options
   */
  constructor(options) {
    this.serverDir = options.serverDir;
    this.env = options.env;
    this.port = options.port;
    this.log = options.log;
    /** @type {Electron.UtilityProcess | null} */
    this.child = null;
    /** @type {Promise<number> | null} */
    this.exited = null;
    this.stopping = false;
    /** @type {((code: number) => void) | null} */
    this.onUnexpectedExit = null;
    /** @type {string[]} */
    this.recent = [];
  }

  get baseUrl() {
    return `http://127.0.0.1:${this.port}`;
  }

  /** Spawns the server and resolves once GET /api/health returns { ok: true }. */
  async start() {
    const entry = path.join(this.serverDir, "server.js");
    if (!fs.existsSync(entry)) throw new ServerError("NOT_INSTALLED", "The bundled web server is missing.");
    this.log.info(`Starting the web server on ${this.baseUrl}.`);
    const child = utilityProcess.fork(entry, [], {
      cwd: this.serverDir,
      env: this.env,
      stdio: "pipe",
      serviceName: "Harbour Server",
    });
    this.child = child;
    const remember = (/** @type {string} */ line) => {
      this.recent.push(line);
      if (this.recent.length > 40) this.recent.shift();
    };
    this.log.server.pipe(child.stdout, remember);
    this.log.server.pipe(child.stderr, remember);
    this.exited = new Promise((resolve) => {
      child.once("exit", (code) => {
        this.log.info(`Web server exited (code ${code}).`);
        resolve(code);
        if (!this.stopping) this.onUnexpectedExit?.(code);
      });
    });
    let exited = false;
    void this.exited.then(() => {
      exited = true;
    });

    const deadline = Date.now() + TIMEOUTS.serverHealthMs;
    while (Date.now() < deadline) {
      if (exited) {
        const inUse = this.recent.some((l) => /EADDRINUSE/.test(l));
        throw new ServerError(inUse ? "PORT_IN_USE" : "EXITED", inUse ? `Port ${this.port} is already in use.` : "The web server stopped during startup.");
      }
      if (await this.healthy()) {
        this.log.info("Web server is healthy.");
        return;
      }
      await sleep(250);
    }
    await this.stop();
    throw new ServerError("HEALTH_TIMEOUT", `The web server did not become healthy within ${Math.round(TIMEOUTS.serverHealthMs / 1000)}s.`);
  }

  /** True when /api/health answers 200 { ok: true } (server and database both up). */
  async healthy() {
    try {
      const res = await localGet(`${this.baseUrl}/api/health`, { timeoutMs: 3000 });
      return res.status === 200 && JSON.parse(res.body)?.ok === true;
    } catch {
      return false;
    }
  }

  async stop() {
    const child = this.child;
    if (!child || !this.exited) return;
    this.stopping = true;
    if (child.pid === undefined) {
      await Promise.race([this.exited, sleep(1000)]);
      return;
    }
    this.log.info("Stopping the web server.");
    child.kill();
    const result = await Promise.race([this.exited, sleep(TIMEOUTS.serverStopMs).then(() => "timeout")]);
    if (result === "timeout") {
      this.log.warn("Web server did not stop in time; terminating it.");
      if (child.pid) {
        try {
          process.kill(child.pid, "SIGKILL");
        } catch {
          // Already gone.
        }
      }
      await Promise.race([this.exited, sleep(2000)]);
    }
  }
}
