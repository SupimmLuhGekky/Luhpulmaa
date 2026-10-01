# Bank data in Harbour

Harbour is not a bank and never moves money. It only reads what you choose to give it, and it
never sees or stores bank passwords, card numbers or one-time codes. Bank data can arrive in
three ways:

| Way in | Works today | Needs |
| --- | --- | --- |
| **CSV import** (Transactions → Import) | Every Canadian bank that offers a CSV download, including Neo Financial | Nothing; the file you pick is the only thing Harbour receives |
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

So for personal use the reliable path is **CSV import**, which is built to cope with exactly this:

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

A simple routine: once a month, export the last month or two from Neo's website and import it.

**Never** install browser extensions, bookmarklets or scripts on your bank's website to "export"
data. They run with full access to your signed-in bank account.

## Choosing the provider

`BANKING_PROVIDER` selects the aggregator used by "Connect a bank":

| Value | Behaviour |
| --- | --- |
| `mock` | Simulated bank. Default outside production. Always used by automated tests. |
| `flinks` | Flinks Connect (Canadian coverage including Neo, Desjardins and the big banks). |
| `plaid` | Plaid Link with `country_codes: ["CA"]`. Default in production when unset. |

`ENABLE_BANKING=false` hides bank connections entirely (CSV import and manual accounts still work).

All adapters implement the same `FinancialDataProvider` interface (`lib/banking/types.ts`) and
return data already normalised to Harbour's conventions: integer cents, outflows negative,
liability balances as positive amounts owed, dates as `YYYY-MM-DD`. Nothing outside
`lib/banking/providers` knows a provider's field names or sign conventions.

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

1. Implement `FinancialDataProvider` in `lib/banking/providers/<name>.ts`.
2. Add the value to the `ProviderType` enum in `prisma/schema.prisma` and migrate.
3. Register it in `lib/banking/registry.ts` and add its variables to `lib/config/env.ts` and
   `.env.example`.
4. Allow its hosted widget in the Content Security Policy in `next.config.ts`.

The sync pipeline, duplicate detection, categorisation, automations and notifications work
unchanged for any provider.
