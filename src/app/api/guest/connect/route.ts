import type { NextRequest } from "next/server";
import { guard, json, sameOrigin } from "@/lib/server/guard";
import { createGc, gcFor } from "@/lib/server/guest-service";

export async function GET(req: NextRequest) {
  const g = guard(req, {});
  if (!g.ok) return g.response;
  const r = gcFor(g.user);
  return r.ok ? json(r) : json({ error: r.error }, r.status);
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const g = guard(req, {});
  if (!g.ok) return g.response;
  const r = createGc(g.user, (await req.json().catch(() => ({}))) as Record<string, unknown>);
  return r.ok ? json({ request: r.request }) : json({ error: r.error }, r.status);
}
