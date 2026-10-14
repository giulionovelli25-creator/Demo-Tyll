"use client";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Delta, EmptyState, Segmented, Select, TableWrap, Td, Th, cn, rowClass, useSort } from "@/components/ui";
import { itemById } from "@/lib/data/catalog";
import type { ItemRow } from "@/lib/domain/metrics";
import { fmtNum, fmtPct, pctChange } from "@/lib/util";

type Key = "name" | "units" | "revenue" | "price" | "unitCost" | "unitProfit" | "grossProfit" | "margin" | "marginMove" | "priceChange";
type Show = "all" | "best" | "least" | "falling";

const marginMove = (r: ItemRow) => (r.marginBefore === null ? 0 : (r.margin - r.marginBefore) * 100);

export function MenuTable({ rows, money }: { rows: ItemRow[]; money: (n: number, o?: { compact?: boolean; decimals?: boolean }) => string }) {
  const router = useRouter();
  const { sort, toggle } = useSort<Key>({ key: "grossProfit", dir: "desc" });
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("all");
  const [show, setShow] = useState<Show>("all");
  const categories = useMemo(() => [...new Set(rows.map((r) => itemById[r.itemId].category))].sort(), [rows]);

  const visible = useMemo(() => {
    let list = rows.filter((r) => r.units > 0 || r.unitsBefore > 0);
    if (q.trim()) list = list.filter((r) => itemById[r.itemId].name.toLowerCase().includes(q.trim().toLowerCase()));
    if (category !== "all") list = list.filter((r) => itemById[r.itemId].category === category);
    if (show === "falling") list = list.filter((r) => marginMove(r) <= -0.5);
    const value = (r: ItemRow): number | string =>
      ({ name: itemById[r.itemId].name, units: r.units, revenue: r.revenue, price: r.price, unitCost: r.unitCost, unitProfit: r.unitProfit, grossProfit: r.grossProfit, margin: r.margin, marginMove: marginMove(r), priceChange: r.priceChangePct })[sort.key];
    list = [...list].sort((a, b) => {
      const [x, y] = [value(a), value(b)];
      const d = typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number);
      return sort.dir === "asc" ? d : -d;
    });
    if (show === "best") list = [...list].sort((a, b) => b.units - a.units).slice(0, 8);
    if (show === "least") list = [...list].sort((a, b) => a.units - b.units).slice(0, 8);
    return list;
  }, [rows, q, category, show, sort]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 px-5 pb-4 sm:px-6">
        <Segmented label="Show" size="sm" value={show} onChange={setShow} options={[{ value: "all", label: "All items" }, { value: "best", label: "Best sellers" }, { value: "least", label: "Least sold" }, { value: "falling", label: "Falling margin" }]} />
        <Select label="Category" hideLabel className="w-[160px]" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="all">All categories</option>
          {categories.map((c) => <option key={c}>{c}</option>)}
        </Select>
        <div className="relative ml-auto w-full sm:w-[220px]">
          <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-steel" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a dish or drink" aria-label="Find a dish or drink" className="h-10 w-full rounded-full border border-line bg-paper pl-9 pr-3 text-sm placeholder:text-fog hover:border-fog" />
        </div>
      </div>
      {visible.length === 0 ? (
        <div className="px-5 pb-6 sm:px-6"><EmptyState title="No items match these filters">Clear the search or choose another category.</EmptyState></div>
      ) : (
        <TableWrap>
          <table className="w-full min-w-[980px] text-sm">
            <thead>
              <tr>
                <Th sortKey="name" sort={sort} onSort={toggle}>Item</Th>
                <Th sortKey="units" sort={sort} onSort={toggle} align="right">Units sold</Th>
                <Th sortKey="revenue" sort={sort} onSort={toggle} align="right">Revenue</Th>
                <Th sortKey="price" sort={sort} onSort={toggle} align="right">Selling price</Th>
                <Th sortKey="unitCost" sort={sort} onSort={toggle} align="right">Ingredient cost</Th>
                <Th sortKey="unitProfit" sort={sort} onSort={toggle} align="right">Profit per unit</Th>
                <Th sortKey="grossProfit" sort={sort} onSort={toggle} align="right">Total gross profit</Th>
                <Th sortKey="margin" sort={sort} onSort={toggle} align="right">Margin</Th>
                <Th sortKey="marginMove" sort={sort} onSort={toggle} align="right">Margin change</Th>
                <Th sortKey="priceChange" sort={sort} onSort={toggle} align="right">Price change</Th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const it = itemById[r.itemId];
                const move = marginMove(r);
                return (
                  <tr key={r.itemId} className={cn(rowClass, "cursor-pointer")} onClick={() => router.push(`/menu/${r.itemId}`)}>
                    <Td>
                      <button type="button" className="text-left text-ink underline-offset-4 hover:underline" onClick={(e) => { e.stopPropagation(); router.push(`/menu/${r.itemId}`); }}>{it.name}</button>
                      <span className="mt-0.5 flex items-center gap-2 text-xs text-steel">{it.category}{!r.hasRecipe && <Badge className="!py-0">standard cost</Badge>}</span>
                    </Td>
                    <Td align="right">{fmtNum(r.units)}<span className="block"><Delta value={pctChange(r.units, r.unitsBefore)} /></span></Td>
                    <Td align="right">{money(r.revenue)}</Td>
                    <Td align="right">{money(r.price, { decimals: r.price % 1 !== 0 })}</Td>
                    <Td align="right">{money(r.unitCost, { decimals: true })}{Math.abs(r.costChangePct) >= 0.005 && <span className="block"><Delta value={r.costChangePct} goodWhen="down" /></span>}</Td>
                    <Td align="right">{money(r.unitProfit, { decimals: true })}</Td>
                    <Td align="right" className="text-ink">{money(r.grossProfit)}</Td>
                    <Td align="right">{fmtPct(r.margin)}</Td>
                    <Td align="right">{r.marginBefore === null ? <span className="text-xs text-fog">new</span> : <Delta value={move} kind="pts" />}</Td>
                    <Td align="right">{Math.abs(r.priceChangePct) < 0.0005 ? <span className="text-xs text-fog">none</span> : <Delta value={r.priceChangePct} goodWhen="none" />}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      )}
    </div>
  );
}
