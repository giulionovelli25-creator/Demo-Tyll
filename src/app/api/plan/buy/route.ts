import type { NextRequest } from "next/server";
import { guard, json, sameOrigin } from "@/lib/server/guard";
import { buyPlan } from "@/lib/server/purchasing";
import { cleanEntries } from "@/lib/server/stock";

/** What to buy: forecast requirement against usable stock, for the user's outlets. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const g = guard(req, { module: "forecast" });
  if (!g.ok) return g.response;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const r = buyPlan(g.user, body, cleanEntries(g.user, body));
  return r.ok ? json({ plan: r.plan }) : json({ error: r.error }, r.status);
}
