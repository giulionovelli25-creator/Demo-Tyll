import type { NextRequest } from "next/server";
import { guard, json, sameOrigin } from "@/lib/server/guard";
import { cancelSupport, decideItem, respondItem } from "@/lib/server/ops";

type Params = { params: Promise<{ id: string }> };

/** decide: the lending manager; respond: the requester answers an alternative; cancel: withdraw the request. */
export async function POST(req: NextRequest, { params }: Params) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const g = guard(req, { module: "events" });
  if (!g.ok) return g.response;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const itemId = String(body.itemId ?? "");
  const r = body.action === "decide" ? decideItem(g.user, id, itemId, body) : body.action === "respond" ? respondItem(g.user, id, itemId, body) : body.action === "cancel" ? cancelSupport(g.user, id, body) : { ok: false as const, status: 400, error: "Unknown action." };
  return r.ok ? json({ request: r.request }) : json({ error: r.error }, r.status);
}
