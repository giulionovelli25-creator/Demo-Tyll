import type { NextRequest } from "next/server";
import { guard, json } from "@/lib/server/guard";
import { searchFor } from "@/lib/server/search";

/** Records and screens this person may open, matching the search. Filtered here, never in the browser. */
export async function GET(req: NextRequest) {
  const g = guard(req, {});
  if (!g.ok) return g.response;
  return json({ hits: searchFor(g.user, (req.nextUrl.searchParams.get("q") ?? "").slice(0, 80)) });
}
