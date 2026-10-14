import type { NextRequest } from "next/server";
import { guard, json, sameOrigin } from "@/lib/server/guard";
import { createSupport, managedDepts, requestableDepts, supportFor } from "@/lib/server/ops";

/** Requests the user sent or must decide, and the departments they can act for. */
export async function GET(req: NextRequest) {
  const g = guard(req, { module: "events" });
  if (!g.ok) return g.response;
  return json({ requests: supportFor(g.user), manages: managedDepts(g.user), canRequestFor: requestableDepts(g.user) });
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const g = guard(req, { module: "events" });
  if (!g.ok) return g.response;
  const r = createSupport(g.user, (await req.json().catch(() => ({}))) as Record<string, unknown>);
  return r.ok ? json({ request: r.request }) : json({ error: r.error }, r.status);
}
