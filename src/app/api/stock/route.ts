import type { NextRequest } from "next/server";
import { allowedProperties } from "@/lib/domain/access";
import { guard, json, sameOrigin } from "@/lib/server/guard";
import { cleanEntries, stockFor } from "@/lib/server/stock";

/** Stock positions worked out on complete data, returned only for stores this user may see. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const g = guard(req, { module: "stock" });
  if (!g.ok) return g.response;
  const body = (await req.json().catch(() => ({}))) as { propertyId?: unknown };
  if (typeof body.propertyId !== "string" || !allowedProperties(g.user).includes(body.propertyId)) return json({ error: "This property is outside your access." }, 403);
  return json({ rows: stockFor(g.user, body.propertyId, cleanEntries(g.user, body)) });
}
