import type { NextRequest } from "next/server";
import { guard, json, sameOrigin } from "@/lib/server/guard";
import { findCandidates } from "@/lib/server/ops";

/** People with the skill who are free for the whole time. Only what a requester needs is returned. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const g = guard(req, { module: "events" });
  if (!g.ok) return g.response;
  const r = findCandidates(g.user, (await req.json().catch(() => ({}))) as Record<string, unknown>);
  return r.ok ? json({ candidates: r.candidates, note: r.note }) : json({ error: r.error }, r.status);
}
