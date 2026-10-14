import type { NextRequest } from "next/server";
import { guard, json, sameOrigin } from "@/lib/server/guard";
import { alertsFor } from "@/lib/server/purchasing";
import { cleanEntries } from "@/lib/server/stock";

/** Short notices for this user: approvals waiting, a shortage tomorrow, a prep plan to review. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const g = guard(req, { module: "forecast" });
  if (!g.ok) return g.response;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return json({ alerts: alertsFor(g.user, cleanEntries(g.user, body)) });
}
