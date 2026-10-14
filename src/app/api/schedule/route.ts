import type { NextRequest } from "next/server";
import { guard, json } from "@/lib/server/guard";
import { deptSchedule } from "@/lib/server/ops";

/** A department's day, for its own managers only. */
export async function GET(req: NextRequest) {
  const g = guard(req, { module: "events" });
  if (!g.ok) return g.response;
  const r = deptSchedule(g.user, req.nextUrl.searchParams.get("dept") ?? "", req.nextUrl.searchParams.get("date") ?? "");
  return r.ok ? json({ rows: r.rows, borrowed: r.borrowed }) : json({ error: r.error }, r.status);
}
