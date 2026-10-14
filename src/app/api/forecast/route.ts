import type { NextRequest } from "next/server";
import { allowedProperties } from "@/lib/domain/access";
import type { ForecastInputs } from "@/lib/domain/forecast";
import { guard, json, sameOrigin } from "@/lib/server/guard";
import { cleanEntries, forecastFor } from "@/lib/server/stock";

/** Forecast and purchase suggestions worked out on complete data for the shared store. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const g = guard(req, { module: "forecast" });
  if (!g.ok) return g.response;
  const body = (await req.json().catch(() => ({}))) as { propertyId?: unknown; inputs?: Partial<ForecastInputs> };
  if (typeof body.propertyId !== "string" || !allowedProperties(g.user).includes(body.propertyId)) return json({ error: "This property is outside your access." }, 403);
  return json(forecastFor(g.user, body.propertyId, body.inputs, cleanEntries(g.user, body)));
}
