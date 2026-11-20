"use client";
import { ChevronDown, Copy, Mail } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { Badge, Button, Drawer, EmptyState, Field, Note, Panel, SummaryBar, TableWrap, Td, Th, cn, report, rowClass, textLink } from "@/components/ui";
import { StripTrend } from "@/components/charts";
import { byDay, lastDays, versus, weekSums } from "@/lib/domain/trends";
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

export function Suppliers({ propertyId, tabs }: { propertyId: string; tabs?: ReactNode }) {
  const ctx = useCtx();
  const property = propertyById[propertyId];
  const money = (n: number) => fmtMoney(n, property.currency, { decimals: true });
  const [onlyIssues, setOnlyIssues] = useState(true);
  // An order opened from Orders arrives with ?delivery=, which opens that delivery's three way check.
  const asked = useSearchParams().get("delivery");
  const [open, setOpen] = useState<string | null>(asked);
  const [draft, setDraft] = useState<string | null>(null);
  const me = useUser();
  const receipts = useDemo((s) => s.receiptCorrections);
  // Recorded receiving differences replace the delivered quantity in every check and in stock. The originals stay visible.
  const corrected = useMemo(() => receivedAsCorrected(ctx.data.deliveries, receipts), [ctx.data.deliveries, receipts]);

  const deliveries = useMemo(
    () => corrected.filter((d) => d.propertyId === propertyId && d.status === "delivered").map((d) => ({ d, lines: d.lines.map(matchDeliveryLine), over: deliveryOvercharge(d) })).sort((a, b) => (a.d.date < b.d.date ? 1 : -1)),
    [corrected, propertyId],
  );
  const withIssues = deliveries.filter((x) => x.lines.some((l) => l.issues.length > 0));
  // The largest amount to query first, then the newest.
  const visible = [...(onlyIssues ? withIssues : deliveries)].sort((a, b) => b.over - a.over || (a.d.date < b.d.date ? 1 : -1));
  const expected = ctx.data.deliveries.filter((d) => d.propertyId === propertyId && d.status === "expected");
  // Staff and the head chef see quantities without prices, so money is said to be hidden rather than shown as nothing.
  const priced = deliveries.some((x) => x.d.lines.some((l) => l.poPrice > 0 || l.invoicePrice > 0));
  const perDay = priced ? byDay(deliveries, (x) => x.d.date, (x) => x.over, lastDays(30)) : byDay(withIssues, (x) => x.d.date, () => 1, lastDays(30));
  const weekIssues = weekSums(withIssues, (x) => x.d.date, () => 1);
  // The five largest first; the rest one click away, so the page never opens on a long list.
  const [everything, setEverything] = useState(false);
  const askedRow = asked ? deliveries.find((x) => x.d.id === asked) : undefined;
  const rows = askedRow ? [askedRow, ...(everything ? visible : visible.slice(0, 5)).filter((x) => x !== askedRow)] : everything ? visible : visible.slice(0, 5);
  useEffect(() => { if (asked) requestAnimationFrame(() => document.getElementById("deliveries")?.scrollIntoView({ block: "start", behavior: "smooth" })); }, [asked]);
  const show = (issues: boolean) => { setOnlyIssues(issues); setEverything(true); requestAnimationFrame(() => document.getElementById("deliveries")?.scrollIntoView({ block: "start", behavior: "smooth" })); };

  return (
    <div className="space-y-6">
      <SummaryBar
        items={[
          { label: "Deliveries checked", value: deliveries.length, compare: { text: "Last 30 days", good: null }, onClick: () => show(false) },
          { label: "With a difference", value: withIssues.length, tone: withIssues.length ? "warn" : "pos", compare: versus(weekIssues.now, weekIssues.before, "down", "the week before"), onClick: () => show(true) },
          // Still to query: credited deliveries are settled, so they are left out, as on the Overview's supplier invoices card.
          { label: "To query with suppliers", value: priced ? fmtMoney(sum(deliveries.filter((x) => !x.d.credit), (x) => x.over), property.currency) : "Not shown", tone: priced ? "money" : undefined, compare: { text: priced ? "Invoiced for goods not delivered or above the agreed price, not yet credited" : "Prices not shown to your role", good: null }, onClick: () => show(true) },
          { label: "Confirmed for tomorrow", value: expected.length, compare: { text: expected.length === 1 ? "1 delivery" : `${expected.length} deliveries`, good: null } },
        ]}
        trend={<StripTrend goodWhen="down" title={priced ? "Amount to query per delivery day, last 30 days" : "Deliveries with a difference, last 30 days"} points={perDay} explain="What suppliers invoiced beyond what arrived or the agreed price, by delivery day." series={priced ? [{ id: "count", label: "Deliveries with a difference", axis: "count", format: (n) => `${Math.round(n)}`, points: byDay(withIssues, (x) => x.d.date, () => 1, lastDays(13)), goodWhen: "down" as const, explain: "Short, over, or invoiced above the order price." }] : []} format={priced ? money : (n) => `${n} ${n === 1 ? "delivery" : "deliveries"}`} summary={`Invoiced beyond delivery or agreed price, by delivery date. Deliveries are only held for the last 13 days.`} note="13 days held" />}
      />

      {tabs}
      <div id="deliveries" className="scroll-mt-24">
      <Panel
        title="Deliveries"
        action={<label className="flex cursor-pointer items-center gap-2 text-[13px] text-graphite"><input type="checkbox" className="accent-[var(--color-accent)]" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} /> Only deliveries with a difference</label>}
        flush
      >
        {visible.length === 0 ? <div className="px-6 pb-6"><EmptyState title="Every delivery matched its order and invoice" /></div> : (
          <TableWrap>
            <table className="w-full min-w-[780px] text-sm">
              <thead><tr><Th>Supplier</Th><Th>Delivered</Th><Th>What differs</Th><Th align="right">To query</Th></tr></thead>
              <tbody>
                {rows.map(({ d, lines, over }) => {
                  const issues = [...new Set(lines.flatMap((l) => l.issues))];
                  const isOpen = open === d.id;
                  return [
                    <tr key={d.id} className={cn(rowClass, "cursor-pointer", isOpen && "bg-cloud")} onClick={() => setOpen(isOpen ? null : d.id)}>
                      <Td>
                        <button type="button" aria-expanded={isOpen} className="flex items-center gap-2 text-start text-ink" onClick={(e) => { e.stopPropagation(); setOpen(isOpen ? null : d.id); }}>
                          <ChevronDown size={15} className={cn("shrink-0 text-steel transition-transform duration-200 ease-tyll", isOpen && "rotate-180")} aria-hidden /><span>{supplierById[d.supplierId].name}<span className="num block text-xs text-steel">{d.id}</span></span>
                        </button>
                      </Td>
                      <Td className="num text-graphite">{fmtDate(d.date, true)}</Td>
                      <Td>{issues.length === 0 ? <Badge tone="pos">Matched</Badge> : <span className="flex flex-wrap gap-1">{issues.map((i) => <Badge key={i} tone="neutral">{i === "short_delivery" && over === 0 ? "Short, not charged" : ISSUE_LABEL[i]}</Badge>)}</span>}</Td>
                      <Td align="right" className={cn(over > 0 && "font-medium text-ink")}>{!priced ? "Not shown" : over > 0 ? <>{fmtMoney(over, property.currency)}{d.credit && <span className="mt-0.5 block text-xs font-normal text-pos">Credited {fmtDate(d.credit.date)}</span>}</> : "None"}</Td>
                    </tr>,
                    isOpen && (
                      <tr key={`${d.id}-lines`} className="border-t border-hair bg-cloud">
                        <td colSpan={4} className="px-6 pb-5 pt-2">
                          <table className="w-full text-[13px]">
                            <thead><tr className="text-start text-xs text-steel"><th className="py-1.5 font-medium">Item</th><th className="py-1.5 text-end font-medium">Ordered</th><th className="py-1.5 text-end font-medium">Delivered</th><th className="py-1.5 text-end font-medium">Invoiced</th><th className="py-1.5 text-end font-medium">Order price</th><th className="py-1.5 text-end font-medium">Invoice price</th><th className="py-1.5 text-end font-medium">Invoiced, not delivered</th><th className="py-1.5 text-end font-medium">To query</th></tr></thead>
                            <tbody>
                              {lines.map(({ line, issues: li, overcharge }) => {
                                const g = ingredientById[line.ingredientId];
                                return (
                                  <tr key={line.ingredientId} className="num border-t border-hair">
                                    <td className="py-1.5 text-ink">{g.name}</td>
                                    <td className="py-1.5 text-end">{fmtQty(line.ordered, g.unit)}</td>
                                    <td className={cn("py-1.5 text-end", li.includes("short_delivery") && "font-semibold text-ink")}>
                                      {fmtQty(line.delivered, g.unit)}
                                      {(() => { const was = ctx.data.deliveries.find((x) => x.id === d.id)?.lines.find((l) => l.ingredientId === line.ingredientId)?.delivered; return was !== undefined && was !== line.delivered ? <span className="block text-xs text-steel line-through">{fmtQty(was, g.unit)}</span> : null; })()}
                                    </td>
                                    <td className={cn("py-1.5 text-end", li.includes("invoiced_not_delivered") && "font-semibold text-ink")}>{fmtQty(line.invoiced, g.unit)}</td>
                                    <td className="py-1.5 text-end">{money(line.poPrice)}</td>
                                    <td className={cn("py-1.5 text-end", li.includes("price_above_po") && "font-semibold text-ink")}>{money(line.invoicePrice)}</td>
                                    <td className={cn("py-1.5 text-end", line.invoiced > line.delivered ? "font-semibold text-ink" : "text-steel")}>{line.invoiced > line.delivered ? fmtQty(line.invoiced - line.delivered, g.unit) : "None"}</td>
                                    <td className={cn("py-1.5 text-end", overcharge > 0 ? "font-semibold text-ink" : "text-steel")}>{overcharge > 0 ? money(overcharge) : "None"}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                          {priced && over > 0 && !d.credit && <div className="mt-3"><Button size="sm" onClick={() => setDraft(d.id)}><Mail size={14} aria-hidden /> Draft a credit request for {fmtMoney(over, property.currency)}</Button></div>}
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
        {visible.length > 5 && <div className="border-t border-hair px-6 py-3"><button type="button" onClick={() => setEverything((v) => !v)} className={textLink}>{everything ? "Show the five largest" : `Show all ${visible.length} deliveries`}</button></div>}
        <Note className="px-6 py-4">Only the delivered quantity is added to estimated stock. Deliveries and invoices are simulated. A live version would read them from the purchasing system.</Note>
      </Panel>
      </div>
      <CreditDraft delivery={deliveries.find((x) => x.d.id === draft) ?? null} onClose={() => setDraft(null)} money={(n) => fmtMoney(n, property.currency, { decimals: true })} hotel={property.name} from={me?.name ?? "The purchasing team"} />
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

/** A credit request the manager sends from their own email: every line invoiced beyond what arrived or above the order price. Nothing is sent from Tyll. */
function CreditDraft({ delivery, onClose, money, hotel, from }: { delivery: { d: { id: string; date: string; supplierId: string; lines: DeliveryLine[] }; over: number } | null; onClose: () => void; money: (n: number) => string; hotel: string; from: string }) {
  const [copied, setCopied] = useState(false);
  if (!delivery) return null;
  const { d, over } = delivery;
  const supplier = supplierById[d.supplierId].name;
  const lines = d.lines.map(matchDeliveryLine).filter((m) => m.overcharge > 0).map(({ line, overcharge }) => {
    const g = ingredientById[line.ingredientId];
    const parts = [line.invoiced > line.delivered ? `invoiced ${fmtQty(line.invoiced, g.unit)}, received ${fmtQty(line.delivered, g.unit)}` : null, line.invoicePrice > line.poPrice + 0.005 ? `invoiced at ${money(line.invoicePrice)}, ordered at ${money(line.poPrice)}` : null].filter(Boolean).join("; ");
    return `- ${g.name}: ${parts}. Difference ${money(overcharge)}.`;
  });
  const text = [`To: ${supplier}`, `Subject: Credit request for ${d.id}, delivered ${fmtDate(d.date, true)}`, "", "Hello,", "", `For our order ${d.id}, delivered on ${fmtDate(d.date, true)}, your invoice does not match what we received:`, "", ...lines, "", `Please send a credit note for ${money(over)}, or let us know if our records are wrong.`, "", "Thank you,", `${from}, ${hotel}`].join("\n");
  const copy = async () => { try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); } };
  return (
    <Drawer open onClose={onClose} title={`Credit request to ${supplier}`} description="Ready to paste into your email. Tyll does not send it.">
      <div className="space-y-4">
        <pre className="whitespace-pre-wrap rounded-[var(--radius-control)] border border-line bg-cloud p-4 font-sans text-sm leading-relaxed text-ink">{text}</pre>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={copy}><Copy size={15} aria-hidden /> {copied ? "Copied" : "Copy the text"}</Button>
          <span className="text-xs text-steel">Asking is not accusing: the note leaves room for a mistake on our side.</span>
        </div>
      </div>
    </Drawer>
  );
}
