"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronDown, Search } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Badge, EmptyState, Note, Panel, Stat, TableWrap, Td, Th, cn, rowClass, useSort } from "@/components/ui";
import { ingredientById, outletById, propertyById, supplierById } from "@/lib/data/catalog";
import { can } from "@/lib/domain/access";
import { countVariance, countVarianceValue, type StockRow } from "@/lib/domain/inventory";
import { personName, useCtx, useInvestigations, useServerStock, useUser } from "@/lib/hooks";
import { STATUS_LABEL } from "@/lib/labels";
import { OpenStockCase } from "./stock-case";
import { fmtDate, fmtMoney, fmtNum, fmtQty, sum } from "@/lib/util";

type Key = "name" | "estimated" | "usage" | "value" | "cover" | "waste";

export function Inventory({ propertyId }: { propertyId: string }) {
  const ctx = useCtx();
  const property = propertyById[propertyId];
  const money = (n: number, decimals = false) => fmtMoney(n, property.currency, { decimals });
  const { data } = useServerStock(propertyId);
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const [q, setQ] = useState("");
  const [priority, setPriority] = useState(false);
  const { sort, toggle } = useSort<Key>({ key: "value", dir: "desc" });
  const user = useUser()!;
  const investigations = useInvestigations();
  // A link from a case names the item to open.
  const linked = useSearchParams().get("item");
  const [open, setOpen] = useState<string | null>(linked);
  useEffect(() => {
    if (linked && data) document.getElementById(`item-${linked}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [linked, data]);

  const lastFull = useMemo(() => {
    const dates = ctx.counts.filter((c) => c.propertyId === propertyId && c.kind === "weekly").map((c) => c.date).sort();
    return dates[dates.length - 1];
  }, [ctx.counts, propertyId]);
  const missingAtCount = useMemo(() => -sum(ctx.counts.filter((c) => c.propertyId === propertyId && c.date === lastFull), (c) => countVarianceValue(c, ctx.overrides)), [ctx.counts, ctx.overrides, propertyId, lastFull]);

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    const value = (r: StockRow): number | string =>
      ({ name: ingredientById[r.ingredientId].name, estimated: r.estimated, usage: r.usage, value: r.value, cover: r.daysCover ?? 999, waste: r.waste + r.breakage })[sort.key];
    return rows
      .filter((r) => (!priority || ingredientById[r.ingredientId].priority) && (!term || ingredientById[r.ingredientId].name.toLowerCase().includes(term)))
      .sort((a, b) => {
        const [x, y] = [value(a), value(b)];
        const d = typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number);
        return sort.dir === "asc" ? d : -d;
      });
  }, [rows, q, priority, sort]);
  const cost = (r: StockRow, qty: number) => qty * r.unitCost;

  return (
    <div className="space-y-5">
      <Panel title="Stock since the last count" description={`Estimated stock is the last physical count plus deliveries, less what recipes say was used, less recorded waste and breakage, plus or minus transfers. Last full count: ${lastFull ? fmtDate(lastFull, true) : "none"}.`}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-6 md:grid-cols-4 xl:grid-cols-7">
          <Stat label="Estimated stock value" value={money(sum(rows, (r) => r.value))} />
          <Stat label="Stock received" value={money(sum(rows, (r) => cost(r, r.received)))} />
          <Stat label="Expected usage" value={money(sum(rows, (r) => cost(r, r.usage)))} sub="from recipes and sales" />
          <Stat label="Recorded waste" value={money(sum(rows, (r) => cost(r, r.waste)))} />
          <Stat label="Breakages" value={money(sum(rows, (r) => cost(r, r.breakage)))} />
          <Stat label="Transfers, net" value={money(sum(rows, (r) => cost(r, r.transferIn - r.transferOut)))} sub="in less out" />
          <Stat label="Missing at last count" tone={missingAtCount > 0 ? "warn" : undefined} value={money(missingAtCount)} sub="expected less counted" />
        </div>
      </Panel>

      <Panel title="Items" flush>
        <div className="flex flex-wrap items-center gap-2 px-5 pb-4 sm:px-6">
          <label className="flex h-10 cursor-pointer items-center gap-2 rounded-full border border-line px-4 text-sm"><input type="checkbox" className="accent-ink" checked={priority} onChange={(e) => setPriority(e.target.checked)} /> Priority items only</label>
          <div className="relative ml-auto w-full sm:w-[240px]">
            <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-steel" aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an item" aria-label="Find an item" className="h-10 w-full rounded-full border border-line bg-paper pl-9 pr-3 text-sm placeholder:text-fog hover:border-fog" />
          </div>
        </div>
        {!data ? <div className="px-5 pb-6 sm:px-6"><EmptyState title="Loading stock" /></div> : visible.length === 0 ? <div className="px-5 pb-6 sm:px-6"><EmptyState title="No items match" /></div> : (
          <TableWrap>
            <table className="w-full min-w-[1080px] text-sm">
              <thead>
                <tr>
                  <Th sortKey="name" sort={sort} onSort={toggle}>Item</Th>
                  <Th align="right">Last count</Th>
                  <Th align="right">Received</Th>
                  <Th sortKey="usage" sort={sort} onSort={toggle} align="right">Expected usage</Th>
                  <Th sortKey="waste" sort={sort} onSort={toggle} align="right">Waste and breakage</Th>
                  <Th align="right">Transfers</Th>
                  <Th sortKey="estimated" sort={sort} onSort={toggle} align="right">Estimated now</Th>
                  <Th sortKey="cover" sort={sort} onSort={toggle} align="right">Days of cover</Th>
                  <Th sortKey="value" sort={sort} onSort={toggle} align="right">Value</Th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const g = ingredientById[r.ingredientId];
                  const net = r.transferIn - r.transferOut;
                  const low = r.daysCover !== null && r.daysCover < 1;
                  return (
                    <Fragment key={r.ingredientId}>
                    <tr id={`item-${r.ingredientId}`} className={cn(rowClass, "cursor-pointer scroll-mt-40")} onClick={() => setOpen(open === r.ingredientId ? null : r.ingredientId)}>
                      <Td><button type="button" aria-expanded={open === r.ingredientId} className="inline-flex items-center gap-1.5 text-left text-ink" onClick={(e) => { e.stopPropagation(); setOpen(open === r.ingredientId ? null : r.ingredientId); }}><ChevronDown size={14} className={cn("shrink-0 text-steel transition-transform duration-200", open === r.ingredientId && "rotate-180")} aria-hidden />{g.name}</button>{g.priority && <Badge className="ml-2 !py-0">priority</Badge>}{r.store && <Badge className="ml-2 !py-0">{outletById[r.store].name} store</Badge>}<span className="block text-xs text-steel">{supplierById[g.supplierId].name}</span></Td>
                      <Td align="right">{fmtQty(r.baselineQty, g.unit)}<span className="block text-xs text-steel">{fmtDate(r.baselineDate)}</span></Td>
                      <Td align="right">{r.received ? `+${fmtQty(r.received, g.unit)}` : "–"}</Td>
                      <Td align="right">{r.usage ? `−${fmtQty(r.usage, g.unit)}` : "–"}</Td>
                      <Td align="right">{r.waste + r.breakage ? `−${fmtQty(r.waste + r.breakage, g.unit)}` : "–"}</Td>
                      <Td align="right">{net ? `${net > 0 ? "+" : "−"}${fmtQty(Math.abs(net), g.unit)}` : "–"}</Td>
                      <Td align="right" className={cn("text-ink", r.estimated < 0 && "text-neg")}>{fmtQty(r.estimated, g.unit)}</Td>
                      <Td align="right">{r.daysCover === null ? "–" : <span className={cn(low && "text-warn")}>{fmtNum(Math.max(0, r.daysCover), 1)}{low && <Badge tone="warn" className="ml-2 !py-0">low</Badge>}</span>}</Td>
                      <Td align="right">{money(r.value)}</Td>
                    </tr>
                    {open === r.ingredientId && (
                      <tr className="border-b border-hair bg-cloud/60">
                        <td colSpan={9} className="p-0">
                          <ItemDetail row={r} propertyId={propertyId} money={money} cases={investigations.filter((i) => i.type === "stock_shortfall" && i.ingredientId === r.ingredientId && i.propertyId === propertyId)} mayCount={can(user, "stock.count")} mayLog={can(user, "stock.logWaste")} />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
        <Note className="px-6 py-4">Quantities for {property.name}, valued at today&rsquo;s cost in {property.currency}. Expected usage covers the first 20 recipes. Items sold at a standard cost do not draw down stock yet.</Note>
      </Panel>
    </div>
  );
}

/** What sits behind one inventory figure: recent counts, open cases and the next thing to do. */
function ItemDetail({ row, propertyId, money, cases, mayCount, mayLog }: {
  row: StockRow & { allocation?: Record<string, number> };
  propertyId: string;
  money: (n: number, decimals?: boolean) => string;
  cases: { id: string; headline: string; status: keyof typeof STATUS_LABEL }[];
  mayCount: boolean;
  mayLog: boolean;
}) {
  const ctx = useCtx();
  const g = ingredientById[row.ingredientId];
  const history = ctx.counts.filter((c) => c.propertyId === propertyId && c.ingredientId === row.ingredientId).sort((a, b) => b.date.localeCompare(a.date) || b.seq - a.seq).slice(0, 4);
  const shares = Object.entries(row.allocation ?? {}).filter(([, s]) => s > 0);
  // The table scrolls sideways on narrow screens. The detail stays pinned to the visible width.
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number>();
  useEffect(() => {
    const box = ref.current?.closest(".overflow-x-auto");
    if (!box) return;
    const ro = new ResizeObserver(() => setWidth(box.clientWidth));
    ro.observe(box);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} style={{ width }} className="sticky left-0 grid gap-6 px-5 py-5 sm:px-6 lg:grid-cols-[1.4fr_1fr]">
      <div>
        <h3 className="text-[15px]">Recent counts</h3>
        {history.length === 0 ? <p className="mt-2 text-sm text-steel">Not counted yet.</p> : (
          <ul className="mt-2 divide-y divide-hair rounded-2xl border border-line bg-paper text-sm">
            {history.map((c) => {
              const v = countVariance(c);
              const value = countVarianceValue(c, ctx.overrides);
              return (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
                  <span className="min-w-[150px]">{fmtDate(c.date, true)}<span className="block text-xs text-steel">{c.kind === "weekly" ? "weekly count" : "spot check"}, {personName(c.by)}</span></span>
                  <span className="num text-graphite">counted {fmtQty(c.counted, g.unit)} of {fmtQty(c.expected, g.unit)}</span>
                  <span className={cn("num", value < -0.5 ? "text-warn" : "text-steel")}>{Math.abs(v) < 0.005 ? "matches" : `${v < 0 ? "−" : "+"}${money(Math.abs(value), true)}`}</span>
                  {value < -0.5 && <OpenStockCase count={c} />}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="space-y-5">
        {shares.length > 0 && (
          <div>
            <h3 className="text-[15px]">Use in the past week</h3>
            <ul className="mt-2 space-y-1 text-sm">
              {shares.map(([id, s]) => <li key={id} className="flex justify-between gap-4"><span className="text-graphite">{outletById[id].name}</span><span className="num">{Math.round(s * 100)}%</span></li>)}
            </ul>
            <p className="mt-1 text-xs text-steel">Count differences are shared out in these proportions.</p>
          </div>
        )}
        {cases.length > 0 && (
          <div>
            <h3 className="text-[15px]">Cases</h3>
            <ul className="mt-2 space-y-1.5 text-sm">
              {cases.map((c) => <li key={c.id}><Link href={`/investigations/${c.id}`} className="underline decoration-line underline-offset-4 hover:decoration-ink">{c.headline}</Link> <Badge className="ml-1 !py-0">{STATUS_LABEL[c.status]}</Badge></li>)}
            </ul>
          </div>
        )}
        {(mayCount || mayLog) && (
          <div className="flex flex-wrap gap-2">
            {mayCount && <Link href={`/stock?tab=counts&item=${row.ingredientId}`} className="inline-flex h-9 items-center rounded-full border border-line bg-paper px-4 text-[13px] hover:border-fog">Count this item</Link>}
            {mayLog && <Link href="/stock?tab=log" className="inline-flex h-9 items-center rounded-full border border-line bg-paper px-4 text-[13px] hover:border-fog">Log waste or breakage</Link>}
          </div>
        )}
      </div>
    </div>
  );
}
