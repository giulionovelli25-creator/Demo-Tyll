"use client";
// Stock: how much is left. The counts and the critical items come first. Everything else is one click away.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardCheck, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Section, useRemembered } from "@/components/disclosure";
import { useCountDraft } from "@/components/stock/count-flow";
import { QuickCount } from "@/components/stock/quick-count";
import { EmptyState, PageHeader, Panel, Segmented, Skeleton, StatusPill, SummaryBar, TableWrap, Tabs, Td, Th, WidgetError, cn, linkButton, rowClass, textLink, toast, useSort, type Rag } from "@/components/ui";
import { useAlertFeed } from "@/lib/alert-feed";
import { ingredientById, propertyById } from "@/lib/data/catalog";
import { STOCK_AREAS, stockAreaOf, type StockArea } from "@/lib/data/locations";
import { can } from "@/lib/domain/access";
import { countVariance, countVarianceValue } from "@/lib/domain/inventory";
import { VARIANCE_RULES } from "@/lib/domain/variance";
import { useCtx, useView } from "@/lib/hooks";
import type { MonthPlanOut, PlanItem, StockHealth } from "@/lib/server/purchasing";
import type { CountRecord } from "@/lib/types";
import { fmtDate, fmtMoney, fmtPct, fmtQty, sum } from "@/lib/util";

const RAG: Record<StockHealth, Rag> = { critical: "red", low: "amber", fine: "green" };
const WORD: Record<StockHealth, string> = { critical: "Critical", low: "Low", fine: "Fine" };
const RANK: Record<StockHealth, number> = { critical: 0, low: 1, fine: 2 };

const name = (i: { ingredientId: string }) => ingredientById[i.ingredientId].name;
const daysWords = (i: PlanItem, end: string) => (i.daysUntilOut === null ? (i.predicted > 0 ? `Lasts past ${fmtDate(end)}` : "Not used lately") : i.daysUntilOut === 0 ? "Today" : `${i.daysUntilOut} day${i.daysUntilOut === 1 ? "" : "s"}`);

/** Only what is about to run out, split the way the stores are: food, drinks, inventory. */
function CriticalItems({ plan }: { plan: MonthPlanOut }) {
  const rows = plan.items.filter((i) => i.health === "critical").sort((a, b) => (a.daysUntilOut ?? 99) - (b.daysUntilOut ?? 99));
  if (rows.length === 0) return <Panel><p className="text-sm text-graphite">Nothing is critical. Every item can wait for a normal order.</p></Panel>;
  return (
    <Panel title="Critical items" description="An order placed today would arrive too late." action={<Link href="/forecast" className={textLink}>See what to order</Link>} flush>
      <ul>
        {rows.map((r) => (
          <li key={r.ingredientId} className="border-t border-hair">
            <Link href={`/stock?tab=inventory&item=${r.ingredientId}`} className="flex flex-col gap-0.5 px-4 py-2.5 transition-colors duration-150 hover:bg-cloud sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-6">
              <span className="text-sm font-medium text-ink">{name(r)}</span>
              <span className="num text-table text-graphite">{STOCK_AREAS.find((a) => a.id === stockAreaOf(r.ingredientId))!.name}, {fmtQty(r.onHand, r.unit)} left, runs out in {daysWords(r, plan.period.to).toLowerCase()}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function AllItems({ plan, area }: { plan: MonthPlanOut; area: StockArea }) {
  const [q, setQ] = useState("");
  const [show, setShow] = useState<"all" | StockHealth>("all");
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
  const shown = rows;
  const count = (h: StockHealth) => plan.items.filter((i) => i.health === h).length;
  return (
    <>
      <p className="px-4 pt-4 text-[13px] text-steel sm:px-6">{area === "inventory" ? "Glassware, china and hotel supplies, which are reused until they break or run out. On hand is an estimate from the last count, deliveries and breakage." : "On hand is an estimate from the last count, deliveries and sales. Critical means an order placed today would arrive too late."}</p>
      <div className="flex flex-wrap items-center gap-2 px-4 py-4 sm:px-6">
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
        </>
      )}
    </>
  );
}


function ExpectedVsActual({ propertyId, area }: { propertyId: string; area: StockArea }) {
  const ctx = useCtx();
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
  const shown = rows;
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
        </>
      )}
    </Panel>
  );
}

export function StockPage() {
  const { user } = useView();
  const router = useRouter();
  const { plan, error } = useAlertFeed();
  const [tab, setTab] = useRemembered<"stock" | "analysis">("stock.tab", "stock");
  const [area, setArea] = useRemembered<StockArea>("stock.area", "food");
  const mayCount = can(user, "stock.count");
  const paused = useCountDraft((d) => d.byUser[user.id]);
  const setPaused = useCountDraft((d) => d.set);
  const startOver = () => {
    const kept = paused;
    setPaused(user.id, undefined);
    toast.done("Count cleared.", { label: "Undo", run: () => setPaused(user.id, kept) });
  };
  const count = (a: StockArea) => plan?.items.filter((i) => stockAreaOf(i.ingredientId) === a).length ?? 0;
  const view = useMemo(() => plan && { ...plan, items: plan.items.filter((i) => stockAreaOf(i.ingredientId) === area) }, [plan, area]);
  const by = (h: StockHealth) => plan?.items.filter((i) => i.health === h).length ?? 0;
  const areaSwitch = <Segmented label="Part of stock" value={area} onChange={setArea} options={STOCK_AREAS.map((a) => ({ value: a.id, label: a.name }))} />;
  const spotCheck = can(user, "stock.logWaste") && user.outletIds !== "all";

  return (
    <div className="space-y-4">
      <PageHeader title="Stock" question="How much stock is left?" lead="Estimates from the last count, deliveries and sales. Simulated data." />
      {error ? <WidgetError>The stock figures could not load.</WidgetError> : !plan || !view ? (
        <div className="space-y-4" aria-busy><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div>
      ) : (
        <>
          <SummaryBar
            items={[
              { label: "Critical", value: by("critical"), tone: by("critical") ? "neg" : "pos" },
              { label: "Low", value: by("low"), tone: by("low") ? "warn" : "pos" },
              { label: "Fine", value: by("fine"), tone: "pos" },
            ]}
            action={mayCount ? (
              <>
                <Link href="/count" className={linkButton("primary")}><ClipboardCheck size={16} aria-hidden /> {paused ? `Resume count, ${Math.min(paused.index + 1, paused.order.length)} of ${paused.order.length}` : "Start count"}</Link>
                {paused && <button type="button" onClick={startOver} className={cn(textLink, "mt-3 justify-center")}>Clear and start over</button>}
              </>
            ) : undefined}
          />
          <Tabs value={tab} onChange={setTab} tabs={[{ value: "stock", label: "Stock" }, { value: "analysis", label: "Analysis" }]} />
          {tab === "stock" ? (
            <>
              <CriticalItems plan={plan} />
              <Section id="stock.all" title="Show all items" summary={`${plan.items.length} items: ${count("food")} food, ${count("drinks")} drinks, ${count("inventory")} inventory`} flush>
                <div className="px-4 pt-4 sm:px-6">{areaSwitch}</div>
                <AllItems key={area} plan={view} area={area} />
              </Section>
              {spotCheck && <Section id="stock.spot" title="Quick spot check" summary="Count a few items between full counts"><QuickCount user={user} propertyId={plan.propertyId} onFullCount={() => router.push("/count")} /></Section>}
            </>
          ) : (
            <>
              <div>{areaSwitch}</div>
              <ExpectedVsActual key={area} propertyId={plan.propertyId} area={area} />
              <p className="flex flex-wrap gap-x-5 gap-y-2"><Link href="/stock?tab=where" className={textLink}>Where missing stock went</Link><Link href="/stock?tab=counts" className={textLink}>Count records</Link></p>
            </>
          )}
        </>
      )}
    </div>
  );
}
