// @ts-check
/**
 * A stand-in for Lunch Flow's Personal API, for browser tests and local development.
 * Fictional data only. Point the app at it with
 *   LUNCHFLOW_API_URL=http://localhost:3106/api/v1
 * and paste the key below into Harbour's "Connect Lunch Flow" dialog.
 *
 * Shapes follow https://www.lunchflow.app/docs/api/personal-api-overview, including what
 * importers found live: accounts without a currency, amounts as numbers or strings,
 * credit card balances negative while money is owed.
 *
 *   node tests/e2e/support/fake-lunchflow.mjs   (port: FAKE_LUNCHFLOW_PORT, default 3106)
 */
import http from "node:http";

// Defaults match tests/e2e/support/env.ts.
const KEY = process.env.FAKE_LUNCHFLOW_KEY || "lf-fictional-test-key";
const PORT = Number(process.env.FAKE_LUNCHFLOW_PORT || 3106);

/** "YYYY-MM-DD", `days` from today (UTC). */
function day(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const ACCOUNTS = [
  // No currency, as importers found on the live API: the balance carries it.
  { id: 9001, connection_id: 501, name: "Fictional Neo Mastercard", institution_name: "Fictional Neo Financial", institution_logo: "", provider: "mx", status: "ACTIVE" },
  { id: 9002, connection_id: 501, name: "Fictional Everyday Account", institution_name: "Fictional Neo Financial", institution_logo: "", provider: "mx", currency: "CAD", status: "ACTIVE" },
];

const BALANCES = {
  9001: { amount: -523.1, currency: "CAD" },
  9002: { amount: "1840.25", currency: "CAD" },
};

function transactions(accountId) {
  if (accountId === 9001) {
    return [
      { id: "lf-tx-1001", accountId, amount: -5.25, currency: "CAD", date: day(-2), merchant: "Fictional Corner Cafe", description: "FICTIONAL CORNER CAFE MONTREAL QC", isPending: false },
      { id: "lf-tx-1002", accountId, amount: "-87.34", currency: "CAD", date: day(-5), merchant: "Fictional Grocer", description: "FICTIONAL GROCER #12", isPending: false },
      { id: "lf-tx-1003", accountId, amount: 300, currency: "CAD", date: day(-3), merchant: null, description: "PAYMENT - THANK YOU", isPending: false },
      { id: "lf-tx-1004", accountId, amount: -41.17, currency: "CAD", date: day(0), merchant: "Fictional Bistro", description: "FICTIONAL BISTRO", isPending: true },
    ];
  }
  if (accountId === 9002) {
    return [
      { id: "lf-tx-2001", accountId, amount: 2000, currency: "CAD", date: day(-10), merchant: "Fictional Employer", description: "PAYROLL FICTIONAL EMPLOYER", isPending: false },
      { id: "lf-tx-2002", accountId, amount: -300, currency: "CAD", date: day(-3), merchant: null, description: "TRANSFER TO CARD", isPending: false },
    ];
  }
  return [];
}

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  if (url.pathname === "/health") return send(res, 200, { ok: true });
  if (req.method !== "GET") return send(res, 405, { error: "Method Not Allowed", message: "GET only" });
  if (req.headers["x-api-key"] !== KEY) {
    return send(res, 401, { error: "Unauthorized", message: "Authentication required. Provide x-api-key header or Authorization: Bearer token." });
  }
  if (url.pathname === "/api/v1/accounts") return send(res, 200, { accounts: ACCOUNTS, total: ACCOUNTS.length });

  const match = /^\/api\/v1\/accounts\/(\d+)\/(balance|transactions)$/.exec(url.pathname);
  const account = match ? ACCOUNTS.find((a) => a.id === Number(match[1])) : undefined;
  if (!match || !account) return send(res, 404, { error: "Not Found", message: "Account not found" });
  if (match[2] === "balance") return send(res, 200, { balance: BALANCES[account.id] });

  const from = url.searchParams.get("from") ?? "0000-01-01";
  const to = url.searchParams.get("to") ?? "9999-12-31";
  const pending = url.searchParams.get("include_pending") === "true";
  const rows = transactions(account.id).filter((t) => t.date >= from && t.date <= to && (pending || !t.isPending));
  return send(res, 200, { transactions: rows, total: rows.length });
});

server.listen(PORT, () => console.info(`Fake Lunch Flow listening on http://localhost:${PORT}/api/v1 (key: ${KEY})`));
