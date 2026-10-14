import type { NextRequest } from "next/server";
import { guard, json, sameOrigin } from "@/lib/server/guard";
import { requestsFor, saveRequest } from "@/lib/server/purchasing";

/** Purchase requests the user may see. */
export async function GET(req: NextRequest) {
  const g = guard(req, { module: "forecast" });
  if (!g.ok) return g.response;
  return json({ requests: requestsFor(g.user) });
}

/** Create or update a draft. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const g = guard(req, { module: "forecast" });
  if (!g.ok) return g.response;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const r = saveRequest(g.user, body);
  return r.ok ? json({ request: r.request }) : json({ error: r.error }, r.status);
}
