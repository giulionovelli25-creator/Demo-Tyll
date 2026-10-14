import type { NextRequest } from "next/server";
import { guard, json, sameOrigin } from "@/lib/server/guard";
import { markAssignmentDone, myAssignments } from "@/lib/server/ops";

/** The signed-in staff member's own assignments. Nobody else's. */
export async function GET(req: NextRequest) {
  const g = guard(req, {});
  if (!g.ok) return g.response;
  return json({ assignments: myAssignments(g.user) });
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const g = guard(req, {});
  if (!g.ok) return g.response;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const r = markAssignmentDone(g.user, String(body.id ?? ""));
  return r.ok ? json({ id: r.id }) : json({ error: r.error }, r.status);
}
