// @ts-check
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { OUT_DIR, packagedApp, target } from "./lib.mjs";

/**
 * npm run desktop:smoke [-- --app=<path to Harbour.app or Linux app dir>] [-- --data-dir=<dir>] [-- --screenshot=<png>]
 *
 * Launches the packaged app with --smoke-test: it boots the database and server, waits
 * for the sign-in page, checks /api/health, saves a screenshot and quits. (It also reports
 * a demo sign-in, with a second screenshot, and a daily-jobs run.) Exits with the app's
 * exit code. On Linux without a display it runs under xvfb-run. Without --data-dir the
 * app uses its normal data folder, so running it twice tests a first and a second launch.
 */
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--") && a.includes("="))
    .map((a) => {
      const [k, ...v] = a.slice(2).split("=");
      return [k, v.join("=")];
    }),
);

const { platform, arch } = target();
const appPath = args.app ? path.resolve(args.app) : packagedApp().app;
const executable = appPath.endsWith(".app") ? path.join(appPath, "Contents", "MacOS", "Harbour") : path.join(appPath, "Harbour");
const screenshot = path.resolve(args.screenshot ?? path.join(OUT_DIR, "smoke", `harbour-${platform}-${arch}.png`));
if (!fs.existsSync(executable)) {
  console.error(`No packaged app at ${appPath}. Run npm run desktop:build first.`);
  process.exit(1);
}
fs.rmSync(screenshot, { force: true });

const appArgs = [`--smoke-test=${screenshot}`];
if (args["data-dir"]) appArgs.push(`--data-dir=${path.resolve(args["data-dir"])}`);
const useXvfb = platform === "linux" && !process.env.DISPLAY;
const [command, commandArgs] = useXvfb ? ["xvfb-run", ["-a", executable, ...appArgs]] : [executable, appArgs];

console.info(`Smoke test: ${executable} ${appArgs.join(" ")}`);
const started = Date.now();
const child = spawn(command, commandArgs, { stdio: "inherit" });
const timer = setTimeout(() => {
  console.error("Smoke test did not finish within 6 minutes; killing the app.");
  child.kill("SIGKILL");
}, 6 * 60 * 1000);
child.on("exit", (code, signal) => {
  clearTimeout(timer);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (code === 0 && fs.existsSync(screenshot) && fs.statSync(screenshot).size > 0) {
    console.info(`Smoke test passed in ${seconds}s; screenshot at ${screenshot}`);
    process.exit(0);
  }
  console.error(`Smoke test failed after ${seconds}s (${signal ? `signal ${signal}` : `exit code ${code}`}).`);
  process.exit(code || 1);
});
