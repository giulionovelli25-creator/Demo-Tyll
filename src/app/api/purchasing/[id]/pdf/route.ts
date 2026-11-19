import type { NextRequest } from "next/server";
import { guard, json } from "@/lib/server/guard";
import { readPurchaseOrderPdf } from "@/lib/server/procurement";

type Params = { params: Promise<{ id: string }> };

/** The purchase order PDF: the copy that was sent, or a preview of an order not sent yet. */
export async function GET(req: NextRequest, { params }: Params) {
  const f = guard(req, { module: "forecast" });
  const g = f.ok ? f : guard(req, { module: "staff", permission: "purchase.receive" });
  if (!g.ok) return f.ok ? g.response : f.response;
  const { id } = await params;
  const r = readPurchaseOrderPdf(g.user, id);
  if (!r.ok) return json({ error: r.error }, r.status);
  return new Response(new Uint8Array(r.bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${r.name}"`, "Cache-Control": "no-store" } });
}
