# Harbour

Personal finance, budgeting and automation for people in Canada, built for Quebec first (CAD,
`America/Toronto`, English and French bank files). It shows where your money is, what is safe
to spend, what is coming up, and how your goals are doing, and it automates the tedious parts.

> This application provides financial organization and budgeting tools. It is not a bank and
> does not itself hold customer deposits.

Harbour runs as a web app (deployable to Vercel), installs to the iPhone home screen and the Mac
Dock from Safari, and ships as a self-contained Mac desktop app that keeps your data on your Mac.

## Contents

- [Features](#features)
- [Quick start (Mac)](#quick-start-mac)
- [Configuration](#configuration)
- [What is simulated and what needs real credentials](#what-is-simulated-and-what-needs-real-credentials)
- [Tests](#tests)
- [Deploying to Vercel](#deploying-to-vercel)
- [Mac desktop app and iPhone](#mac-desktop-app-and-iphone)
- [Project structure](#project-structure)
- [Known limitations](#known-limitations)
- More: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/PROVIDERS.md](docs/PROVIDERS.md),
  [docs/DESKTOP.md](docs/DESKTOP.md)

## Features

- **Dashboard** with cards you can show, hide and reorder: safe to spend, cash, income and
  spending this month, net worth, budget, goals, upcoming bills, subscriptions, a 30-day cash
  flow estimate, spending by category, recent transactions and insights. On a phone the most
  useful cards come first, with quick actions to add a transaction, goal, budget or account.
- **Accounts**: connect a bank through your own Lunch Flow account (works with Neo Financial) or
  a data provider's hosted sign-in, add manual accounts (cash, loans, investments, property),
  hide or archive accounts, see balance history and sync status.
- **Transactions**: search, filters (account, category, type, tag, dates, amounts, pending,
  needs review), bulk categorise, a detail panel to edit category, merchant name, notes, tags,
  transfer and recurring flags, and an explanation of why each transaction got its category.
  Corrections teach Harbour your merchants.
- **CSV import** for Neo Financial and other Canadian banks: automatic column, date format and
  sign detection, a preview of new versus already-imported rows, duplicate protection and undo.
- **Budgets**, **goals** and **income**: monthly budgets by category with rollover and alerts,
  savings goals with planned and actual contributions, income sources and paycheque allocation
  plans.
- **Bills and subscriptions**: detected from recurring transactions or added by hand, with a
  calendar, reminders and price change detection.
- **Automations**: "when this happens, if these conditions match, do these actions" rules, with a
  preview of what a rule would have matched and a run history.
- **Analytics, forecast and net worth**: spending trends, category breakdowns, income versus
  spending, a cash flow forecast, and net worth over time.
- **Notifications** in the app and by email, with per-type preferences.
- **Search** across transactions, merchants, accounts and pages (Cmd+K).
- **Settings**: profile and province, security (password, signed-in devices, activity), bank
  connections, categories and merchant rules, budget defaults (alert thresholds, rollover,
  whether savings count in safe to spend), how goal contributions are recorded, currency and
  formatting, notifications (including the large-purchase amount and how early bill reminders
  come), automations, appearance (theme, rounded dashboard figures), and data and privacy (CSV
  or ZIP export, AI features, account deletion).
- **Onboarding** that walks a new user through their profile, accounts, income, budget, goals and
  notifications, and a **demo mode** with realistic simulated data.
- **AI assistant and AI categorisation**, both off by default behind feature flags.

## Quick start (Mac)

Requirements: Node.js 22.9 or newer and PostgreSQL 14 or newer.

```bash
# 1. Tools (Homebrew)
brew install node@22 postgresql@16
brew services start postgresql@16

# 2. A database user and database matching .env.example
psql postgres -c "CREATE ROLE budget LOGIN PASSWORD 'budget' CREATEDB;"
psql postgres -c "CREATE DATABASE budget OWNER budget;"
#    (or, with Docker: docker compose up -d)

# 3. Configuration
cp .env.example .env
#    then set AUTH_SECRET to the output of `openssl rand -base64 48`
#    and ENCRYPTION_KEY to the output of `openssl rand -base64 32`

# 4. Install, create the tables, add the demo account, start
npm ci
npm run db:deploy
npm run db:seed
npm run dev
```

Open http://localhost:3000. Create your own account, or use **Try the demo** (demo mode is on by
default outside production) or sign in as `demo@example.com` / `harbour-demo-2026`. The demo
account is filled with clearly labelled simulated data and is reset when the seed runs again.

Emails (verification, password reset) are printed in the terminal running `npm run dev` until an
email provider is configured.

Useful scripts:

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm run lint` / `npm run typecheck` | ESLint (no warnings allowed) and TypeScript |
| `npm test` | Unit tests |
| `npm run test:integration` | Integration tests against PostgreSQL |
| `npm run test:e2e` | Browser tests (Playwright) |
| `npm run db:migrate` | Create and apply a migration after changing `prisma/schema.prisma` |
| `npm run db:deploy` | Apply existing migrations (production, CI, fresh setups) |
| `npm run db:seed` | Create or refresh the demo account (refuses to run in production) |
| `npm run jobs:daily` | Run the daily background jobs once |

## Configuration

All settings are environment variables, validated at startup by `lib/config/env.ts`.
[`.env.example`](.env.example) lists every one with a comment. Never commit `.env`.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `AUTH_SECRET` | Yes | At least 32 characters; signs tokens |
| `ENCRYPTION_KEY` | Yes | Base64 of 32 random bytes; encrypts bank provider tokens |
| `APP_URL` | Yes in production | Public URL, used in emails, redirects and origin checks |
| `APP_ENV` | No | Overrides `NODE_ENV` for app behaviour |
| `BANKING_PROVIDER` | No | `mock`, `flinks` or `plaid` (see [PROVIDERS.md](docs/PROVIDERS.md)) |
| `FLINKS_*`, `PLAID_*` | For live bank connections through Flinks or Plaid | Provider credentials (Lunch Flow needs none: each person pastes their own key) |
| `EMAIL_PROVIDER`, `EMAIL_FROM`, `RESEND_API_KEY` | For real email | `console` (default) or `resend` |
| `ANTHROPIC_API_KEY` | For AI features | Only used when an AI flag is on |
| `CRON_SECRET` | In production | Protects `GET /api/cron/daily` |

Feature flags (`true` or `false`):

| Flag | Default | Turns on |
| --- | --- | --- |
| `DEMO_MODE` | `true` outside production, `false` in production | "Try the demo" with simulated data |
| `ENABLE_BANKING` | `true` | Bank connections through the provider and Lunch Flow |
| `ENABLE_CSV_IMPORT` | `true` | CSV import |
| `ENABLE_AUTOMATIONS` | `true` | Automations |
| `ENABLE_NOTIFICATIONS` | `true` | Notifications and reminders |
| `ENABLE_AI_CATEGORIZATION` | `false` | AI category suggestions (needs `ANTHROPIC_API_KEY` and user opt-in) |
| `ENABLE_AI_ASSISTANT` | `false` | AI assistant (needs `ANTHROPIC_API_KEY` and user opt-in) |
| `ENABLE_MULTI_CURRENCY` | `false` | Non-CAD accounts converted with user-maintained rates |

## What is simulated and what needs real credentials

Simulated or local by default, so everything works with no accounts anywhere:

- **Bank data:** the `mock` provider is a simulated bank with realistic Canadian transactions. Its
  accounts are labelled as simulated and it never pretends to be a real institution.
- **Email:** printed to the server log.
- **AI:** off.
- **Rate limiting:** kept in memory in the server process.
- **Exchange rates:** entered by the user (multi-currency is off by default).

Needs real credentials or accounts:

| Feature | Needs |
| --- | --- |
| Live bank connections | Each person's own Lunch Flow subscription (covers Neo Financial), or for the whole server a Flinks contract (covers Neo) or a Plaid account (does not cover Neo) |
| Email delivery | A Resend API key and a verified sending domain |
| AI features | An Anthropic API key |
| Production hosting | A PostgreSQL database, `AUTH_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET` |

For Neo Financial specifically, connect through Lunch Flow or import CSV files from Neo's website.
See [docs/PROVIDERS.md](docs/PROVIDERS.md).

## Tests

```bash
npm test                    # unit tests (no database needed)

# integration tests use their own database; never point them at real data
createdb -O budget budget_test
DATABASE_URL="postgresql://budget:budget@localhost:5432/budget_test" npm run test:integration

npm run test:e2e            # Playwright: starts the app against a test database
```

The end-to-end suite covers signing up, signing in, the nine onboarding steps, connecting the
simulated bank, the dashboard, importing a CSV file, creating a budget and a goal, editing a
transaction, and building an automation and checking what it does to new transactions.

GitHub Actions (`.github/workflows/ci.yml`) runs lint, type checks, the unit tests and a
production build, then the integration tests against a PostgreSQL service and the end-to-end
suite in Chromium, on every push and pull request.

## Deploying to Vercel

1. Create a PostgreSQL database (Neon, Supabase or any managed Postgres) and copy its connection
   string.
2. Import the repository in Vercel. The default build command `npm run build` runs
   `prisma generate` and `next build`.
3. Set the environment variables: `DATABASE_URL`, `AUTH_SECRET`, `ENCRYPTION_KEY`,
   `APP_URL=https://your-domain`, `CRON_SECRET`, `DEMO_MODE=false`, and the provider and email
   variables you use.
4. Apply the migrations once from your machine:
   `DATABASE_URL="<production url>" npm run db:deploy`.
5. `vercel.json` schedules `GET /api/cron/daily` every day at 10:00 UTC (early morning in
   Quebec). Vercel sends `CRON_SECRET` automatically.
6. With more than one serverless instance, move rate limiting to a shared store (see
   [ARCHITECTURE.md](docs/ARCHITECTURE.md#authentication-and-security)).

## Mac desktop app and iPhone

**Mac:** the desktop app bundles the server and its own PostgreSQL database, so it runs entirely on
your Mac with no hosting. Download the newest `Harbour-<version>-arm64.dmg` (Apple silicon) or
`-x64.dmg` (Intel) from the [releases page](https://github.com/SupimmLuhGekky/Luhpulmaa/releases).
Install, update and build steps are in [docs/DESKTOP.md](docs/DESKTOP.md).

**iPhone and iPad:** open a deployed Harbour site in Safari, tap Share, then **Add to Home Screen**.
It opens full screen like an app. This needs the web app deployed somewhere reachable over HTTPS;
the Mac desktop app's local server is only reachable from that Mac.

**Mac without the desktop app:** open a deployed site in Safari and choose File, then
**Add to Dock**.

## Project structure

```
app/                    Next.js App Router
  (auth)/               sign in, sign up, password reset, email verification
  (app)/                signed-in app: dashboard, accounts, transactions, budget, goals, income,
                        bills, subscriptions, automations, analytics, forecast, net worth,
                        notifications, settings, assistant
  onboarding/           the nine setup steps after sign-up
  actions/              server actions (forms and buttons)
  api/                  JSON API (transactions, import, search, cron, health, ...)
  legal/                terms and privacy
components/             UI by feature, plus components/ui (shared primitives)
lib/                    server-only domain services, one folder per area
  banking/              provider abstraction and the mock, Lunch Flow, Flinks and Plaid adapters
  sync/ import/         bank sync and CSV import pipelines
  transactions/         normalisation, duplicate detection, categorisation, transfers
  finance/ dates/       money in integer cents, calendar dates
  auth/ security/       sessions, passwords, rate limits, encryption, redaction
  jobs/                 daily background jobs
  ledger/               double-entry ledger (not used by the budgeting app; see ARCHITECTURE.md)
prisma/                 schema, migrations, demo seed
desktop/                Mac desktop app (Electron shell, bundled PostgreSQL)
tests/                  unit, integration and end-to-end tests
docs/                   architecture, providers, desktop app
```

## Known limitations

- **Neo Financial connects only through Lunch Flow for individuals.** Plaid does not cover Neo,
  and Flinks, which does, works only under a business contract. Lunch Flow is a paid service of
  its own; CSV import is the free path.
- **The Lunch Flow adapter has not been run against a live Lunch Flow account.** It follows Lunch
  Flow's published Personal API and is covered by tests against stand-ins; the first real
  connection is its first live check.
- **The Flinks adapter has not been tested against a live Flinks instance.** It follows Flinks'
  published API and is covered by unit tests on recorded shapes; verify it in a Flinks sandbox
  before relying on it.
- **The interface is in English.** French bank files, French merchant names and Canadian
  formats are handled, but the screens are not translated yet.
- **Rate limiting is per process** until a shared store is configured.
- **No native iPhone app.** iPhone support is the installable web app, which needs a hosted
  deployment.
- **Harbour never moves money.** Goal contributions and allocations are plans or records of
  transfers you made at your bank.

## License

Private project. All rights reserved.
