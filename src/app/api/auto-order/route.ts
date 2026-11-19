import type { NextRequest } from "next/server";
import { guard, json, sameOrigin } from "@/lib/server/guard";
import { autoFor, saveAutoSettings } from "@/lib/server/auto-order";
import { cleanEntries } from "@/lib/server/stock";
import { allowedProperties } from "@/lib/domain/access";

/** Automatic ordering: this morning's run and the rules. action "settings" changes the rules. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const g = guard(req, { module: "forecast" });
  if (!g.ok) return g.response;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const propertyId = String(body.propertyId ?? "");
  if (!allowedProperties(g.user).includes(propertyId)) return json({ error: "This hotel is outside your access." }, 403);
  if (body.action === "settings") {
    const r = saveAutoSettings(g.user, propertyId, body);
    return r.ok ? json({ settings: r.settings }) : json({ error: r.error }, r.status);
  }
  const r = autoFor(g.user, propertyId, cleanEntries(g.user, body));
  return r.ok ? json({ auto: r.auto }) : json({ error: r.error }, r.status);
}
