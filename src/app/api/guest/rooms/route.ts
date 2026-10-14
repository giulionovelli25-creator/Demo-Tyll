import type { NextRequest } from "next/server";
import { guard, json, sameOrigin } from "@/lib/server/guard";
import { alternativeRooms, roomAction, roomsBoard } from "@/lib/server/guest";

/** The rooms board, or ready rooms of the same type with ?alternativesFor=roomId. */
export async function GET(req: NextRequest) {
  const g = guard(req, {});
  if (!g.ok) return g.response;
  const alt = req.nextUrl.searchParams.get("alternativesFor");
  const r = alt ? alternativeRooms(g.user, alt) : roomsBoard(g.user);
  return r.ok ? json(r) : json({ error: r.error }, r.status);
}

/** One step on a room: priority, assign, helper, start, cleaned, inspect, issue, resolve. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const g = guard(req, {});
  if (!g.ok) return g.response;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const r = roomAction(g.user, String(body.roomId ?? ""), body);
  return r.ok ? json({ room: r.room }) : json({ error: r.error }, r.status);
}
