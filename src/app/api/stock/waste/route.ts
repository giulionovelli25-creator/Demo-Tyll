import type { NextRequest } from "next/server";
import { guard, json, sameOrigin } from "@/lib/server/guard";
import { logWasteShared } from "@/lib/server/stock-log";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const g = guard(req, {});
  if (!g.ok) return g.response;
  const r = logWasteShared(g.user, (await req.json().catch(() => ({}))) as Record<string, unknown>);
  return r.ok ? json({ entry: r.entry }) : json({ error: r.error }, r.status);
}
