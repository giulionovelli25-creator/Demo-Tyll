import type { NextRequest } from "next/server";
import { guard, json, sameOrigin } from "@/lib/server/guard";
import { confirmRecipe, menuFor } from "@/lib/server/menu-sync";

/** The menu as synced from Simphony this morning, new dishes waiting for a recipe, and the modifier rules. */
export async function GET(req: NextRequest) {
  const g = guard(req, { module: "stock" });
  if (!g.ok) return g.response;
  const r = await menuFor(g.user);
  return r.ok ? json({ menu: r.menu }) : json({ error: r.error }, r.status);
}

/** The chef confirms a new dish's recipe. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const g = guard(req, { module: "stock" });
  if (!g.ok) return g.response;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (body.action !== "confirm") return json({ error: "Unknown action." }, 400);
  const r = confirmRecipe(g.user, body);
  return r.ok ? json({ dish: r.dish }) : json({ error: r.error }, r.status);
}
