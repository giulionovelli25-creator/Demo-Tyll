"use client";
// Shared figures for the number strips. Each is computed once per page from the records the screens already read.
import { useMemo } from "react";
import { outletById, propertyById } from "./data/catalog";
import { countVariance, countVarianceValue, deliveryOvercharge, matchDeliveryLine, receivedAsCorrected } from "./domain/inventory";
import { computeTotals, type Totals } from "./domain/metrics";
import { byDay, lastDays } from "./domain/trends";
import { useDemo } from "./store";
import { useCtx, useVariancePeriods, useView } from "./hooks";
import { periodVariance } from "./domain/variance";
import { DEMO_TODAY, addDays, sum } from "./util";

/** The current selection's totals for each of the last 30 full days. Today is left out: it is only part of a day. */
export function useDailyTotals(n = 30, propertyId?: string | null): { date: string; t: Totals }[] {
  const ctx = useCtx();
  const { sel } = useView();
  return useMemo(() => {
    // Limited to one hotel when the figures sit beside that hotel's own numbers, so currencies never mix.
    const s = propertyId ? { ...sel, outletIds: sel.outletIds.filter((o) => outletById[o].propertyId === propertyId), wholeProperties: sel.wholeProperties.filter((p) => p === propertyId), currency: propertyById[propertyId].currency } : sel;
    return lastDays(n, addDays(DEMO_TODAY, -1)).map((date) => ({ date, t: computeTotals(ctx, { ...s, range: { from: date, to: date } }) }));
  }, [ctx, sel, n, propertyId]);
}

/** The same totals for this week and the week before, for the comparisons. */
export function useWeekTotals(): { now: Totals; before: Totals } {
  const ctx = useCtx();
  const { sel } = useView();
  return useMemo(() => ({
    now: computeTotals(ctx, { ...sel, range: { from: addDays(DEMO_TODAY, -6), to: DEMO_TODAY } }),
    before: computeTotals(ctx, { ...sel, range: { from: addDays(DEMO_TODAY, -13), to: addDays(DEMO_TODAY, -7) }, cutDate: addDays(DEMO_TODAY, -7) }),
  }), [ctx, sel]);
}

/** Stock missing at each weekly count of one hotel, newest first: the value short and how many items had a gap. */
export function useCountGaps(propertyId: string | null) {
  const ctx = useCtx();
  return useMemo(() => {
    if (!propertyId) return [];
    const byDate = new Map<string, { value: number; items: number; largest: { ingredientId: string; value: number } | null }>();
    for (const c of ctx.counts) {
      if (c.propertyId !== propertyId || c.kind !== "weekly") continue;
      const gap = countVariance(c);
      if (gap >= 0) { if (!byDate.has(c.date)) byDate.set(c.date, { value: 0, items: 0, largest: null }); continue; }
      const value = -countVarianceValue(c, ctx.overrides);
      const cur = byDate.get(c.date) ?? { value: 0, items: 0, largest: null };
      cur.value += value;
      cur.items += 1;
      if (!cur.largest || value > cur.largest.value) cur.largest = { ingredientId: c.ingredientId, value };
      byDate.set(c.date, cur);
    }
    return [...byDate].map(([date, v]) => ({ date, ...v })).sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [ctx.counts, ctx.overrides, propertyId]);
}

/** The three way check of each delivery in one hotel: ordered, delivered and invoiced. The same figures as Deliveries and invoices. */
export function useDeliveryChecks(propertyId: string | null | undefined) {
  const ctx = useCtx();
  const receipts = useDemo((s) => s.receiptCorrections);
  return useMemo(() => {
    const ds = receivedAsCorrected(ctx.data.deliveries, receipts).filter((d) => d.propertyId === propertyId && d.status === "delivered").map((d) => ({ d, over: deliveryOvercharge(d), issue: d.lines.some((l) => matchDeliveryLine(l).issues.length > 0) }));
    return { issues: ds.filter((x) => x.issue).length, value: sum(ds, (x) => x.over), perDay: byDay(ds, (x) => x.d.date, (x) => x.over, lastDays(13)) };
  }, [ctx.data.deliveries, receipts, propertyId]);
}

/** Stock used without a sale or waste to explain it, at cost: the same figure as the top of Counts and missing stock. */
export function useUnexplained(propertyId: string | null) {
  const ctx = useCtx();
  const { sel } = useView();
  const { data } = useVariancePeriods(propertyId ?? "dxb");
  return useMemo(() => {
    const outlets = new Set(sel.outletIds);
    const flagged = (data?.periods ?? []).filter((p) => outlets.has(p.outletId)).map((p) => periodVariance(p, ctx.adjust)).filter((v) => v.significant && v.unexplained > 0);
    return data ? { value: sum(flagged, (v) => v.value), items: flagged.length } : null;
  }, [data, sel.outletIds, ctx.adjust]);
}
