import type { NextRequest } from "next/server";
import { COUNT_LOCATIONS, DEFAULT_ROUTE, type LocationId } from "@/lib/data/locations";
import { allowedProperties, can } from "@/lib/domain/access";
import { guard, json, sameOrigin } from "@/lib/server/guard";
import { loadStore, mutateStore } from "@/lib/server/purchasing-store";

const clean = (route: unknown): LocationId[] | null => {
  if (!Array.isArray(route)) return null;
  const known = new Set<string>(COUNT_LOCATIONS.map((l) => l.id));
  const picked = route.filter((r): r is LocationId => typeof r === "string" && known.has(r));
  return new Set(picked).size === known.size && picked.length === known.size ? picked : null;
};

/** The order someone walks the storeroom, set once by a manager and used by everyone counting at that hotel. */
export async function GET(req: NextRequest) {
  const g = guard(req, { module: "stock" });
  if (!g.ok) return g.response;
  const propertyId = req.nextUrl.searchParams.get("propertyId") ?? "";
  if (!allowedProperties(g.user).includes(propertyId)) return json({ error: "This hotel is outside your access." }, 403);
  return json({ route: loadStore().countRoutes?.[propertyId] ?? DEFAULT_ROUTE, mayEdit: can(g.user, "stock.review") || can(g.user, "stock.editPrices") });
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const g = guard(req, { module: "stock" });
  if (!g.ok) return g.response;
  if (!can(g.user, "stock.review") && !can(g.user, "stock.editPrices")) return json({ error: "Only a manager can change the walking order." }, 403);
  const body = (await req.json().catch(() => ({}))) as { propertyId?: unknown; route?: unknown };
  const propertyId = String(body.propertyId ?? "");
  if (!allowedProperties(g.user).includes(propertyId)) return json({ error: "This hotel is outside your access." }, 403);
  const route = clean(body.route);
  if (!route) return json({ error: "The walking order must list every location once." }, 400);
  mutateStore((s) => { s.countRoutes = { ...s.countRoutes, [propertyId]: route }; });
  return json({ route });
}
