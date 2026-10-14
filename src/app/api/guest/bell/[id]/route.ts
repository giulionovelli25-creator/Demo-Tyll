import type { NextRequest } from "next/server";
import { guard, json, sameOrigin } from "@/lib/server/guard";
import { bellAction } from "@/lib/server/guest";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const g = guard(req, {});
  if (!g.ok) return g.response;
  const { id } = await params;
  const r = bellAction(g.user, id, (await req.json().catch(() => ({}))) as Record<string, unknown>);
  return r.ok ? json({ task: r.task }) : json({ error: r.error }, r.status);
}
