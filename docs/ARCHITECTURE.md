# Architecture

Harbour is one Next.js application (App Router) backed by PostgreSQL through Prisma. The same
code runs on Vercel, on any Node host, and inside the Mac desktop app, which starts the server and
its database locally (see [DESKTOP.md](DESKTOP.md)).

```
Browser (React, Tailwind, Radix)                 Scheduled jobs
  │  server components render pages                 │  Vercel Cron → GET /api/cron/daily
  │  server actions for forms and buttons           │  or `npm run jobs:daily`
  │  JSON API under /api for other clients          │
  ▼                                                 ▼
app/          pages, server actions (app/actions), API routes (app/api)
  │  every entry point: requireUser / authedAction / apiRoute → zod validation
  ▼
lib/          server-only domain services (one folder per area)
  │  accounts, transactions, import, budget, goals, income, bills, subscriptions,
  │  recurring, automation, notifications, analytics, forecast, networth, sync, banking
  ▼
Prisma  →  PostgreSQL
```

## Ground rules

These hold everywhere in the code base:

- **Harbour is not a bank.** It organises information about money held elsewhere. Nothing in the
  product moves money or claims to: goal "contributions" are either planned allocations or
  transfers the user reports or the bank data shows, and the UI says which.
- **Money is integer cents.** Amounts are `number` cents in TypeScript (exact up to about
  $90 trillion) and `BigInt` or `Int` columns in the database. Multiplication and division go
  through `mulDiv` in BigInt with explicit rounding; percentages are basis points
  (`lib/finance/money.ts`). Floating point is never used on money.
- **Dates are calendar days.** Transaction dates, due dates, paydays and deadlines are
  `"YYYY-MM-DD"` strings (`LocalDate`) stored in `@db.Date` columns, with arithmetic on UTC
  midnights so time zones and daylight saving can never shift them. The user's IANA time zone
  (default `America/Toronto`) is used only to decide what "today" is (`lib/dates`).
- **Every query is scoped to the signed-in user.** Services take a `userId` and include it in
  every `where`. Ids coming from the client are re-checked for ownership; a record that belongs
  to someone else is reported as not found.
- **Server-only code stays on the server.** Services import `server-only`, so a client
  component that imports one fails the build. Secrets come from `lib/config/env.ts`, which
  validates the environment at startup.

## Request handling

| Entry point | Helper | What it guarantees |
| --- | --- | --- |
| Pages | `requireUser()` / `requireOnboardedUser()` (`lib/auth/guard.ts`) | Valid session, otherwise redirect to sign-in (or onboarding) |
| Server actions | `authedAction(schema, handler)` (`lib/api/action.ts`) | Session, zod-validated input, errors mapped to `{ ok: false, error }` with safe messages |
| API routes | `apiRoute({ body, query, rateLimit }, handler)` (`lib/api/route.ts`) | Session, same-origin check on mutations, zod validation, rate limit, `{ data }` / `{ error }` envelope, `Cache-Control: no-store` |
| Cron | `GET /api/cron/daily` | `Authorization: Bearer $CRON_SECRET`, compared in constant time; 503 when the secret is unset |

`middleware.ts` only bounces requests without a session cookie away from app pages. It is a
fast path, never the authorisation check.

## Authentication and security

- **Sessions** are database rows (`Session`). The cookie `harbour_session` holds a random 256-bit
  token; the database stores only its SHA-256 hash. Cookies are `httpOnly`, `SameSite=Lax`,
  `Secure` in production, valid 30 days and slid forward at most once a day. Users can see and
  revoke their sessions; changing the password revokes every other session.
- **Passwords** are hashed with bcrypt (cost 12). Sign-in burns the same bcrypt time for
  unknown emails, and an account locks for 15 minutes after 8 failed attempts.
- **Email verification and password reset** use single-use hashed tokens that expire (24 hours
  and 1 hour).
- **Rate limits** (`lib/security/rate-limit.ts`): sign-in, sign-up, password reset, email
  verification, sync, export, import, assistant, and a general API limit. The default store is
  in memory, which is right for one server process (local, desktop, a single container). For
  several serverless instances, plug in a shared store with `setRateLimitStore()`.
- **CSRF:** `SameSite=Lax` cookies, Next.js's built-in origin check for server actions, and an
  explicit same-origin check for mutating API requests.
- **Headers** (`next.config.ts`): a Content Security Policy that only allows the app's own origin
  plus the Plaid and Flinks hosted widgets, `frame-ancestors 'none'`, `X-Frame-Options: DENY`,
  `nosniff`, a strict referrer policy, a locked-down permissions policy, and HSTS in production.
- **Secrets at rest:** provider access tokens are encrypted with AES-256-GCM using
  `ENCRYPTION_KEY` (`lib/security/encryption.ts`). Bank credentials never reach the app.
- **Logs and audit trail:** `lib/security/redact.ts` strips anything that looks like a password,
  token, key or account number before logging. Security- and money-relevant events (sign-in,
  password change, connections, imports, exports, deletions) are written to `AuditLog`.

## Data model

All tables live in `prisma/schema.prisma` (one initial migration in `prisma/migrations`). Every
user-owned table has a `userId` with `onDelete: Cascade`, so deleting an account removes all of
its data.

| Area | Tables | Notes |
| --- | --- | --- |
| Identity | `User`, `Session`, `VerificationToken`, `AuditLog` | Profile, currency, locale, time zone, province, onboarding state, demo flag |
| Bank data | `Institution`, `ProviderConnection`, `Account`, `AccountBalanceSnapshot`, `SyncLog`, `ImportBatch` | Connections hold the encrypted provider token. Accounts are connected or manual, can be hidden, and keep daily balance history |
| Transactions | `Transaction`, `Merchant`, `Category`, `Subcategory`, `MerchantRule`, `Tag`, `TransactionTag` | Amounts are signed `BigInt` cents (negative = money out). Each row records how it was categorised and by which rule |
| Planning | `Budget`, `BudgetItem`, `Goal`, `GoalContribution`, `IncomeSource`, `AllocationPlan`, `AllocationItem` | Standard or zero-based budgets; goal contributions say whether money was planned or actually moved |
| Recurring | `RecurringTransaction`, `Subscription`, `Bill`, `BillPayment` | Detected series feed subscriptions, bills and the forecast |
| Automations | `Automation`, `AutomationCondition`, `AutomationAction`, `AutomationRun` | Trigger, conditions (all/any), ordered actions, and a run log |
| Notifications | `Notification`, `NotificationPreference` | Per-type, per-channel preferences |
| Reporting | `NetWorthSnapshot`, `ExchangeRate` | Daily net worth; user-maintained rates for multi-currency |
| Ledger | `LedgerAccount`, `LedgerJournalEntry`, `LedgerEntry` | Double-entry ledger kept separate on purpose; see below |

Uniqueness constraints make background work idempotent:

- `Transaction (accountId, providerTransactionId)`: the same provider transaction is stored once.
- `GoalContribution (userId, idempotencyKey)`, `AutomationRun (automationId, idempotencyKey)`,
  `BillPayment (billId, dueDate)`, `Notification (userId, dedupeKey)`,
  `NetWorthSnapshot (userId, date)`, `AccountBalanceSnapshot (accountId, date)`: re-running a job
  never doubles anything.

## Pipelines

### Bank sync (`lib/sync/service.ts`)

For each connection: fetch accounts and balances, upsert accounts and balance history, fetch
transactions (cursor or overlapping date window; 180 days on first sync), normalise, drop
duplicates, replace pending transactions with their posted versions, apply removals, categorise,
run automations, match transfers between the user's own accounts, detect recurring series,
refresh net worth, and write a `SyncLog`. A connection already syncing is skipped, and a failure
marks the connection and notifies the user without losing earlier data.

### CSV import (`lib/import`)

The browser parses the file (Papa Parse), detects columns, date format, sign convention and
encoding, and shows a live preview. Only the mapped columns are sent to the server, which
validates every row again, previews new versus duplicate rows, and on commit runs the same
ingest path as bank sync inside an `ImportBatch` that can be undone.

### Duplicate detection (`lib/transactions/dedupe.ts`)

A transaction is a duplicate when, in order: it has the same provider id in the same account; it
is the posted version of a pending transaction already stored; it has the same fingerprint (date,
amount, normalised description); or it matches fuzzily (same account and amount, dates within a
small window, a similar merchant or bank description) when at least one side has no provider id.
Of several fuzzy matches, the most similar wins, then the closest in date. This is what lets a
Lunch Flow account continue an account filled from CSV files without importing anything twice.

### Categorisation (`lib/transactions/categorization.ts`)

The first rule that answers wins: the user's merchant rules, built-in merchant keyword rules
(Quebec and Canadian merchants), the provider's category hint, income and transfer heuristics,
then an optional AI suggestion. Automations with a "set category" action run afterwards. When a
user corrects the same merchant twice, a merchant rule is learned. Each transaction stores the
source and rule so the UI can explain why it was categorised.

### Automations (`lib/automation`)

Triggers: new transaction, income received, weekly or monthly schedule, subscription detected,
budget threshold. Conditions compare merchant, description, amount, category, account or type.
Actions: set category, add tag, mark as transfer or recurring, set a note, rename the merchant,
plan an allocation or round-up to a goal, or send a notification. Every run is logged with an
idempotency key, so a transaction or a scheduled period is processed once.

### Daily jobs (`lib/jobs/daily.ts`)

Run per user, in the user's time zone: sync connections, detect recurring series, reconcile bill
payments, send bill and subscription reminders, budget alerts, goal deadline checks, scheduled
automations, and the net worth snapshot. Each step is idempotent and a failing step does not stop
the others. Triggered by Vercel Cron (`vercel.json`), `npm run jobs:daily`, or the desktop app.

## Bank data providers

`lib/banking` defines `FinancialDataProvider` and four adapters: mock (simulated bank), Lunch Flow
(each person's own API key, beside the server's provider), Flinks and Plaid. See
[PROVIDERS.md](PROVIDERS.md) for setup and for what works with Neo Financial.

## The ledger

`lib/ledger` contains a validated, append-only, idempotent double-entry ledger
(`PrismaLedgerService`). Nothing in the budgeting app posts to it. Budgeting rows describe money
held at other institutions; a ledger records money an operator actually holds. It exists so that a
licensed banking or payments partner could be added later without reshaping the data model, and
it must stay unused until such a partner exists.

## Optional AI

`lib/ai` adds AI categorisation suggestions and a read-only assistant, both off by default
(`ENABLE_AI_CATEGORIZATION`, `ENABLE_AI_ASSISTANT`), both requiring `ANTHROPIC_API_KEY` and the
user's opt-in in Settings. The assistant answers by calling read-only tools that look up the signed-in user's own data;
none of them can change data or move money.

## Tests

- `tests/unit`: pure logic (money, dates, categorisation, duplicate detection, CSV parsing,
  forecasting, providers' parsing) with Vitest.
- `tests/integration`: services against a real PostgreSQL database.
- `tests/e2e`: Playwright flows through the browser, against a dev server and a throwaway
  `*_e2e` database.

All three run in GitHub Actions on every push and pull request (`.github/workflows/ci.yml`). See
the README for commands.
