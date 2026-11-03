"use client";
// Predictions: what to order and how much, for the rest of the month. How it was worked out is one click away.
import dynamic from "next/dynamic";
import Link from "next/link";
import { Search } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { Section, SectionLink, useRemembered } from "@/components/disclosure";
import { Button, Drawer, EmptyState, Note, PageHeader, Panel, Segmented, Skeleton, StatusPill, SummaryBar, TableWrap, Td, Th, WidgetError, cn, linkButton, rowClass, textLink, toast, useSort, type Rag } from "@/components/ui";
import { api } from "@/lib/api";
import { useAlertFeed } from "@/lib/alert-feed";
import { ingredientById, propertyById } from "@/lib/data/catalog";
import { supplierName } from "@/lib/data/purchasing-rules";
import { STOCK_AREAS, groupByStock, stockAreaOf, type StockArea } from "@/lib/data/locations";
import { can } from "@/lib/domain/access";
import type { ConfidenceLevel } from "@/lib/domain/planning";
import { useLiveGet } from "@/lib/guest-hooks";
import { useSessionEntries, useView } from "@/lib/hooks";
import { usePlanDrafts } from "@/lib/plan-hooks";
import type { MonthPlanOut, PlanItem } from "@/lib/server/purchasing";
import type { PurchaseRequest } from "@/lib/types";
import { DEMO_TODAY, fmtDate, fmtMoney, fmtNum, fmtPct, fmtQty, sum } from "@/lib/util";

const CategoryChart = dynamic(() => import("@/components/stock/category-charts").then((m) => m.CategoryChart), { ssr: false, loading: () => <Skeleton className="h-[216px] w-full" /> });

const CONF: Record<ConfidenceLevel, { rag: Rag; word: string }> = { high: { rag: "green", word: "High" }, medium: { rag: "amber", word: "Medium" }, low: { rag: "red", word: "Low" } };
const FIRST = 5;
const WAITING: PurchaseRequest["status"][] = ["purchasing", "accounting", "manager"];

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

function ItemList({ rows, plan }: { rows: PlanItem[]; plan: MonthPlanOut }) {
  const money = (n: number) => fmtMoney(n, propertyById[plan.propertyId].currency);
  const end = fmtDate(plan.period.to);
  const groups = groupByStock(rows, (r) => r.ingredientId);
  const Split = ({ r }: { r: PlanItem }) => (r.deliveries > 1 ? <span className="block text-xs text-steel">Keeps {r.shelfLifeDays} days: {r.deliveries} deliveries, next {fmtQty(r.nextQty, r.unit)}</span> : null);
  return (
    <>
      <ul className="md:hidden">
        {groups.map((g) => <Fragment key={g.id}><li className="border-t border-hair bg-cloud px-4 py-2 text-[13px] font-semibold text-ink">{g.name}</li>{g.rows.map((r) => (
          <li key={r.ingredientId} className="border-t border-hair px-4 py-3">
            <div className="flex items-baseline justify-between gap-2"><span className="text-sm font-medium text-ink">{name(r)}</span><span className="num shrink-0 text-sm font-medium text-ink">{fmtQty(r.orderQty, r.unit)}</span></div>
            <p className="mt-1 text-xs text-steel">Order by <OrderBy r={r} />. Cost {money(r.cost)}. Use to {end}: {fmtQty(r.predicted, r.unit)}.</p>
            <Split r={r} />
          </li>
        ))}</Fragment>)}
      </ul>
      <TableWrap className="hidden md:block">
        <table className="w-full min-w-[560px] text-table">
          <thead><tr><Th>Item</Th><Th align="right">Predicted use</Th><Th align="right">Have and coming</Th><Th align="right">Order</Th><Th align="right">Cost</Th><Th>Order by</Th></tr></thead>
          <tbody>
            {groups.map((g) => <Fragment key={g.id}><tr><td colSpan={6} className="border-t border-hair bg-cloud px-5 py-2 text-[13px] font-semibold text-ink sm:px-6">{g.name}</td></tr>{g.rows.map((r) => (
              <tr key={r.ingredientId} className={rowClass}>
                <Td><span className="text-ink">{name(r)}</span><span className="block text-xs text-steel">{supplierName(r.supplierId)}</span></Td>
                <Td align="right">{fmtQty(r.predicted, r.unit)}<span className="block text-xs text-steel">last 4 weeks {fmtQty(r.lastFourWeeks, r.unit)}</span></Td>
                <Td align="right">{fmtQty(r.onHand + r.incoming, r.unit)}</Td>
                <Td align="right"><span className="font-medium text-ink">{fmtQty(r.orderQty, r.unit)}</span><Split r={r} /></Td>
                <Td align="right">{money(r.cost)}</Td>
                <Td><OrderBy r={r} /></Td>
              </tr>
            ))}</Fragment>)}
          </tbody>
        </table>
      </TableWrap>
    </>
  );
}

function AllRecommended({ rows, plan }: { rows: PlanItem[]; plan: MonthPlanOut }) {
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
        <div className="relative ml-auto w-full sm:w-[220px]">
          <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-steel" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an item" aria-label="Find an item" className="h-10 w-full rounded-full border border-line bg-paper pl-9 pr-3 text-sm text-ink placeholder:text-steel" />
        </div>
      </div>
      <div className="flex flex-wrap gap-2 px-4 pb-3 text-[13px] text-steel sm:px-6">
        Sort by
        {([["orderBy", "Order date"], ["cost", "Cost"], ["name", "Name"]] as const).map(([k, label]) => <button key={k} type="button" onClick={() => toggle(k, k === "cost" ? "desc" : "asc")} className={cn("underline-offset-4 hover:underline", sort.key === k && "font-medium text-accent-ink")}>{label}</button>)}
      </div>
      {shown.length === 0 ? <div className="px-4 pb-6 sm:px-6"><EmptyState title="Nothing to order here">{q ? "Try another name." : "This part of stock covers the month."}</EmptyState></div> : <ItemList rows={shown} plan={plan} />}
    </>
  );
}

export function Predictions() {
  const { user, money } = useView();
  const { plan, error, propertyId } = useAlertFeed();
  const entries = useSessionEntries();
  const bump = usePlanDrafts((s) => s.bump);
  const { data } = useLiveGet<{ requests: PurchaseRequest[] }>("/api/purchasing");
  const [busy, setBusy] = useState(false);
  const [built, setBuilt] = useState<{ request: PurchaseRequest; lines: number; total: number } | null>(null);
  const mayBuild = can(user, "purchase.create");
  const local = (n: number) => fmtMoney(n, propertyById[propertyId ?? "dxb"].currency);

  const build = async () => {
    setBusy(true);
    try {
      const r = await api<{ request: PurchaseRequest; lines: number; total: number }>("/api/plan/month", { method: "POST", body: { action: "build", propertyId, ...entries } });
      setBuilt(r);
      bump();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The order could not be built. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const rows = useMemo(() => (plan?.items ?? []).filter((i) => i.orderQty > 0).sort((a, b) => (a.orderBy ?? "").localeCompare(b.orderBy ?? "") || b.cost - a.cost), [plan]);
  const groups = useMemo(() => {
    if (!built) return [];
    const m = new Map<string, PurchaseRequest["lines"]>();
    for (const l of built.request.lines) m.set(l.supplierId, [...(m.get(l.supplierId) ?? []), l]);
    return [...m].map(([supplierId, lines]) => ({ supplierId, lines, total: sum(lines, (l) => l.qty * l.unitPrice) })).sort((a, b) => b.total - a.total);
  }, [built]);
  const requests = data?.requests ?? [];
  const waiting = requests.filter((r) => WAITING.includes(r.status)).length;
  const onTheWay = requests.filter((r) => r.status === "approved").length;
  const next = rows[0]?.orderBy;
  const dueToday = rows.filter((r) => r.orderBy === DEMO_TODAY && r.nextQty > 0);
  const draft = built?.request ?? requests.find((r) => r.status === "draft" && r.createdBy === user.id);

  return (
    <div className="space-y-4">
      <PageHeader title="Predictions" question="What do I need to order?" lead="An estimate from forecast covers, events and recent use. Simulated data." />
      {error ? <WidgetError>The stock prediction could not load.</WidgetError> : !plan ? (
        <div className="space-y-4" aria-busy><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div>
      ) : (
        <>
          <SummaryBar
            items={[
              { label: `Cost to ${fmtDate(plan.period.to)}`, value: fmtMoney(sum(rows, (r) => r.cost), propertyById[plan.propertyId].currency, { compact: true }), tone: "money" },
              { label: "Items to order", value: rows.length },
              { label: "Next order", value: next ? (next === DEMO_TODAY ? "Today" : fmtDate(next)) : "None", tone: next === DEMO_TODAY ? "neg" : undefined },
            ]}
            action={mayBuild ? (
              <>
                <Button variant="primary" onClick={build} disabled={busy || rows.length === 0}>{busy ? "Building…" : draft ? "Update draft order" : "Build order"}</Button>
                {draft && <Link href={`/forecast?tab=approvals&request=${draft.id}`} className={cn(textLink, "mt-3 justify-center")}>Open draft {draft.id}</Link>}
              </>
            ) : undefined}
          />
          <section id="order" className="scroll-mt-24">
            <Panel title={dueToday.length ? `Order today: ${dueToday.length} ${dueToday.length === 1 ? "item" : "items"}, ${local(sum(dueToday, (r) => r.nextCost))}` : "Order these first"} flush>
              {rows.length === 0 ? <div className="px-4 pb-6 sm:px-6"><EmptyState title="Nothing to order">Stock covers the month.</EmptyState></div> : (
                <>
                  {STOCK_AREAS.filter((area) => (dueToday.length ? dueToday : rows).slice(0, FIRST).some((r) => stockAreaOf(r.ingredientId) === area.id)).map((area) => (
                    <div key={area.id}>
                      <h3 className="border-t border-hair bg-cloud px-4 py-1.5 text-xs font-semibold text-ink sm:px-6">{area.name}</h3>
                      <ul>
                        {(dueToday.length ? dueToday : rows).slice(0, FIRST).filter((r) => stockAreaOf(r.ingredientId) === area.id).map((r) => (
                          <li key={r.ingredientId} className="flex flex-col gap-0.5 border-t border-hair px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-6">
                            <span className="text-sm font-medium text-ink">{name(r)}</span>
                            <span className="num text-table text-graphite">{r.orderBy === DEMO_TODAY ? `${fmtQty(r.nextQty, r.unit)} now, ${local(r.nextCost)}` : `${fmtQty(r.orderQty, r.unit)}, ${local(r.cost)}, by ${fmtDate(r.orderBy!, true)}`}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </>
              )}
            </Panel>
          </section>
          {rows.length > FIRST && (
            <Section id="predictions.all" title={`Show all ${rows.length} recommended items`} summary={`${rows.filter((r) => stockAreaOf(r.ingredientId) === "food").length} food, ${rows.filter((r) => stockAreaOf(r.ingredientId) === "drinks").length} beverage, ${rows.filter((r) => stockAreaOf(r.ingredientId) === "inventory").length} inventory`} flush>
              <AllRecommended rows={rows} plan={plan} />
            </Section>
          )}
          <Section id="predictions.how" title="How this is calculated" summary={`${fmtNum(plan.inputs.covers)} forecast covers, ${plan.inputs.events.length} ${plan.inputs.events.length === 1 ? "event" : "events"}, last 4 weeks of usage. Confidence ${CONF[plan.inputs.confidence].word.toLowerCase()}.`}>
            <p className="text-[13px] text-steel">Predicted use from forecast covers and events, plus a safe buffer of 2 days, less what you have and what is on the way. Simulated data. Build order puts food, drinks and inventory into one draft.</p>
            <Inputs plan={plan} />
            <Panel title="Monthly view" description="Where predicted use passes stock, the shelf is empty without a new order. The dashed line is the date to order by.">
              <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-graphite">
                <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-[var(--chart-a)]" aria-hidden />Stock and deliveries</span>
                <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-[var(--chart-b)]" aria-hidden />Predicted use</span>
                <span className="flex items-center gap-1.5"><span className="h-0 w-4 border-t-2 border-dashed border-neg" aria-hidden />Reorder date</span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {plan.categories.map((c) => <CategoryChart key={c.id} category={c} money={(n) => money(n)} />)}
              </div>
            </Panel>
          </Section>
          <SectionLink href="/forecast?tab=approvals" title="Orders and history" summary={data ? `${waiting} waiting for approval, ${onTheWay} on the way, ${requests.length} in total` : "Drafts, approvals and deliveries"} />
        </>
      )}

      <Drawer open={!!built} onClose={() => setBuilt(null)} title={built ? `Draft order ${built.request.id}` : ""} description={built ? `${built.lines} items from ${groups.length} suppliers, ${local(built.total)}. Nothing is sent until it is approved.` : undefined}>
        {built && (
          <div className="space-y-6">
            {groups.map((g) => (
              <section key={g.supplierId}>
                <div className="flex items-baseline justify-between gap-3 border-b border-line pb-2"><h3 className="text-[15px] font-medium text-ink">{supplierName(g.supplierId)}</h3><span className="num text-sm text-ink">{local(g.total)}</span></div>
                <ul className="mt-1">
                  {g.lines.map((l) => {
                    const it = ingredientById[l.ingredientId];
                    return <li key={l.ingredientId} className="flex items-baseline justify-between gap-3 py-1.5 text-table"><span className="text-graphite">{it.name}</span><span className="num shrink-0 text-ink">{fmtQty(l.qty, it.unit)}</span></li>;
                  })}
                </ul>
              </section>
            ))}
            <Link href={`/forecast?tab=approvals&request=${built.request.id}`} className={cn(linkButton("primary"), "w-full")}>Open in Orders and history</Link>
            <Note>Fresh items keep only a few days, so this draft covers their next delivery. Build it again whenever you need the next one. Building again updates this draft.</Note>
          </div>
        )}
      </Drawer>
    </div>
  );
}
