import type { NextRequest } from "next/server";
import { guard, json, sameOrigin } from "@/lib/server/guard";
import { proposalAction } from "@/lib/server/sales";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const g = guard(req, { module: "events" });
  if (!g.ok) return g.response;
  const r = proposalAction(g.user, (await params).id, (await req.json().catch(() => ({}))) as Record<string, unknown>);
  return r.ok ? json({ proposal: r.proposal, eventId: r.eventId }) : json({ error: r.error }, r.status);
}
