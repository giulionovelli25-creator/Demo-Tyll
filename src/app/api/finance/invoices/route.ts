import type { NextRequest } from "next/server";
import { guard, json, sameOrigin } from "@/lib/server/guard";
import { invoicesFor, recordInvoice } from "@/lib/server/finance";

export async function GET(req: NextRequest) {
  const g = guard(req, { module: "finance" });
  if (!g.ok) return g.response;
  const r = invoicesFor(g.user, req.nextUrl.searchParams.get("propertyId") ?? undefined);
  return r.ok ? json(r) : json({ error: r.error }, r.status);
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const g = guard(req, { module: "finance" });
  if (!g.ok) return g.response;
  const r = recordInvoice(g.user, (await req.json().catch(() => ({}))) as Record<string, unknown>);
  return r.ok ? json({ invoice: r.invoice }) : json({ error: r.error }, r.status);
}
