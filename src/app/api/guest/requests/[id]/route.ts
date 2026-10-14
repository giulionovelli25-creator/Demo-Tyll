import type { NextRequest } from "next/server";
import { guard, json, sameOrigin } from "@/lib/server/guard";
import { requestAction } from "@/lib/server/guest-service";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const g = guard(req, {});
  if (!g.ok) return g.response;
  const r = requestAction(g.user, (await params).id, (await req.json().catch(() => ({}))) as Record<string, unknown>);
  return r.ok ? json({ request: r.request }) : json({ error: r.error }, r.status);
}
