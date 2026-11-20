import type { NextRequest } from "next/server";
import { guard, json } from "@/lib/server/guard";
import { tillCheckFor } from "@/lib/server/till";

/** The till rule check for a period and the outlets in view. Read only. */
export async function GET(req: NextRequest) {
  const g = guard(req, { module: "money", permission: "till.view" });
  if (!g.ok) return g.response;
  const p = req.nextUrl.searchParams;
  const r = tillCheckFor(g.user, { from: p.get("from"), to: p.get("to"), outlets: p.get("outlets") });
  return r.ok ? json(r) : json({ error: r.error }, r.status);
}
