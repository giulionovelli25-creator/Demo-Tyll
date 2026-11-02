"use client";
// Stock: what we have, what we need to order, and whether the counts matched. All on one page, with no tabs to click through.
import dynamic from "next/dynamic";
import Link from "next/link";
import { ChevronRight, ClipboardCheck, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, Drawer, EmptyState, KeyNumber, KeyNumbers, Note, PageHeader, Panel, Segmented, Skeleton, StatusPill, TableWrap, Td, Th, WidgetError, cn, linkButton, rowClass, toast, useSort, type Rag } from "@/components/ui";
import { api } from "@/lib/api";
import { useAlertFeed } from "@/lib/alert-feed";
import { ingredientById, propertyById } from "@/lib/data/catalog";
import { STOCK_AREAS, stockAreaOf, type StockArea } from "@/lib/data/locations";
import { supplierName } from "@/lib/data/purchasing-rules";
import { can } from "@/lib/domain/access";
import { countVariance, countVarianceValue } from "@/lib/domain/inventory";
import type { ConfidenceLevel } from "@/lib/domain/planning";
import { VARIANCE_RULES } from "@/lib/domain/variance";
import { useCtx, useSessionEntries, useView } from "@/lib/hooks";
import { usePlanDrafts } from "@/lib/plan-hooks";
import type { MonthPlanOut, PlanItem, StockHealth } from "@/lib/server/purchasing";
import type { CountRecord, PurchaseRequest } from "@/lib/types";
import { DEMO_TODAY, fmtDate, fmtMoney, fmtNum, fmtPct, fmtQty, sum } from "@/lib/util";

const CategoryChart = dynamic(() => import("./category-charts").then((m) => m.CategoryChart), { ssr: false, loading: () => <Skeleton className="h-[216px] w-full" /> });

const RAG: Record<StockHealth, Rag> = { critical: "red", low: "amber", fine: "green" };
const WORD: Record<StockHealth, string> = { critical: "Critical", low: "Low", fine: "Fine" };
const RANK: Record<StockHealth, number> = { critical: 0, low: 1, fine: 2 };
const CONF: Record<ConfidenceLevel, { rag: Rag; word: string }> = { high: { rag: "green", word: "High" }, medium: { rag: "amber", word: "Medium" }, low: { rag: "red", word: "Low" } };
const PAGE = 10;

const name = (i: { ingredientId: string }) => ingredientById[i.ingredientId].name;
const daysWords = (i: PlanItem, end: string) => (i.daysUntilOut === null ? (i.predicted > 0 ? `Lasts past ${fmtDate(end)}` : "Not used lately") : i.daysUntilOut === 0 ? "Today" : `${i.daysUntilOut} day${i.daysUntilOut === 1 ? "" : "s"}`);

function ShowAll({ total, open, onToggle, noun }: { total: number; open: boolean; onToggle: () => void; noun: string }) {
  if (total <= PAGE) return null;
  return (
    <div className="border-t border-hair px-4 py-3 sm:px-6">
      <button type="button" onClick={onToggle} className="text-[13px] font-medium text-accent-ink underline-offset-4 hover:underline">{open ? "Show fewer" : `Show all ${total} ${noun}`}</button>
    </div>
  );
}

function CurrentStock({ plan, area }: { plan: MonthPlanOut; area: StockArea }) {
  const [q, setQ] = useState("");
  const [show, setShow] = useState<"all" | StockHealth>("all");
  const [all, setAll] = useState(false);
  const { sort, toggle: flip } = useSort<"name" | "onHand" | "par" | "days" | "health">({ key: "health", dir: "asc" });
  const toggle = (k: typeof sort.key) => flip(k, k === "onHand" || k === "par" ? "desc" : "asc");
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const value = (r: PlanItem): number | string => ({ name: name(r), onHand: r.onHand, par: r.par, days: r.daysUntilOut ?? 9999, health: RANK[r.health] })[sort.key];
    return plan.items.filter((r) => (show === "all" || r.health === show) && (!term || name(r).toLowerCase().includes(term))).sort((a, b) => {
      // Critical items stay on top, whatever the sort.
      const pin = Number(b.health === "critical") - Number(a.health === "critical");
      if (pin) return pin;
      const [x, y] = [value(a), value(b)];
      const d = typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number);
      return (sort.dir === "asc" ? d : -d) || (a.daysUntilOut ?? 9999) - (b.daysUntilOut ?? 9999);
    });
  }, [plan.items, q, show, sort]);
  const shown = all ? rows : rows.slice(0, PAGE);
  const count = (h: StockHealth) => plan.items.filter((i) => i.health === h).length;
  return (
    <Panel title={area === "inventory" ? "Current inventory" : area === "drinks" ? "Current drinks stock" : "Current food stock"} description={area === "inventory" ? "Glassware, china and hotel supplies, which are reused until they break or run out. On hand is an estimate from the last count, deliveries and breakage." : "On hand is an estimate from the last count, deliveries and sales. Critical means an order placed today would arrive too late."} flush>
      <div className="flex flex-wrap items-center gap-2 px-4 pb-4 sm:px-6">
        <Segmented size="sm" label="Show items" value={show} onChange={setShow} options={[{ value: "all", label: `All ${plan.items.length}` }, { value: "critical", label: `Critical ${count("critical")}` }, { value: "low", label: `Low ${count("low")}` }, { value: "fine", label: `Fine ${count("fine")}` }]} />
        <div className="relative ml-auto w-full sm:w-[220px]">
          <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-steel" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an item" aria-label="Find an item" className="h-10 w-full rounded-full border border-line bg-paper pl-9 pr-3 text-sm text-ink placeholder:text-steel" />
        </div>
      </div>
      {rows.length === 0 ? <div className="px-4 pb-6 sm:px-6"><EmptyState title={q ? `No item matches "${q}"` : "No items here right now"}>Try another name, or show all items.</EmptyState></div> : (
        <>
          <ul className="md:hidden">
            {shown.map((r) => (
              <li key={r.ingredientId} className={cn("border-t border-hair px-4 py-3", r.health === "critical" && "bg-neg-soft/40")}>
                <div className="flex items-start justify-between gap-2"><span className="text-sm font-medium text-ink">{name(r)}</span><StatusPill rag={RAG[r.health]}>{WORD[r.health]}</StatusPill></div>
                <dl className="mt-2 grid grid-cols-3 gap-2 text-table">
                  <div><dt className="text-xs text-steel">On hand</dt><dd className="num text-ink">{fmtQty(r.onHand, r.unit)}</dd></div>
                  <div><dt className="text-xs text-steel">Par level</dt><dd className="num text-ink">{fmtQty(r.par, r.unit)}</dd></div>
                  <div><dt className="text-xs text-steel">Runs out in</dt><dd className="num text-ink">{daysWords(r, plan.period.to)}</dd></div>
                </dl>
              </li>
            ))}
          </ul>
          <TableWrap className="hidden md:block">
            <table className="w-full min-w-[560px] text-table">
              <thead><tr>
                <Th sortKey="name" sort={sort} onSort={toggle}>Item</Th>
                <Th sortKey="onHand" sort={sort} onSort={toggle} align="right">On hand</Th>
                <Th sortKey="par" sort={sort} onSort={toggle} align="right">Par level</Th>
                <Th sortKey="days" sort={sort} onSort={toggle} align="right">Runs out in</Th>
                <Th sortKey="health" sort={sort} onSort={toggle}>Status</Th>
              </tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.ingredientId} className={cn(rowClass, r.health === "critical" && "bg-neg-soft/40")}>
                    <Td><Link href={`/stock?tab=inventory&item=${r.ingredientId}`} className="text-ink underline-offset-4 hover:underline">{name(r)}</Link></Td>
                    <Td align="right"><span className="text-ink">{fmtQty(r.onHand, r.unit)}</span></Td>
                    <Td align="right">{fmtQty(r.par, r.unit)}</Td>
                    <Td align="right"><span className={r.health === "critical" ? "text-neg" : r.health === "low" ? "text-warn" : "text-ink"}>{daysWords(r, plan.period.to)}</span></Td>
                    <Td><StatusPill rag={RAG[r.health]}>{WORD[r.health]}</StatusPill></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <ShowAll total={rows.length} open={all} onToggle={() => setAll((v) => !v)} noun="items" />
        </>
      )}
    </Panel>
  );
}

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

function OrderPlan({ plan, onBuild, busy, mayBuild }: { plan: MonthPlanOut; onBuild: () => void; busy: boolean; mayBuild: boolean }) {
  const [all, setAll] = useState(false);
  const money = (n: number) => fmtMoney(n, propertyById[plan.propertyId].currency);
  const rows = useMemo(() => plan.items.filter((i) => i.orderQty > 0).sort((a, b) => (a.orderBy ?? "").localeCompare(b.orderBy ?? "") || b.cost - a.cost), [plan.items]);
  const shown = all ? rows : rows.slice(0, PAGE);
  const end = fmtDate(plan.period.to);
  const Split = ({ r }: { r: PlanItem }) => (r.deliveries > 1 ? <span className="block text-xs text-steel">Keeps {r.shelfLifeDays} days: {r.deliveries} deliveries, next {fmtQty(r.nextQty, r.unit)}</span> : null);
  return (
    <section id="order" className="scroll-mt-24">
      <Panel
        title={`Order recommendation, to ${end}`}
        description={`Predicted use from forecast covers and events, plus a safe buffer of 2 days, less what you have and what is already on the way. Build order puts food, drinks and inventory into one draft.`}
        action={mayBuild && rows.length > 0 ? <Button variant="primary" onClick={onBuild} disabled={busy}>{busy ? "Building" : "Build order"}</Button> : undefined}
        flush
      >
        {rows.length === 0 ? <div className="px-4 pb-6 sm:px-6"><EmptyState title="Nothing to order">Stock covers the month.</EmptyState></div> : (
          <>
            <ul className="md:hidden">
              {shown.map((r) => (
                <li key={r.ingredientId} className="border-t border-hair px-4 py-3">
                  <div className="flex items-baseline justify-between gap-2"><span className="text-sm font-medium text-ink">{name(r)}</span><span className="num shrink-0 text-sm font-medium text-ink">{fmtQty(r.orderQty, r.unit)}</span></div>
                  <p className="mt-1 text-xs text-steel">Use to {end}: {fmtQty(r.predicted, r.unit)}. Order by {fmtDate(r.orderBy!, true)}. Cost {money(r.cost)}.</p>
                  <Split r={r} />
                </li>
              ))}
            </ul>
            <TableWrap className="hidden md:block">
              <table className="w-full min-w-[720px] text-table">
                <thead><tr><Th>Item</Th><Th align="right">Predicted use</Th><Th align="right">Have and coming</Th><Th align="right">Order</Th><Th align="right">Cost</Th><Th>Order by</Th></tr></thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.ingredientId} className={rowClass}>
                      <Td><span className="text-ink">{name(r)}</span><span className="block text-xs text-steel">{supplierName(r.supplierId)}</span></Td>
                      <Td align="right">{fmtQty(r.predicted, r.unit)}<span className="block text-xs text-steel">last 4 weeks {fmtQty(r.lastFourWeeks, r.unit)}</span></Td>
                      <Td align="right">{fmtQty(r.onHand + r.incoming, r.unit)}</Td>
                      <Td align="right"><span className="font-medium text-ink">{fmtQty(r.orderQty, r.unit)}</span><Split r={r} /></Td>
                      <Td align="right">{money(r.cost)}</Td>
                      <Td><span className={r.orderBy === DEMO_TODAY ? "font-medium text-neg" : "text-ink"}>{r.orderBy === DEMO_TODAY ? "Today" : fmtDate(r.orderBy!, true)}</span></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            <ShowAll total={rows.length} open={all} onToggle={() => setAll((v) => !v)} noun="items" />
          </>
        )}
      </Panel>
    </section>
  );
}

function ExpectedVsActual({ propertyId, area }: { propertyId: string; area: StockArea }) {
  const ctx = useCtx();
  const [all, setAll] = useState(false);
  const money = (n: number) => fmtMoney(n, propertyById[propertyId].currency);
  const rows = useMemo(() => {
    const latest = new Map<string, CountRecord>();
    for (const c of ctx.counts) {
      if (c.propertyId !== propertyId) continue;
      const cur = latest.get(c.ingredientId);
      if (!cur || c.date > cur.date || (c.date === cur.date && c.seq > cur.seq)) latest.set(c.ingredientId, c);
    }
    return [...latest.values()].filter((c) => ingredientById[c.ingredientId].dept !== "supplies" && stockAreaOf(c.ingredientId) === area).map((c) => {
      const gap = countVariance(c);
      const value = countVarianceValue(c, ctx.overrides);
      const share = c.expected > 0 ? Math.abs(gap) / c.expected : 0;
      return { c, gap, value, share, flagged: gap < 0 && share >= VARIANCE_RULES.minShare && Math.abs(value) >= VARIANCE_RULES.minValue };
    }).sort((a, b) => Number(b.flagged) - Number(a.flagged) || a.value - b.value);
  }, [ctx.counts, ctx.overrides, propertyId, area]);
  const flagged = rows.filter((r) => r.flagged);
  const shown = all ? rows : rows.slice(0, PAGE);
  const Words = ({ gap, unit }: { gap: number; unit: string }) => <>{Math.abs(gap) < 0.005 ? "None" : `${fmtQty(Math.abs(gap), unit)} ${gap < 0 ? "short" : "over"}`}</>;
  return (
    <Panel
      title="Expected vs actual"
      description={`What should be left based on sales, against what was counted. Highlighted when the gap is over ${fmtPct(VARIANCE_RULES.minShare, 0)} and worth at least ${money(VARIANCE_RULES.minValue)}. ${flagged.length} highlighted, ${money(-sum(flagged, (r) => r.value))} in total.`}
      flush
    >
      {rows.length === 0 ? <div className="px-4 pb-6 sm:px-6"><EmptyState title="No counts yet">Start a stock count to compare it with sales.</EmptyState></div> : (
        <>
          <ul className="md:hidden">
            {shown.map((r) => {
              const g = ingredientById[r.c.ingredientId];
              return (
                <li key={r.c.id} className={cn("border-t border-hair px-4 py-3", r.flagged && "bg-money-soft/60")}>
                  <div className="flex items-baseline justify-between gap-2"><span className="text-sm font-medium text-ink">{g.name}</span><span className={cn("num shrink-0 text-sm", r.flagged ? "font-medium text-money" : "text-ink")}>{r.gap < 0 ? money(-r.value) : "None"}</span></div>
                  <p className="mt-1 text-xs text-steel">Should be {fmtQty(r.c.expected, g.unit)}, counted {fmtQty(r.c.counted, g.unit)} on {fmtDate(r.c.date)}. <Words gap={r.gap} unit={g.unit} />.</p>
                </li>
              );
            })}
          </ul>
          <TableWrap className="hidden md:block">
            <table className="w-full min-w-[640px] text-table">
              <thead><tr><Th>Item</Th><Th align="right">Should be left</Th><Th align="right">Counted</Th><Th align="right">Gap</Th><Th align="right">Worth</Th><Th>Counted on</Th></tr></thead>
              <tbody>
                {shown.map((r) => {
                  const g = ingredientById[r.c.ingredientId];
                  return (
                    <tr key={r.c.id} className={cn(rowClass, r.flagged && "bg-money-soft/60")}>
                      <Td><span className="text-ink">{g.name}</span></Td>
                      <Td align="right">{fmtQty(r.c.expected, g.unit)}</Td>
                      <Td align="right">{fmtQty(r.c.counted, g.unit)}</Td>
                      <Td align="right"><span className={r.flagged ? "font-medium text-money" : undefined}><Words gap={r.gap} unit={g.unit} /></span></Td>
                      <Td align="right"><span className={r.flagged ? "font-medium text-money" : undefined}>{r.gap < 0 ? money(-r.value) : "None"}</span></Td>
                      <Td>{fmtDate(r.c.date)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
          <ShowAll total={rows.length} open={all} onToggle={() => setAll((v) => !v)} noun="items" />
        </>
      )}
    </Panel>
  );
}

export function StockPage() {
  const { user, money } = useView();
  const { plan, error, propertyId } = useAlertFeed();
  const entries = useSessionEntries();
  const bump = usePlanDrafts((s) => s.bump);
  const [area, setArea] = useState<StockArea>("food");
  const [busy, setBusy] = useState(false);
  const [built, setBuilt] = useState<{ request: PurchaseRequest; lines: number; total: number } | null>(null);
  const mayBuild = can(user, "purchase.create");
  const mayCount = can(user, "stock.count");
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

  const critical = plan?.items.filter((i) => i.health === "critical") ?? [];
  const low = plan?.items.filter((i) => i.health === "low") ?? [];
  // Everything below the switch shows one area. The headline and Build order cover all three.
  const view = useMemo(() => plan && {
    ...plan,
    items: plan.items.filter((i) => stockAreaOf(i.ingredientId) === area),
    categories: plan.categories.filter((c) => area !== "inventory" && (c.id === "drinks") === (area === "drinks")),
  }, [plan, area]);
  const areaWord = STOCK_AREAS.find((a) => a.id === area)!.name;
  const areaCritical = view?.items.filter((i) => i.health === "critical") ?? [];
  const today = view?.items.filter((i) => i.orderBy === DEMO_TODAY && i.nextQty > 0) ?? [];
  const nextCost = sum(view?.items ?? [], (i) => i.nextCost);
  const monthCost = sum(view?.items ?? [], (i) => i.cost);
  const first = [...critical].sort((a, b) => (a.daysUntilOut ?? 99) - (b.daysUntilOut ?? 99))[0];

  const groups = useMemo(() => {
    if (!built) return [];
    const m = new Map<string, PurchaseRequest["lines"]>();
    for (const l of built.request.lines) m.set(l.supplierId, [...(m.get(l.supplierId) ?? []), l]);
    return [...m].map(([supplierId, lines]) => ({ supplierId, lines, total: sum(lines, (l) => l.qty * l.unitPrice) })).sort((a, b) => b.total - a.total);
  }, [built]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock"
        question="What do I have and what do I need to order?"
        lead={plan ? `${critical.length} critical and ${low.length} low${first ? `. ${name(first)} runs out first, ${first.daysUntilOut === 0 ? "today" : fmtDate(first.runOutDate!, true)}.` : "."}` : "Working out the month ahead."}
      >
        {mayCount && <Link href="/count" className={linkButton()}><ClipboardCheck size={16} aria-hidden /> Count stock</Link>}
        {mayBuild && plan && <Button variant="primary" onClick={build} disabled={busy || nextCost <= 0}>{busy ? "Building" : "Build order"}</Button>}
      </PageHeader>

      {error ? <WidgetError>The stock prediction could not load.</WidgetError> : !plan || !view ? (
        <div className="space-y-4" aria-busy>
          <KeyNumbers>{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}</KeyNumbers>
          <Skeleton className="h-96 w-full" />
        </div>
      ) : (
        <>
          <Segmented
            label="Part of stock"
            value={area}
            onChange={setArea}
            options={STOCK_AREAS.map((a) => {
              const n = plan.items.filter((i) => i.health === "critical" && stockAreaOf(i.ingredientId) === a.id).length;
              return { value: a.id, label: n ? `${a.name}, ${n} critical` : a.name };
            })}
          />

          <KeyNumbers>
            <KeyNumber label="Critical items" value={areaCritical.length} tone={areaCritical.length ? "neg" : "pos"} note="An order today would arrive too late" />
            <KeyNumber label="Order today" value={today.length} tone={today.length ? "warn" : "pos"} note={today.length ? "Items that cannot wait" : "Nothing is due today"} />
            <KeyNumber label="Next deliveries" value={local(nextCost)} note={`${areaWord} share of Build order`} />
            <KeyNumber label={`To reach ${fmtDate(plan.period.to)}`} value={local(monthCost)} note={`${areaWord}, all deliveries, with the buffer`} />
          </KeyNumbers>

          <div className={cn("grid grid-cols-1 items-start gap-4", area !== "inventory" && "xl:grid-cols-[2fr_1fr]")}>
            <CurrentStock key={area} plan={view} area={area} />
            {area !== "inventory" && <Inputs plan={plan} />}
          </div>

          <OrderPlan key={area} plan={view} onBuild={build} busy={busy} mayBuild={mayBuild} />

          {area !== "inventory" && <Panel title="Monthly view" description="Where predicted use passes stock, the shelf is empty without a new order. The dashed line is the date to order by.">
            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-graphite">
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-[var(--chart-a)]" aria-hidden />Stock and deliveries</span>
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-[var(--chart-b)]" aria-hidden />Predicted use</span>
              <span className="flex items-center gap-1.5"><span className="h-0 w-4 border-t-2 border-dashed border-neg" aria-hidden />Reorder date</span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {view.categories.map((c) => <CategoryChart key={c.id} category={c} money={(n) => money(n)} />)}
            </div>
          </Panel>}

          <ExpectedVsActual key={`variance-${area}`} propertyId={plan.propertyId} area={area} />

          <nav aria-label="More about stock" className="flex flex-wrap gap-x-6 gap-y-2 text-[13px]">
            {[["Item history", "/stock?tab=inventory"], ["Where missing stock went", "/stock?tab=where"], ["Count records", "/stock?tab=counts"], ["Recipes and costs", "/stock?tab=recipes"], ["Suppliers", "/stock?tab=suppliers"]].map(([label, href]) => (
              <Link key={href} href={href} className="inline-flex items-center gap-1 font-medium text-accent-ink underline-offset-4 hover:underline">{label} <ChevronRight size={14} aria-hidden /></Link>
            ))}
          </nav>
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
            <Link href={`/forecast?tab=approvals&request=${built.request.id}`} className={cn(linkButton("primary"), "w-full")}>Open in Orders</Link>
            <Note>Fresh items keep only a few days, so this draft covers their next delivery. Build it again whenever you need the next one. Building again updates this draft.</Note>
          </div>
        )}
      </Drawer>
    </div>
  );
}
