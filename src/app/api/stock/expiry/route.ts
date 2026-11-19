import type { NextRequest } from "next/server";
import { guard, json, sameOrigin } from "@/lib/server/guard";
import { expiringFor } from "@/lib/server/expiry";
import { cleanEntries } from "@/lib/server/stock";

/** Batches expiring in the next days, with a suggested action for each. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const g = guard(req, { module: "stock" });
  if (!g.ok) return g.response;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const days = [1, 2, 3, 7].includes(Number(body.days)) ? Number(body.days) : 3;
  const r = expiringFor(g.user, String(body.propertyId ?? ""), cleanEntries(g.user, body), days);
  return r.ok ? json(r) : json({ error: r.error }, r.status);
}
