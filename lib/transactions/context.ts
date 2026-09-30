import "server-only";
import { prisma, type Tx } from "@/lib/db/prisma";
import type { CategorizationContext } from "./categorization";

export async function loadCategorizationContext(userId: string, db: Tx = prisma): Promise<CategorizationContext> {
  const [categories, merchantRules] = await Promise.all([
    db.category.findMany({ where: { userId }, select: { id: true, systemKey: true, name: true, kind: true, subcategories: { select: { id: true, name: true } } } }),
    db.merchantRule.findMany({ where: { userId, isActive: true }, select: { id: true, pattern: true, categoryId: true, subcategoryId: true, source: true, isActive: true, correctionCount: true } }),
  ]);
  return { categories, merchantRules };
}
