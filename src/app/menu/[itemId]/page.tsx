"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { TrendChart } from "@/components/charts";
import { Badge, Button, Crumbs, Delta, EmptyState, Note, PageHeader, Panel, Stat, TableWrap, Td, Th, cn, rowClass } from "@/components/ui";
import { ingredientById, itemById, outletById, outletLabel, propertyById } from "@/lib/data/catalog";
import { computeTotals, itemPerformance, type Sel } from "@/lib/domain/metrics";
import { ingredientCostAt, itemEconomics, recipeBreakdown } from "@/lib/domain/pricing";
import { useApi, useCtx, useView } from "@/lib/hooks";
import type { ItemOrderRow } from "@/lib/server/snapshot";
import { DEMO_TODAY, eachDay, fmtDate, fmtNum, fmtPct, fmtQty, fmtRange, fmtTime, fxRate, pctChange, previousRange } from "@/lib/util";

export default function MenuItemPage() {
  const { itemId } = useParams<{ itemId: string }>();
  const router = useRouter();
  const { sel, money, currency } = useView();
  const ctx = useCtx();
  const item = itemById[itemId];
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [shown, setShown] = useState(25);

  const selling = useMemo(() => sel.outletIds.filter((id) => outletById[id].menu.some((m) => m.itemId === itemId)), [sel.outletIds, itemId]);
  const row = useMemo(() => itemPerformance(ctx, { ...sel, dept: "all" }).find((r) => r.itemId === itemId), [ctx, sel, itemId]);
  const byOutlet = useMemo(
    () => selling.map((id) => ({ id, econ: itemEconomics(itemId, id, DEMO_TODAY, ctx.overrides), perf: itemPerformance(ctx, { ...sel, dept: "all", outletIds: [id] }).find((r) => r.itemId === itemId) })),
    [selling, itemId, ctx, sel],
  );
  const { data: fetched } = useApi<{ rows: ItemOrderRow[] }>(selling.length ? `/api/orders?item=${itemId}&from=${sel.range.from}&to=${sel.range.to}&outlets=${selling.join(",")}` : null);
  const orders = useMemo(() => (fetched?.rows ?? []).filter((r) => !onlyChanged || r.state !== "kept"), [fetched, onlyChanged]);

  // Daily margin for this item alone: sales of the item less its recipe cost on the day.
  const trend = useMemo(() => {
    if (!item || sel.range.from === sel.range.to) return [];
    const one: Sel = { ...sel, dept: "all", outletIds: selling, wholeProperties: [] };
    const prev = eachDay(previousRange(sel.range));
    const marginOn = (date: string) => {
      const r = itemPerformance(ctx, { ...one, range: { from: date, to: date } }).find((x) => x.itemId === itemId);
      return r && r.net > 0 ? r.margin * 100 : null;
    };
    return eachDay(sel.range).map((date, i) => ({ label: fmtDate(date), now: marginOn(date), before: marginOn(prev[i]) }));
  }, [ctx, sel, selling, item, itemId]);

  if (!item || selling.length === 0 || !row) {
    return (
      <EmptyState title="This item is not sold in the current selection" action={<Button variant="primary" onClick={() => router.push("/")}>Back to the overview</Button>}>
        Choose another outlet or property in the top bar.
      </EmptyState>
    );
  }
  const baseCurrencyRate = fxRate("AED", currency);
  const recipe = recipeBreakdown(item, DEMO_TODAY, ctx.overrides);
  const recipeTotal = recipe.reduce((s, l) => s + l.cost, 0);
  const totals = computeTotals(ctx, { ...sel, dept: "all" });

  return (
    <div className="space-y-5">
      <PageHeader
        crumbs={<Crumbs items={[{ label: "Tyll Overview", onClick: () => router.push("/") }, { label: "Menu performance", onClick: () => router.push("/menu") }, { label: item.name }]} />}
        title={item.name}
        lead={`${item.category}, ${item.dept === "food" ? "kitchen" : "bar"}. Sold at ${selling.length} outlet${selling.length === 1 ? "" : "s"} in this selection.`}
      >
        <Badge>{fmtRange(sel.range)}</Badge>
        {!item.recipe && <Badge tone="warn">Standard cost, no recipe yet</Badge>}
      </PageHeader>

      <Panel>
        <div className="grid grid-cols-2 gap-x-6 gap-y-6 md:grid-cols-3 xl:grid-cols-6">
          <Stat label="Units sold" value={fmtNum(row.units)} delta={<Delta value={pctChange(row.units, row.unitsBefore)} />} />
          <Stat label="Revenue" value={money(row.revenue)} sub={totals.gross ? `${fmtPct(row.revenue / totals.gross)} of all sales` : undefined} />
          <Stat label="Selling price" value={money(row.price, { decimals: row.price % 1 !== 0 })} sub={Math.abs(row.priceChangePct) > 0.0005 ? `${row.priceChangePct > 0 ? "up" : "down"} ${fmtPct(Math.abs(row.priceChangePct))}` : "unchanged"} />
          <Stat label="Ingredient cost" value={money(row.unitCost, { decimals: true })} delta={Math.abs(row.costChangePct) > 0.0005 ? <Delta value={row.costChangePct} goodWhen="down" /> : undefined} sub={Math.abs(row.costChangePct) > 0.0005 ? undefined : "unchanged"} />
          <Stat label="Gross profit per unit" value={money(row.unitProfit, { decimals: true })} sub={`${fmtPct(row.unitMargin)} margin at today's cost`} />
          <Stat label="Total gross profit" value={money(row.grossProfit)} delta={row.marginBefore === null ? undefined : <Delta value={(row.margin - row.marginBefore) * 100} kind="pts" />} sub={`${fmtPct(row.margin)} margin`} />
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Panel title="Recipe and cost" description={item.recipe ? "Cost per portion at today's ingredient prices, in the group price list (AED)." : undefined} action={<Link href="/stock?tab=recipes" className="text-[13px] text-steel underline-offset-4 hover:text-ink hover:underline">Edit ingredient prices</Link>} flush>
          {item.recipe ? (
            <TableWrap>
              <table className="w-full min-w-[460px] text-sm">
                <thead><tr><Th>Ingredient</Th><Th align="right">Quantity</Th><Th align="right">Unit cost</Th><Th align="right">Cost</Th><Th align="right">Share</Th></tr></thead>
                <tbody>
                  {recipe.sort((a, b) => b.cost - a.cost).map((l) => {
                    const g = ingredientById[l.ingredientId];
                    const was = ingredientCostAt(l.ingredientId, previousRange(sel.range).from, ctx.overrides);
                    return (
                      <tr key={l.ingredientId} className={rowClass}>
                        <Td>{g.name}{Math.abs(l.unitCost / was - 1) > 0.001 && <span className="ml-2"><Delta value={l.unitCost / was - 1} goodWhen="down" /></span>}</Td>
                        <Td align="right">{fmtQty(l.qty, g.unit)}</Td>
                        <Td align="right">{money(l.unitCost * baseCurrencyRate, { decimals: true })}</Td>
                        <Td align="right" className="text-ink">{money(l.cost * baseCurrencyRate, { decimals: true })}</Td>
                        <Td align="right">{fmtPct(recipeTotal ? l.cost / recipeTotal : 0, 0)}</Td>
                      </tr>
                    );
                  })}
                  <tr className="border-t border-line"><Td className="text-ink">Recipe cost per portion</Td><Td align="right"> </Td><Td align="right"> </Td><Td align="right" className="text-ink">{money(recipeTotal * baseCurrencyRate, { decimals: true })}</Td><Td align="right">100%</Td></tr>
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <div className="px-6 pb-6"><Note>This item is not among the first 20 recipes. Its margin uses a standard cost of {money((item.standardCost ?? 0) * baseCurrencyRate, { decimals: true })} per portion until a recipe is built.</Note></div>
          )}
        </Panel>

        <Panel title="Margin day by day" description="Net sales of this item less its recipe cost on the day.">
          {trend.length > 1 ? <TrendChart data={trend} format={(n) => `${n.toFixed(0)}%`} height={230} summary={`Daily gross margin of ${item.name} for ${fmtRange(sel.range)} against the previous period.`} /> : <Note>Choose 7 days or 30 days in the top bar to see the daily margin.</Note>}
        </Panel>
      </div>

      <Panel title="By outlet" flush>
        <TableWrap>
          <table className="w-full min-w-[820px] text-sm">
            <thead><tr><Th>Outlet</Th><Th align="right">Price</Th><Th align="right">Ingredient cost</Th><Th align="right">Profit per unit</Th><Th align="right">Margin</Th><Th align="right">Units sold</Th><Th align="right">Revenue</Th><Th align="right">Total gross profit</Th></tr></thead>
            <tbody>
              {byOutlet.map(({ id, econ, perf }) => {
                const cur = propertyById[outletById[id].propertyId].currency;
                const r = fxRate(cur, currency);
                return (
                  <tr key={id} className={rowClass}>
                    <Td className="text-ink">{outletLabel(id)}</Td>
                    <Td align="right">{money(econ.price * r, { decimals: (econ.price * r) % 1 !== 0 })}</Td>
                    <Td align="right">{money(econ.cost * r, { decimals: true })}</Td>
                    <Td align="right">{money(econ.grossProfit * r, { decimals: true })}</Td>
                    <Td align="right">{fmtPct(econ.margin)}</Td>
                    <Td align="right">{fmtNum(perf?.units ?? 0)}</Td>
                    <Td align="right">{money(perf?.revenue ?? 0)}</Td>
                    <Td align="right" className="text-ink">{money(perf?.grossProfit ?? 0)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      </Panel>

      <Panel
        title="Orders containing this item"
        description="The individual orders behind the figures above. Choose one to see its full history."
        action={<label className="flex cursor-pointer items-center gap-2 text-[13px] text-graphite"><input type="checkbox" className="accent-ink" checked={onlyChanged} onChange={(e) => { setOnlyChanged(e.target.checked); setShown(25); }} /> Only where it was removed, voided or given free</label>}
        flush
      >
        {fetched === undefined ? <div className="px-5 pb-6 sm:px-6"><EmptyState title="Loading orders" /></div> : orders.length === 0 ? <div className="px-5 pb-6 sm:px-6"><EmptyState title="No orders match" /></div> : (
          <>
            <TableWrap>
              <table className="w-full min-w-[720px] text-sm">
                <thead><tr><Th>Order</Th><Th>Outlet</Th><Th>When</Th><Th align="right">Quantity</Th><Th>On the final bill</Th><Th> </Th></tr></thead>
                <tbody>
                  {orders.slice(0, shown).map((o) => (
                    <tr key={o.id} className={cn(rowClass, "cursor-pointer")} onClick={() => router.push(`/money/orders/${o.id}`)}>
                      <Td><Link href={`/money/orders/${o.id}`} onClick={(e) => e.stopPropagation()} className="num text-ink underline-offset-4 hover:underline">{o.id}</Link></Td>
                      <Td>{outletLabel(o.outletId)}</Td>
                      <Td className="num whitespace-nowrap text-graphite">{fmtDate(o.date)}, {fmtTime(o.openMin)}</Td>
                      <Td align="right">{o.qty}</Td>
                      <Td>{o.state === "kept" ? "Charged" : o.state === "comped" ? "Complimentary" : o.state === "voided" ? "Order voided" : o.state === "removed_post" ? "Removed after dispatch" : "Removed before dispatch"}</Td>
                      <Td>{o.flagged && <Badge tone="warn">flagged</Badge>}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            <p className="num border-t border-hair px-6 py-3 text-xs text-steel">
              Showing {Math.min(shown, orders.length)} of {fmtNum(orders.length)} orders.
              {orders.length > shown && <button type="button" className="ml-3 underline underline-offset-4 hover:text-ink" onClick={() => setShown((n) => n + 25)}>Show 25 more</button>}
            </p>
          </>
        )}
      </Panel>
    </div>
  );
}
