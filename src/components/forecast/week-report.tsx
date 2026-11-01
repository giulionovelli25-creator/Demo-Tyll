"use client";
import { ArrowDown, CalendarClock, ListChecks, TriangleAlert, Wallet } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Badge, Panel, Stat, TableWrap, Td, Th, rowClass } from "@/components/ui";
import { RISK } from "@/components/forecast/parts";
import { ingredientById, outletById, propertyById, supplierById } from "@/lib/data/catalog";
import { allowedOutlets, allowedProperties } from "@/lib/domain/access";
import { useBuyPlan, type BuyDraft } from "@/lib/plan-hooks";
import type { User } from "@/lib/types";
import { fmtDate, fmtMoney, fmtQty } from "@/lib/util";

const RANK = { high: 0, medium: 1, low: 2, none: 3 } as const;

const TILE = { accent: "bg-accent-soft text-accent", pos: "bg-pos-soft text-pos", warn: "bg-warn-soft text-warn", neg: "bg-neg-soft text-neg" };

function Tile({ icon, tone = "accent", children }: { icon: ReactNode; tone?: keyof typeof TILE; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-panel border border-line bg-paper p-4 shadow-panel">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${TILE[tone]}`}>{icon}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * "What to buy this week": the purchasing report that opens first. A read-only seven-day plan for every outlet the
 * person may buy for. The step-by-step order below it is unchanged and is where a request is actually sent.
 */
export function BuyWeekReport({ user }: { user: User }) {
  const propertyId = allowedProperties(user)[0];
  const outletIds = useMemo(() => allowedOutlets(user).filter((id) => outletById[id].propertyId === propertyId), [user, propertyId]);
  const draft = useMemo<BuyDraft>(() => ({ propertyId, outletIds, period: "7", step: 2, assumptions: {}, picks: {}, comment: "" }), [propertyId, outletIds]);
  const { data, loading, error } = useBuyPlan(draft);
  const [all, setAll] = useState(false);
  const currency = propertyById[propertyId].currency;

  const lines = (data?.plan.lines ?? []).filter((l) => l.suggested > 0).sort((a, b) => a.orderBy.localeCompare(b.orderBy) || RANK[a.risk] - RANK[b.risk]);
  const short = lines.filter((l) => l.risk === "high");
  const cost = lines.reduce((s, l) => s + l.cost, 0);
  const shown = all ? lines : lines.slice(0, 8);

  return (
    <section aria-labelledby="week-report" className="space-y-4">
      <div>
        <h2 id="week-report" className="text-xl tracking-[-0.02em] text-ink">What to buy this week</h2>
        <p className="mt-1 text-sm text-steel">Next 7 days for {outletIds.length === 1 ? outletById[outletIds[0]].name : `${outletIds.length} outlets`} at {propertyById[propertyId].name}. Estimated from bookings, events and recent sales.</p>
      </div>
      {error ? (
        <p className="text-sm text-neg">{error}</p>
      ) : !data ? (
        <p className="text-sm text-steel">{loading ? "Calculating this week's needs…" : ""}</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4">
            <Tile icon={<ListChecks size={18} aria-hidden />}><Stat label="Items to order" value={lines.length} /></Tile>
            <Tile icon={<Wallet size={18} aria-hidden />}><Stat label="Estimated cost" value={fmtMoney(cost, currency)} sub="Before supplier confirmation" /></Tile>
            <Tile tone={short.length ? "neg" : "pos"} icon={<TriangleAlert size={18} aria-hidden />}><Stat label="Run short before next delivery" value={short.length} tone={short.length ? "neg" : "pos"} /></Tile>
            <Tile tone={lines[0] ? "warn" : "pos"} icon={<CalendarClock size={18} aria-hidden />}><Stat label="Earliest order-by date" value={lines[0] ? fmtDate(lines[0].orderBy) : "None"} /></Tile>
          </div>
          <a href="#order-steps" className="inline-flex h-10 items-center gap-2 rounded-full bg-accent px-4 text-sm font-medium text-paper transition-colors duration-300 ease-tyll hover:bg-accent-hover"><ArrowDown size={16} aria-hidden /> Start this order</a>
          {lines.length === 0 ? (
            <p className="text-sm text-steel">Stock covers the next 7 days. Nothing needs ordering.</p>
          ) : (
            <Panel flush>
              <ul className="sm:hidden">
                {shown.map((l) => (
                  <li key={l.ingredientId} className="border-t border-hair px-4 py-3 first:border-t-0">
                    <div className="flex items-baseline justify-between gap-3"><span className="min-w-0 text-sm text-ink">{ingredientById[l.ingredientId]?.name ?? l.ingredientId}</span><span className="num shrink-0 text-sm font-medium text-ink">{fmtQty(l.suggested, l.unit)}</span></div>
                    <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-steel">Order by {fmtDate(l.orderBy)}</span><Badge tone={RISK[l.risk].tone}>{l.risk === "high" && l.shortageDay ? `Runs short ${fmtDate(l.shortageDay)}` : RISK[l.risk].label}</Badge></div>
                  </li>
                ))}
              </ul>
              <TableWrap className="hidden sm:block">
                <table className="w-full min-w-[560px] text-sm">
                  <thead><tr><Th>Item</Th><Th align="right">Suggested</Th><Th>Order by</Th><Th>Status</Th></tr></thead>
                  <tbody>
                    {shown.map((l) => (
                      <tr key={l.ingredientId} className={rowClass}>
                        <Td><span className="block text-ink">{ingredientById[l.ingredientId]?.name ?? l.ingredientId}</span><span className="block text-xs text-steel">{supplierById[l.supplierId]?.name}</span></Td>
                        <Td align="right" className="num whitespace-nowrap">{fmtQty(l.suggested, l.unit)}</Td>
                        <Td className="whitespace-nowrap">{fmtDate(l.orderBy)}</Td>
                        <Td><Badge tone={RISK[l.risk].tone}>{l.risk === "high" && l.shortageDay ? `Runs short ${fmtDate(l.shortageDay)}` : RISK[l.risk].label}</Badge></Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
              {lines.length > 8 && (
                <div className="border-t border-hair px-4 py-3">
                  <button type="button" onClick={() => setAll((v) => !v)} className="text-sm text-ink underline-offset-4 hover:underline">{all ? "Show fewer" : `Show all ${lines.length} items`}</button>
                </div>
              )}
            </Panel>
          )}
        </>
      )}
    </section>
  );
}
