import type { NextRequest } from "next/server";
import { guard, json } from "@/lib/server/guard";
import { pourFor } from "@/lib/server/pour";

/** Pour Control for one hotel, limited to the outlets this person may see. */
export async function GET(req: NextRequest) {
  const g = guard(req, { module: "money" });
  if (!g.ok) return g.response;
  const q = req.nextUrl.searchParams;
  const r = pourFor(g.user, q.get("propertyId") ?? "", q.get("outlets")?.split(",").filter(Boolean));
  return r.ok ? json({ pour: r.pour }) : json({ error: r.error }, r.status);
}
