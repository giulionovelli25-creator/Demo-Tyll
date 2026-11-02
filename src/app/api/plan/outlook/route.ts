import type { NextRequest } from "next/server";
import { guard, json, sameOrigin } from "@/lib/server/guard";
import { outlookFor } from "@/lib/server/purchasing";
import { cleanEntries } from "@/lib/server/stock";

/** Read only: expected guests, what to prep and what to order for tomorrow or the next seven days. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const g = guard(req, { module: "forecast" });
  if (!g.ok) return g.response;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const r = outlookFor(g.user, body, cleanEntries(g.user, body));
  return r.ok ? json({ outlook: r.outlook }) : json({ error: r.error }, r.status);
}
