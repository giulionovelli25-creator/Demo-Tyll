"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { BarList } from "@/components/charts";
import { Section, useRemembered } from "@/components/disclosure";
import { BreakageFlow, mayLogBreakage } from "@/components/shell/breakage";
import { WasteAnalytics } from "@/components/stock/waste-analytics";
import { WasteLogger } from "@/components/stock/waste-logger";
import { EmptyState, OutletDot, PageHeader, Panel, Segmented, SummaryBar, TableWrap, Td, Th, rowClass, textLink } from "@/components/ui";
import { ingredientById, itemById, outletLabel, propertyById } from "@/lib/data/catalog";
import { STOCK_AREAS, stockAreaOf, type StockArea } from "@/lib/data/locations";
import { allowedProperties, can } from "@/lib/domain/access";
import { isBreakage, wasteCost } from "@/lib/domain/inventory";
import { computeTotals } from "@/lib/domain/metrics";
import { useCtx, useView } from "@/lib/hooks";
import { REASON_LABEL } from "@/lib/labels";
import type { WasteLog } from "@/lib/types";
import { DEMO_TODAY, fmtDate, fmtPct, fmtQty, fxRate, sum } from "@/lib/util";
import { StripTrend } from "@/components/charts";
import { LAST_WEEK, THIS_WEEK, byDay, inRange, topBy, versus, wasteInCurrency } from "@/lib/domain/trends";

const MONTH = { from: `${DEMO_TODAY.slice(0, 8)}01`, to: DEMO_TODAY };

const nameOf = (w: WasteLog) => (w.ingredientId ? ingredientById[w.ingredientId].name : w.itemId ? `${itemById[w.itemId].name}, prepared` : "Item");
const qtyOf = (w: WasteLog) => (w.ingredientId ? fmtQty(w.qty, ingredientById[w.ingredientId].unit) : `${w.qty}`);

/** Log waste: the flow first. What was lost sits underneath, closed until someone wants it. */
export default function WastePage() {
  const { user, sel, money, propertyId } = useView();
  const ctx = useCtx();
  const params = useSearchParams();
  const pid = propertyId ?? allowedProperties(user)[0];
  const [area, setArea] = useRemembered<StockArea>("waste.month.area", "food");
  const [flowKey, setFlowKey] = useState(0);
  const [filter, setFilter] = useState<{ kind: "week" | "broken" | "reason" | "item"; key?: string; title: string } | null>(null);
  const toDisplay = (n: number) => n * fxRate(propertyById[pid].currency, sel.currency);
  const today = useMemo(() => computeTotals(ctx, { ...sel, range: { from: DEMO_TODAY, to: DEMO_TODAY } }), [ctx, sel]);
  const entries = useMemo(() => ctx.waste.filter((w) => w.synced && sel.outletIds.includes(w.outletId)).map((w) => ({ w, cost: toDisplay(wasteCost(w, ctx.overrides)) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ctx.waste, ctx.overrides, sel.outletIds, sel.currency, pid]);
  // Today's log, largest cost first. The same item, outlet and reason logged twice shows as one line.
  const todays = useMemo(() => {
    const m = new Map<string, { w: WasteLog; cost: number; qty: number; times: number }>();
    for (const { w, cost } of entries.filter(({ w }) => w.date === DEMO_TODAY)) {
      const k = `${w.ingredientId ?? w.itemId}|${w.outletId}|${w.reason}`;
      const cur = m.get(k);
      if (cur) { cur.cost += cost; cur.qty += w.qty; cur.times += 1; } else m.set(k, { w, cost, qty: w.qty, times: 1 });
    }
    return [...m.values()].sort((a, b) => b.cost - a.cost);
  }, [entries]);
  const month = entries.filter(({ w }) => w.date >= MONTH.from && w.date <= MONTH.to);
  const areaOf = (w: WasteLog) => (w.ingredientId ? stockAreaOf(w.ingredientId) : w.itemId && itemById[w.itemId].dept === "beverage" ? "drinks" : "food");
  const monthBy = (a: StockArea) => sum(month.filter(({ w }) => (a === "inventory" ? isBreakage(w) : !isBreakage(w) && areaOf(w) === a)), (x) => x.cost);
  const broken = useMemo(() => {
    const items = new Map<string, number>();
    const outlets = new Map<string, number>();
    for (const { w, cost } of month) {
      if (!isBreakage(w)) continue;
      if (w.ingredientId) items.set(w.ingredientId, (items.get(w.ingredientId) ?? 0) + cost);
      outlets.set(w.outletId, (outlets.get(w.outletId) ?? 0) + cost);
    }
    return {
      items: [...items].map(([id, value]) => ({ key: id, label: ingredientById[id].name, value })).sort((a, b) => b.value - a.value).slice(0, 8),
      outlets: [...outlets].map(([id, value]) => ({ key: id, label: outletLabel(id), value, outletId: id })).sort((a, b) => b.value - a.value),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  if (params.get("log") === "1") {
    return (
      <div className="space-y-6">
        <PageHeader title="Log with more detail" question="For a prepared dish, a late entry or a note." />
        <WasteLogger key={pid} propertyId={pid} />
      </div>
    );
  }

  const logs = mayLogBreakage(user);
  const lost = today.waste + today.breakage;
  const all = wasteInCurrency(ctx, sel.outletIds, sel.currency);
  const week = all.filter((e) => inRange(e.w.date, THIS_WEEK));
  const lastWeek = all.filter((e) => inRange(e.w.date, LAST_WEEK));
  const wasted = (l: typeof all) => sum(l.filter((e) => !e.broken), (e) => e.cost);
  const brokenSum = (l: typeof all) => sum(l.filter((e) => e.broken), (e) => e.cost);
  const reason = topBy(week, (w) => w.reason);
  const item = topBy(week, (w) => nameOf(w));
  const perDay = byDay(all, (e) => e.w.date, (e) => e.cost);
  const behind = filter && (filter.kind === "week" ? week.filter((e) => !e.broken) : filter.kind === "broken" ? week.filter((e) => e.broken) : filter.kind === "reason" ? week.filter((e) => e.w.reason === filter.key) : week.filter((e) => nameOf(e.w) === filter.key));
  const pick = (f: NonNullable<typeof filter>) => { setFilter(f); requestAnimationFrame(() => document.getElementById("waste-records")?.scrollIntoView({ block: "start", behavior: "smooth" })); };
  return (
    <div className="space-y-6">
      <PageHeader title="Waste and breakage" question="What was wasted or broken, and what did it cost?" lead={`Saved to today's log straight away. Lost today: ${money(lost)}. Simulated data.`} />
      <SummaryBar
        items={[
          { label: "Waste this week", value: money(wasted(week)), tone: "money", compare: versus(wasted(week), wasted(lastWeek), "down"), onClick: () => pick({ kind: "week", title: "Waste this week" }) },
          { label: "Top reason", value: reason.key ? REASON_LABEL[reason.key as keyof typeof REASON_LABEL].en : "None", compare: { text: reason.key ? `${fmtPct(reason.share, 0)} of this week, ${money(reason.value)}` : "Nothing logged this week", good: null }, onClick: reason.key ? () => pick({ kind: "reason", key: reason.key!, title: `Reason: ${REASON_LABEL[reason.key as keyof typeof REASON_LABEL].en}` }) : undefined },
          { label: "Top item", value: item.key ?? "None", compare: { text: item.key ? `${money(item.value)} this week` : "Nothing logged this week", good: null }, onClick: item.key ? () => pick({ kind: "item", key: item.key!, title: item.key! }) : undefined },
          { label: "Breakage this week", value: money(brokenSum(week)), compare: versus(brokenSum(week), brokenSum(lastWeek), "down"), onClick: () => pick({ kind: "broken", title: "Breakage this week" }) },
        ]}
        trend={<StripTrend goodWhen="down" title="Waste and breakage per day, last 30 days" points={perDay} format={money}
          explain="What was logged as wasted or broken each day, at cost. Switch on the parts to see which one drives a peak."
          series={[
            { id: "waste", label: "Waste", axis: "main", format: money, points: byDay(all.filter((e) => !e.broken), (e) => e.w.date, (e) => e.cost), goodWhen: "down" as const, explain: "Food and drinks thrown away, at cost." },
            { id: "broken", label: "Breakage", axis: "main", format: money, points: byDay(all.filter((e) => e.broken), (e) => e.w.date, (e) => e.cost), goodWhen: "down" as const, explain: "Glassware and china broken, at cost." },
            { id: "dishes", label: "Prepared dishes wasted", axis: "count", format: (n) => `${Math.round(n)}`, points: byDay(all.filter((e) => !!e.w.itemId), (e) => e.w.date, (e) => e.w.qty), goodWhen: "down" as const, explain: "Plated or prepared dishes thrown away, not ingredients." },
          ]} summary={`Waste and breakage at cost per day. This week ${money(wasted(week) + brokenSum(week))}.`} note="at cost" />}
      />

      {logs ? (
        <Panel>
          <BreakageFlow wide key={flowKey} onDone={() => setFlowKey((k) => k + 1)} />
          {can(user, "stock.logWaste") && <p className="mt-3 text-center"><Link href="/waste?log=1" className={textLink}>Log a prepared dish or add a note</Link></p>}
        </Panel>
      ) : <EmptyState title="Your role reads waste, it does not log it">Kitchen, bar and outlet teams log waste here. What they logged is below.</EmptyState>}

      {filter && behind && (
        <section id="waste-records" className="scroll-mt-24">
          <Panel title={`${filter.title}: ${behind.length} ${behind.length === 1 ? "entry" : "entries"}, ${money(sum(behind, (e) => e.cost))}`} description={`${fmtDate(THIS_WEEK.from)} to ${fmtDate(THIS_WEEK.to)}. The records behind the number above.`} action={<button type="button" onClick={() => setFilter(null)} className={textLink}>Close</button>} flush>
            <TableWrap>
              <table className="w-full min-w-[560px] text-table">
                <thead><tr><Th>Date</Th><Th>Item</Th><Th align="right">Amount</Th><Th>Why</Th><Th>Outlet</Th><Th align="right">Cost</Th></tr></thead>
                <tbody>
                  {[...behind].sort((a, b) => b.cost - a.cost).map(({ w, cost }) => (
                    <tr key={w.id} className={rowClass}>
                      <Td className="num text-graphite">{fmtDate(w.date)}</Td>
                      <Td><span className="text-ink">{nameOf(w)}</span></Td>
                      <Td align="right">{qtyOf(w)}</Td>
                      <Td>{REASON_LABEL[w.reason].en}</Td>
                      <Td><OutletDot id={w.outletId} />{outletLabel(w.outletId)}</Td>
                      <Td align="right">{money(cost)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Panel>
        </section>
      )}

      <Section id="waste.today" title="Today's log" summary={todays.length ? `${todays.length} ${todays.length === 1 ? "entry" : "entries"}, ${money(sum(todays, (x) => x.cost))}` : "Nothing logged yet today"} flush>
        {todays.length === 0 ? <div className="p-4 sm:p-6"><EmptyState title="Nothing logged yet today">Anything you log appears here at once.</EmptyState></div> : (
          <TableWrap>
            <table className="w-full min-w-[520px] text-table">
              <thead><tr><Th>Item</Th><Th align="right">Amount</Th><Th>Why</Th><Th>Outlet</Th><Th align="right">Cost</Th></tr></thead>
              <tbody>
                {todays.map(({ w, cost, qty, times }) => (
                  <tr key={w.id} className={rowClass}>
                    <Td><span className="text-ink">{nameOf(w)}</span>{times > 1 && <span className="ms-2 text-xs text-steel">logged {times} times</span>}</Td>
                    <Td align="right">{qtyOf({ ...w, qty })}</Td>
                    <Td>{REASON_LABEL[w.reason].en}</Td>
                    <Td><OutletDot id={w.outletId} />{outletLabel(w.outletId)}</Td>
                    <Td align="right">{money(cost)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Section>

      <Section id="waste.month" title="Waste this month" summary={`${money(sum(month, (x) => x.cost))} lost since ${fmtDate(MONTH.from)}: ${money(monthBy("food"))} food, ${money(monthBy("drinks"))} beverage, ${money(monthBy("inventory"))} inventory`}>
        <Segmented label="Part of waste" value={area} onChange={setArea} options={STOCK_AREAS.map((a) => ({ value: a.id, label: a.name }))} />
        {area !== "inventory" ? <WasteAnalytics area={area} range={MONTH} /> : (
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
            <Panel title="Most broken" description="By value. Glassware and china.">
              {broken.items.length === 0 ? <EmptyState title="Nothing broken this month">Breakage logged by the team shows up here.</EmptyState> : <BarList rows={broken.items} format={(n) => money(n)} />}
            </Panel>
            {broken.outlets.length > 0 && <Panel title="Breakage by outlet" description="By value."><BarList rows={broken.outlets} format={(n) => money(n)} /></Panel>}
          </div>
        )}
      </Section>
    </div>
  );
}
