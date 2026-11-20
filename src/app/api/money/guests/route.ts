import type { NextRequest } from "next/server";
import { guard, json } from "@/lib/server/guard";
import { guestsCheckFor } from "@/lib/server/guests";

/** Hotel guests against outlet charges for the last 7 or 30 days and the outlets in view. Read only. */
export async function GET(req: NextRequest) {
  const g = guard(req, { module: "money", permission: "guests.view" });
  if (!g.ok) return g.response;
  const p = req.nextUrl.searchParams;
  const r = guestsCheckFor(g.user, { days: p.get("days"), outlets: p.get("outlets") });
  return r.ok ? json(r) : json({ error: r.error }, r.status);
}
