"use client";
// Suppliers at this hotel: contact, order email, delivery days, cut-off, minimum order and payment terms, and each
// supplier's catalogue with packs, barcodes and agreed prices. Purchase prices follow the invoices: the last invoiced
// price sits beside the agreed one, and a price above it is flagged. Another hotel keeps its own suppliers and terms.
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { Badge, Button, Drawer, EmptyState, Field, Note, PageHeader, Panel, Segmented, Select, Skeleton, SummaryBar, TableWrap, Td, Th, WidgetError, cn, rowClass, textLink, toast } from "@/components/ui";
import { useAlertFeed } from "@/lib/alert-feed";
import { propertyById } from "@/lib/data/catalog";
import { useView } from "@/lib/hooks";
import { usePrices, useProcAction, useSuppliers } from "@/lib/procurement-hooks";
import type { CatalogueView, SupplierView } from "@/lib/server/procurement";
import type { SendChannel } from "@/lib/types";
import { CHANNEL_LABEL } from "@/lib/domain/dispatch";
import { fmtDate, fmtMoney, fmtPct } from "@/lib/util";

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const daysText = (d: number[]) => (d.length === 7 ? "Every day" : d.length === 6 && !d.includes(0) ? "Monday to Saturday" : d.map((x) => DAY[x]).join(", "));

function usePid() {
  const { propertyId: feedPid } = useAlertFeed();
  const { propertyId } = useView();
  return feedPid ?? propertyId ?? "lis";
}

function SupplierEditor({ s, pid, onClose }: { s: SupplierView; pid: string; onClose: () => void }) {
  const act = useProcAction();
  const [v, setV] = useState({ contact: s.contact, phone: s.phone, orderEmail: s.orderEmail, cutOff: s.cutOff, minOrderValue: s.minOrderValue, paymentTerms: s.paymentTerms, leadDays: s.leadDays, deliveryDays: s.deliveryDays, channel: s.channel ?? "email" });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await act("/api/procurement", { action: "supplier", propertyId: pid, id: s.id, ...v }); toast.done(`${s.name} saved.`); onClose(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "The supplier could not be saved."); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-4">
      <Field label="Contact" value={v.contact} onChange={(e) => setV({ ...v, contact: e.target.value })} />
      <Field label="Phone" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />
      <Field label="Order email" type="email" value={v.orderEmail} onChange={(e) => setV({ ...v, orderEmail: e.target.value })} hint="Purchase orders are sent here as a PDF." />
      <Select label="How approved orders are sent" value={v.channel} onChange={(e) => setV({ ...v, channel: e.target.value as SendChannel })}>
        <option value="email">Email with the PDF</option>
        <option value="portal">The supplier&rsquo;s ordering system</option>
        <option value="manual">By phone, recorded by purchasing</option>
      </Select>
      <div>
        <p className="mb-2 text-[13px] font-medium text-ink">Delivery days</p>
        <div className="flex flex-wrap gap-1.5">
          {DAY.map((d, i) => <button key={d} type="button" aria-pressed={v.deliveryDays.includes(i)} onClick={() => setV({ ...v, deliveryDays: v.deliveryDays.includes(i) ? v.deliveryDays.filter((x) => x !== i) : [...v.deliveryDays, i].sort() })} className={cn("h-9 rounded-full border px-3 text-[13px]", v.deliveryDays.includes(i) ? "border-accent bg-accent text-on-accent" : "border-line text-ink hover:bg-cloud")}>{d}</button>)}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Order cut-off" type="time" value={v.cutOff} onChange={(e) => setV({ ...v, cutOff: e.target.value })} />
        <Field label="Lead time, days" type="number" min="0" value={v.leadDays} onChange={(e) => setV({ ...v, leadDays: Number(e.target.value) })} />
      </div>
      <Field label="Minimum order value" type="number" min="0" value={v.minOrderValue} onChange={(e) => setV({ ...v, minOrderValue: Number(e.target.value) })} suffix={propertyById[pid].currency} />
      <Field label="Payment terms" value={v.paymentTerms} onChange={(e) => setV({ ...v, paymentTerms: e.target.value })} />
      <Button variant="primary" className="w-full" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save supplier"}</Button>
      <Note>These terms apply at {propertyById[pid].name} only. Another hotel in the group keeps its own terms, or its own supplier, for the same items.</Note>
    </div>
  );
}

function PriceHistory({ pid, line, onClose }: { pid: string; line: CatalogueView; onClose: () => void }) {
  const { data } = usePrices(pid, line.ingredientId);
  const act = useProcAction();
  const money = (n: number) => fmtMoney(n, propertyById[pid].currency, { decimals: true });
  const [price, setPrice] = useState(String(line.agreedPrice));
  const points = (data?.points ?? []).filter((p) => p.supplierId === line.supplierId).slice().reverse();
  const save = async () => {
    try { await act("/api/procurement", { action: "catalogue", propertyId: pid, supplierId: line.supplierId, ingredientId: line.ingredientId, agreedPrice: Number(price) }); toast.done(`Agreed price for ${line.name} is now ${money(Number(price))}.`); onClose(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "The price could not be saved."); }
  };
  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-[var(--radius-control)] bg-cloud px-3 py-2"><dt className="text-xs text-steel">Agreed price</dt><dd className="num font-medium text-ink">{money(line.agreedPrice)} per {line.unit === "units" ? "unit" : line.unit}</dd></div>
        <div className="rounded-[var(--radius-control)] bg-cloud px-3 py-2"><dt className="text-xs text-steel">Last invoiced</dt><dd className="num font-medium text-ink">{line.lastPrice === null ? "No invoice yet" : money(line.lastPrice)}</dd></div>
      </dl>
      <div>
        <h3 className="text-[13px] font-medium text-ink">Every invoiced price</h3>
        {points.length === 0 ? <p className="mt-1 text-sm text-steel">No invoices for this item from this supplier yet.</p> : (
          <ul className="mt-2 divide-y divide-hair text-table">
            {points.map((p) => <li key={`${p.ref}-${p.date}`} className="flex items-baseline justify-between gap-3 py-1.5"><span className="text-graphite">{fmtDate(p.date, true)} <span className="text-xs text-steel">{p.ref}</span></span><span className={cn("num", p.above ? "font-semibold text-ink" : "text-ink")}>{money(p.price)}{p.above && <Badge tone="warn" className="ms-2">Above agreed</Badge>}</span></li>)}
          </ul>
        )}
      </div>
      <div className="flex items-end gap-2 border-t border-hair pt-4">
        <Field label="Change the agreed price" type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className="flex-1" />
        <Button onClick={save}>Save</Button>
      </div>
      <Note>Purchase prices follow the invoices: stock is valued from what was actually paid. The agreed price is the contract; an invoice above it is flagged in the three way match.</Note>
    </div>
  );
}

export function SupplierDirectory({ view, tabs }: { view: "suppliers" | "catalogue"; tabs?: ReactNode }) {
  const pid = usePid();
  const { data, error } = useSuppliers(pid);
  const money = (n: number, d = false) => fmtMoney(n, propertyById[pid].currency, { decimals: d });
  const [editing, setEditing] = useState<SupplierView | null>(null);
  const [priced, setPriced] = useState<CatalogueView | null>(null);
  const [sup, setSup] = useState<string>("all");
  const [q, setQ] = useState("");
  const [onlyAbove, setOnlyAbove] = useState(false);
  const catalogue = useMemo(() => (data?.catalogue ?? []).filter((c) => (sup === "all" || c.supplierId === sup) && (!onlyAbove || c.aboveAgreed) && (!q.trim() || `${c.name} ${c.code} ${c.barcode}`.toLowerCase().includes(q.trim().toLowerCase()))), [data, sup, q, onlyAbove]);
  const suppliers = data?.suppliers ?? [];
  const above = (data?.catalogue ?? []).filter((c) => c.aboveAgreed);
  return (
    <div className="space-y-6">
      <PageHeader title={view === "suppliers" ? "Suppliers" : "Catalogue and prices"} question={view === "suppliers" ? "Who do we buy from, and on what terms?" : "What does each supplier sell us, and at what price?"} lead={`${propertyById[pid].name}. Fictional suppliers, addresses and prices. Simulated data.`} />
      {error ? <WidgetError>Suppliers could not load.</WidgetError> : !data ? <Skeleton className="h-64 w-full" /> : (
        <>
          <SummaryBar items={[
            { label: "Suppliers", value: suppliers.filter((s) => s.active).length, compare: { text: `${suppliers.filter((s) => !s.items).length ? `${suppliers.filter((s) => !s.items).length} without a catalogue` : "Each with its catalogue"}`, good: null } },
            { label: "Catalogue lines", value: data.catalogue.length, compare: { text: `${new Set(data.catalogue.map((c) => c.ingredientId)).size} items, most with a second supplier`, good: null } },
            { label: "Invoiced above agreed", value: above.length, tone: above.length ? "warn" : "pos", compare: { text: above.length ? "Last invoice price above the contract" : "Every last price within the contract", good: above.length ? false : true }, onClick: () => { setOnlyAbove(true); } },
            { label: "Open orders", value: suppliers.reduce((n, s) => n + s.openOrders, 0), compare: { text: `${money(suppliers.reduce((n, s) => n + s.openValue, 0))} before VAT`, good: null }, href: "/forecast?tab=approvals&queue=all" },
          ]} />
          {tabs}
          {view === "suppliers" ? (
            <Panel flush>
              <TableWrap>
                <table className="w-full min-w-[980px] text-table">
                  <thead><tr><Th>Supplier</Th><Th>Delivers</Th><Th>Cut-off</Th><Th align="right">Minimum order</Th><Th>Payment</Th><Th align="right">Bought, 30 days</Th><Th align="right">Items</Th><Th><span className="sr-only">Edit</span></Th></tr></thead>
                  <tbody>
                    {suppliers.map((s) => (
                      <tr key={s.id} className={rowClass}>
                        <Td><span className="font-medium text-ink">{s.name}</span><span className="block text-xs text-steel">{s.contact}, {s.phone}</span><span className="block text-xs text-steel">{s.orderEmail}</span><span className="block text-xs text-steel">Orders: {CHANNEL_LABEL[s.channel ?? "email"].toLowerCase()}</span></Td>
                        <Td>{daysText(s.deliveryDays)}<span className="block text-xs text-steel">{s.leadDays} {s.leadDays === 1 ? "day" : "days"} lead time</span></Td>
                        <Td className="num">{s.cutOff}</Td>
                        <Td align="right">{money(s.minOrderValue)}</Td>
                        <Td className="text-graphite">{s.paymentTerms}</Td>
                        <Td align="right">{s.spend30 ? money(s.spend30) : <span className="text-steel">None</span>}</Td>
                        <Td align="right">{s.items}{s.aboveAgreed > 0 && <Badge tone="warn" className="ms-2">{s.aboveAgreed} above agreed</Badge>}</Td>
                        <Td>{data.mayEdit && <button type="button" className={textLink} onClick={() => setEditing(s)}>Edit</button>}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
              <Note className="px-6 py-4">Suppliers are kept per hotel: the same company can deliver to two hotels on different days, terms and prices, and a hotel can buy the same item from another supplier.</Note>
            </Panel>
          ) : (
            <Panel flush>
              <div className="flex flex-wrap items-center gap-2 p-4 sm:px-6">
                <select aria-label="Supplier" value={sup} onChange={(e) => setSup(e.target.value)} className="h-10 rounded-full border border-line bg-paper px-3 text-sm text-ink"><option value="all">Every supplier</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
                <Segmented label="Show" size="sm" value={onlyAbove ? "above" : "all"} onChange={(v) => setOnlyAbove(v === "above")} options={[{ value: "all", label: "All lines" }, { value: "above", label: `Above agreed (${above.length})` }]} />
                <div className="relative ms-auto w-full sm:w-[240px]">
                  <Search size={15} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-steel" aria-hidden />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Item, code or barcode" aria-label="Find in the catalogue" className="h-10 w-full rounded-full border border-line bg-paper ps-9 pe-3 text-sm text-ink placeholder:text-steel" />
                </div>
              </div>
              {catalogue.length === 0 ? <div className="px-6 pb-6"><EmptyState title="Nothing matches">Try another supplier or name.</EmptyState></div> : (
                <TableWrap>
                  <table className="w-full min-w-[980px] text-table">
                    <thead><tr><Th>Item</Th><Th>Supplier</Th><Th>Pack</Th><Th align="right">Agreed price</Th><Th align="right">Last invoiced</Th><Th align="right">VAT</Th><Th><span className="sr-only">Prices</span></Th></tr></thead>
                    <tbody>
                      {catalogue.map((c) => (
                        <Fragment key={`${c.supplierId}|${c.ingredientId}`}>
                          <tr className={rowClass}>
                            <Td><span className="text-ink">{c.name}</span><span className="num block text-xs text-steel">{c.code} · {c.barcode}</span></Td>
                            <Td>{suppliers.find((s) => s.id === c.supplierId)?.name ?? c.supplierId}{c.preferred ? <Badge className="ms-2">Preferred</Badge> : null}</Td>
                            <Td className="text-graphite">{c.packLabel}</Td>
                            <Td align="right">{money(c.agreedPrice, true)}<span className="block text-xs text-steel">per {c.unit === "units" ? "unit" : c.unit}</span></Td>
                            <Td align="right">{c.lastPrice === null ? <span className="text-steel">No invoice</span> : <><span className={c.aboveAgreed ? "font-semibold text-ink" : "text-ink"}>{money(c.lastPrice, true)}</span>{c.aboveAgreed && <Badge tone="warn" className="ms-2">Above agreed</Badge>}</>}{c.lastDate && <span className="block text-xs text-steel">{fmtDate(c.lastDate, true)}</span>}</Td>
                            <Td align="right">{fmtPct(c.vatRate, 0)}</Td>
                            <Td><button type="button" className={textLink} onClick={() => setPriced(c)}>Prices</button></Td>
                          </tr>
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              )}
              <Note className="px-6 py-4">Agreed prices are per kg, litre or unit, before VAT. The barcode is on the supplier&rsquo;s pack, so a stock take can be counted by scanning.</Note>
            </Panel>
          )}
        </>
      )}
      <Drawer open={!!editing} onClose={() => setEditing(null)} title={editing ? editing.name : ""} description="Terms at this hotel.">
        {editing && <SupplierEditor key={editing.id} s={editing} pid={pid} onClose={() => setEditing(null)} />}
      </Drawer>
      <Drawer open={!!priced} onClose={() => setPriced(null)} title={priced ? `${priced.name}, ${suppliers.find((s) => s.id === priced.supplierId)?.name ?? ""}` : ""} description="Agreed price and every invoiced price.">
        {priced && <PriceHistory key={`${priced.supplierId}|${priced.ingredientId}`} pid={pid} line={priced} onClose={() => setPriced(null)} />}
      </Drawer>
    </div>
  );
}
