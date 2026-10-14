import type { NextRequest } from "next/server";
import { guard, json, sameOrigin } from "@/lib/server/guard";
import { eventsFor, saveEvent } from "@/lib/server/ops";

/** Events the user may see. */
export async function GET(req: NextRequest) {
  const g = guard(req, { module: "events" });
  if (!g.ok) return g.response;
  return json({ events: eventsFor(g.user) });
}

/** Create a draft or save changes to an event. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const g = guard(req, { module: "events" });
  if (!g.ok) return g.response;
  const r = saveEvent(g.user, (await req.json().catch(() => ({}))) as Record<string, unknown>);
  return r.ok ? json({ event: r.event, notes: r.notes }) : json({ error: r.error }, r.status);
}
