import { z } from "zod";

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const uuid = z.string().uuid();

export const TRANSACTION_TYPES = ["INCOME", "EXPENSE", "TRANSFER", "REFUND", "ADJUSTMENT"] as const;

export const transactionFiltersSchema = z.object({
  q: z.string().trim().max(100).optional(),
  accountId: z.union([uuid, z.array(uuid)]).optional(),
  categoryId: z.union([uuid, z.literal("uncategorized"), z.array(z.union([uuid, z.literal("uncategorized")]))]).optional(),
  merchantId: uuid.optional(),
  type: z.enum(TRANSACTION_TYPES).optional(),
  tagId: uuid.optional(),
  from: localDate.optional(),
  to: localDate.optional(),
  minCents: z.coerce.number().int().min(0).optional(),
  maxCents: z.coerce.number().int().min(0).optional(),
  pending: z.enum(["true", "false"]).optional(),
  review: z.enum(["uncategorized", "ai"]).optional(),
  sort: z.enum(["date_desc", "date_asc", "amount_desc", "amount_asc", "merchant_asc"]).default("date_desc"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(50),
});

export type TransactionFilters = z.infer<typeof transactionFiltersSchema>;

export const createTransactionSchema = z.object({
  accountId: uuid,
  date: localDate,
  /** Signed cents: negative for money out. */
  amountCents: z.number().int().refine((v) => v !== 0, "Amount can't be zero").refine((v) => Math.abs(v) <= 10_000_000_00, "Amount is too large"),
  merchantName: z.string().trim().min(1, "Required").max(80),
  description: z.string().trim().max(200).optional(),
  categoryId: uuid.nullable().optional(),
  subcategoryId: uuid.nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
});

export const updateTransactionSchema = z.object({
  date: localDate.optional(),
  amountCents: z.number().int().refine((v) => v !== 0).optional(),
  merchantName: z.string().trim().min(1).max(80).optional(),
  categoryId: uuid.nullable().optional(),
  subcategoryId: uuid.nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  type: z.enum(TRANSACTION_TYPES).optional(),
  isRecurring: z.boolean().optional(),
  isTransfer: z.boolean().optional(),
  isExcluded: z.boolean().optional(),
  /** Also apply the new category to other transactions from the same merchant. */
  applyToMerchant: z.boolean().optional(),
});
