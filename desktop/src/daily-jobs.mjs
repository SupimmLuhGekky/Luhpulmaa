// @ts-check
import { powerMonitor } from "electron";
import { DAILY_JOBS_FIRST_RUN_DELAY_MS, DAILY_JOBS_INTERVAL_MS } from "./constants.mjs";
import { localGet } from "./net-utils.mjs";

/**
 * Hosting platforms call /api/cron/daily on a schedule; on the desktop the app does it
 * itself: shortly after startup, then every 6 hours while it is open (and on wake from
 * sleep if a run is overdue). Failures are logged and otherwise ignored.
 *
 * @param {{ baseUrl: string, cronSecret: string, log: import("./logger.mjs").Logger }} options
 * @returns {{ stop: () => void, runNow: () => Promise<string> }} runNow resolves with a short
 *   outcome ("HTTP 200", "failed (…)"); while a run is in progress it waits for that run.
 */
export function scheduleDailyJobs({ baseUrl, cronSecret, log }) {
  let lastRun = 0;
  /** @type {Promise<string> | null} */
  let current = null;
  let stopped = false;

  const run = () => {
    if (current) return current;
    if (stopped) return Promise.resolve("skipped (shutting down)");
    lastRun = Date.now();
    current = (async () => {
      try {
        const res = await localGet(`${baseUrl}/api/cron/daily`, {
          timeoutMs: 10 * 60 * 1000,
          headers: { Authorization: `Bearer ${cronSecret}` },
        });
        log.info(`Daily jobs: /api/cron/daily answered ${res.status}.`);
        return `HTTP ${res.status}`;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        log.warn(`Daily jobs: request failed (${reason}).`);
        return `failed (${reason})`;
      } finally {
        current = null;
      }
    })();
    return current;
  };

  const first = setTimeout(() => void run(), DAILY_JOBS_FIRST_RUN_DELAY_MS);
  const interval = setInterval(() => void run(), DAILY_JOBS_INTERVAL_MS);
  const onResume = () => {
    if (Date.now() - lastRun >= DAILY_JOBS_INTERVAL_MS) void run();
  };
  powerMonitor.on("resume", onResume);

  return {
    runNow: run,
    stop: () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(interval);
      powerMonitor.removeListener("resume", onResume);
    },
  };
}
