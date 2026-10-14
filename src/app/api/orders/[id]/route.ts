import type { NextRequest } from "next/server";
import { guard, json } from "@/lib/server/guard";
import { orderById } from "@/lib/server/snapshot";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = guard(req);
  if (!g.ok) return g.response;
  if (g.user.role === "employee") return json({ error: "Your role cannot open this." }, 403);
  const order = orderById(g.user, decodeURIComponent((await params).id));
  // The same answer for "does not exist" and "not yours", so records outside a user's access stay invisible.
  return order ? json({ order }) : json({ error: "Not found." }, 404);
}
