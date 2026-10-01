# Bank data in Harbour

Harbour is not a bank and never moves money. It only reads what you choose to give it, and it
never sees or stores bank passwords, card numbers or one-time codes. Bank data can arrive in
four ways:

| Way in | Works today | Needs |
| --- | --- | --- |
| **CSV import** (Transactions → Import) | Every Canadian bank that offers a CSV download, including Neo Financial | Nothing; the file you pick is the only thing Harbour receives |
| **Lunch Flow** (Accounts → Add an account → Connect a bank) | Yes, for anyone, including Neo Financial customers | The person's own Lunch Flow subscription and an API key they paste into Harbour; no server keys |
| **Data aggregator** (Flinks or Plaid hosted sign-in) | Yes in code; live use needs a provider contract | A business account with the aggregator and the keys in [`.env.example`](../.env.example) |
| **Manual accounts and transactions** | Yes | Nothing |

In development and in demo mode a fourth, **simulated bank** (the `mock` provider) fills accounts
with realistic, clearly labelled fake data so every screen can be explored. It never pretends to
be a real institution.

## Neo Financial

What we found while building the app (September 2026):

- **No personal API.** Neo does not offer an API that individuals can use for their own data.
- **Plaid does not cover Neo.** Plaid's Canadian coverage does not include Neo Financial, so the
  Plaid adapter cannot help Neo customers.
- **Flinks covers Neo, but only for businesses.** Flinks lists Neo Financial, but it sells to
  companies under contract (onboarding, compliance review, per-connection pricing). An individual
  cannot sign up for keys to connect their own account.
- **CSV export exists on the website.** Neo lets you download transactions as CSV from the web
  app (not the mobile app). Each export is capped at roughly 2,000 rows and the column layout is
  not documented, so it may change.

- **Lunch Flow covers Neo for individuals.** Lunch Flow is a paid personal service (listed at
  $34.99 a year with two bank connections in October 2026, after a 7-day free trial) that connects
  to banks through aggregators such as MX and Finicity and offers a read-only Personal API. Harbour
  connects to it with the person's own key: see [Lunch Flow](#lunch-flow) below. Check that Neo
  appears in Lunch Flow during the trial before paying.

So for personal use there are two paths. **Lunch Flow** keeps accounts up to date on their own.
**CSV import** costs nothing, and is built to cope with Neo's files:

- columns are detected automatically from the header (English and French), and you can adjust
  the mapping before anything is saved;
- the date format (DD/MM vs MM/DD) is detected for the whole file, not guessed row by row;
- credit card files where purchases are positive are recognised and the sign is flipped;
- pending and declined rows are skipped;
- files saved by Excel in Windows-1252 are read correctly;
- the preview shows which rows are new, already imported, skipped or unreadable;
- overlapping exports are safe, because duplicates are detected and skipped (see
  [ARCHITECTURE.md](ARCHITECTURE.md#duplicate-detection));
- every import can be undone from the import history.

A simple routine without Lunch Flow: once a month, export the last month or two from Neo's website
and import it. With Lunch Flow, a CSV import can still bring in older history: when connecting, a
Lunch Flow account can continue the account the files went into, and the duplicate detection
skips what both have.

**Never** install browser extensions, bookmarklets or scripts on your bank's website to "export"
data. They run with full access to your signed-in bank account.

## Choosing the provider

`BANKING_PROVIDER` selects the aggregator used by "Connect a bank" (Lunch Flow is always offered
beside it, because it needs no server keys):

| Value | Behaviour |
| --- | --- |
| `mock` | Simulated bank. Default outside production. Always used by automated tests. |
| `flinks` | Flinks Connect (Canadian coverage including Neo, Desjardins and the big banks). |
| `plaid` | Plaid Link with `country_codes: ["CA"]`. Default in production when unset. |

`ENABLE_BANKING=false` hides bank connections entirely, Lunch Flow included (CSV import and
manual accounts still work).

All adapters implement the same `FinancialDataProvider` interface (`lib/banking/types.ts`) and
return data already normalised to Harbour's conventions: integer cents, outflows negative,
liability balances as positive amounts owed, dates as `YYYY-MM-DD`. The one exception is an
adapter whose provider doesn't say what kind of account each one is (`reportsAccountTypes =
false`, Lunch Flow): it returns balances signed from the holder's view, and the sync turns them
into amounts owed once it knows, from the person's choice, that the account is a debt. Nothing
outside `lib/banking/providers` knows a provider's field names.

## Lunch Flow

[Lunch Flow](https://www.lunchflow.app) is a personal service: each person connects their bank
inside their own Lunch Flow account, then creates an **API destination** there (Destinations →
Add Destination → API) and pastes its key into Harbour. The server needs no keys of its own, so
Lunch Flow works on every server where `ENABLE_BANKING` is on, including the Mac app.

How it works (`lib/banking/providers/lunchflow.ts`, `lib/accounts/lunchflow.ts`):

1. **Check the key.** Harbour calls `GET /accounts` and `GET /accounts/:id/balance` on the
   Personal API (`https://www.lunchflow.app/api/v1`, header `x-api-key`) and shows what the key
   can read. Nothing is saved yet.
2. **Choose.** Lunch Flow doesn't report account types, so Harbour suggests one from each
   account's name and the person confirms it. Each account comes in as a new account, continues
   an existing manual account (for example one filled from Neo's CSV files, so its history stays
   and nothing is imported twice), or stays out. Accounts in another currency than the person's
   stay out while multi-currency support is off.
3. **Save and import.** One Harbour connection is saved per Lunch Flow bank connection. Its
   stored "access token" is a small JSON document holding the key, which bank connection it
   covers and the accounts left out, encrypted with AES-256-GCM (`ENCRYPTION_KEY`). The key is
   never sent back to the browser, logged or written to the audit log.
4. **Sync.** Like Flinks, Lunch Flow is date-range based: each sync reads
   `GET /accounts/:id/transactions?from&to&include_pending=false` over an overlapping window and the
   duplicate detection drops what is already stored. Only posted transactions are imported, so a
   card hold that settles at a different amount never becomes a duplicate. When a response's
   `total` says rows are missing, the window is fetched again in halves.

Conventions handled by the adapter: amounts arrive as numbers or strings and are converted to cents
without floating point; purchases are negative; a card's balance is negative while money is owed;
accounts often have no currency (the balance's is used). Lunch Flow's own error text is never shown.
A refused key (401/403) marks the connection as needing a new key; 429 and 5xx answers are retried
a couple of times, then left to the next sync; redirects are not followed, so the key only ever
goes to the configured host. `LUNCHFLOW_API_URL` exists for tests only, and production refuses a
plain-http address.

To stop, the person disconnects in Harbour (the key is deleted, history kept) and deletes the API
destination in Lunch Flow. Pasting a key again later reconnects the same accounts.

For local development and the browser tests, `tests/e2e/support/fake-lunchflow.mjs` is a stand-in
with fictional data: run it with `node tests/e2e/support/fake-lunchflow.mjs`, set
`LUNCHFLOW_API_URL=http://localhost:3106/api/v1` and paste the key it prints.

**Before relying on it:** the adapter follows Lunch Flow's published Personal API and what
open-source importers found live (missing currencies, string amounts), and is covered by unit and
integration tests against stand-ins, but it was not run against a live Lunch Flow account while
being built.

## Flinks

Flinks is the adapter to use for Neo Financial once a contract is in place.

1. Sign a Flinks agreement. Flinks provisions an instance and gives you a customer id, an API
   base URL, a Connect (iframe) URL, a secret key and possibly a data API key.
2. Set the variables:

   ```bash
   BANKING_PROVIDER="flinks"
   FLINKS_CUSTOMER_ID="..."
   FLINKS_API_URL="https://<instance>-api.private.fin.ag"        # the adapter adds /v3/<customer id>/BankingServices
   FLINKS_CONNECT_URL="https://<instance>-iframe.private.fin.ag/v2/"
   FLINKS_SECRET="..."                                            # server only, never sent to the browser
   FLINKS_API_KEY="..."                                           # only if your instance requires x-api-key
   ```

3. Ask Flinks to allow your `APP_URL` origin for the Connect iframe and the `/accounts/connect`
   redirect.

How the connection works (`lib/banking/providers/flinks.ts`):

1. The server calls `GenerateAuthorizeToken` with the secret and opens Flinks Connect in an
   iframe with that short-lived token. Outside production the iframe runs in Flinks demo mode.
2. You sign in to your bank inside Flinks. Harbour never sees the credentials.
3. Flinks posts a `REDIRECT` message with a `loginId`. The page accepts it only from the Connect
   origin it opened, and only if it is a UUID (`lib/banking/flinks-connect.ts`).
4. The server stores the `loginId` encrypted (AES-256-GCM, `ENCRYPTION_KEY`) and, for every sync,
   calls `Authorize` (most recent cached data) then `GetAccountsDetail`, polling
   `GetAccountsDetailAsync` while Flinks answers 202.

Flinks is date-range based with no cursor, so each sync re-reads an overlapping window and the
duplicate detection drops what is already stored.

**Before going live:** the adapter follows the Flinks v3 BankingServices documentation, but it has
not been run against a live Flinks instance. Check field names, error codes and the iframe events
against your instance's sandbox first; `tests/unit/flinks.test.ts` covers the parsing.

## Plaid

Useful for Canadian institutions Plaid supports (not Neo).

```bash
BANKING_PROVIDER="plaid"
PLAID_CLIENT_ID="..."
PLAID_SECRET="..."
PLAID_ENV="sandbox"            # sandbox | development | production
```

Leave `PLAID_WEBHOOK_URL` unset. Harbour syncs every day and whenever you press Sync; it has no
Plaid webhook endpoint yet.

The adapter (`lib/banking/providers/plaid.ts`) creates Link tokens, exchanges the public token
for an access token (stored encrypted), and syncs incrementally with `/transactions/sync`.
Plaid's positive-means-outflow amounts are negated and decimal amounts are converted to cents
without floating point rounding errors.

## Adding another provider

1. Implement `FinancialDataProvider` in `lib/banking/providers/<name>.ts`. If the provider
   doesn't report account types, set `reportsAccountTypes = false` and add it to
   `PERSON_TYPED_PROVIDERS` in `lib/accounts/types.ts`.
2. Add the value to the `ProviderType` enum in `prisma/schema.prisma` and migrate.
3. Register it in `lib/banking/registry.ts` and add its variables to `lib/config/env.ts` and
   `.env.example`.
4. Allow its hosted widget in the Content Security Policy in `next.config.ts`.

The sync pipeline, duplicate detection, categorisation, automations and notifications work
unchanged for any provider.
