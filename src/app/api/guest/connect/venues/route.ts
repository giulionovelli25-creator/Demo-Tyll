import type { NextRequest } from "next/server";
import { guard, json, sameOrigin } from "@/lib/server/guard";
import { venuesFor } from "@/lib/server/guest-service";

/** Venues with simulated availability for a time and party size. Read-only; POST keeps the query out of URLs. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const g = guard(req, {});
  if (!g.ok) return g.response;
  const r = venuesFor(g.user, (await req.json().catch(() => ({}))) as Record<string, unknown>);
  return r.ok ? json(r) : json({ error: r.error }, r.status);
}
