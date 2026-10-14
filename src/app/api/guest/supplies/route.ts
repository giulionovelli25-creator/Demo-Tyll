import type { NextRequest } from "next/server";
import { guard, json, sameOrigin } from "@/lib/server/guard";
import { suppliesFor } from "@/lib/server/guest-service";
import { cleanEntries } from "@/lib/server/stock";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const g = guard(req, {});
  if (!g.ok) return g.response;
  const r = suppliesFor(g.user, cleanEntries(g.user, (await req.json().catch(() => ({}))) as Record<string, unknown>));
  return r.ok ? json(r) : json({ error: r.error }, r.status);
}
