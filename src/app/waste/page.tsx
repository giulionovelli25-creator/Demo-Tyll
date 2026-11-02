"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { GlassWater } from "lucide-react";
import { useMemo } from "react";
import { BarList } from "@/components/charts";
import { mayLogBreakage, useBreakageSheet } from "@/components/shell/breakage";
import { QuickCount } from "@/components/stock/quick-count";
import { WasteAnalytics } from "@/components/stock/waste-analytics";
import { WasteLogger } from "@/components/stock/waste-logger";
import { Button, Delta, EmptyState, KeyNumber, KeyNumbers, PageHeader, Panel, Segmented, cn } from "@/components/ui";
import { ingredientById, outletLabel, propertyById } from "@/lib/data/catalog";
import { allowedProperties, can } from "@/lib/domain/access";
import { isBreakage, wasteCost } from "@/lib/domain/inventory";
import { compare, computeTotals } from "@/lib/domain/metrics";
import { useCtx, useView } from "@/lib/hooks";
import { DEMO_TODAY, addDays, fxRate, pctChange } from "@/lib/util";

export default function WastePage() {
  const { user, sel, money, propertyId } = useView();
  const ctx = useCtx();
  const params = useSearchParams();
  const router = useRouter();
  const openSheet = useBreakageSheet((s) => s.set);
  const pid = propertyId ?? allowedProperties(user)[0];
  const logging = params.get("log") === "1";
  const view = logging ? "log" : params.get("view") === "drinks" ? "drinks" : params.get("view") === "inventory" ? "inventory" : "food";
  const today = useMemo(() => computeTotals(ctx, { ...sel, range: { from: DEMO_TODAY, to: DEMO_TODAY } }), [ctx, sel]);
  const yesterday = useMemo(() => computeTotals(ctx, { ...sel, range: { from: addDays(DEMO_TODAY, -1), to: addDays(DEMO_TODAY, -1) } }), [ctx, sel]);
  const period = useMemo(() => compare(ctx, sel), [ctx, sel]);
  const brokenByOutlet = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of ctx.waste) {
      if (!w.synced || !isBreakage(w) || w.date < sel.range.from || w.date > sel.range.to || !sel.outletIds.includes(w.outletId)) continue;
      m.set(w.outletId, (m.get(w.outletId) ?? 0) + wasteCost(w, ctx.overrides) * fxRate(propertyById[pid].currency, sel.currency));
    }
    return [...m].map(([id, value]) => ({ key: id, label: outletLabel(id), value })).sort((a, b) => b.value - a.value);
  }, [ctx.waste, ctx.overrides, sel, pid]);
  const broken = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of ctx.waste) {
      if (!w.synced || !w.ingredientId || !isBreakage(w) || w.date < sel.range.from || w.date > sel.range.to || !sel.outletIds.includes(w.outletId)) continue;
      m.set(w.ingredientId, (m.get(w.ingredientId) ?? 0) + wasteCost(w, ctx.overrides) * fxRate(propertyById[pid].currency, sel.currency));
    }
    return [...m].map(([id, value]) => ({ key: id, label: ingredientById[id].name, value })).sort((a, b) => b.value - a.value).slice(0, 8);
  }, [ctx.waste, ctx.overrides, sel, pid]);
  const lostToday = today.waste + today.breakage;
  // One tap waste suits someone with their own kitchen. A director looks across outlets, so the chart takes the full width.
  const quick = can(user, "stock.logWaste") && user.outletIds !== "all";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Waste and Breakage"
        question="What did we lose today, and why?"
        lead={`${money(lostToday)} lost so far today, ${money(today.waste)} of food and drinks wasted and ${money(today.breakage)} of inventory broken.`}
      >
        {mayLogBreakage(user) && <Button variant="primary" onClick={() => openSheet(true)}><GlassWater size={16} aria-hidden /> Log breakage</Button>}
      </PageHeader>

      <KeyNumbers>
        <KeyNumber label="Food and drinks wasted today" value={money(today.waste)} delta={<Delta value={pctChange(today.waste, yesterday.waste)} goodWhen="down" />} note="vs yesterday" />
        <KeyNumber label="Inventory broken today" value={money(today.breakage)} delta={<Delta value={pctChange(today.breakage, yesterday.breakage)} goodWhen="down" />} note="vs yesterday" />
        <KeyNumber label="Food and drinks wasted, this period" value={money(period.now.waste)} delta={<Delta value={pctChange(period.now.waste, period.before.waste)} goodWhen="down" />} note="vs the period before" />
        <KeyNumber label="Inventory broken, this period" value={money(period.now.breakage)} delta={<Delta value={pctChange(period.now.breakage, period.before.breakage)} goodWhen="down" />} note="vs the period before" />
      </KeyNumbers>

      <Segmented
        label="Waste and breakage"
        value={view}
        onChange={(v) => router.replace(v === "log" ? "/waste?log=1" : v === "food" ? "/waste" : `/waste?view=${v}`)}
        options={[{ value: "food", label: "Food" }, { value: "drinks", label: "Drinks" }, { value: "inventory", label: "Inventory" }, ...(can(user, "stock.logWaste") ? [{ value: "log" as const, label: "Log waste" }] : [])]}
      />

      {logging ? <WasteLogger key={pid} propertyId={pid} /> : view === "food" || view === "drinks" ? <WasteAnalytics area={view} /> : (
        <>
          <div className={cn("grid grid-cols-1 items-start gap-4", quick && "xl:grid-cols-2")}>
            {quick && <QuickCount user={user} propertyId={pid} onFullCount={() => router.push("/count")} />}
            <Panel title="Most broken, this period" description="By value. Glassware and china.">
              {broken.length === 0 ? <EmptyState title="Nothing broken in this period">Breakage logged by the team shows up here.</EmptyState> : <BarList rows={broken} format={(n) => money(n)} />}
            </Panel>
          </div>
          {brokenByOutlet.length > 0 && <Panel title="Breakage by outlet" description="By value, this period."><BarList rows={brokenByOutlet} format={(n) => money(n)} /></Panel>}
        </>
      )}
    </div>
  );
}
