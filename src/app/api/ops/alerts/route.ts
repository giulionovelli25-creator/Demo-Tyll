import type { NextRequest } from "next/server";
import { guard, json, sameOrigin } from "@/lib/server/guard";
import { opsAlerts } from "@/lib/server/ops";
import { cleanEntries } from "@/lib/server/stock";

/** Event and staffing notices for this user. Staff get only their own assignments. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const g = guard(req, {});
  if (!g.ok) return g.response;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return json({ alerts: opsAlerts(g.user, cleanEntries(g.user, body)) });
}
