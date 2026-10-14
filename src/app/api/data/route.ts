import type { NextRequest } from "next/server";
import { audit } from "@/lib/server/auth";
import { clientIp, guard, json } from "@/lib/server/guard";
import { snapshotFor } from "@/lib/server/snapshot";

/** The records the signed-in user may see, filtered on the server. Management roles need a recent PIN unlock. */
export async function GET(req: NextRequest) {
  const g = guard(req);
  if (!g.ok) return g.response;
  audit(g.user.id, "Data loaded", "", clientIp(req));
  return json(snapshotFor(g.user));
}
