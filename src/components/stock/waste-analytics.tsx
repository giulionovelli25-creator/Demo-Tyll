"use client";
import { useCallback, useMemo } from "react";
import { BarList } from "@/components/charts";
import { Delta, EmptyState, Note, Panel, Stat } from "@/components/ui";
import { ingredientById, itemById, outletById, outletLabel, propertyById } from "@/lib/data/catalog";
import { stockAreaOf } from "@/lib/data/locations";
import { isBreakage, wasteCost } from "@/lib/domain/inventory";
import { compare, prevSel } from "@/lib/domain/metrics";
import { useCtx, useView } from "@/lib/hooks";
import { REASON_LABEL } from "@/lib/labels";
import type { DateRange, WasteLog, WasteReason } from "@/lib/types";
import { fmtPct, fmtRange, fxRate, pctChange } from "@/lib/util";

const isDrink = (w: WasteLog) => (w.ingredientId ? stockAreaOf(w.ingredientId) === "drinks" : !!w.itemId && itemById[w.itemId].dept === "beverage");

/** Waste for one area. Glass and china breakage has its own view, under Inventory. */
export function WasteAnalytics({ area, range }: { area: "food" | "drinks"; range?: DateRange }) {
  const view = useView();
  const { money, currency } = view;
  const sel = useMemo(() => (range ? { ...view.sel, range } : view.sel), [view.sel, range]);
  const ctx = useCtx();
  const word = area === "drinks" ? "beverage" : "food";
  const inArea = useCallback((w: WasteLog) => w.synced && sel.outletIds.includes(w.outletId) && !isBreakage(w) && !(w.ingredientId && stockAreaOf(w.ingredientId) === "inventory") && isDrink(w) === (area === "drinks"), [sel.outletIds, area]);
  const c = useMemo(() => compare(ctx, sel), [ctx, sel]);
  const logs = useMemo(
    () => ctx.waste.filter((w) => w.synced && w.date >= sel.range.from && w.date <= sel.range.to && inArea(w)).map((w) => ({ w, cost: wasteCost(w, ctx.overrides) * fxRate(propertyById[outletById[w.outletId].propertyId].currency, currency) })),
    [ctx.waste, ctx.overrides, sel, currency, inArea],
  );
  const group = (key: (x: (typeof logs)[number]) => string) => {
    const m = new Map<string, number>();
    for (const x of logs) m.set(key(x), (m.get(key(x)) ?? 0) + x.cost);
    return [...m].map(([k, value]) => ({ k, value })).sort((a, b) => b.value - a.value);
  };
  const byItem = group((x) => (x.w.ingredientId ? `i:${x.w.ingredientId}` : `d:${x.w.itemId}`));
  const byReason = group((x) => x.w.reason);
  const byOutlet = group((x) => x.w.outletId);
  const t = c.now;
  const lost = logs.reduce((s, x) => s + x.cost, 0);
  const prev = prevSel(sel).range;
  const lostBefore = ctx.waste.filter((w) => inArea(w) && w.date >= prev.from && w.date <= prev.to).reduce((s, w) => s + wasteCost(w, ctx.overrides) * fxRate(propertyById[outletById[w.outletId].propertyId].currency, currency), 0);
  const marginCost = t.net > 0 ? (lost / t.net) * 100 : 0;

  if (logs.length === 0) return <EmptyState title={`No ${word} waste recorded in this period`}>Anything logged with the Log waste button appears here at once.</EmptyState>;

  return (
    <div className="space-y-5">
      <Panel title={`What ${word} waste cost`} description={`${fmtRange(sel.range)}. ${area === "drinks" ? "Beverage" : "Food"} only. Breakage is under Inventory.`}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-3">
          <Stat label="Waste cost" value={money(lost)} delta={<Delta value={pctChange(lost, lostBefore)} goodWhen="down" />} />
          <Stat label="Waste per guest" value={money(t.covers ? lost / t.covers : 0, { decimals: true })} />
          <Stat label="Margin without this waste" value={fmtPct(t.net ? (t.grossProfit + lost) / t.net : 0)} sub={`${marginCost.toFixed(2)} points lower with it`} />
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Panel title="Most wasted" description="By cost, ingredients and prepared dishes.">
          <BarList format={(n) => money(n)} rows={byItem.slice(0, 8).map((r) => ({ key: r.k, label: r.k.startsWith("i:") ? ingredientById[r.k.slice(2)].name : `${itemById[r.k.slice(2)].name} (prepared)`, value: r.value }))} />
        </Panel>
        <Panel title="By reason">
          <BarList format={(n) => money(n)} rows={byReason.map((r) => ({ key: r.k, label: REASON_LABEL[r.k as WasteReason].en, sub: fmtPct(lost ? r.value / lost : 0, 0), value: r.value }))} />
          <Note className="mt-3">Spoilage points to over-ordering, which Purchasing Prediction addresses. Waste points to preparation and portioning.</Note>
        </Panel>
        <Panel title="By outlet">
          <BarList format={(n) => money(n)} rows={byOutlet.map((r) => ({ key: r.k, label: outletLabel(r.k), value: r.value, outletId: r.k }))} />
        </Panel>
      </div>

      {(() => {
        // Possible reasons and how to help, by fixed rules from the figures above. To check, not proven.
        const share = (r: WasteReason) => (lost ? (byReason.find((x) => x.k === r)?.value ?? 0) / lost : 0);
        const topItem = byItem[0] ? (byItem[0].k.startsWith("i:") ? ingredientById[byItem[0].k.slice(2)].name : itemById[byItem[0].k.slice(2)].name) : null;
        const topOutlet = byOutlet[0] ? outletLabel(byOutlet[0].k) : null;
        const likely: string[] = [];
        const help: string[] = [];
        if (share("spoilage") >= 0.25) { likely.push(`${fmtPct(share("spoilage"), 0)} is spoilage: more is bought than is used before it goes off.`); help.push(`Lower the order for ${topItem ?? "the most wasted items"} on Predictions and check how it is stored.`); }
        if (share("waste") >= 0.25) { likely.push(`${fmtPct(share("waste"), 0)} is unused or dropped: preparation runs ahead of what sells.`); help.push(`Prep to the forecast covers at ${topOutlet ?? "the outlet that wastes most"} with Plan the prep, in smaller batches.`); }
        if (topOutlet && byOutlet.length > 1 && byOutlet[0].value > byOutlet[1].value * 1.5) { likely.push(`${topOutlet} loses more than any other outlet.`); help.push(`Walk the team at ${topOutlet} through their top three wasted items this week.`); }
        if (!likely.length) return null;
        return (
          <Panel title="Possible reasons and how to help" description="Worked out from the figures by fixed rules. To check, not proven.">
            <div className="grid gap-4 text-[13px] md:grid-cols-2">
              <ul className="list-disc space-y-1 ps-4 text-graphite">{likely.map((l) => <li key={l}>{l}</li>)}</ul>
              <ol className="list-decimal space-y-1 ps-4 text-graphite">{help.map((h) => <li key={h}>{h}</li>)}</ol>
            </div>
          </Panel>
        );
      })()}
    </div>
  );
}
