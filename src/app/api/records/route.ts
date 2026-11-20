import type { NextRequest } from "next/server";
import { guard, json, sameOrigin } from "@/lib/server/guard";
import { applyRecord, recordsFor } from "@/lib/server/records";

/** Decisions and corrections saved on the demo server that this person may see. */
export async function GET(req: NextRequest) {
  const g = guard(req, {});
  if (!g.ok) return g.response;
  return json(recordsFor(g.user));
}

/** Saves one change. The rules and the permission are checked here again, with the person's own session. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const g = guard(req, {});
  if (!g.ok) return g.response;
  const r = applyRecord(g.user, (await req.json().catch(() => ({}))) as Record<string, unknown>);
  return r.ok ? json(r) : json({ error: r.error }, r.status);
}
