import type { NextRequest } from "next/server";
import { guard, json, sameOrigin } from "@/lib/server/guard";
import { saveProposal } from "@/lib/server/sales";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const g = guard(req, { module: "events" });
  if (!g.ok) return g.response;
  const r = saveProposal(g.user, (await req.json().catch(() => ({}))) as Record<string, unknown>);
  return r.ok ? json({ proposal: r.proposal }) : json({ error: r.error }, r.status);
}
