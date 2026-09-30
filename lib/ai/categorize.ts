import "server-only";
import { z } from "zod/v4";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { isEnabled } from "@/lib/flags";
import { userPreferences } from "@/lib/settings/preferences";
import type { CategorizationContext } from "@/lib/transactions/categorization";
import { AI_MODEL, aiClient } from "./client";

/**
 * AI fallback for transactions no deterministic rule could categorise.
 * Only runs when ENABLE_AI_CATEGORIZATION is on, an API key is configured and the
 * user opted in. Sends only the transaction's description/merchant/amount and the
 * list of the user's category names — no account numbers or identity.
 * Results are marked categorizedBy=AI so the UI can flag them for review.
 */
const resultSchema = z.object({ category: z.string(), confidence: z.enum(["low", "medium", "high"]) });

export async function suggestCategoryWithAI(
  userId: string,
  txn: { description: string; merchantName: string | null; amountCents: number },
  ctx: CategorizationContext,
): Promise<{ categoryId: string } | null> {
  if (!isEnabled("ENABLE_AI_CATEGORIZATION")) return null;
  const client = aiClient();
  if (!client) return null;
  const prefs = await userPreferences(userId);
  if (!prefs.aiOptIn) return null;
  const names = ctx.categories.map((c) => c.name);
  try {
    const response = await client.messages.parse({
      model: AI_MODEL,
      max_tokens: 1024,
      output_config: { effort: "low", format: zodOutputFormat(resultSchema) },
      system:
        "You categorise personal bank transactions. Pick exactly one category name from the provided list. If none fits, answer \"Other\". Use confidence \"low\" when unsure.",
      messages: [
        {
          role: "user",
          content: `Categories: ${names.join(", ")}\nTransaction: ${txn.merchantName ?? ""} | ${txn.description} | ${txn.amountCents < 0 ? "money out" : "money in"}`,
        },
      ],
    });
    if (response.stop_reason === "refusal") return null;
    const parsed = response.parsed_output;
    if (!parsed || parsed.confidence === "low") return null;
    const match = ctx.categories.find((c) => c.name.toLowerCase() === parsed.category.toLowerCase());
    return match ? { categoryId: match.id } : null;
  } catch (error) {
    console.error("[ai] categorisation unavailable:", error instanceof Error ? error.name : "unknown");
    return null;
  }
}
