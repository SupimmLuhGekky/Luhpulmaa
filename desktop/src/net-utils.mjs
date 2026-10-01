// @ts-check
import http from "node:http";
import net from "node:net";
import { LOOPBACK_HOST } from "./constants.mjs";

/** Resolves true when nothing is listening on host:port (we can bind it ourselves). */
export function isPortFree(/** @type {number} */ port, host = LOOPBACK_HOST) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ port, host, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

/** Asks the OS for a currently unused loopback port. */
export function getFreePort(host = LOOPBACK_HOST) {
  return /** @type {Promise<number>} */ (
    new Promise((resolve, reject) => {
      const server = net.createServer();
      server.unref();
      server.once("error", reject);
      server.listen({ port: 0, host, exclusive: true }, () => {
        const address = server.address();
        const port = typeof address === "object" && address ? address.port : 0;
        server.close(() => (port ? resolve(port) : reject(new Error("The OS did not assign a port."))));
      });
    })
  );
}

/**
 * Minimal HTTP GET against the local server (never goes through a proxy).
 * @param {string} url
 * @param {{ timeoutMs?: number, headers?: Record<string, string> }} [options]
 * @returns {Promise<{ status: number, headers: http.IncomingHttpHeaders, body: string }>}
 */
export function localGet(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers: options.headers, timeout: options.timeoutMs ?? 5000 }, (res) => {
      /** @type {Buffer[]} */
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error(`Request timed out: ${new URL(url).pathname}`)));
    req.on("error", reject);
  });
}

/** Resolves after ms milliseconds. */
export function sleep(/** @type {number} */ ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
