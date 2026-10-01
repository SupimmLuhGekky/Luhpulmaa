# Harbour for Mac

Harbour for Mac is the Harbour web app packaged as a normal Mac app. It brings its own
PostgreSQL 16 database and runs everything on your Mac: there is no hosting account, no
cloud database, and your financial data never leaves your computer. The window shows the
same app you would get on the web, served by Harbour itself at `http://127.0.0.1:47800`
(another free port if that one is taken), reachable only from your Mac.

- [Install](#install)
- [Updating](#updating)
- [Forgot your password?](#forgot-your-password)
- [Where your data lives](#where-your-data-lives)
- [Back up and restore](#back-up-and-restore)
- [Optional settings: harbour.env](#optional-settings-harbourenv)
- [Troubleshooting](#troubleshooting)
- [Build it yourself](#build-it-yourself)
- [How it works](#how-it-works)
- [Releasing a new version](#releasing-a-new-version)

## Install

You need macOS 13 Ventura or later, on Apple silicon or Intel. The download is about
140 MB; the installed app takes about 430 MB, plus room for your data.

1. Open the [releases page](https://github.com/SupimmLuhGekky/Luhpulmaa/releases) and pick the
   newest **Harbour … for Mac** release (tags start with `desktop-v`). Download the DMG for
   your Mac:
   - Apple silicon (M1, M2, M3, M4 and later): `Harbour-<version>-arm64.dmg`
   - Intel: `Harbour-<version>-x64.dmg`

   Not sure? Apple menu → **About This Mac**: "Chip: Apple M…" is Apple silicon,
   "Processor: Intel…" is Intel.
2. Open the DMG and drag **Harbour** onto the **Applications** shortcut next to it.
3. Open Harbour from your Applications folder. **The first time, macOS blocks it**: Harbour
   is signed but not notarized by Apple, so macOS says it can't verify the app. Click
   **Done** (or **OK**). Don't choose Move to Trash.
4. Open **System Settings → Privacy & Security** and scroll down to Security. Next to the
   message that Harbour was blocked, click **Open Anyway**, confirm with **Open Anyway**,
   and enter your password or use Touch ID. Harbour opens. You only do this once per
   version.
5. On first launch Harbour sets itself up, which takes a few seconds ("Starting Harbour…"):
   it creates its private database and the keys that protect it, and stores those keys in
   your login keychain.
6. Create your account (it exists only on this Mac), or click **Explore the demo account**
   to look around with simulated data first.

If macOS instead says Harbour "is damaged and can't be opened", or that a part of Harbour
(for example "postgres") can't be opened, quit Harbour, run this in Terminal, and open it
again:

```sh
xattr -dr com.apple.quarantine /Applications/Harbour.app
```

This removes the "downloaded from the internet" mark from Harbour only. It is the
command-line equivalent of **Open Anyway**.

To check a download, compare it with the `.sha256` file published next to it:
`shasum -a 256 -c Harbour-<version>-arm64.dmg.sha256`.

## Updating

Harbour checks the releases page when it starts (and when you choose **Harbour → Check for
Updates…**). When a newer version exists it offers to open the download page; it never
downloads or installs anything by itself.

To update: quit Harbour (**Harbour → Quit Harbour**, ⌘Q), download the new DMG, drag
Harbour into Applications and choose **Replace**. Open it and approve it once more as in
step 4 above. Your data is kept, and the database is upgraded automatically on the first
launch of the new version.

After an update, macOS may ask whether Harbour may use the **"Harbour Safe Storage"**
item in your keychain. That's Harbour's own key: enter your login password and click
**Always Allow**. (This happens because each version is signed separately. If you click
Deny, Harbour explains what happened and offers to try again.)

## Forgot your password?

Harbour for Mac never sends email: your account exists only on this Mac, so there is no
confirmation email when you sign up and no emailed reset link. Reset your password from the
menu bar instead:

1. In the menu bar, choose **Harbour → Reset Password…**.
2. Confirm your account, or pick it if this Mac has more than one.
3. The Harbour window shows **Choose a new password**. Enter the new password twice, click
   **Update password**, then sign in with it.

The link Harbour opens works once and expires after an hour; choosing **Reset Password…**
again replaces it. Resetting signs the account out everywhere, and Harbour signs its window
out first. The demo account isn't listed. Like everything in Harbour, this relies on your Mac
login: anyone who can use your Mac account can reset a Harbour password, so lock your Mac
when you step away.

## Where your data lives

Everything Harbour stores is in one folder (**Help → Open Data Folder**):

```
~/Library/Application Support/Harbour/
  database/          your Harbour data (PostgreSQL 16)
  secrets.enc        Harbour's keys, encrypted by the macOS keychain ("Harbour Safe Storage")
  logs/              main.log, server.log, postgres.log (5 MB each, three older copies kept)
  harbour.env        optional settings (only if you create it, see below)
  session/           the window's cookies and cache
  window-state.json  window size and position
```

The app itself (`/Applications/Harbour.app`) contains no personal data and can be
replaced or deleted at any time. Deleting the data folder deletes your Harbour data.

The keys are generated on your Mac on first launch: the session secret, the key that
encrypts bank-connection tokens, the password of the database account Harbour uses, and a
token for the background jobs. They never leave your Mac. The database only accepts
connections from your Mac (127.0.0.1) with those passwords.

## Back up and restore

Two ways, and doing both doesn't hurt:

- **Export from the app.** Use the export in Harbour's **Settings** to save a copy of your
  data as files you can open elsewhere.
- **Copy the data folder.** Quit Harbour first (the database must not be running), then copy
  `~/Library/Application Support/Harbour` somewhere safe, for example an external drive.
  Time Machine backs this folder up too; for a guaranteed-consistent copy, make sure
  Harbour was quit during the backup or keep the folder copy as well.

To restore a folder copy: quit Harbour, put the copied folder back at
`~/Library/Application Support/Harbour` (replace the existing one), and open Harbour.

Restoring on a *different* Mac or user account works too, with one extra step: the keys in
`secrets.enc` can only be unlocked by the keychain they were created with. Harbour will say
it couldn't unlock its keys and offer **Create New Keys…**. Choose it: your accounts,
budgets and transactions are kept; you sign in again, and bank connections (if you use a
bank-data provider) need to be connected again.

## Optional settings: harbour.env

Harbour runs without any configuration: CSV import, budgets, goals and everything else work
out of the box, and the demo account is available. To connect a bank-data provider or turn
on optional features, create a plain-text file named `harbour.env` in the data folder:

```sh
# ~/Library/Application Support/Harbour/harbour.env
BANKING_PROVIDER=plaid
PLAID_CLIENT_ID=your-client-id
PLAID_SECRET=your-secret
PLAID_ENV=sandbox

ENABLE_AI_CATEGORIZATION=true
ANTHROPIC_API_KEY=your-key
```

Then quit and reopen Harbour. Rules:

- Format: one `KEY=value` per line; `#` starts a comment; values may be quoted.
- Only these keys are used: `BANKING_PROVIDER`, `PLAID_*`, `FLINKS_*`, `ANTHROPIC_API_KEY`
  and `ENABLE_*` feature flags. Anything else (database, secrets, URLs, `DEMO_MODE`, Node.js
  options) is ignored and noted in `logs/main.log`, because Harbour manages it itself.
- Keep the file private: it holds your provider credentials. Harbour never writes them to
  its logs.

Bank connections that need your bank's website to open in a pop-up may not work inside the
desktop app yet; CSV import always does.

## Troubleshooting

**Logs.** **Help → Open Logs Folder**. `main.log` is the app's own log (start-up steps,
errors), `server.log` the web app, `postgres.log` the database. They never contain your
keys or passwords. Include them if you ask for help.

**"Harbour couldn't start".** The dialog says what failed and has an **Open Logs Folder**
button. Common causes:

- *Disk full*: free some space and open Harbour again.
- *"Harbour's database from an earlier session is still running"*: Harbour stops a database
  left over from a crash by itself; if it can't, restart your Mac.
- *"macOS stopped Harbour's database program from opening"*: see the `xattr` command in
  [Install](#install).
- *Keys couldn't be unlocked*: you probably clicked Deny on the keychain prompt. Choose
  **Try Again** and then **Always Allow**.

**Port 47800 is busy.** Harbour then picks another free port automatically. Nothing to do.
(It prefers 47800 so the window keeps the same address, and so you stay signed in, between
launches.)

**Forgot your password.** Choose **Harbour → Reset Password…** in the menu bar (see
[Forgot your password?](#forgot-your-password)). Harbour for Mac doesn't send email, so
**Forgot password?** on the sign-in page points you there too.

**Starting over.** Quit Harbour and move `~/Library/Application Support/Harbour` to the
Trash. This deletes all your Harbour data. You can also delete the "Harbour Safe Storage"
item in the Keychain Access app.

## Build it yourself

You need a Mac with Node.js 22 (or later) and the Xcode Command Line Tools
(`xcode-select --install`). Builds target the Mac you build on (Apple silicon or Intel).

```sh
git clone https://github.com/SupimmLuhGekky/Luhpulmaa.git
cd Luhpulmaa
npm ci                    # the web app's dependencies
npm run desktop:install   # the Mac app's own dependencies (desktop/package.json)
npm run desktop:build     # Next.js standalone build + PostgreSQL + Electron app
npm run desktop:sign      # ad-hoc code signing, inside-out, then verification
npm run desktop:dmg       # desktop/out/Harbour-<version>-<arch>.dmg
npm run desktop:smoke     # optional: starts the built app, checks it, takes screenshots, quits
```

The app is at `desktop/out/package/Harbour-darwin-<arch>/Harbour.app`. Other scripts:
`npm run desktop:typecheck`, `npm run desktop:test` (unit tests of the shell), and
`npm run desktop:dev`, which runs the shell from source against the last build's resources
with its data in `~/Library/Application Support/Harbour Development`.

The build never needs your secrets: `next build` gets throwaway values, real keys are made
on the Mac where Harbour first runs, and the bundle is checked for `.env` files, which are
never shipped.

## How it works

The Mac app is a small [Electron](https://www.electronjs.org/) shell (`desktop/`) around the
unchanged web app:

1. **Keys**: loaded from `secrets.enc` (decrypted with the keychain), or generated with the
   system's secure random generator on first launch.
2. **Database**: on first launch `initdb` creates the cluster (SCRAM-SHA-256 passwords, UTF-8,
   data checksums). PostgreSQL 16 then starts on a free port on 127.0.0.1, with no Unix
   socket. A lock file left by a crash is cleaned up safely first.
3. **Schema**: the app's database role and database are created if needed, then pending
   migrations from `prisma/migrations` are applied, with the same bookkeeping
   (`_prisma_migrations`) the Prisma CLI uses.
4. **Web server**: the Next.js standalone server runs in a utility process on
   `127.0.0.1:47800`, with an environment built from scratch (`HARBOUR_DESKTOP=true`,
   `DEMO_MODE=true`, `APP_URL` set to the window's exact address, the generated keys, and
   allow-listed `harbour.env` keys). The splash screen shows progress until `/api/health`
   answers.
5. **Window**: opens `/dashboard` (signed-out users land on sign-in). Pages run sandboxed and
   context-isolated without Node.js access, can't leave the app's address (other links open
   in your browser), and every permission request (camera, location, notifications…) is
   denied.
6. **Background jobs**: the app calls `/api/cron/daily` shortly after start-up and every 6
   hours while open, the job that Vercel Cron runs for the web version.
7. **Quit**: the web server stops, then the database shuts down cleanly.

**Harbour → Reset Password…** stands in for the reset email. It lists the accounts in the
database (not the demo account) and creates a reset token the way the web app's
`issueToken` does: 32 random bytes (base64url), stored only as its SHA-256 hash, valid for one
hour, replacing the account's unused reset tokens in the same transaction. It signs the window
out and opens `/reset-password?token=…` there; the web app's page does the rest (new password,
every session signed out, audit entry). Harbour never writes the token to its logs.

Electron's [fuses](https://www.electronjs.org/docs/latest/tutorial/fuses) are set so the
app can't be used as a generic Node.js runtime, only loads its own code from `app.asar`, and
checks that code's integrity.

The web app's own protections (Secure, HttpOnly session cookies, Content-Security-Policy,
origin checks) apply unchanged on the desktop.

## Releasing a new version

1. Set the new version in `desktop/package.json` (`"version": "0.2.0"`) and commit.
2. Tag the commit `desktop-v0.2.0` and push the tag.

The **Desktop app** workflow (`.github/workflows/desktop.yml`) builds both DMGs on GitHub's
macOS runners (Apple silicon on `macos-15`, Intel on `macos-15-intel`), signs them ad hoc,
installs each from its DMG, runs the app's smoke test twice (first launch and relaunch), and
then publishes a GitHub release with `Harbour-0.2.0-arm64.dmg`, `Harbour-0.2.0-x64.dmg`,
their checksums and install notes. Pushes to the `desktop` branch and manual runs do
everything except the release; their DMGs, screenshots and logs are attached to the
workflow run as artifacts.
