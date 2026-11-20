"use client";
// To order: items below their minimum, with the quantity back to the maximum, grouped by supplier. One click turns them
// into draft purchase orders, one per supplier. Par levels: the minimum and maximum per item and location, with the
// levels the prediction would suggest beside them. Par levels work on their own; the suggestion is only a suggestion.
import Link from "next/link";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { Badge, Button, Drawer, EmptyState, Note, PageHeader, Panel, Segmented, Skeleton, SummaryBar, TableWrap, Td, Th, WidgetError, cn, linkButton, rowClass, textLink, toast } from "@/components/ui";
import { useAlertFeed } from "@/lib/alert-feed";
import { propertyById } from "@/lib/data/catalog";
import { packsText } from "@/lib/domain/procurement";
import { useView } from "@/lib/hooks";
import { usePars, useProcAction, useToOrder } from "@/lib/procurement-hooks";
import type { ParRow } from "@/lib/server/procurement";
import type { PurchaseRequest } from "@/lib/types";
import { fmtDate, fmtMoney, fmtNum, sum } from "@/lib/util";

const qtyText = (n: number) => fmtNum(n, Math.abs(n % 1) < 1e-9 ? 0 : 1);

function usePid() {
  const { propertyId: feedPid } = useAlertFeed();
  const { propertyId } = useView();
  return feedPid ?? propertyId ?? "lis";
}

export function ToOrder({ tabs }: { tabs?: ReactNode }) {
  const pid = usePid();
  const { data, error } = useToOrder(pid);
  const act = useProcAction();
  const money = (n: number) => fmtMoney(n, propertyById[pid].currency);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [skip, setSkip] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ orders: PurchaseRequest[]; warnings: string[] } | null>(null);
  const [showCovered, setShowCovered] = useState(false);
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const below = rows.filter((r) => r.action === "order");
  // Items already covered by open orders need nothing; they are listed only on request.
  const order = below.filter((r) => showCovered || !r.covered);
  const coveredCount = below.filter((r) => r.covered).length;
  const issue = rows.filter((r) => r.action === "issue");
  const qtyOf = (r: ParRow) => qty[r.ingredientId] ?? r.qty;
  const picked = order.filter((r) => !skip[r.ingredientId] && qtyOf(r) > 0);
  const groups = [...new Set(order.map((r) => r.supplierId))].map((s) => ({ s, name: order.find((r) => r.supplierId === s)!.supplierName, list: order.filter((r) => r.supplierId === s) }));

  const create = async () => {
    setBusy(true);
    try {
      const r = await act<{ orders: PurchaseRequest[]; warnings: string[] }>("/api/procurement", { action: "create_pos", propertyId: pid, source: "par", lines: picked.map((r) => ({ ingredientId: r.ingredientId, qty: qtyOf(r), available: r.onHand, incoming: r.onOrder })) });
      setMade(r);
      setQty({});
      toast.done(`${r.orders.length} draft purchase ${r.orders.length === 1 ? "order" : "orders"} ready to check.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The purchase orders could not be created. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Below minimum" question="What is below its minimum, and how much brings it back to the maximum?" lead="From par levels and stock on hand, less what is already on order. Simulated data." />
      {error ? <WidgetError>To order could not load.</WidgetError> : !data ? <div className="space-y-4" aria-busy><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div> : (
        <>
          <SummaryBar
            items={[
              { label: "Below minimum", value: below.length, tone: below.length ? "warn" : "pos", compare: { text: coveredCount ? `${coveredCount} already covered by open orders` : below.length ? "Nothing on order for them yet" : "Every item is above its minimum", good: below.length ? null : true }, onClick: () => setShowCovered(true) },
              { label: "To order", value: money(sum(picked, (r) => qtyOf(r) * r.unitPrice)), tone: "money", compare: { text: `${picked.length} ${picked.length === 1 ? "item" : "items"} from ${new Set(picked.map((r) => r.supplierId)).size} ${new Set(picked.map((r) => r.supplierId)).size === 1 ? "supplier" : "suppliers"}, before VAT`, good: null } },
              { label: "Outlet top-ups", value: issue.length, compare: { text: issue.length ? "From the main store, see below" : "Every outlet is above its minimum", good: issue.length ? null : true }, onClick: () => document.getElementById("top-ups")?.scrollIntoView({ block: "start", behavior: "smooth" }) },
            ]}
            action={data.mayCreate ? <Button variant="primary" onClick={create} disabled={busy || !picked.length}>{busy ? "Creating…" : !picked.length ? "Nothing to order" : `${picked.every((r) => r.inDraft) ? "Update" : "Create"} ${new Set(picked.map((r) => r.supplierId)).size === 1 ? "purchase order" : `${new Set(picked.map((r) => r.supplierId)).size} purchase orders`}`}</Button> : undefined}
          />
          {tabs}
          <Panel title="Order from suppliers" description="Grouped by supplier, the way orders are placed. Quantities are in the supplier's packs; untick a line to leave it out." flush>
            {coveredCount > 0 && <p className="px-5 pb-2 text-[13px] text-graphite sm:px-6">{coveredCount} more {coveredCount === 1 ? "item is" : "items are"} below the minimum but already covered by open orders. <button type="button" className="font-medium text-accent-ink underline-offset-4 hover:underline" onClick={() => setShowCovered(!showCovered)}>{showCovered ? "Hide them" : "Show them"}</button></p>}
            {order.length === 0 ? <div className="p-6"><EmptyState title="Nothing to order">{coveredCount ? "Open orders cover every item below its minimum." : "Stock covers every par level in the main store."}</EmptyState></div> : (<>
              <ul className="md:hidden">
                {groups.map((g) => (
                  <Fragment key={g.s}>
                    <li className="flex justify-between border-t border-hair bg-cloud px-4 py-2 text-[13px]"><span className="font-semibold text-ink">{g.name}</span><span className="num font-semibold text-ink">{money(sum(g.list.filter((r) => !skip[r.ingredientId]), (r) => qtyOf(r) * r.unitPrice))}</span></li>
                    {g.list.map((r) => (
                      <li key={r.ingredientId} className={cn("border-t border-hair px-4 py-3", skip[r.ingredientId] && "opacity-50")}>
                        <div className="flex items-start gap-3">
                          <input type="checkbox" aria-label={`Include ${r.name}`} checked={!skip[r.ingredientId] && qtyOf(r) > 0} disabled={r.covered && !qty[r.ingredientId]} onChange={(e) => setSkip({ ...skip, [r.ingredientId]: !e.target.checked })} className="mt-1 h-5 w-5 accent-[var(--color-accent)]" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-2"><span className="text-sm font-medium text-ink">{r.name}</span><span className="num text-sm text-ink">{money(qtyOf(r) * r.unitPrice)}</span></div>
                            <p className="mt-0.5 text-xs text-steel">On hand {qtyText(r.onHand)} {r.unit}, minimum {qtyText(r.min)}, maximum {qtyText(r.max)}{r.onOrder ? `, ${qtyText(r.onOrder)} on order` : ""}.</p>
                            <label className="mt-2 flex items-center gap-2"><span className="text-xs text-graphite">Order</span>
                              <input type="number" min={0} step={r.packSize} value={qtyOf(r)} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0) setQty({ ...qty, [r.ingredientId]: v }); }} className="num h-9 w-24 rounded-full border border-line bg-paper px-3 text-end text-sm" />
                              <span className="text-xs text-steel">{r.unit}</span>
                            </label>
                            <p className="mt-1 text-xs text-steel">{packsText(qtyOf(r), r.packSize, r.packLabel, r.unit)}</p>
                            {r.inDraft && <Link prefetch={false} href={`/forecast?tab=approvals&request=${r.inDraft}`} className="mt-1 block text-xs text-accent-ink underline-offset-4 hover:underline">In your draft {r.inDraft}</Link>}
                          </div>
                        </div>
                      </li>
                    ))}
                  </Fragment>
                ))}
              </ul>
              <TableWrap className="hidden md:block">
                <table className="w-full min-w-[860px] text-table">
                  <thead><tr><Th className="w-10"><span className="sr-only">Include</span></Th><Th>Item</Th><Th align="right">On hand</Th><Th align="right">Min / max</Th><Th align="right">On order</Th><Th align="right">To order</Th><Th align="right">Cost</Th></tr></thead>
                  <tbody>
                    {groups.map((g) => (
                      <Fragment key={g.s}>
                        <tr className="border-t border-hair bg-cloud"><td colSpan={6} className="px-5 py-2 text-[13px] sm:px-6"><span className="font-semibold text-ink">{g.name}</span><span className="ms-2 text-steel">{g.list.length} {g.list.length === 1 ? "item" : "items"}</span></td><td className="num px-5 py-2 text-end text-[13px] font-semibold text-ink sm:px-6">{money(sum(g.list.filter((r) => !skip[r.ingredientId]), (r) => qtyOf(r) * r.unitPrice))}</td></tr>
                        {g.list.map((r) => (
                          <tr key={r.ingredientId} className={cn(rowClass, skip[r.ingredientId] && "opacity-50")}>
                            <Td><input type="checkbox" aria-label={`Include ${r.name}`} checked={!skip[r.ingredientId] && qtyOf(r) > 0} disabled={r.covered && !qty[r.ingredientId]} onChange={(e) => setSkip({ ...skip, [r.ingredientId]: !e.target.checked })} className="h-4 w-4 accent-[var(--color-accent)]" /></Td>
                            <Td><span className="text-ink">{r.name}</span><span className="block text-xs text-steel">{r.locationName}{r.covered ? ", already covered by open orders" : ""}</span>{r.inDraft && <Link prefetch={false} href={`/forecast?tab=approvals&request=${r.inDraft}`} className="mt-0.5 block text-xs text-accent-ink underline-offset-4 hover:underline">In your draft {r.inDraft}</Link>}</Td>
                            <Td align="right"><span className="font-medium text-ink">{qtyText(r.onHand)}</span> <span className="text-xs text-steel">{r.unit}</span></Td>
                            <Td align="right">{qtyText(r.min)} / {qtyText(r.max)} <span className="text-xs text-steel">{r.unit}</span></Td>
                            <Td align="right">{r.onOrder ? <>{qtyText(r.onOrder)} <span className="text-xs text-steel">{r.unit}</span></> : <span className="text-steel">None</span>}</Td>
                            <Td align="right">
                              <label className="inline-flex items-center gap-1.5"><span className="sr-only">Quantity of {r.name}</span>
                                <input type="number" min={0} step={r.packSize} value={qtyOf(r)} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0) setQty({ ...qty, [r.ingredientId]: v }); }} className="num h-8 w-20 rounded-full border border-line bg-paper px-2.5 text-end text-sm hover:border-fog" />
                                <span className="w-9 text-start text-xs text-steel">{r.unit}</span>
                              </label>
                              <span className="block text-xs text-steel">{packsText(qtyOf(r), r.packSize, r.packLabel, r.unit)}</span>
                            </Td>
                            <Td align="right" className="num text-ink">{money(qtyOf(r) * r.unitPrice)}</Td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </>)}
            <Note className="px-6 py-4">Prices are the agreed catalogue prices, before VAT. A supplier&rsquo;s minimum order and delivery days are checked when the drafts are made. Nothing goes to a supplier until a draft is approved and sent.</Note>
          </Panel>
          <section id="top-ups" className="scroll-mt-24">
            <Panel title="Top up outlets from the main store" description="Outlet working stock against each outlet's own par level, from the last count at close." flush>
              {issue.length === 0 ? <div className="p-6"><EmptyState title="No outlet needs a top-up">Every outlet is above its minimum at its last count.</EmptyState></div> : (
                <TableWrap>
                  <table className="w-full min-w-[720px] text-table">
                    <thead><tr><Th>Outlet</Th><Th>Item</Th><Th align="right">At last count</Th><Th align="right">Min / max</Th><Th align="right">Issue</Th></tr></thead>
                    <tbody>
                      {issue.map((r) => (
                        <tr key={`${r.location}|${r.ingredientId}`} className={rowClass}>
                          <Td>{r.locationName}</Td>
                          <Td className="text-ink">{r.name}</Td>
                          <Td align="right">{qtyText(r.onHand)} {r.unit}{r.onHandAt && <span className="block text-xs text-steel">{fmtDate(r.onHandAt.slice(0, 10), true)} {r.onHandAt.slice(11)}</span>}</Td>
                          <Td align="right">{qtyText(r.min)} / {qtyText(r.max)}</Td>
                          <Td align="right" className="font-medium text-ink">{qtyText(r.qty)} {r.unit}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              )}
              <Note className="px-6 py-4">Issue these from the main store before service. The main store&rsquo;s own levels above decide what is bought.</Note>
            </Panel>
          </section>
        </>
      )}
      <Drawer open={!!made} onClose={() => setMade(null)} title={made ? `${made.orders.length} draft purchase ${made.orders.length === 1 ? "order" : "orders"}` : ""} description="One per supplier, for its next delivery day. Check each, then send it for approval.">
        {made && (
          <div className="space-y-4">
            {made.warnings.length > 0 && <div className="rounded-2xl border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-ink"><p className="font-medium">To check</p><ul className="mt-1 list-disc space-y-1 ps-5 text-graphite">{made.warnings.map((w) => <li key={w}>{w}</li>)}</ul></div>}
            <ul className="divide-y divide-hair rounded-2xl border border-line">
              {made.orders.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="min-w-0"><span className="num block text-sm font-medium text-ink">{o.id}</span><span className="text-xs text-steel">{o.lines.length} {o.lines.length === 1 ? "item" : "items"}, delivery {o.deliveryDate ? fmtDate(o.deliveryDate, true) : "to set"}, {o.costCentre}</span></span>
                  <span className="flex shrink-0 items-center gap-3"><span className="num text-sm text-ink">{money(sum(o.lines, (l) => l.qty * l.unitPrice))}</span><Link prefetch={false} href={`/forecast?tab=approvals&request=${o.id}`} className={textLink}>Open</Link></span>
                </li>
              ))}
            </ul>
            <Link prefetch={false} href="/forecast?tab=approvals&queue=drafts" className={cn(linkButton("primary"), "w-full")}>See my drafts in Orders</Link>
          </div>
        )}
      </Drawer>
    </div>
  );
}

export function ParLevels({ tabs }: { tabs?: ReactNode }) {
  const pid = usePid();
  const { data, error } = usePars(pid);
  const act = useProcAction();
  const [where, setWhere] = useState<string>("main");
  const [q, setQ] = useState("");
  const [onlyBelow, setOnlyBelow] = useState(false);
  const [edit, setEdit] = useState<Record<string, { min: number; max: number }>>({});
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const locations = useMemo(() => [...new Map(rows.map((r) => [r.location, r.locationName])).entries()], [rows]);
  const shown = rows.filter((r) => r.location === where && (!onlyBelow || r.below) && (!q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase())));
  const key = (r: ParRow) => `${r.location}|${r.ingredientId}`;
  const save = async (r: ParRow, v: { min: number; max: number }) => {
    setBusy(true);
    try {
      await act("/api/procurement", { action: "par", propertyId: pid, location: r.location, ingredientId: r.ingredientId, min: v.min, max: v.max });
      setEdit((e) => { const n = { ...e }; delete n[key(r)]; return n; });
      toast.done(`${r.name}: minimum ${qtyText(v.min)}, maximum ${qtyText(v.max)} ${r.unit}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The par level could not be saved.");
    } finally { setBusy(false); }
  };
  const applyAll = async () => {
    setBusy(true);
    try {
      await act("/api/procurement", { action: "par", propertyId: pid, apply: "suggested", keys: shown.map(key) });
      toast.done(`Suggested levels set for ${shown.length} ${shown.length === 1 ? "item" : "items"}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The levels could not be saved.");
    } finally { setBusy(false); }
  };
  return (
    <div className="space-y-6">
      <PageHeader title="Par levels" question="How much of each item should each location keep?" lead="Minimum and maximum per item and location. Below the minimum, an item goes to To order with the quantity back to the maximum. Simulated data." />
      {error ? <WidgetError>Par levels could not load.</WidgetError> : !data ? <Skeleton className="h-64 w-full" /> : (
        <>
          <SummaryBar
            items={[
              { label: "Items with a par level", value: rows.filter((r) => r.location === where).length, compare: { text: locations.find(([id]) => id === where)?.[1] ?? "", good: null } },
              { label: "Below minimum", value: rows.filter((r) => r.location === where && r.below).length, tone: rows.some((r) => r.location === where && r.below) ? "warn" : "pos", compare: { text: "Listed in To order", good: null }, onClick: () => setOnlyBelow(true) },
              { label: "Set by hand", value: rows.filter((r) => r.location === where && r.source === "set").length, compare: { text: `${rows.filter((r) => r.location === where && r.source === "suggested").length} from the prediction's suggestion`, good: null } },
            ]}
            action={data.mayEdit ? <Button disabled={busy || !shown.length} onClick={() => { if (window.confirm(`Replace the levels of these ${shown.length} items with the suggested ones?`)) applyAll(); }}>Use suggested levels for these {shown.length}</Button> : undefined}
          />
          {tabs}
          <Panel flush>
            <div className="flex flex-wrap items-center gap-2 p-4 sm:px-6">
              <Segmented label="Location" value={where} onChange={setWhere} options={locations.map(([id, name]) => ({ value: id, label: name }))} size="sm" />
              <label className="ms-auto flex items-center gap-2 text-[13px] text-graphite"><input type="checkbox" checked={onlyBelow} onChange={(e) => setOnlyBelow(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />Only below minimum</label>
              <div className="relative w-full sm:w-[220px]">
                <Search size={15} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-steel" aria-hidden />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an item" aria-label="Find an item" className="h-10 w-full rounded-full border border-line bg-paper ps-9 pe-3 text-sm text-ink placeholder:text-steel" />
              </div>
            </div>
            {shown.length === 0 ? <div className="px-6 pb-6"><EmptyState title="No items here">{q ? "Try another name." : "No par levels at this location."}</EmptyState></div> : (
              <TableWrap>
                <table className="w-full min-w-[860px] text-table">
                  <thead><tr><Th>Item</Th><Th align="right">{where === "main" ? "On hand" : "At last count"}</Th><Th align="right">Minimum</Th><Th align="right">Maximum</Th><Th align="right">Suggested</Th><Th>Set by</Th></tr></thead>
                  <tbody>
                    {shown.map((r) => {
                      const e = edit[key(r)];
                      const v = e ?? { min: r.min, max: r.max };
                      const input = (k: "min" | "max") => <input type="number" min={0} step="any" aria-label={`${k === "min" ? "Minimum" : "Maximum"} of ${r.name}`} disabled={!data.mayEdit} value={v[k]} onChange={(x) => setEdit({ ...edit, [key(r)]: { ...v, [k]: Number(x.target.value) } })} className="num h-8 w-20 rounded-full border border-line bg-paper px-2.5 text-end text-sm hover:border-fog disabled:border-transparent disabled:bg-transparent" />;
                      return (
                        <tr key={key(r)} className={rowClass}>
                          <Td><span className="text-ink">{r.name}</span><span className="block text-xs text-steel">{r.supplierName}, {r.packLabel.toLowerCase()}</span>{r.below && <Badge tone="warn" className="mt-1">Below minimum</Badge>}</Td>
                          <Td align="right">{qtyText(r.onHand)} <span className="text-xs text-steel">{r.unit}</span></Td>
                          <Td align="right">{input("min")}</Td>
                          <Td align="right">{input("max")}{e && <span className="mt-1 flex justify-end gap-2"><button type="button" className={textLink} disabled={busy || v.max < v.min} onClick={() => save(r, v)}>Save</button><button type="button" className="text-[13px] text-steel underline-offset-4 hover:underline" onClick={() => setEdit((x) => { const n = { ...x }; delete n[key(r)]; return n; })}>Cancel</button></span>}{e && v.max < v.min && <span className="block text-xs text-neg">Maximum below minimum</span>}</Td>
                          <Td align="right"><span className="text-graphite">{qtyText(r.suggested.min)} / {qtyText(r.suggested.max)}</span>{data.mayEdit && (r.suggested.min !== r.min || r.suggested.max !== r.max) && <button type="button" className={cn(textLink, "block w-full justify-end")} onClick={() => save(r, r.suggested)} disabled={busy}>Use</button>}</Td>
                          <Td className="text-xs text-steel">{r.source === "seed" ? "Starting level" : r.source === "suggested" ? "From the suggestion" : "Set by hand"}</Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableWrap>
            )}
            <Note className="px-6 py-4">The suggestion comes from the prediction: average daily use over four weeks, times the supplier&rsquo;s lead time plus one day of safety for the minimum, plus one delivery cycle for the maximum. Outlets: one day of use, topped up to two and a half. Par levels work on their own; the suggestion changes nothing until someone uses it.</Note>
          </Panel>
        </>
      )}
    </div>
  );
}
