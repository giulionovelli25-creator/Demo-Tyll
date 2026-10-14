import type { NextRequest } from "next/server";
import { guard, json } from "@/lib/server/guard";
import { serviceSummary } from "@/lib/server/guest-service";

export async function GET(req: NextRequest) {
  const g = guard(req, {});
  if (!g.ok) return g.response;
  const r = serviceSummary(g.user);
  return r.ok ? json(r) : json({ error: r.error }, r.status);
}
