import type { NextRequest } from "next/server";
import { APPROVAL_POLICY, approvalSteps, quotesFor } from "@/lib/data/purchasing-rules";
import { guard, json, sameOrigin } from "@/lib/server/guard";
import { actOnRequest, budgetFor, canSee, requestTotal, requestsFor } from "@/lib/server/purchasing";
import { DEMO_TODAY } from "@/lib/util";

type Params = { params: Promise<{ id: string }> };

/** One request with what each reviewer needs: supplier quotes, the hotel's rules and the demo budget. */
export async function GET(req: NextRequest, { params }: Params) {
  const g = guard(req, { module: "forecast" });
  if (!g.ok) return g.response;
  const { id } = await params;
  const r = requestsFor(g.user).find((x) => x.id === id);
  if (!r || !canSee(g.user, r)) return json({ error: "Not found." }, 404);
  const total = requestTotal(r);
  return json({
    request: r,
    total,
    steps: approvalSteps(r.propertyId, total),
    policy: APPROVAL_POLICY[r.propertyId],
    budget: budgetFor(r),
    quotes: Object.fromEntries(r.lines.map((l) => [l.ingredientId, quotesFor(l.ingredientId, r.propertyId, DEMO_TODAY)])),
  });
}

/** Submit, review, approve, reject, request changes, comment or receive. */
export async function POST(req: NextRequest, { params }: Params) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const g = guard(req, { module: "forecast" });
  if (!g.ok) return g.response;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const r = actOnRequest(g.user, id, body);
  return r.ok ? json({ request: r.request }) : json({ error: r.error }, r.status);
}
