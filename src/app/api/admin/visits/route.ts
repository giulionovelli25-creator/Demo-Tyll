import type { NextRequest } from "next/server";
import { adminKeySet, adminWho, githubSet } from "@/lib/server/admin";
import { json } from "@/lib/server/guard";
import { visitReport, visitsCsv } from "@/lib/server/visits";

/** The Tyll team's view of demo visits. CSV with ?format=csv. */
export async function GET(req: NextRequest) {
  const who = adminWho(req);
  if (!who) return json({ error: githubSet() || adminKeySet() ? "Sign in to see demo visits." : "Open this page on the computer running Tyll, or set up GitHub sign-in or an admin key.", needsKey: adminKeySet(), github: githubSet() }, 401);
  const days = Math.min(90, Math.max(1, Number(req.nextUrl.searchParams.get("days")) || 7));
  if (req.nextUrl.searchParams.get("format") === "csv") {
    return new Response(visitsCsv(days), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="tyll-demo-visits-${days}d.csv"`, "Cache-Control": "no-store" } });
  }
  return json({ ...visitReport(days), who });
}
