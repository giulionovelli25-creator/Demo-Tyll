import type { NextRequest } from "next/server";
import { guard, json, sameOrigin } from "@/lib/server/guard";
import { cleanEntries, stockFor } from "@/lib/server/stock";
import { submitCount } from "@/lib/server/stock-log";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const g = guard(req, {});
  if (!g.ok) return g.response;
  const user = g.user;
  const r = submitCount(user, (await req.json().catch(() => ({}))) as Record<string, unknown>, (p, ing) => stockFor(user, p, cleanEntries(user, {})).find((x) => x.ingredientId === ing)?.estimated);
  return r.ok ? json({ count: r.count }) : json({ error: r.error }, r.status);
}
