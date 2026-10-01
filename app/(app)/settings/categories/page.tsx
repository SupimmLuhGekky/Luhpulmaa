import type { Metadata } from "next";
import Link from "next/link";
import { requireOnboardedUser } from "@/lib/auth/guard";
import { listCategories, listMerchantRules } from "@/lib/categories/service";
import { LEARNING_THRESHOLD } from "@/lib/transactions/categorization";
import { CategoriesManager, type CategoryRow } from "@/components/settings/categories-manager";
import { MerchantRules, type MerchantRuleRow } from "@/components/settings/merchant-rules";
import { SettingsPageHeader, SettingsSection } from "@/components/settings/settings-ui";

export const metadata: Metadata = { title: "Categories · Settings" };

export default async function CategoriesSettingsPage() {
  const user = await requireOnboardedUser();
  const [categories, rules] = await Promise.all([listCategories(user.id), listMerchantRules(user.id)]);
  const rows: CategoryRow[] = categories.map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind,
    icon: c.icon,
    color: c.color,
    systemKey: c.systemKey,
    isHidden: c.isHidden,
    transactionCount: c.transactionCount,
    subcategories: c.subcategories.map((s) => ({ id: s.id, name: s.name })),
  }));
  const ruleRows: MerchantRuleRow[] = rules.map((r) => ({ id: r.id, pattern: r.pattern, source: r.source, isActive: r.isActive, correctionCount: r.correctionCount, category: r.category, subcategory: r.subcategory }));
  return (
    <div className="space-y-6">
      <SettingsPageHeader title="Categories" description="Organise spending your way. Built-in categories can be renamed or hidden; your own can also be deleted." />
      <SettingsSection id="categories" title="Your categories" description="Use the arrows to change the order they appear in. Open a category to manage its subcategories.">
        <CategoriesManager categories={rows} />
      </SettingsSection>
      <SettingsSection
        id="rules"
        title="Merchant rules"
        description={
          <>
            Rules Harbour learned from your corrections, or that you created. For conditions like amounts or accounts, use{" "}
            <Link href="/automations" className="font-medium text-primary hover:underline">
              automations
            </Link>
            .
          </>
        }
      >
        <MerchantRules rules={ruleRows} learningThreshold={LEARNING_THRESHOLD} />
      </SettingsSection>
    </div>
  );
}
