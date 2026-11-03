"use client";
// Missing drinks: bottles and cans used that sales do not explain, and drinks taken off a bill after they went to the bar.
// A difference has several possible explanations, so this lists facts and what to check. It never says who or why.
import Link from "next/link";
import { useMemo } from "react";
import { EmptyState, Note, textLink } from "@/components/ui";
import { ingredientById, outletById, propertyById } from "@/lib/data/catalog";
import { groupByStock, stockAreaOf } from "@/lib/data/locations";
import { allowedProperties } from "@/lib/domain/access";
import { REMOVAL_TYPES } from "@/lib/domain/detect";
import { periodVariance, qtyWords } from "@/lib/domain/variance";
import { useCtx, useInvestigations, useVariancePeriods, useView } from "@/lib/hooks";
import { fmtMoney } from "@/lib/util";
import { periodPlace } from "@/components/stock/usage";

export function useMissingDrinks() {
  const { user, sel, propertyId } = useView();
  const ctx = useCtx();
  const cases = useInvestigations();
  const pid = propertyId ?? allowedProperties(user)[0];
  const { data } = useVariancePeriods(pid);
  return useMemo(() => {
    const outlets = new Set(sel.outletIds);
    const unexplained = (data?.periods ?? [])
      .filter((p) => outlets.has(p.outletId) && stockAreaOf(p.ingredientId) === "drinks")
      .map((p) => ({ p, v: periodVariance(p, ctx.adjust) }))
      .filter(({ v }) => v.significant && v.unexplained > 0)
      .map((r) => ({ ...r, value: r.v.unexplained * r.p.unitCost }))
      .sort((a, b) => b.value - a.value);
    const removed = cases.filter((c) => c.status !== "closed" && REMOVAL_TYPES.includes(c.type) && /\bbar\b/i.test(c.headline) && (!c.outletId || outlets.has(c.outletId)));
    return { pid, unexplained, removed, loading: !data, count: unexplained.length + removed.length };
  }, [data, sel.outletIds, ctx.adjust, cases, pid]);
}

const ROW = "flex flex-col gap-1 border-t border-hair px-4 py-3 transition-colors duration-150 hover:bg-cloud sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-6";
const FIGURE = "min-w-0 rounded-[var(--radius-control)] bg-cloud px-3 py-2";

export function MissingDrinks() {
  const { pid, unexplained, removed, loading } = useMissingDrinks();
  const money = (n: number) => fmtMoney(n, propertyById[pid].currency, { decimals: true });
  if (loading) return <p className="px-4 pb-4 text-sm text-steel sm:px-6">Checking the counts.</p>;
  if (unexplained.length === 0 && removed.length === 0) return <div className="p-4 sm:p-6"><EmptyState title="No missing drinks right now">Drinks used match what was sold in your selection.</EmptyState></div>;
  const groups = groupByStock(unexplained, (r) => r.p.ingredientId);
  return (
    <>
      {groups.map((group) => (
        <div key={group.id}>
          <h3 className="border-t border-hair bg-cloud px-4 py-1.5 text-xs font-semibold text-ink sm:px-6">{group.name}</h3>
          <ul>
            {group.rows.map(({ p, v, value }) => (
              <li key={p.id}>
                <Link href={`/stock?tab=where&period=${p.id}`} className="block border-t border-hair px-4 py-3 transition-colors duration-150 hover:bg-cloud sm:px-6">
                  <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="text-[15px] font-semibold text-ink">{ingredientById[p.ingredientId].name}, {outletById[p.outletId].name}</span>
                    <span className="text-xs text-steel">{periodPlace(p).split(", ").slice(1).join(", ")}</span>
                  </span>
                  <span className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <span className={FIGURE}><span className="block text-xs text-steel">Sold</span><span className="num block text-[17px] font-semibold text-ink">{qtyWords(v.expected, p.ingredientId)}</span></span>
                    <span className={FIGURE}><span className="block text-xs text-steel">Actually used</span><span className="num block text-[17px] font-semibold text-ink">{qtyWords(v.actual, p.ingredientId)}</span></span>
                    <span className={FIGURE}><span className="block text-xs text-steel">Not explained</span><span className="num block text-[17px] font-semibold text-neg">{qtyWords(v.unexplained, p.ingredientId)}</span></span>
                    <span className={FIGURE}><span className="block text-xs text-steel">Worth</span><span className="num block text-[17px] font-semibold text-money">{money(value)}</span></span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {removed.length > 0 && (
        <div>
          <h3 className="border-t border-hair bg-cloud px-4 py-1.5 text-xs font-semibold text-ink sm:px-6">Removed from a bill after going to the bar</h3>
          <ul>
            {removed.map((c) => (
              <li key={c.id}>
                <Link href={`/investigations/${c.id}`} className={ROW}>
                  <span className="min-w-0 text-sm font-medium text-ink">{c.headline}</span>
                  <span className="num shrink-0 text-sm font-medium text-money">{money(c.exposure)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="space-y-2 border-t border-hair px-4 py-3 sm:px-6">
        <Note>A difference can have several explanations, such as complimentary drinks, waste not logged or a late delivery. Check before concluding. Simulated data.</Note>
        <p><Link href="/stock?tab=where" className={textLink}>See all missing stock</Link></p>
      </div>
    </>
  );
}
