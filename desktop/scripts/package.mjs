// @ts-check
import fs from "node:fs";
import path from "node:path";
import { FuseState, FuseV1Options, FuseVersion, flipFuses, getCurrentFuseWire } from "@electron/fuses";
import { packager } from "@electron/packager";
import { BUNDLE_ID, DESKTOP_DIR, ICON_DIR, PACKAGE_DIR, PRODUCT_NAME, RESOURCES_DIR, desktopPackage, packagedApp, step, target } from "./lib.mjs";

/**
 * Packages the Electron app for this machine's platform/arch with @electron/packager,
 * copies the assembled resources next to app.asar, and flips Electron's security fuses.
 * (Signing and the DMG are separate steps: sign-mac.mjs, make-dmg.mjs.)
 */
export async function packageApp() {
  const { platform, arch } = target();
  const { version } = desktopPackage();
  step(`Packaging ${PRODUCT_NAME} ${version} for ${platform}-${arch}`);
  fs.rmSync(PACKAGE_DIR, { recursive: true, force: true });

  const runNumber = process.env.GITHUB_RUN_NUMBER;
  await packager({
    dir: DESKTOP_DIR,
    out: PACKAGE_DIR,
    name: PRODUCT_NAME,
    executableName: PRODUCT_NAME,
    platform,
    arch,
    appVersion: version,
    // CFBundleVersion: the CI run number (a plain, increasing integer), shown as "0.1.0 (42)".
    buildVersion: runNumber ?? version,
    appBundleId: BUNDLE_ID,
    appCategoryType: "public.app-category.finance",
    appCopyright: "Harbour. Your data stays on this Mac.",
    icon: path.join(ICON_DIR, "Harbour.icns"),
    darwinDarkModeSupport: true,
    asar: true,
    prune: true,
    junk: true,
    overwrite: true,
    quiet: true,
    // Only src/ and production node_modules belong in app.asar.
    ignore: [/^\/(out|scripts|assets|test)(\/|$)/, /^\/tsconfig\.json$/],
    afterPrune: [
      ({ buildPath }) => {
        // The PostgreSQL package is an (optional) production dependency so npm installs the right
        // platform's binaries, but its files are copied to Resources/postgres, not into app.asar.
        fs.rmSync(path.join(buildPath, "node_modules", "@embedded-postgres"), { recursive: true, force: true });
      },
    ],
    extendInfo: {
      LSMultipleInstancesProhibited: true,
      NSHumanReadableCopyright: "Harbour. Your data stays on this Mac.",
    },
  });

  const app = packagedApp();
  if (!fs.existsSync(app.executable)) throw new Error(`Packaging did not produce ${app.executable}`);
  // The packager's output folder starts life as a private temp dir; give it normal app permissions.
  fs.chmodSync(app.dir, 0o755);

  step("Copying resources into the app");
  for (const name of ["server", "postgres", "migrations", "build-info.json"]) {
    fs.cpSync(path.join(RESOURCES_DIR, name), path.join(app.resources, name), { recursive: true, verbatimSymlinks: true });
  }
  if (platform === "linux") fs.copyFileSync(path.join(ICON_DIR, "icon.png"), path.join(app.resources, "icon.png"));

  step("Flipping Electron fuses");
  await flipFuses(app.executable, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: platform === "darwin",
    // The web server runs in an Electron utility process, so the app never needs to act as plain Node.
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  });
  const wire = /** @type {Record<string, unknown>} */ (await getCurrentFuseWire(app.executable));
  const names = /** @type {Record<string, string>} */ (/** @type {unknown} */ (FuseV1Options));
  const label = (/** @type {unknown} */ v) => (v === FuseState.ENABLE ? "on" : v === FuseState.DISABLE ? "off" : String(v));
  console.info(
    Object.entries(wire)
      .filter(([key]) => key !== "version")
      .map(([key, value]) => `  ${names[key] ?? key}: ${label(value)}`)
      .join("\n"),
  );
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) await packageApp();
