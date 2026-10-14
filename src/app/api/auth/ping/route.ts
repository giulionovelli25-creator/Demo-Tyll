import type { NextRequest } from "next/server";
import { guard, json } from "@/lib/server/guard";

/** Reports that the user is active, which keeps the PIN unlock alive. */
export async function POST(req: NextRequest) {
  const g = guard(req);
  if (!g.ok) return g.response;
  return json({ pinExpiresAt: g.view.pinExpiresAt });
}
