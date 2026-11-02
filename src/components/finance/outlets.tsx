"use client";
// Finance: revenue, cost and profit per outlet, with drill down to transactions and flagged items.
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { Delta, EmptyState, Panel, Stat, StatusPill, TableWrap, Td, Th, cn, rowClass, useSort, type Rag } from "@/components/ui";
import { outletById, propertyById } from "@/lib/data/catalog";
import { compare, exceptionInSel, totalsByOutlet, type OutletRow, type Totals } from "@/lib/domain/metrics";
import { useCtx, useInvestigations, useView } from "@/lib/hooks";
import { useDemo } from "@/lib/store";
import { fmtDate, fmtPct, fxRate, pctChange, sum } from "@/lib/util";

type Key = "name" | "revenue" | "cost" | "profit" | "margin" | "flags";

const costOf = (t: Totals) => t.operatingExpenses ?? t.fnbCost;
const profitOf = (t: Totals) => t.operatingProfit ?? t.grossProfit;

function ragOf(r: OutletRow): Rag {
  const move = (r.now.gpMargin - r.before.gpMargin) * 100;
  return move <= -2 ? "red" : move <= -0.5 ? "amber" : "green";
}

export function OutletFinance() {
  const { sel, money } = useView();
  const ctx = useCtx();
  const investigations = useInvestigations();
  const setScope = useDemo((s) => s.setScope);
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const { sort, toggle: flip } = useSort<Key>({ key: "revenue", dir: "desc" });
  const toggle = (k: Key) => flip(k, k === "name" ? "asc" : "desc");
  const c = useMemo(() => compare(ctx, sel), [ctx, sel]);
  const rows = useMemo(() => totalsByOutlet(ctx, sel), [ctx, sel]);
  const flags = useMemo(() => investigations.filter((i) => i.status !== "closed" && exceptionInSel(i, sel)), [investigations, sel]);
  const flagsOf = (id: string) => flags.filter((i) => i.outletId === id);
  const flagValue = (id: string) => sum(flagsOf(id), (i) => i.exposure * fxRate(propertyById[i.propertyId].currency, sel.currency));
  const hasOps = c.now.operatingProfit !== null;
  const profitWord = hasOps ? "Net profit, estimate" : "Gross profit";

  const sorted = useMemo(() => {
    const value = (r: OutletRow): number | string => ({ name: outletById[r.outletId].name, revenue: r.now.net, cost: costOf(r.now), profit: profitOf(r.now), margin: r.now.gpMargin, flags: flagValue(r.outletId) })[sort.key];
    return [...rows].sort((a, b) => {
      const [x, y] = [value(a), value(b)];
      const d = typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number);
      return sort.dir === "asc" ? d : -d;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort, flags]);

  const drill = (outletId: string, tab: "orders" | "mistakes") => {
    setScope({ propertyId: outletById[outletId].propertyId, outletId });
    router.push(`/money?tab=${tab}`);
  };
  const tile = "rounded-panel border border-line bg-paper p-4 shadow-panel";

  const Detail = ({ r }: { r: OutletRow }) => (
    <div className="grid gap-4 bg-cloud p-4 sm:grid-cols-2 sm:p-6">
      <dl className="space-y-1.5 text-table">
        {([["Food and drink cost", r.now.fnbCost], ["of which waste", r.now.waste], ["of which missing stock", r.now.variance], ["Staff, estimate", r.now.labor], ["Running costs, estimate", r.now.opex], ["Discounts, comps and refunds", r.now.gross - r.now.net]] as [string, number | null][]).map(([k, v]) => v === null ? null : (
          <div key={k} className="flex justify-between gap-4"><dt className="text-graphite">{k}</dt><dd className="num text-ink">{money(v)}</dd></div>
        ))}
      </dl>
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-ink">{flagsOf(r.outletId).length ? `${flagsOf(r.outletId).length} flagged, ${money(flagValue(r.outletId))} at risk` : "Nothing flagged here"}</p>
        <ul className="mt-1 space-y-1 text-[13px] text-graphite">
          {flagsOf(r.outletId).sort((a, b) => b.exposure - a.exposure).slice(0, 3).map((i) => <li key={i.id} className="truncate">{fmtDate(i.date)}: {i.headline}</li>)}
        </ul>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={() => drill(r.outletId, "orders")} className="inline-flex h-9 items-center rounded-full bg-accent px-4 text-[13px] font-medium text-on-accent transition-colors duration-200 hover:bg-accent-hover">See transactions</button>
          <button type="button" onClick={() => drill(r.outletId, "mistakes")} className="inline-flex h-9 items-center rounded-full border border-line px-4 text-[13px] font-medium text-ink transition-colors duration-200 hover:bg-paper">See flagged items</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <div className={tile}><Stat label="Revenue" value={money(c.now.net, { compact: true })} delta={<Delta value={pctChange(c.now.net, c.before.net)} />} sub="vs the period before" /></div>
        <div className={tile}><Stat label={hasOps ? "Cost, estimate" : "Food and drink cost"} value={money(costOf(c.now), { compact: true })} delta={<Delta value={pctChange(costOf(c.now), costOf(c.before))} goodWhen="down" />} sub="vs the period before" /></div>
        <div className={tile}><Stat label={profitWord} value={money(profitOf(c.now), { compact: true })} delta={<Delta value={pctChange(profitOf(c.now), profitOf(c.before))} />} sub="vs the period before" /></div>
        <div className={tile}><Stat label="Gross margin" value={fmtPct(c.now.gpMargin)} delta={<Delta value={(c.now.gpMargin - c.before.gpMargin) * 100} kind="pts" />} sub="vs the period before" /></div>
      </div>

      <Panel title="Revenue, cost and profit per outlet" description="Open an outlet to see what makes up its costs, then its transactions and flagged items." flush>
        {rows.length === 0 ? <div className="px-4 pb-6 sm:px-6"><EmptyState title="No outlet selected">Pick an outlet in the top bar.</EmptyState></div> : (
          <>
            <ul className="md:hidden">
              {sorted.map((r) => (
                <li key={r.outletId} className="border-t border-hair">
                  <button type="button" onClick={() => setOpen(open === r.outletId ? null : r.outletId)} aria-expanded={open === r.outletId} className="w-full px-4 py-4 text-left">
                    <span className="flex items-center justify-between gap-2"><span className="text-sm font-medium text-ink">{outletById[r.outletId].name}</span><StatusPill rag={ragOf(r)}>{fmtPct(r.now.gpMargin)} margin</StatusPill></span>
                    <span className="mt-2 grid grid-cols-3 gap-2 text-table">
                      <span><span className="block text-xs text-steel">Revenue</span><span className="num text-ink">{money(r.now.net, { compact: true })}</span></span>
                      <span><span className="block text-xs text-steel">Cost</span><span className="num text-ink">{money(costOf(r.now), { compact: true })}</span></span>
                      <span><span className="block text-xs text-steel">Profit</span><span className={cn("num", profitOf(r.now) < 0 ? "text-neg" : "text-ink")}>{money(profitOf(r.now), { compact: true })}</span></span>
                    </span>
                  </button>
                  {open === r.outletId && <Detail r={r} />}
                </li>
              ))}
            </ul>
            <TableWrap className="hidden md:block">
              <table className="w-full min-w-[820px] text-table">
                <thead>
                  <tr>
                    <Th sortKey="name" sort={sort} onSort={toggle}>Outlet</Th>
                    <Th sortKey="revenue" sort={sort} onSort={toggle} align="right">Revenue</Th>
                    <Th sortKey="cost" sort={sort} onSort={toggle} align="right">Cost</Th>
                    <Th sortKey="profit" sort={sort} onSort={toggle} align="right">{hasOps ? "Net profit" : "Gross profit"}</Th>
                    <Th sortKey="margin" sort={sort} onSort={toggle} align="right">Gross margin</Th>
                    <Th sortKey="flags" sort={sort} onSort={toggle} align="right">Flagged</Th>
                    <Th><span className="sr-only">Open</span></Th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => (
                    <Fragment key={r.outletId}>
                      <tr className={cn(rowClass, "cursor-pointer")} onClick={() => setOpen(open === r.outletId ? null : r.outletId)}>
                        <Td><span className="font-medium text-ink">{outletById[r.outletId].name}</span><span className="block text-xs text-steel">{outletById[r.outletId].kind}</span></Td>
                        <Td align="right"><span className="text-ink">{money(r.now.net, { compact: true })}</span><span className="block"><Delta value={pctChange(r.now.net, r.before.net)} /></span></Td>
                        <Td align="right"><span className="text-ink">{money(costOf(r.now), { compact: true })}</span><span className="block"><Delta value={pctChange(costOf(r.now), costOf(r.before))} goodWhen="down" /></span></Td>
                        <Td align="right"><span className={profitOf(r.now) < 0 ? "text-neg" : "text-ink"}>{money(profitOf(r.now), { compact: true })}</span><span className="block"><Delta value={pctChange(profitOf(r.now), profitOf(r.before))} /></span></Td>
                        <Td align="right"><StatusPill rag={ragOf(r)}>{fmtPct(r.now.gpMargin)}</StatusPill><span className="mt-0.5 block"><Delta value={(r.now.gpMargin - r.before.gpMargin) * 100} kind="pts" /></span></Td>
                        <Td align="right">{flagsOf(r.outletId).length ? <span className="text-money">{money(flagValue(r.outletId))}<span className="block text-xs">{flagsOf(r.outletId).length} open</span></span> : <span className="text-steel">None</span>}</Td>
                        <Td align="right"><button type="button" aria-expanded={open === r.outletId} aria-label={`Open ${outletById[r.outletId].name}`} onClick={(e) => { e.stopPropagation(); setOpen(open === r.outletId ? null : r.outletId); }} className="rounded-full p-1.5 text-steel transition-colors duration-200 hover:bg-mist hover:text-ink"><ChevronDown size={16} className={cn("transition-transform duration-200", open === r.outletId && "rotate-180")} aria-hidden /></button></Td>
                      </tr>
                      {open === r.outletId && <tr><td colSpan={7} className="p-0"><Detail r={r} /></td></tr>}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </>
        )}
      </Panel>
    </div>
  );
}
