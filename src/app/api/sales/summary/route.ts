import type { NextRequest } from "next/server";
import { guard, json } from "@/lib/server/guard";
import { confirmedSummary } from "@/lib/server/sales";

/** Confirmed business this month, per hotel, for the Overview. */
export async function GET(req: NextRequest) {
  const g = guard(req, {});
  if (!g.ok) return g.response;
  return json({ summary: confirmedSummary(g.user) });
}
