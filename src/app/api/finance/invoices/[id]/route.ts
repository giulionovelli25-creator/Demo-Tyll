import type { NextRequest } from "next/server";
import { guard, json, sameOrigin } from "@/lib/server/guard";
import { invoiceAction, invoiceById } from "@/lib/server/finance";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const g = guard(req, { module: "finance" });
  if (!g.ok) return g.response;
  const r = invoiceById(g.user, (await params).id);
  return r.ok ? json({ invoice: r.invoice }) : json({ error: r.error }, r.status);
}

export async function POST(req: NextRequest, { params }: Params) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const g = guard(req, { module: "finance" });
  if (!g.ok) return g.response;
  const r = invoiceAction(g.user, (await params).id, (await req.json().catch(() => ({}))) as Record<string, unknown>);
  return r.ok ? json({ invoice: r.invoice }) : json({ error: r.error }, r.status);
}
