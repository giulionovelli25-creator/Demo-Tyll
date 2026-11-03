"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { BarList } from "@/components/charts";
import { Section, useRemembered } from "@/components/disclosure";
import { BreakageFlow, mayLogBreakage } from "@/components/shell/breakage";
import { WasteAnalytics } from "@/components/stock/waste-analytics";
import { WasteLogger } from "@/components/stock/waste-logger";
import { Crumbs, EmptyState, OutletDot, PageHeader, Panel, Segmented, SummaryBar, TableWrap, Td, Th, rowClass, textLink } from "@/components/ui";
import { ingredientById, itemById, outletLabel, propertyById } from "@/lib/data/catalog";
import { STOCK_AREAS, stockAreaOf, type StockArea } from "@/lib/data/locations";
import { allowedProperties, can } from "@/lib/domain/access";
import { isBreakage, wasteCost } from "@/lib/domain/inventory";
import { computeTotals } from "@/lib/domain/metrics";
import { useCtx, useView } from "@/lib/hooks";
import { REASON_LABEL } from "@/lib/labels";
import type { WasteLog } from "@/lib/types";
import { DEMO_TODAY, fmtDate, fmtQty, fxRate, sum } from "@/lib/util";

const MONTH = { from: `${DEMO_TODAY.slice(0, 8)}01`, to: DEMO_TODAY };

const nameOf = (w: WasteLog) => (w.ingredientId ? ingredientById[w.ingredientId].name : w.itemId ? `${itemById[w.itemId].name}, prepared` : "Item");
const qtyOf = (w: WasteLog) => (w.ingredientId ? fmtQty(w.qty, ingredientById[w.ingredientId].unit) : `${w.qty}`);

/** Log waste: the flow first. What was lost sits underneath, closed until someone wants it. */
export default function WastePage() {
  const { user, sel, money, propertyId } = useView();
  const ctx = useCtx();
  const params = useSearchParams();
  const router = useRouter();
  const pid = propertyId ?? allowedProperties(user)[0];
  const [area, setArea] = useRemembered<StockArea>("waste.month.area", "food");
  const [flowKey, setFlowKey] = useState(0);
  const toDisplay = (n: number) => n * fxRate(propertyById[pid].currency, sel.currency);
  const today = useMemo(() => computeTotals(ctx, { ...sel, range: { from: DEMO_TODAY, to: DEMO_TODAY } }), [ctx, sel]);
  const entries = useMemo(() => ctx.waste.filter((w) => w.synced && sel.outletIds.includes(w.outletId)).map((w) => ({ w, cost: toDisplay(wasteCost(w, ctx.overrides)) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ctx.waste, ctx.overrides, sel.outletIds, sel.currency, pid]);
  const todays = entries.filter(({ w }) => w.date === DEMO_TODAY).sort((a, b) => b.w.seq - a.w.seq);
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
      <div className="space-y-5">
        <PageHeader title="Log with more detail" question="For a prepared dish, a late entry or a note." crumbs={<Crumbs items={[{ label: "Log waste", onClick: () => router.push("/waste") }, { label: "More detail" }]} />} />
        <WasteLogger key={pid} propertyId={pid} />
      </div>
    );
  }

  const logs = mayLogBreakage(user);
  const lost = today.waste + today.breakage;
  return (
    <div className="space-y-4">
      <PageHeader title="Log waste" question="What was wasted or broken?" lead="Saved to today's log straight away. Simulated data." />
      <SummaryBar items={[{ label: "Lost today", value: money(lost), tone: lost > 0 ? "money" : undefined, note: `${money(today.waste)} wasted, ${money(today.breakage)} broken` }]} />

      {logs ? (
        <Panel>
          <BreakageFlow wide key={flowKey} onDone={() => setFlowKey((k) => k + 1)} />
          {can(user, "stock.logWaste") && <p className="mt-3 text-center"><Link href="/waste?log=1" className={textLink}>Log a prepared dish or add a note</Link></p>}
        </Panel>
      ) : <EmptyState title="Your role reads waste, it does not log it">Kitchen, bar and outlet teams log waste here. What they logged is below.</EmptyState>}

      <Section id="waste.today" title="Today's log" summary={todays.length ? `${todays.length} ${todays.length === 1 ? "entry" : "entries"}, ${money(sum(todays, (x) => x.cost))}` : "Nothing logged yet today"} flush>
        {todays.length === 0 ? <div className="p-4 sm:p-6"><EmptyState title="Nothing logged yet today">Anything you log appears here at once.</EmptyState></div> : (
          <TableWrap>
            <table className="w-full min-w-[520px] text-table">
              <thead><tr><Th>Item</Th><Th align="right">Amount</Th><Th>Why</Th><Th>Outlet</Th><Th align="right">Cost</Th></tr></thead>
              <tbody>
                {todays.map(({ w, cost }) => (
                  <tr key={w.id} className={rowClass}>
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
