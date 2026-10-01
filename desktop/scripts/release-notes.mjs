// @ts-check
/**
 * Prints the GitHub release notes for a desktop version (used by .github/workflows/desktop.yml).
 *   node desktop/scripts/release-notes.mjs 0.2.0 > notes.md
 * Self-contained on purpose: the release job runs it without installing dependencies.
 */

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("Usage: node desktop/scripts/release-notes.mjs <version>");
  process.exit(1);
}

const notes = `Harbour ${version} for Mac: the Harbour web app and its database, running entirely on your Mac. No account with a hosting service, and your financial data never leaves your computer.

## Download

| Your Mac | File |
| --- | --- |
| Apple silicon (M1, M2, M3, M4 and later) | \`Harbour-${version}-arm64.dmg\` |
| Intel processor | \`Harbour-${version}-x64.dmg\` |

Not sure which one? Apple menu → **About This Mac**: "Chip: Apple M…" means Apple silicon, "Processor: Intel…" means Intel. Requires macOS 13 Ventura or later.

## Install

1. Open the downloaded DMG and drag **Harbour** onto the **Applications** folder.
2. Open Harbour from Applications. The first time, macOS blocks it with a message that it can't verify the app (Harbour isn't notarized by Apple). Click **Done** (or **OK**).
3. Open **System Settings → Privacy & Security**, scroll down to the message about Harbour and click **Open Anyway**, then confirm with your password or Touch ID. You only do this once per version.
4. Harbour sets itself up on first launch, which takes a few seconds: it creates a private database and the keys that protect it, which are kept in your login keychain.

If macOS says Harbour "is damaged" or that a part of Harbour can't be opened, run this in Terminal and open Harbour again:

\`\`\`
xattr -dr com.apple.quarantine /Applications/Harbour.app
\`\`\`

## Updating

Quit Harbour, then drag the new version into Applications and choose **Replace**. Your data lives in \`~/Library/Application Support/Harbour\` and is kept. After an update macOS may ask whether Harbour can use "Harbour Safe Storage" in your keychain: enter your login password and choose **Always Allow**.

## Verify the download (optional)

Each DMG has a \`.sha256\` file. In Terminal, in the download folder: \`shasum -a 256 -c Harbour-${version}-arm64.dmg.sha256\` (or the x64 file).

More: [docs/DESKTOP.md](https://github.com/SupimmLuhGekky/Luhpulmaa/blob/desktop-v${version}/docs/DESKTOP.md) covers backups, logs, optional bank-provider and AI settings (\`harbour.env\`) and troubleshooting.
`;

process.stdout.write(notes);
