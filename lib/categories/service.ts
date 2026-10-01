import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { AppError, notFound } from "@/lib/api/errors";
import { audit } from "@/lib/audit";

export const categoryInputSchema = z.object({
  name: z.string().trim().min(1).max(40),
  kind: z.enum(["EXPENSE", "INCOME", "TRANSFER"]).default("EXPENSE"),
  icon: z.string().trim().min(1).max(40).default("circle"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#64748b"),
});

export const subcategoryInputSchema = z.object({ name: z.string().trim().min(1).max(40), icon: z.string().max(40).nullable().optional() });

export async function listCategories(userId: string) {
  const rows = await prisma.category.findMany({
    where: { userId },
    include: { subcategories: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, icon: true, sortOrder: true } }, _count: { select: { transactions: true } } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind,
    icon: c.icon,
    color: c.color,
    systemKey: c.systemKey,
    isHidden: c.isHidden,
    sortOrder: c.sortOrder,
    transactionCount: c._count.transactions,
    subcategories: c.subcategories,
  }));
}

export type CategoryOption = Awaited<ReturnType<typeof listCategories>>[number];

function isUniqueViolation(error: unknown) {
  return (error as { code?: string } | null)?.code === "P2002";
}

function duplicateName(name: string | undefined): AppError {
  const message = `You already have a category called “${name ?? ""}”.`;
  return new AppError("CONFLICT", message, { fieldErrors: { name: [message] } });
}

export async function createCategory(userId: string, input: z.infer<typeof categoryInputSchema>) {
  const count = await prisma.category.count({ where: { userId } });
  if (count >= 200) throw new AppError("CONFLICT", "You can have up to 200 categories.");
  const cat = await prisma.category.create({ data: { userId, ...input, sortOrder: count } }).catch((error: unknown) => {
    if (isUniqueViolation(error)) throw duplicateName(input.name);
    throw error;
  });
  await audit(userId, "category.created", { type: "category", id: cat.id }, { name: cat.name });
  return cat;
}

export async function updateCategory(userId: string, id: string, input: Partial<z.infer<typeof categoryInputSchema>> & { isHidden?: boolean }) {
  const cat = await prisma.category.findFirst({ where: { id, userId } });
  if (!cat) throw notFound("Category");
  // Built-in categories drive transfers, income and safe-to-spend, so their type is fixed.
  if (cat.systemKey && input.kind && input.kind !== cat.kind) throw new AppError("FORBIDDEN", "Built-in categories keep their type.");
  const updated = await prisma.category.update({ where: { id }, data: input }).catch((error: unknown) => {
    if (isUniqueViolation(error)) throw duplicateName(input.name);
    throw error;
  });
  await audit(userId, "category.updated", { type: "category", id }, { fields: Object.keys(input) });
  return updated;
}

export async function reorderCategories(userId: string, orderedIds: string[]) {
  const owned = await prisma.category.findMany({ where: { userId, id: { in: orderedIds } }, select: { id: true } });
  if (owned.length !== orderedIds.length) throw notFound("Category");
  await prisma.$transaction(orderedIds.map((id, index) => prisma.category.update({ where: { id }, data: { sortOrder: index } })));
}

/**
 * Deletes a category. If transactions still use it, `reassignTo` (another category id,
 * or null for "uncategorised") must be given explicitly — nothing is silently dropped.
 */
export async function deleteCategory(userId: string, id: string, reassignTo?: string | null) {
  const cat = await prisma.category.findFirst({ where: { id, userId }, include: { _count: { select: { transactions: true } } } });
  if (!cat) throw notFound("Category");
  // Built-in categories anchor automatic categorisation, transfers, subscriptions and
  // safe-to-spend; they can be renamed or hidden but not deleted.
  if (cat.systemKey) throw new AppError("FORBIDDEN", "Built-in categories can't be deleted. You can hide it instead.");
  if (cat._count.transactions > 0) {
    if (reassignTo === undefined) {
      throw new AppError("CONFLICT", `${cat._count.transactions} transactions use this category. Choose where to move them first.`);
    }
    if (reassignTo === id) throw new AppError("VALIDATION_FAILED", "Pick a different category.");
    if (reassignTo && !(await prisma.category.count({ where: { id: reassignTo, userId } }))) throw notFound("Target category");
    await prisma.transaction.updateMany({
      where: { userId, categoryId: id },
      data: { categoryId: reassignTo, subcategoryId: null, categorizedBy: reassignTo ? "USER" : "UNCATEGORIZED", categorizedByLabel: reassignTo ? "Moved when a category was deleted" : null },
    });
  }
  await prisma.category.delete({ where: { id } });
  await audit(userId, "category.deleted", { type: "category", id }, { name: cat.name, reassignedTo: reassignTo ?? null });
}

export async function createSubcategory(userId: string, categoryId: string, input: z.infer<typeof subcategoryInputSchema>) {
  const cat = await prisma.category.findFirst({ where: { id: categoryId, userId } });
  if (!cat) throw notFound("Category");
  const count = await prisma.subcategory.count({ where: { categoryId } });
  if (count >= 50) throw new AppError("CONFLICT", "A category can have up to 50 subcategories.");
  const sub = await prisma.subcategory.create({ data: { userId, categoryId, name: input.name, icon: input.icon ?? null, sortOrder: count } }).catch((error: unknown) => {
    if (isUniqueViolation(error)) throw new AppError("CONFLICT", `${cat.name} already has a subcategory called “${input.name}”.`);
    throw error;
  });
  await audit(userId, "category.updated", { type: "category", id: categoryId }, { subcategoryAdded: sub.id });
  return sub;
}

export async function updateSubcategory(userId: string, id: string, input: Partial<z.infer<typeof subcategoryInputSchema>>) {
  const sub = await prisma.subcategory.findFirst({ where: { id, userId } });
  if (!sub) throw notFound("Subcategory");
  const updated = await prisma.subcategory.update({ where: { id }, data: input }).catch((error: unknown) => {
    if (isUniqueViolation(error)) throw new AppError("CONFLICT", `This category already has a subcategory called “${input.name}”.`);
    throw error;
  });
  await audit(userId, "category.updated", { type: "category", id: sub.categoryId }, { subcategoryUpdated: id });
  return updated;
}

export async function deleteSubcategory(userId: string, id: string) {
  const sub = await prisma.subcategory.findFirst({ where: { id, userId } });
  if (!sub) throw notFound("Subcategory");
  // Transactions keep their parent category; the subcategory link is cleared (onDelete: SetNull).
  await prisma.subcategory.delete({ where: { id } });
  await audit(userId, "category.updated", { type: "category", id: sub.categoryId }, { subcategoryDeleted: id });
}

// Merchant rules (learned + user-defined) ─────────────────────────────────────

export const merchantRuleInputSchema = z.object({
  pattern: z.string().trim().min(2).max(80),
  categoryId: z.string().uuid(),
  subcategoryId: z.string().uuid().nullable().optional(),
});

export async function listMerchantRules(userId: string) {
  const rules = await prisma.merchantRule.findMany({
    where: { userId },
    include: { category: { select: { id: true, name: true, color: true, icon: true } }, subcategory: { select: { name: true } } },
    orderBy: [{ isActive: "desc" }, { correctionCount: "desc" }],
  });
  return rules.map((r) => ({ id: r.id, pattern: r.pattern, source: r.source, isActive: r.isActive, correctionCount: r.correctionCount, category: r.category, subcategory: r.subcategory?.name ?? null, updatedAt: r.updatedAt.toISOString() }));
}

export async function createMerchantRule(userId: string, input: z.infer<typeof merchantRuleInputSchema>) {
  const { normalizeMerchant } = await import("@/lib/transactions/normalize");
  const pattern = normalizeMerchant(input.pattern) || input.pattern.toLowerCase();
  if (!(await prisma.category.count({ where: { id: input.categoryId, userId } }))) throw notFound("Category");
  if (input.subcategoryId && !(await prisma.subcategory.count({ where: { id: input.subcategoryId, userId, categoryId: input.categoryId } }))) throw notFound("Subcategory");
  await prisma.merchantRule.updateMany({ where: { userId, pattern }, data: { isActive: false } });
  const rule = await prisma.merchantRule.upsert({
    where: { userId_pattern_categoryId: { userId, pattern, categoryId: input.categoryId } },
    update: { isActive: true, source: "USER_DEFINED", subcategoryId: input.subcategoryId ?? null },
    create: { userId, pattern, categoryId: input.categoryId, subcategoryId: input.subcategoryId ?? null, source: "USER_DEFINED", isActive: true, correctionCount: 0 },
  });
  await audit(userId, "category.updated", { type: "merchant_rule", id: rule.id }, { pattern, categoryId: input.categoryId });
  return rule;
}

export async function deleteMerchantRule(userId: string, id: string) {
  const { count } = await prisma.merchantRule.deleteMany({ where: { id, userId } });
  if (!count) throw notFound("Rule");
  await audit(userId, "category.updated", { type: "merchant_rule", id }, { deleted: true });
}
