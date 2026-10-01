/**
 * Request schemas for accounts and bank connections. Client-safe (no server imports)
 * so forms validate with exactly the rules the server enforces.
 */
import { z } from "zod";
import { DEFAULT_CURRENCY, SUPPORTED_CURRENCIES } from "@/lib/finance/money";

export const ACCOUNT_TYPES = ["CHEQUING", "SAVINGS", "CASH", "CREDIT_CARD", "LINE_OF_CREDIT", "LOAN", "MORTGAGE", "INVESTMENT", "OTHER_ASSET", "OTHER_LIABILITY"] as const;
export const ACCOUNT_CURRENCIES = SUPPORTED_CURRENCIES;

/** $100 million: far above any personal balance, well inside safe-integer cents. */
export const MAX_BALANCE_CENTS = 100_000_000_00;

const balance = z
  .number({ required_error: "Enter the balance", invalid_type_error: "Enter the balance" })
  .int()
  .min(-MAX_BALANCE_CENTS, "That amount is too large")
  .max(MAX_BALANCE_CENTS, "That amount is too large");

const creditLimit = z.number({ invalid_type_error: "Enter an amount" }).int().min(0).max(MAX_BALANCE_CENTS, "That amount is too large");

export const manualAccountSchema = z.object({
  name: z.string().trim().min(1, "Give the account a name").max(60, "Keep it under 60 characters"),
  type: z.enum(ACCOUNT_TYPES, { errorMap: () => ({ message: "Choose a type" }) }),
  institutionName: z.string().trim().max(60, "Keep it under 60 characters").optional(),
  currency: z.enum(ACCOUNT_CURRENCIES).default(DEFAULT_CURRENCY),
  /** Assets: amount held. Liabilities: amount owed (positive). */
  balanceCents: balance,
  creditLimitCents: creditLimit.nullable().optional(),
  mask: z
    .string()
    .trim()
    .regex(/^\d{0,4}$/, "Use up to 4 digits")
    .optional(),
});

export type ManualAccountInput = z.input<typeof manualAccountSchema>;

export const accountUpdateSchema = z.object({
  name: z.string().trim().min(1, "Give the account a name").max(60, "Keep it under 60 characters").optional(),
  isHidden: z.boolean().optional(),
  includeInNetWorth: z.boolean().optional(),
  /** Manual accounts only. */
  balanceCents: balance.optional(),
  /** Manual accounts only. */
  type: z.enum(ACCOUNT_TYPES).optional(),
  /** Manual credit cards and lines of credit only; null removes the limit. */
  creditLimitCents: creditLimit.nullable().optional(),
});

export type AccountUpdateInput = z.input<typeof accountUpdateSchema>;

const uuid = z.string().uuid();

export const linkSessionSchema = z.object({ reconnectConnectionId: uuid.optional() });

/**
 * Finishing a bank link. `publicToken` is the provider's one-time token (Plaid
 * public_token, Flinks loginId, or a simulated-bank token in demo mode). Only the
 * institution is accepted from the widget's metadata; anything else is dropped.
 */
export const connectSchema = z.object({
  publicToken: z.string().trim().min(1).max(512),
  metadata: z
    .object({
      institution: z
        .union([z.string().trim().max(120), z.object({ institution_id: z.string().max(100).optional(), name: z.string().max(120).optional() })])
        .nullable()
        .optional(),
    })
    .optional(),
});

/** A Lunch Flow API key as pasted. It is sent to the server only, stored encrypted and never logged. */
const lunchFlowKey = z
  .string({ required_error: "Paste your Lunch Flow API key", invalid_type_error: "Paste your Lunch Flow API key" })
  .trim()
  .min(1, "Paste your Lunch Flow API key")
  .max(512, "That doesn't look like a Lunch Flow API key")
  .regex(/^[\x21-\x7e]+$/, "That doesn't look like a Lunch Flow API key. Copy it again, without spaces.");

export const lunchFlowPreviewSchema = z.object({ apiKey: lunchFlowKey });

const lunchFlowAccountId = z.string().trim().min(1).max(100);

/** How one Lunch Flow account comes into Harbour: as a new account, into an existing manual account, or not at all. */
export const lunchFlowChoiceSchema = z.discriminatedUnion("action", [
  z.object({ providerAccountId: lunchFlowAccountId, action: z.literal("new"), type: z.enum(ACCOUNT_TYPES) }),
  z.object({ providerAccountId: lunchFlowAccountId, action: z.literal("link"), type: z.enum(ACCOUNT_TYPES), linkAccountId: uuid }),
  z.object({ providerAccountId: lunchFlowAccountId, action: z.literal("skip") }),
]);
export type LunchFlowChoice = z.infer<typeof lunchFlowChoiceSchema>;

export const lunchFlowConnectSchema = z.object({ apiKey: lunchFlowKey, accounts: z.array(lunchFlowChoiceSchema).max(100) });

export const syncAccountSchema = z.object({ accountId: uuid });
export const connectionIdSchema = z.object({ connectionId: uuid });
export const disconnectSchema = z.object({ connectionId: uuid, deleteData: z.boolean().default(false) });
