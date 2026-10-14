import type { NextRequest } from "next/server";
import { guard, json, sameOrigin } from "@/lib/server/guard";
import { plansFor, prepAssignees, prepPlanFor, savePrepPlan, updatePrepTask } from "@/lib/server/purchasing";
import { cleanEntries } from "@/lib/server/stock";

/** Saved preparation plans for the user's outlets. */
export async function GET(req: NextRequest) {
  const g = guard(req, { module: "forecast" });
  const t = g.ok ? g : guard(req, { module: "tasks" });
  const alt = t.ok ? t : guard(req, { module: "staff" });
  if (!alt.ok) return alt.response;
  const plans = plansFor(alt.user);
  return json({ plans, assignees: Object.fromEntries([...new Set(plans.map((p) => p.outletId))].map((o) => [o, prepAssignees(o)])) });
}

/** action "suggest": the forecast; "save": store a plan; "task": assign or tick off a task. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  // Staff tick tasks from their task list; everything else is in Forecast.
  const g = guard(req, body.action === "task" ? {} : { module: "forecast" });
  if (!g.ok) return g.response;
  if (body.action === "suggest") {
    const r = prepPlanFor(g.user, body, cleanEntries(g.user, body));
    return r.ok ? json({ prep: r.prep, assignees: prepAssignees(String(body.outletId)) }) : json({ error: r.error }, r.status);
  }
  const r = body.action === "save" ? savePrepPlan(g.user, body) : body.action === "task" ? updatePrepTask(g.user, body) : { ok: false as const, status: 400, error: "Unknown action." };
  return r.ok ? json({ plan: r.plan }) : json({ error: r.error }, r.status);
}
