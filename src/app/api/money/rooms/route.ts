import type { NextRequest } from "next/server";
import { guard, json } from "@/lib/server/guard";
import { roomCheckFor } from "@/lib/server/room-charges";

/** Room charges set against guest folios for a period and the outlets in view. Read only. */
export async function GET(req: NextRequest) {
  const g = guard(req, { module: "money", permission: "roomcharge.view" });
  if (!g.ok) return g.response;
  const p = req.nextUrl.searchParams;
  const r = roomCheckFor(g.user, { from: p.get("from"), to: p.get("to"), outlets: p.get("outlets"), whole: p.get("whole") });
  return r.ok ? json(r) : json({ error: r.error }, r.status);
}
