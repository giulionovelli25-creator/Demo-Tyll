import type { NextRequest } from "next/server";
import { allowedProperties } from "@/lib/domain/access";
import { guard, json } from "@/lib/server/guard";
import { periodFor, periodsFor } from "@/lib/server/variance";

/** Where did it go? The latest stock period for each item at the user's outlets, or one period by id. */
export async function GET(req: NextRequest) {
  const g = guard(req, { module: "investigations" });
  if (!g.ok) return g.response;
  const id = req.nextUrl.searchParams.get("id");
  if (id) {
    const p = periodFor(g.user, id);
    return p ? json({ period: p }) : json({ error: "Not found." }, 404);
  }
  const propertyId = req.nextUrl.searchParams.get("propertyId") ?? "";
  if (!allowedProperties(g.user).includes(propertyId)) return json({ error: "This property is outside your access." }, 403);
  return json({ periods: periodsFor(g.user, propertyId) });
}
