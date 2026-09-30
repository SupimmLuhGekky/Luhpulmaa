import "server-only";
import type { Tx } from "@/lib/db/prisma";
import { DEFAULT_CATEGORIES } from "./defaults";

/** Creates the built-in categories and subcategories for a new user (idempotent). */
export async function provisionDefaultCategories(tx: Tx, userId: string): Promise<void> {
  for (const [index, def] of DEFAULT_CATEGORIES.entries()) {
    const category = await tx.category.upsert({
      where: { userId_systemKey: { userId, systemKey: def.key } },
      update: {},
      create: { userId, name: def.name, systemKey: def.key, kind: def.kind, icon: def.icon, color: def.color, sortOrder: index },
    });
    for (const [subIndex, name] of (def.subcategories ?? []).entries()) {
      await tx.subcategory.upsert({
        where: { categoryId_name: { categoryId: category.id, name } },
        update: {},
        create: { userId, categoryId: category.id, name, sortOrder: subIndex },
      });
    }
  }
}
