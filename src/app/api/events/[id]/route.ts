import type { NextRequest } from "next/server";
import { guard, json, sameOrigin } from "@/lib/server/guard";
import { eventDetail, setEventStatus, setKitchenPortions } from "@/lib/server/ops";
import { cleanEntries } from "@/lib/server/stock";

type Params = { params: Promise<{ id: string }> };

/** One event with its requirements, staffing, cost and linked records. POST so the session's stock corrections count. */
export async function POST(req: NextRequest, { params }: Params) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const g = guard(req, { module: "events" });
  if (!g.ok) return g.response;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const entries = cleanEntries(g.user, body);
  if (body.action === "status") {
    const r = setEventStatus(g.user, id, body, entries);
    if (!r.ok) return json({ error: r.error }, r.status);
  } else if (body.action === "kitchen") {
    const r = setKitchenPortions(g.user, id, body);
    if (!r.ok) return json({ error: r.error }, r.status);
  } else if (body.action !== undefined && body.action !== "read") return json({ error: "Unknown action." }, 400);
  const d = eventDetail(g.user, id, entries);
  return d.ok ? json({ detail: d.detail }) : json({ error: d.error }, d.status);
}
