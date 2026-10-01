import { z } from "zod";
import { apiRoute, json } from "@/lib/api/route";
import { createGoal, goalDetail, goalInputSchema, listGoalItems } from "@/lib/goals/service";

export const dynamic = "force-dynamic";

const querySchema = z.object({ status: z.enum(["active", "completed", "archived", "all"]).default("all") });

/**
 * GET /api/goals[?status=active|completed|archived] → goals with progress, required
 * amounts, pace, and planned allocations kept apart from actual transfers.
 */
export const GET = apiRoute({ query: querySchema }, async ({ user, query }) => {
  const goals = await listGoalItems(user.id, user.timeZone);
  return query.status === "all" ? goals : goals.filter((g) => g.status === query.status.toUpperCase());
});

/** POST /api/goals → creates a goal; a starting amount is recorded as an actual transfer the user reported. */
export const POST = apiRoute({ body: goalInputSchema }, async ({ user, body }) => {
  const goal = await createGoal(user.id, body);
  return json(await goalDetail(user.id, goal.id, user.timeZone), { status: 201 });
});
