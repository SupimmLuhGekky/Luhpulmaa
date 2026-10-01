import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { notFound } from "@/lib/api/errors";
import { deleteGoal, goalDetail, goalUpdateSchema, updateGoal } from "@/lib/goals/service";

export const dynamic = "force-dynamic";

type Params = { id: string };

function goalId(params: Params) {
  const parsed = z.string().uuid().safeParse(params.id);
  if (!parsed.success) throw notFound("Goal");
  return parsed.data;
}

/** GET /api/goals/:id → the goal with progress, pace, contribution history and growth series. */
export const GET = apiRoute<Params>({}, async ({ user, params }) => goalDetail(user.id, goalId(params), user.timeZone));

/** PATCH /api/goals/:id → updates details or status (ACTIVE / COMPLETED / ARCHIVED). */
export const PATCH = apiRoute<Params, typeof goalUpdateSchema>({ body: goalUpdateSchema }, async ({ user, params, body }) => {
  const id = goalId(params);
  await updateGoal(user.id, id, body);
  return goalDetail(user.id, id, user.timeZone);
});

/** DELETE /api/goals/:id → deletes the goal and its contribution history. No money is affected. */
export const DELETE = apiRoute<Params>({}, async ({ user, params }) => {
  await deleteGoal(user.id, goalId(params));
  return { deleted: true };
});
