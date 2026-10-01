import "server-only";
import { prisma } from "@/lib/db/prisma";

/**
 * The user's categories, accounts and goals in the shape the automation builder and list
 * use to show names. Only this user's rows are read.
 */
export async function automationOptions(userId: string) {
  const [categories, accounts, goals] = await Promise.all([
    prisma.category.findMany({
      where: { userId },
      select: { id: true, name: true, kind: true, icon: true, color: true, isHidden: true, systemKey: true, subcategories: { select: { id: true, name: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.account.findMany({ where: { userId }, select: { id: true, name: true }, orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }] }),
    prisma.goal.findMany({ where: { userId }, select: { id: true, name: true, status: true }, orderBy: [{ status: "asc" }, { priority: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }] }),
  ]);
  return { categories, accounts, goals };
}
