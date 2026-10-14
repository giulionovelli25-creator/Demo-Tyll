import type { NextRequest } from "next/server";
import { guard, json } from "@/lib/server/guard";
import { sharedFor } from "@/lib/server/stock-log";

/** Waste, corrections and counts saved on the server that this user may see. */
export async function GET(req: NextRequest) {
  const g = guard(req, {});
  if (!g.ok) return g.response;
  return json(sharedFor(g.user));
}
