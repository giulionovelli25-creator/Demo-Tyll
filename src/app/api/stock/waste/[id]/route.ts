import type { NextRequest } from "next/server";
import { guard, json, sameOrigin } from "@/lib/server/guard";
import { correctWasteShared } from "@/lib/server/stock-log";

type Params = { params: Promise<{ id: string }> };

/** A correction to a saved entry. The original stays on record. */
export async function POST(req: NextRequest, { params }: Params) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const g = guard(req, {});
  if (!g.ok) return g.response;
  const r = correctWasteShared(g.user, (await params).id, (await req.json().catch(() => ({}))) as Record<string, unknown>);
  return r.ok ? json({ correction: r.correction }) : json({ error: r.error }, r.status);
}
