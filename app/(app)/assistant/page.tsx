import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { requireOnboardedUser } from "@/lib/auth/guard";
import { ASSISTANT_TOOL_LABELS, assistantStatus } from "@/lib/ai/assistant";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";
import { AssistantChat } from "@/components/assistant/assistant-chat";
import { AssistantIntro } from "@/components/assistant/assistant-intro";

export const metadata: Metadata = { title: "Assistant" };

/**
 * Optional assistant: the chat appears only when the server enables it, an AI provider is
 * configured and the person has opted in. Otherwise the page explains it (and offers the
 * opt-in when that's what's missing).
 */
export default async function AssistantPage() {
  const user = await requireOnboardedUser();
  const status = await assistantStatus(user.id);
  const ready = status.enabled && status.configured && status.optedIn;
  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        title="Assistant"
        description="Ask about your spending, budgets, bills, goals and cash flow. Answers come from your own Harbour data."
        actions={
          ready ? (
            <Badge variant="neutral">
              <ShieldCheck aria-hidden /> Read-only · never moves money
            </Badge>
          ) : null
        }
      />
      {ready ? (
        <AssistantChat toolLabels={ASSISTANT_TOOL_LABELS} />
      ) : (
        <AssistantIntro state={!status.enabled ? "disabled" : !status.optedIn ? "opt-in" : "not-configured"} optedIn={status.optedIn} />
      )}
    </div>
  );
}
