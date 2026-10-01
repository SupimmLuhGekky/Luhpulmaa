import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireOnboardedUser } from "@/lib/auth/guard";
import { AppError } from "@/lib/api/errors";
import { goalAccountOptions, goalDetail } from "@/lib/goals/service";
import { GoalDetailScreen } from "@/components/goals/goal-detail-screen";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Props = { params: Promise<{ id: string }> };

// Metadata and the page share one load per request.
const load = cache(async (id: string) => {
  const user = await requireOnboardedUser();
  if (!UUID_RE.test(id)) notFound();
  try {
    return { user, goal: await goalDetail(user.id, id, user.timeZone) };
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const { goal } = await load(id);
  return { title: goal.name };
}

/** /goals/[id] — one goal: progress (actual vs planned), plan, growth chart and history. */
export default async function GoalPage({ params }: Props) {
  const { id } = await params;
  const { user, goal } = await load(id);
  const accounts = await goalAccountOptions(user.id);
  return <GoalDetailScreen goal={goal} accounts={accounts} />;
}
