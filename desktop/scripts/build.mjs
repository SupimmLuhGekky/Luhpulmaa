// @ts-check
import { assemble } from "./assemble.mjs";
import { checkBundle } from "./check-bundle.mjs";
import { makeIcons } from "./icon.mjs";
import { packageApp } from "./package.mjs";

/**
 * npm run desktop:build [-- --skip-next]
 *
 * 1. next build with HARBOUR_DESKTOP=1 (standalone output)   (skip with --skip-next)
 * 2. assemble server + PostgreSQL + migrations into desktop/out/resources
 * 3. render the icon, package the app for this machine, flip Electron fuses
 * 4. check the bundle (no .env files, everything present)
 *
 * On macOS, follow with `npm run desktop:sign` and `npm run desktop:dmg`.
 */
const skipNext = process.argv.includes("--skip-next");
await assemble({ skipNext });
makeIcons();
const app = await packageApp();
checkBundle(app.app);
console.info(`\nBuilt ${app.app}`);
