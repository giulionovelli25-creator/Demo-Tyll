import type { NextRequest } from "next/server";
import { guard, json } from "@/lib/server/guard";
import { adapterSampleFor } from "@/lib/server/integrations/sample";

/** The Lightspeed and Mews adapters run on sample responses, replayed as last night. Read only, no live call. */
export async function GET(req: NextRequest) {
  const g = guard(req, { module: "settings", permission: "adapters.view" });
  if (!g.ok) return g.response;
  const r = await adapterSampleFor(g.user);
  return r.ok ? json(r.sample) : json({ error: r.error }, r.status);
}
