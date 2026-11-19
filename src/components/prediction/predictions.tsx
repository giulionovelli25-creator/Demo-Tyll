"use client";
// Predictions: what to order and how much, for the rest of the month. How it was worked out is one click away.
import dynamic from "next/dynamic";
import Link from "next/link";
import { AlertTriangle, Minus, Plus, Search } from "lucide-react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { Section, useRemembered } from "@/components/disclosure";
import { Button, Drawer, EmptyState, Note, PageHeader, Panel, Segmented, Skeleton, StatusPill, SummaryBar, TableWrap, Td, Th, WidgetError, cn, linkButton, rowClass, textLink, toast, useSort, type Rag } from "@/components/ui";
import { api } from "@/lib/api";
import { useAlertFeed } from "@/lib/alert-feed";
import { ingredientById, propertyById } from "@/lib/data/catalog";
import { supplierName } from "@/lib/data/purchasing-rules";
import { STOCK_AREAS, stockAreaOf, type StockArea } from "@/lib/data/locations";
import { can } from "@/lib/domain/access";
import type { ConfidenceLevel } from "@/lib/domain/planning";
import { useLiveGet } from "@/lib/guest-hooks";
import { useCtx, useSessionEntries, useView } from "@/lib/hooks";
import { StripTrend } from "@/components/charts";
import { useDailyTotals } from "@/lib/strip-data";
import { usePilot } from "@/lib/pilot";
import { useAutoOrder, usePlanDrafts } from "@/lib/plan-hooks";
import { reviewReason } from "@/lib/domain/auto-order";
export { reviewReason };
import type { MonthPlanOut, PlanItem } from "@/lib/server/purchasing";
import type { PurchaseRequest } from "@/lib/types";
import { DEMO_TODAY, addDays, eachDay, unitLabel, fmtDate, fmtMoney, fmtNum, fmtPct, fmtQty, sum } from "@/lib/util";

const CategoryChart = dynamic(() => import("@/components/stock/category-charts").then((m) => m.CategoryChart), { ssr: false, loading: () => <Skeleton className="h-[216px] w-full" /> });

const CONF: Record<ConfidenceLevel, { rag: Rag; word: string }> = { high: { rag: "green", word: "High" }, medium: { rag: "amber", word: "Medium" }, low: { rag: "red", word: "Low" } };
const FIRST = 5;

const name = (i: { ingredientId: string }) => ingredientById[i.ingredientId].name;

function InputRow({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="border-t border-hair py-2 first:border-t-0 first:pt-0">
      <div className="flex items-baseline justify-between gap-3 text-table"><dt className="text-graphite">{label}</dt><dd className="num font-medium text-ink">{value}</dd></div>
      {note && <p className="mt-0.5 text-xs text-steel">{note}</p>}
    </div>
  );
}

function Inputs({ plan }: { plan: MonthPlanOut }) {
  const i = plan.inputs;
  const money = (n: number) => fmtMoney(n, propertyById[plan.propertyId].currency, { compact: true });
  return (
    <Panel title="What the prediction uses" description={`${fmtDate(plan.period.from)} to ${fmtDate(plan.period.to)}, the whole hotel.`}>
      <dl>
        <InputRow label="Hotel occupancy" value={i.occupancy.nights ? `${fmtNum(i.occupancy.minGuests)} to ${fmtNum(i.occupancy.maxGuests)}` : "Not available"} note={i.occupancy.nights ? `In-house guests a night for the next ${i.occupancy.nights} nights (${fmtPct(i.occupancy.minRate, 0)} to ${fmtPct(i.occupancy.maxRate, 0)} of rooms), from the PMS. Breakfast and in-room dining follow it. Simulated.` : "Connect the PMS to use it."} />
        <InputRow label="Forecast covers" value={fmtNum(i.covers)} note={`${fmtNum(i.bookings)} booked or usually booked, ${fmtNum(i.walkIns)} walk ins, ${fmtNum(i.eventGuests)} from events`} />
        <InputRow label="Events" value={String(i.events.length)} note={i.events.length ? i.events.map((e) => `${e.name}, ${fmtDate(e.date)}, ${e.attendance} guests`).join("; ") : "No confirmed events this month"} />
        <InputRow label="Last 4 weeks usage" value={money(i.lastFourWeeksValue)} note={`Predicted use to month end: ${money(i.predictedValue)}`} />
      </dl>
      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-hair pt-3 text-table">
        <span className="text-graphite">Confidence</span>
        <StatusPill rag={CONF[i.confidence].rag}>{CONF[i.confidence].word}</StatusPill>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-steel">The same weekdays have moved about {fmtPct(i.swing, 0)} over the last 4 weeks, and {fmtPct(i.bookedShare, 0)} of guests are already booked. Within 10% is high, within 20% is medium.</p>
    </Panel>
  );
}

function OrderBy({ r }: { r: PlanItem }) {
  return <span className={r.orderBy === DEMO_TODAY ? "font-medium text-neg" : "text-ink"}>{r.orderBy === DEMO_TODAY ? "Today" : fmtDate(r.orderBy!, true)}</span>;
}

/** Quantities changed by hand before the order is built, kept in this browser until the order is built. */
export const usePlanEdits = create<{ qty: Record<string, number>; set(id: string, q: number | null): void; clear(): void }>()(
  persist((set) => ({
    qty: {},
    set: (id, q) => set((s) => { const next = { ...s.qty }; if (q === null) delete next[id]; else next[id] = q; return { qty: next }; }),
    clear: () => set({ qty: {} }),
  }), { name: "tyll-plan-edits-v1" }),
);

const daysLeft = (plan: MonthPlanOut) => Math.max(1, eachDay({ from: addDays(DEMO_TODAY, 1), to: plan.period.to }).length);

/** The figures behind one recommendation, with the manager's quantity if they changed it. */
function useRec(r: PlanItem, plan: MonthPlanOut) {
  const edited = usePlanEdits((s) => s.qty[r.ingredientId]);
  const suggested = r.nextQty > 0 ? r.nextQty : r.orderQty;
  const qty = edited ?? suggested;
  const perDay = r.predicted / daysLeft(plan);
  const start = r.orderBy && r.orderBy > DEMO_TODAY ? r.orderBy : DEMO_TODAY;
  return {
    edited, suggested, qty,
    step: r.unit === "kg" || r.unit === "l" ? 0.5 : 1,
    avg: Math.round((r.lastFourWeeks / 28) * 10) / 10,
    arrives: addDays(start, r.leadDays),
    covers: perDay > 0 ? qty / perDay : null,
    review: reviewReason(r, qty, plan),
  };
}

function QtyEditor({ r, qty, step }: { r: PlanItem; qty: number; step: number }) {
  const setQty = usePlanEdits((s) => s.set);
  return (
    <div className="flex items-center justify-end gap-1" role="group" aria-label={`Quantity of ${name(r)}`}>
      <button type="button" aria-label="Less" onClick={() => setQty(r.ingredientId, Math.max(0, Math.round((qty - step) * 10) / 10))} className="flex h-8 w-8 items-center justify-center rounded-full border border-line text-ink hover:bg-cloud"><Minus size={14} aria-hidden /></button>
      <label className="flex h-8 items-center gap-1 rounded-full border border-line px-2.5">
        <span className="sr-only">Order quantity in {r.unit}</span>
        <input type="number" inputMode="decimal" min={0} step={step} value={qty} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0) setQty(r.ingredientId, v); }} className="num w-14 bg-transparent text-end text-sm font-medium text-ink outline-none" />
        <span className="w-8 text-xs text-steel">{unitLabel(r.unit)}</span>
      </label>
      <button type="button" aria-label="More" onClick={() => setQty(r.ingredientId, Math.round((qty + step) * 10) / 10)} className="flex h-8 w-8 items-center justify-center rounded-full border border-line text-ink hover:bg-cloud"><Plus size={14} aria-hidden /></button>
    </div>
  );
}

function Notes({ r, x }: { r: PlanItem; x: ReturnType<typeof useRec> }) {
  const setQty = usePlanEdits((s) => s.set);
  return (
    <>
      {x.edited !== undefined && x.edited !== x.suggested && <p className="mt-1 text-xs text-steel">Changed from the suggested {fmtQty(x.suggested, r.unit)}. <button type="button" onClick={() => setQty(r.ingredientId, null)} className="font-medium text-accent-ink underline-offset-4 hover:underline">Use the suggestion</button></p>}
      {x.review && <p className="mt-1 flex items-start gap-1.5 text-xs text-warn"><AlertTriangle size={13} className="mt-px shrink-0" aria-hidden /><span><span className="font-medium">Manager review:</span> {x.review}.</span></p>}
    </>
  );
}

function RecTr({ r, plan, edit }: { r: PlanItem; plan: MonthPlanOut; edit: boolean }) {
  const x = useRec(r, plan);
  const money = (n: number) => fmtMoney(n, propertyById[plan.propertyId].currency);
  return (
    <tr className={rowClass}>
      <Td><span className="text-ink">{name(r)}</span><span className="block text-xs text-steel">Order by <OrderBy r={r} /></span><Notes r={r} x={x} /></Td>
      <Td align="right">{fmtQty(x.avg, r.unit)}</Td>
      <Td align="right">{fmtQty(r.onHand, r.unit)}{r.incoming > 0 && <span className="block text-xs text-steel">{fmtQty(r.incoming, r.unit)} coming</span>}</Td>
      <Td align="right">{fmtDate(x.arrives, true)}</Td>
      <Td align="right">{x.covers === null ? "Not used lately" : `${fmtNum(x.covers, x.covers < 10 ? 1 : 0)} days`}</Td>
      <Td align="right">{edit ? <QtyEditor r={r} qty={x.qty} step={x.step} /> : <span className="font-medium text-ink">{fmtQty(x.qty, r.unit)}</span>}</Td>
      <Td align="right"><span className="text-ink">{money(x.qty * r.unitPrice)}</span></Td>
    </tr>
  );
}

function RecCard({ r, plan, edit }: { r: PlanItem; plan: MonthPlanOut; edit: boolean }) {
  const x = useRec(r, plan);
  const money = (n: number) => fmtMoney(n, propertyById[plan.propertyId].currency);
  return (
    <li className="border-t border-hair px-4 py-3">
      <div className="flex items-baseline justify-between gap-2"><span className="text-sm font-medium text-ink">{name(r)}</span><span className="num text-sm text-ink">{money(x.qty * r.unitPrice)}</span></div>
      <p className="mt-1 text-xs text-steel">Uses {fmtQty(x.avg, r.unit)} a day. {fmtQty(r.onHand, r.unit)} in stock. Arrives {fmtDate(x.arrives, true)}. Covers {x.covers === null ? "no recent use" : `${fmtNum(x.covers, 0)} days`}.</p>
      <div className="mt-2">{edit ? <QtyEditor r={r} qty={x.qty} step={x.step} /> : <span className="num text-sm font-medium text-ink">{fmtQty(x.qty, r.unit)}</span>}</div>
      <Notes r={r} x={x} />
    </li>
  );
}

/** Recommended items grouped by supplier, the way orders are placed, with a total per supplier. One header row for the whole table. */
function RecTable({ rows, plan, edit }: { rows: PlanItem[]; plan: MonthPlanOut; edit: boolean }) {
  const edits = usePlanEdits((s) => s.qty);
  const money = (n: number) => fmtMoney(n, propertyById[plan.propertyId].currency);
  const qtyOf = (r: PlanItem) => edits[r.ingredientId] ?? (r.nextQty > 0 ? r.nextQty : r.orderQty);
  const groups = [...new Set(rows.map((r) => r.supplierId))].map((supplierId) => {
    const list = rows.filter((r) => r.supplierId === supplierId);
    return { supplierId, list, total: sum(list, (r) => qtyOf(r) * r.unitPrice) };
  }).sort((a, b) => b.total - a.total);
  const head = (g: (typeof groups)[number]) => <><span className="font-semibold text-ink">{supplierName(g.supplierId)}</span><span className="ms-2 text-steel">{g.list.length} {g.list.length === 1 ? "item" : "items"}</span></>;
  return (
    <>
      <ul className="md:hidden">
        {groups.map((g) => <Fragment key={g.supplierId}><li className="flex justify-between border-t border-hair bg-cloud px-4 py-2 text-[13px]"><span>{head(g)}</span><span className="num font-semibold text-ink">{money(g.total)}</span></li>{g.list.map((r) => <RecCard key={r.ingredientId} r={r} plan={plan} edit={edit} />)}</Fragment>)}
      </ul>
      <TableWrap className="hidden md:block">
        <table className="w-full min-w-[820px] text-table">
          <thead><tr><Th>Item</Th><Th align="right">Uses a day</Th><Th align="right">In stock</Th><Th align="right">Would arrive</Th><Th align="right">Order covers</Th><Th align="right">Order</Th><Th align="right">Cost</Th></tr></thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.supplierId}>
                <tr className="border-t border-hair bg-cloud"><td colSpan={6} className="px-5 py-2 text-[13px] sm:px-6">{head(g)}</td><td className="num px-5 py-2 text-end text-[13px] font-semibold text-ink sm:px-6">{money(g.total)}</td></tr>
                {g.list.map((r) => <RecTr key={r.ingredientId} r={r} plan={plan} edit={edit} />)}
              </Fragment>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </>
  );
}

function AllRecommended({ rows, plan, edit }: { rows: PlanItem[]; plan: MonthPlanOut; edit: boolean }) {
  const [area, setArea] = useRemembered<StockArea>("predictions.area", "food");
  const [q, setQ] = useState("");
  const { sort, toggle } = useSort<"name" | "cost" | "orderBy">({ key: "orderBy", dir: "asc" });
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => stockAreaOf(r.ingredientId) === area && (!term || name(r).toLowerCase().includes(term))).sort((a, b) => {
      const d = sort.key === "cost" ? a.cost - b.cost : sort.key === "name" ? name(a).localeCompare(name(b)) : (a.orderBy ?? "").localeCompare(b.orderBy ?? "");
      return (sort.dir === "asc" ? d : -d) || b.cost - a.cost;
    });
  }, [rows, area, q, sort]);
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 p-4 sm:px-6">
        <Segmented label="Part of the order" value={area} onChange={setArea} options={STOCK_AREAS.map((a) => ({ value: a.id, label: a.name }))} />
        <div className="relative ms-auto w-full sm:w-[220px]">
          <Search size={15} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-steel" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an item" aria-label="Find an item" className="h-10 w-full rounded-full border border-line bg-paper ps-9 pe-3 text-sm text-ink placeholder:text-steel" />
        </div>
      </div>
      <div className="flex flex-wrap gap-2 px-4 pb-3 text-[13px] text-steel sm:px-6">
        Sort by
        {([["orderBy", "Order date"], ["cost", "Cost"], ["name", "Name"]] as const).map(([k, label]) => <button key={k} type="button" onClick={() => toggle(k, k === "cost" ? "desc" : "asc")} className={cn("underline-offset-4 hover:underline", sort.key === k && "font-medium text-accent-ink")}>{label}</button>)}
      </div>
      {shown.length === 0 ? <div className="px-4 pb-6 sm:px-6"><EmptyState title="Nothing to order here">{q ? "Try another name." : "This part of stock covers the month."}</EmptyState></div> : <RecTable rows={shown} plan={plan} edit={edit} />}
    </>
  );
}

export function Predictions({ tabs }: { tabs?: ReactNode } = {}) {
  const { user, money } = useView();
  const { plan, error, propertyId } = useAlertFeed();
  const entries = useSessionEntries();
  const bump = usePlanDrafts((s) => s.bump);
  const { data } = useLiveGet<{ requests: PurchaseRequest[] }>("/api/purchasing");
  const [busy, setBusy] = useState(false);
  const [built, setBuilt] = useState<{ request: PurchaseRequest; requests: PurchaseRequest[]; warnings: string[]; lines: number; total: number } | null>(null);
  const mayBuild = can(user, "purchase.create");
  const local = (n: number) => fmtMoney(n, propertyById[propertyId ?? "lis"].currency);
  const edits = usePlanEdits((s) => s.qty);
  const clearEdits = usePlanEdits((s) => s.clear);
  const earnPilot = usePilot((s) => s.earn);

  const build = async () => {
    setBusy(true);
    try {
      const r = await api<{ request: PurchaseRequest; requests: PurchaseRequest[]; warnings: string[]; lines: number; total: number }>("/api/plan/month", { method: "POST", body: { action: "build", propertyId, quantities: edits, ...entries } });
      clearEdits();
      setBuilt(r);
      bump();
      earnPilot();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The order could not be built. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const rows = useMemo(() => (plan?.items ?? []).filter((i) => i.orderQty > 0).sort((a, b) => (a.orderBy ?? "").localeCompare(b.orderBy ?? "") || b.cost - a.cost), [plan]);
  const groups = useMemo(() => (built?.requests ?? []).map((r) => ({ id: r.id, supplierId: r.supplierId ?? r.lines[0]?.supplierId ?? "", deliveryDate: r.deliveryDate, lines: r.lines, total: sum(r.lines, (l) => l.qty * l.unitPrice) })).sort((a, b) => b.total - a.total), [built]);
  const requests = data?.requests ?? [];
  const next = rows[0]?.orderBy;
  const dueToday = rows.filter((r) => r.orderBy === DEMO_TODAY && r.nextQty > 0);
  const myDrafts = requests.filter((r) => r.status === "draft" && r.createdBy === user.id && r.supplierId);
  const ctx = useCtx();
  const daily = useDailyTotals(30, plan?.propertyId);
  const critical = plan?.items.filter((i) => i.health === "critical").length ?? 0;
  const atRisk = critical + (plan?.items.filter((i) => i.health === "low").length ?? 0);
  const confirmed = ctx.data.deliveries.filter((d) => d.propertyId === plan?.propertyId && d.status === "expected").sort((a, b) => a.date.localeCompare(b.date));
  const nextDelivery = confirmed[0];
  const usage = useMemo(() => {
    const past = daily.map(({ date, t }) => ({ date, value: Math.round(t.theoCost + t.waste + t.breakage) as number | null, predicted: null as number | null }));
    if (!plan) return past;
    // Predicted use is held as a running total per category; one day's use is the step from the day before.
    const cum = new Map<string, number>();
    for (const c of plan.categories) for (const p of c.points) cum.set(p.date, (cum.get(p.date) ?? 0) + p.used);
    const dates = [...cum.keys()].filter((d) => d > DEMO_TODAY).sort();
    const future = dates.map((date, i) => ({ date, value: null, predicted: Math.round(cum.get(date)! - (i ? cum.get(dates[i - 1])! : cum.get(DEMO_TODAY) ?? 0)) }));
    // Purchasing roles get no sales, so they have no past use to show: the trend is then the prediction alone.
    if (!past.some((p) => (p.value ?? 0) > 0)) return future;
    if (past.length) past[past.length - 1].predicted = past[past.length - 1].value;
    return [...past, ...future];
  }, [daily, plan]);
  const autoOrder = useAutoOrder(mayBuild && plan ? plan.propertyId : null).data?.auto;
  const [allOpen, setAllOpen] = useState(false);
  const openAll = () => { setAllOpen(true); requestAnimationFrame(() => document.getElementById("all-recommended")?.scrollIntoView({ block: "start", behavior: "smooth" })); };

  return (
    <div className="space-y-6">
      <PageHeader title="Predictions" question="What do I need to order?" lead="Tyll's own forecasting model works out every quantity from sales history, bookings, events, hotel occupancy and current stock. No AI chooses a quantity. Simulated data." />
      {error ? <WidgetError>The stock prediction could not load.</WidgetError> : !plan ? (
        <div className="space-y-4" aria-busy><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div>
      ) : (
        <>
          <SummaryBar
            items={[
              { label: "Recommended order value", value: local(sum(rows, (r) => r.cost)), tone: "money", compare: { text: `To ${fmtDate(plan.period.to)}, after stock on hand`, good: null }, onClick: () => openAll() },
              { label: "Items to reorder", value: rows.length, compare: { text: dueToday.length ? `${dueToday.length} to order today` : next ? `Next order ${fmtDate(next)}` : "Nothing due", good: null }, onClick: () => openAll() },
              { label: "At risk of running out", value: atRisk, tone: critical ? "neg" : atRisk ? "warn" : "pos", compare: { text: critical ? `${critical} critical` : "None critical", good: critical ? false : null }, href: critical ? "/stock?show=critical" : "/stock?show=low" },
              { label: "Next delivery", value: nextDelivery ? fmtDate(nextDelivery.date, true) : "None booked", compare: { text: nextDelivery ? `${confirmed.length} ${confirmed.length === 1 ? "delivery" : "deliveries"} confirmed` : "Order to book one", good: null }, href: "/stock?tab=suppliers" },
            ]}
            trend={<StripTrend goodWhen="none" title={usage.some((u) => u.value !== null) ? "Stock used per day, then predicted" : `Predicted stock use per day to ${fmtDate(plan.period.to)}`} points={usage} format={local} summary={`Stock used per day at cost over the last 30 days, then predicted use per day to month end.`} note="at cost" />}
            action={mayBuild ? (
              <>
                <Button variant="primary" onClick={build} disabled={busy || rows.length === 0}>{busy ? "Building…" : myDrafts.length ? "Update draft orders" : "Build orders"}</Button>
                {myDrafts.length > 0 && <Link prefetch={false} href="/forecast?tab=approvals&queue=drafts" className={cn(textLink, "mt-3 justify-center")}>{myDrafts.length} draft {myDrafts.length === 1 ? "order" : "orders"} in Orders</Link>}
              </>
            ) : undefined}
          />
          {tabs}
          {autoOrder?.settings.on && (
            <p className="rounded-panel border border-line bg-paper px-5 py-3 text-[13px] text-graphite shadow-panel sm:px-6">
              <span className="font-medium text-ink">Automatic ordering is on.</span> Every morning at {autoOrder.settings.time} Tyll orders the items due that day or the next{autoOrder.orders.length ? `; this morning it placed ${autoOrder.orders.length} ${autoOrder.orders.length === 1 ? "order" : "orders"}, so they no longer show here` : ""}. Find them under Automatic ordering in the menu.
            </p>
          )}
          <section id="order" className="scroll-mt-24">
            <Panel title={dueToday.length ? `Order today: ${dueToday.length} ${dueToday.length === 1 ? "item" : "items"}, ${local(sum(dueToday, (r) => r.nextCost))}` : "Order these first"} flush>
              {rows.length === 0 ? <div className="px-4 pb-6 sm:px-6"><EmptyState title="Nothing to order">Stock covers the month.</EmptyState></div> : (
                <>
                  <RecTable rows={(dueToday.length ? dueToday : rows).slice(0, dueToday.length ? undefined : FIRST)} plan={plan} edit={mayBuild} />
                </>
              )}
            </Panel>
          </section>
          {rows.length > FIRST && (
            <div id="all-recommended" className="scroll-mt-24"><Section id="predictions.all" forceOpen={allOpen} title={`Show all ${rows.length} recommended items`} summary={`${rows.filter((r) => stockAreaOf(r.ingredientId) === "food").length} food, ${rows.filter((r) => stockAreaOf(r.ingredientId) === "drinks").length} beverage, ${rows.filter((r) => stockAreaOf(r.ingredientId) === "inventory").length} inventory`} flush>
              <AllRecommended rows={rows} plan={plan} edit={mayBuild} />
            </Section></div>
          )}
          <Section id="predictions.how" title="How this is calculated" summary={`${plan.inputs.occupancy.nights ? `${fmtNum(plan.inputs.occupancy.minGuests)} to ${fmtNum(plan.inputs.occupancy.maxGuests)} in-house guests a night, ` : ""}${fmtNum(plan.inputs.covers)} forecast covers, ${plan.inputs.events.length} ${plan.inputs.events.length === 1 ? "event" : "events"}, last 4 weeks of usage. Confidence ${CONF[plan.inputs.confidence].word.toLowerCase()}.`}>
            <p className="text-[13px] text-steel">Predicted use from hotel occupancy, forecast covers and events, plus a safe buffer of 2 days, less what you have and what is on the way. Simulated data. Build order puts food, drinks and inventory into one draft.</p>
            <Inputs plan={plan} />
            <Panel title="Monthly view" description="Where predicted use passes stock, the shelf is empty without a new order. The dashed line is the date to order by.">
              <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-graphite">
                <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-accent-ink" aria-hidden />Stock and deliveries</span>
                <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-[var(--chart-b)]" aria-hidden />Predicted use</span>
                <span className="flex items-center gap-1.5"><span className="h-0 w-4 border-t-2 border-dashed border-neg" aria-hidden />Reorder date</span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {plan.categories.map((c) => <CategoryChart key={c.id} category={c} money={(n) => money(n)} />)}
              </div>
            </Panel>
          </Section>
        </>
      )}

      <Drawer open={!!built} onClose={() => setBuilt(null)} title={built ? `${groups.length} draft purchase ${groups.length === 1 ? "order" : "orders"}` : ""} description={built ? `${built.lines} items, ${local(built.total)} before VAT, one order per supplier. Nothing is sent until it is approved.` : undefined}>
        {built && (
          <div className="space-y-6">
            {built.warnings.length > 0 && <div className="rounded-2xl border border-warn/30 bg-warn-soft px-4 py-3 text-[13px] text-ink"><p className="font-medium">To check</p><ul className="mt-1 list-disc space-y-1 ps-5 text-graphite">{built.warnings.map((w) => <li key={w}>{w}</li>)}</ul></div>}
            {groups.map((g) => (
              <section key={g.id}>
                <div className="flex items-baseline justify-between gap-3 border-b border-line pb-2"><h3 className="text-[15px] font-medium text-ink">{supplierName(g.supplierId)} <Link prefetch={false} href={`/forecast?tab=approvals&request=${g.id}`} className="ms-2 text-[13px] font-normal text-accent-ink underline-offset-4 hover:underline">{g.id}</Link></h3><span className="num text-sm text-ink">{local(g.total)}</span></div>
                {g.deliveryDate && <p className="pt-1 text-xs text-steel">Delivery {fmtDate(g.deliveryDate, true)}</p>}
                <ul className="mt-1">
                  {g.lines.map((l) => {
                    const it = ingredientById[l.ingredientId];
                    return <li key={l.ingredientId} className="flex items-baseline justify-between gap-3 py-1.5 text-table"><span className="text-graphite">{it.name}</span><span className="num shrink-0 text-ink">{fmtQty(l.qty, it.unit)}</span></li>;
                  })}
                </ul>
              </section>
            ))}
            <Link prefetch={false} href="/forecast?tab=approvals&queue=drafts" className={cn(linkButton("primary"), "w-full")}>Open the drafts in Orders</Link>
            <Note>Quantities are rounded up to each supplier&rsquo;s packs. Fresh items keep only a few days, so these drafts cover their next delivery. Building again updates the same drafts.</Note>
          </div>
        )}
      </Drawer>
    </div>
  );
}
