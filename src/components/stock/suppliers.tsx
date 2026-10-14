"use client";
import { ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Button, EmptyState, Field, Note, Panel, Stat, TableWrap, Td, Th, cn, report, rowClass } from "@/components/ui";
import { ingredientById, propertyById, supplierById } from "@/lib/data/catalog";
import { can } from "@/lib/domain/access";
import { deliveryOvercharge, matchDeliveryLine, receivedAsCorrected, type MatchIssue } from "@/lib/domain/inventory";
import { personName, useCtx, useUser } from "@/lib/hooks";
import { useDemo } from "@/lib/store";
import type { DeliveryLine } from "@/lib/types";
import { fmtDate, fmtMoney, fmtQty, sum } from "@/lib/util";

const ISSUE_LABEL: Record<MatchIssue, string> = {
  short_delivery: "Delivered less than ordered",
  invoiced_not_delivered: "Invoiced for goods not delivered",
  price_above_po: "Invoice price above the order price",
  over_delivery: "Delivered more than ordered",
};

export function Suppliers({ propertyId }: { propertyId: string }) {
  const ctx = useCtx();
  const property = propertyById[propertyId];
  const money = (n: number) => fmtMoney(n, property.currency, { decimals: true });
  const [onlyIssues, setOnlyIssues] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const receipts = useDemo((s) => s.receiptCorrections);
  // Recorded receiving differences replace the delivered quantity in every check and in stock. The originals stay visible.
  const corrected = useMemo(() => receivedAsCorrected(ctx.data.deliveries, receipts), [ctx.data.deliveries, receipts]);

  const deliveries = useMemo(
    () => corrected.filter((d) => d.propertyId === propertyId && d.status === "delivered").map((d) => ({ d, lines: d.lines.map(matchDeliveryLine), over: deliveryOvercharge(d) })).sort((a, b) => (a.d.date < b.d.date ? 1 : -1)),
    [corrected, propertyId],
  );
  const withIssues = deliveries.filter((x) => x.lines.some((l) => l.issues.length > 0));
  const visible = onlyIssues ? withIssues : deliveries;
  const expected = ctx.data.deliveries.filter((d) => d.propertyId === propertyId && d.status === "expected");

  return (
    <div className="space-y-5">
      <Panel title="Orders, deliveries and invoices" description="Each delivery is checked three ways: what was ordered, what arrived, and what the supplier invoiced.">
        <div className="grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
          <Stat label="Deliveries checked" value={deliveries.length} sub="last 13 days" />
          <Stat label="With a difference" tone={withIssues.length ? "warn" : undefined} value={withIssues.length} />
          <Stat label="Invoiced beyond delivery or agreed price" tone="warn" value={money(sum(deliveries, (x) => x.over))} sub="to query with suppliers" />
          <Stat label="Deliveries confirmed" value={expected.length} sub="for tomorrow" />
        </div>
      </Panel>

      <Panel
        title="Deliveries"
        action={<label className="flex cursor-pointer items-center gap-2 text-[13px] text-graphite"><input type="checkbox" className="accent-ink" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} /> Only deliveries with a difference</label>}
        flush
      >
        {visible.length === 0 ? <div className="px-6 pb-6"><EmptyState title="Every delivery matched its order and invoice" /></div> : (
          <TableWrap>
            <table className="w-full min-w-[780px] text-sm">
              <thead><tr><Th>Purchase order</Th><Th>Supplier</Th><Th>Delivered</Th><Th>Result</Th><Th align="right">To query</Th></tr></thead>
              <tbody>
                {visible.map(({ d, lines, over }) => {
                  const issues = [...new Set(lines.flatMap((l) => l.issues))];
                  const isOpen = open === d.id;
                  return [
                    <tr key={d.id} className={cn(rowClass, "cursor-pointer", isOpen && "bg-cloud")} onClick={() => setOpen(isOpen ? null : d.id)}>
                      <Td>
                        <button type="button" aria-expanded={isOpen} className="num flex items-center gap-2 text-ink" onClick={(e) => { e.stopPropagation(); setOpen(isOpen ? null : d.id); }}>
                          <ChevronDown size={15} className={cn("text-steel transition-transform duration-300 ease-tyll", isOpen && "rotate-180")} aria-hidden />{d.id}
                        </button>
                      </Td>
                      <Td>{supplierById[d.supplierId].name}</Td>
                      <Td className="num text-graphite">{fmtDate(d.date, true)}</Td>
                      <Td>{issues.length === 0 ? <Badge tone="pos">Matched</Badge> : <span className="flex flex-wrap gap-1">{issues.map((i) => <Badge key={i} tone="warn">{ISSUE_LABEL[i]}</Badge>)}</span>}</Td>
                      <Td align="right" className={cn(over > 0 && "text-warn")}>{over > 0 ? money(over) : "–"}</Td>
                    </tr>,
                    isOpen && (
                      <tr key={`${d.id}-lines`} className="border-t border-hair bg-cloud">
                        <td colSpan={5} className="px-6 pb-5 pt-2">
                          <table className="w-full text-[13px]">
                            <thead><tr className="text-left text-xs text-steel"><th className="py-1.5 font-medium">Item</th><th className="py-1.5 text-right font-medium">Ordered</th><th className="py-1.5 text-right font-medium">Delivered</th><th className="py-1.5 text-right font-medium">Invoiced</th><th className="py-1.5 text-right font-medium">Order price</th><th className="py-1.5 text-right font-medium">Invoice price</th></tr></thead>
                            <tbody>
                              {lines.map(({ line, issues: li }) => {
                                const g = ingredientById[line.ingredientId];
                                return (
                                  <tr key={line.ingredientId} className="num border-t border-hair">
                                    <td className="py-1.5 text-ink">{g.name}</td>
                                    <td className="py-1.5 text-right">{fmtQty(line.ordered, g.unit)}</td>
                                    <td className={cn("py-1.5 text-right", li.includes("short_delivery") && "text-warn")}>
                                      {fmtQty(line.delivered, g.unit)}
                                      {(() => { const was = ctx.data.deliveries.find((x) => x.id === d.id)?.lines.find((l) => l.ingredientId === line.ingredientId)?.delivered; return was !== undefined && was !== line.delivered ? <span className="block text-xs text-steel line-through">{fmtQty(was, g.unit)}</span> : null; })()}
                                    </td>
                                    <td className={cn("py-1.5 text-right", li.includes("invoiced_not_delivered") && "text-warn")}>{fmtQty(line.invoiced, g.unit)}</td>
                                    <td className="py-1.5 text-right">{money(line.poPrice)}</td>
                                    <td className={cn("py-1.5 text-right", li.includes("price_above_po") && "text-warn")}>{money(line.invoicePrice)}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                          <ReceiveForm deliveryId={d.id} lines={d.lines} />
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
        <Note className="px-6 py-4">Only the delivered quantity is added to estimated stock. Deliveries and invoices are simulated. A live version would read them from the purchasing system.</Note>
      </Panel>
    </div>
  );
}

/** Record what actually arrived for one line. The difference is added to the record, and stock and the checks above follow it. */
function ReceiveForm({ deliveryId, lines }: { deliveryId: string; lines: DeliveryLine[] }) {
  const user = useUser()!;
  const record = useDemo((s) => s.recordReceipt);
  const history = useDemo((s) => s.receiptCorrections).filter((r) => r.deliveryId === deliveryId);
  const [item, setItem] = useState(lines[0]?.ingredientId ?? "");
  const [qty, setQty] = useState("");
  const [why, setWhy] = useState("");
  const line = lines.find((l) => l.ingredientId === item);
  return (
    <div className="mt-4 border-t border-hair pt-4">
      {history.length > 0 && (
        <ul className="mb-3 space-y-1 text-[13px]">
          {history.map((h) => <li key={h.id} className="text-graphite">{ingredientById[h.ingredientId].name}: received recorded as {fmtQty(h.received, ingredientById[h.ingredientId].unit)} by {personName(h.by)}. {h.reason}</li>)}
        </ul>
      )}
      {can(user, "stock.count") && line && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => {
          e.preventDefault();
          if (report(record({ deliveryId, ingredientId: item, received: Number(qty), reason: why }), "Difference recorded. Stock and the delivery check are updated.")) { setQty(""); setWhy(""); }
        }}>
          <label className="flex flex-col gap-1.5 text-[13px] font-medium text-graphite">
            Item
            <select value={item} onChange={(e) => setItem(e.target.value)} className="h-11 rounded-xl border border-line bg-paper px-3 text-sm hover:border-fog">
              {lines.map((l) => <option key={l.ingredientId} value={l.ingredientId}>{ingredientById[l.ingredientId].name}, {fmtQty(l.ordered, ingredientById[l.ingredientId].unit)} ordered</option>)}
            </select>
          </label>
          <Field label="Actually received" suffix={ingredientById[item].unit === "each" ? "units" : ingredientById[item].unit} className="w-40" type="number" inputMode="decimal" min="0" step="0.01" value={qty} onChange={(e) => setQty(e.target.value)} />
          <Field label="How was it found?" className="min-w-[200px] flex-1" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="For example: two cases missing on the pallet" />
          <Button type="submit" size="sm">Record difference</Button>
        </form>
      )}
    </div>
  );
}
