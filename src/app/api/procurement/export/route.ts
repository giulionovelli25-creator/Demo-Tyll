import type { NextRequest } from "next/server";
import { guard, json } from "@/lib/server/guard";
import { EXPORT_FIELDS, exportDocuments, toCsv, toJson, type ExportKind } from "@/lib/server/procurement-export";

const KINDS: ExportKind[] = ["purchase_orders", "receipts", "invoices"];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Approved purchase orders, receipts or invoices as CSV or JSON. ?fields=1 returns the field list instead. */
export async function GET(req: NextRequest) {
  const g = guard(req, { module: "forecast" });
  if (!g.ok) return g.response;
  const q = req.nextUrl.searchParams;
  const kind = KINDS.find((k) => k === q.get("kind"));
  if (!kind) return json({ error: "Choose purchase_orders, receipts or invoices." }, 400);
  if (q.get("fields") === "1") return json({ kind, fields: EXPORT_FIELDS[kind] });
  const from = q.get("from") ?? undefined, to = q.get("to") ?? undefined;
  if ((from && !ISO.test(from)) || (to && !ISO.test(to))) return json({ error: "Dates are YYYY-MM-DD." }, 400);
  const propertyId = q.get("propertyId") ?? "";
  const r = exportDocuments(g.user, propertyId, kind, from, to);
  if (!r.ok) return json({ error: r.error }, r.status);
  const name = `tyll-${kind.replace("_", "-")}-${propertyId}${from ? `-${from}` : ""}${to ? `-to-${to}` : ""}`;
  if (q.get("format") === "json") {
    return new Response(JSON.stringify(toJson(kind, propertyId, r.documents), null, 2), { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.json"`, "Cache-Control": "no-store" } });
  }
  return new Response(`﻿${toCsv(kind, r.documents)}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"`, "Cache-Control": "no-store" } });
}
