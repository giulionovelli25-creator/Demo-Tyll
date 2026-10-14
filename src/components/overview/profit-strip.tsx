"use client";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { BarList } from "@/components/charts";
import { Badge, Delta, Drawer, Note, cn } from "@/components/ui";
import { itemById, outletLabel } from "@/lib/data/catalog";
import type { Compared, ItemRow, OutletRow, Totals } from "@/lib/domain/metrics";
import { fmtPct, pctChange } from "@/lib/util";

export type MetricKey = "gross" | "net" | "fnbCost" | "grossProfit" | "labor" | "opex" | "operatingProfit";

interface MetricDef {
  key: MetricKey;
  label: string;
  kind: "total" | "deduction";
  goodWhen: "up" | "down";
  help: string;
}

export const METRICS: MetricDef[] = [
  { key: "gross", label: "Total revenue", kind: "total", goodWhen: "up", help: "Everything served at menu price, before discounts, complimentary items and refunds. Excludes tax and service charge." },
  { key: "net", label: "Net sales", kind: "total", goodWhen: "up", help: "Total revenue less discounts, complimentary items and refunds." },
  { key: "fnbCost", label: "Food and beverage cost", kind: "deduction", goodWhen: "down", help: "Recipe cost of what was sold, plus recorded waste, plus stock missing at count." },
  { key: "grossProfit", label: "Gross profit", kind: "total", goodWhen: "up", help: "Net sales less food and beverage cost." },
  { key: "labor", label: "Labor", kind: "deduction", goodWhen: "down", help: "Estimated from rostered hours. Payroll is not connected." },
  { key: "opex", label: "Other operating costs", kind: "deduction", goodWhen: "down", help: "Allocated estimate for utilities, supplies, linen and similar." },
  { key: "operatingProfit", label: "Estimated operating contribution", kind: "total", goodWhen: "up", help: "Net sales less the three cost lines above. An estimate, not accounting profit." },
];

export const metricValue = (t: Totals, key: MetricKey): number | null => t[key];

/**
 * The statement that runs from sales to profit. Each bar is drawn on the same scale as total revenue,
 * so the deductions read as the slices they remove.
 */
export function ProfitStrip({ c, money, onOpen, partialDay }: { c: Compared; money: (n: number, o?: { compact?: boolean }) => string; onOpen?: (key: MetricKey) => void; partialDay: boolean }) {
  const t = c.now;
  const scale = t.gross || 1;
  const hasOps = t.labor !== null && t.opex !== null;
  const offsets: Record<MetricKey, [number, number]> = {
    gross: [0, t.gross],
    net: [0, t.net],
    fnbCost: [t.net - t.fnbCost, t.fnbCost],
    grossProfit: [0, t.grossProfit],
    labor: [t.grossProfit - (t.labor ?? 0), t.labor ?? 0],
    opex: [t.grossProfit - (t.labor ?? 0) - (t.opex ?? 0), t.opex ?? 0],
    operatingProfit: [0, Math.max(0, t.operatingProfit ?? 0)],
  };
  return (
    <div>
      <ol className="grid grid-cols-2 gap-x-5 gap-y-6 lg:grid-cols-4 2xl:grid-cols-7">
        {METRICS.map((m) => {
          const now = metricValue(t, m.key);
          const before = metricValue(c.before, m.key);
          const [left, width] = offsets[m.key];
          const available = now !== null;
          const estimate = m.key === "operatingProfit" || m.key === "labor" || m.key === "opex";
          return (
            <li key={m.key} className={cn("min-w-0", m.key === "operatingProfit" && "col-span-2 2xl:col-span-1")}>
              <button type="button" disabled={!available || !onOpen} onClick={() => onOpen?.(m.key)} title={m.help} className="group -m-2 block w-[calc(100%+1rem)] rounded-xl p-2 text-left transition-colors duration-300 ease-tyll enabled:hover:bg-mist">
                <span className="flex items-center gap-1.5 text-[13px] text-steel">
                  {m.kind === "deduction" && <span aria-hidden>−</span>}
                  {m.label}
                  {estimate && available && <Badge className="!px-1.5 !py-0 !text-[10px]">est.</Badge>}
                </span>
                <span className={cn("num mt-1 block whitespace-nowrap leading-tight tracking-[-0.025em]", m.kind === "total" ? "text-[26px] text-ink" : "text-[22px] text-graphite")}>
                  {available ? money(now, { compact: true }) : "Not split"}
                </span>
                <span className="mt-1 flex min-h-[18px] items-center gap-2 text-xs text-steel">
                  {available && before !== null ? <Delta value={pctChange(now, before)} goodWhen={m.goodWhen} /> : <span>by department</span>}
                  {available && m.key !== "gross" && m.key !== "net" && t.net > 0 && <span className="num">{fmtPct(now / t.net)} of net</span>}
                </span>
                <span className="relative mt-3 block h-2 overflow-hidden rounded-full bg-hair" aria-hidden>
                  {available && (
                    <span
                      className={cn("absolute inset-y-0 rounded-full transition-[left,width] duration-700 ease-tyll", m.kind === "total" ? (m.key === "operatingProfit" ? "bg-pos" : "bg-ink") : "bg-fog")}
                      style={{ left: `${Math.max(0, (left / scale) * 100)}%`, width: `${Math.max(0.8, (width / scale) * 100)}%` }}
                    />
                  )}
                </span>
                <span className="mt-2 flex items-center gap-0.5 text-xs text-fog opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100">
                  {available && onOpen && <>Break down <ChevronRight size={12} /></>}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <Note className="mt-2 max-w-[100ch]">
        {hasOps
          ? "Estimated operating contribution is net sales less food and beverage cost, rostered labor and allocated overheads. It is not accounting profit: no ledger or payroll is connected, and rent, depreciation, management fees and tax are left out."
          : "Labor and overheads are not split by department, so operating contribution is shown only for all departments."}
        {partialDay && " Today runs to 8:55 PM, with dinner still in service: sales count only checks already closed, while most of the day's labor has been worked."}
      </Note>
    </div>
  );
}

export function MetricDrawer({ metric, onClose, c, rows, items, money, onOutlet }: { metric: MetricKey | null; onClose: () => void; c: Compared; rows: OutletRow[]; items: ItemRow[]; money: (n: number, o?: { compact?: boolean }) => string; onOutlet: (id: string) => void }) {
  const def = METRICS.find((m) => m.key === metric);
  if (!metric || !def) return null;
  const t = c.now;
  const byOutlet = rows
    .map((r) => ({ id: r.outletId, now: metricValue(r.now, metric) ?? 0, before: metricValue(r.before, metric) ?? 0, net: r.now.net }))
    .sort((a, b) => b.now - a.now);
  return (
    <Drawer open onClose={onClose} title={def.label} description={def.help}>
      <p className="num text-[32px] tracking-[-0.03em]">{money(metricValue(t, metric) ?? 0)}</p>
      <p className="mt-1 flex items-center gap-2 text-[13px] text-steel"><Delta value={pctChange(metricValue(t, metric) ?? 0, metricValue(c.before, metric) ?? 0)} goodWhen={def.goodWhen} /> against the previous period</p>

      {metric === "net" && (
        <section className="mt-7">
          <h3 className="text-[15px]">How total revenue becomes net sales</h3>
          <dl className="mt-3 divide-y divide-hair border-y border-hair text-sm">
            {([["Total revenue", t.gross], ["Complimentary items", -t.comps], ["Discounts", -t.discounts], ["Refunds", -t.refunds], ["Net sales", t.net]] as const).map(([k, v]) => (
              <div key={k} className="flex justify-between py-2.5"><dt className="text-graphite">{k}</dt><dd className="num">{money(v)}</dd></div>
            ))}
          </dl>
        </section>
      )}

      {metric === "fnbCost" && (
        <section className="mt-7">
          <h3 className="text-[15px]">What the cost is made of</h3>
          <dl className="mt-3 divide-y divide-hair border-y border-hair text-sm">
            <div className="flex justify-between py-2.5"><dt className="text-graphite">Recipe cost of items sold</dt><dd className="num">{money(t.theoCost)}</dd></div>
            <div className="flex justify-between py-2.5"><dt className="text-graphite"><Link href="/stock?tab=waste" className="underline decoration-line underline-offset-4 hover:decoration-ink">Recorded waste</Link></dt><dd className="num">{money(t.waste)}</dd></div>
            <div className="flex justify-between py-2.5"><dt className="text-graphite"><Link href="/stock?tab=counts" className="underline decoration-line underline-offset-4 hover:decoration-ink">Stock missing at count</Link></dt><dd className="num">{money(t.variance)}</dd></div>
          </dl>
          <Note className="mt-2">Stock variance is shared between outlets by how much of each ingredient their recipes used.</Note>
        </section>
      )}

      {byOutlet.length > 1 && (
        <section className="mt-7">
          <h3 className="text-[15px]">By outlet</h3>
          <p className="mb-2 mt-0.5 text-xs text-steel">Choose an outlet to narrow the whole dashboard to it.</p>
          <BarList
            format={(n) => money(n, { compact: true })}
            rows={byOutlet.map((r) => ({ key: r.id, label: outletLabel(r.id), sub: r.net > 0 && metric !== "gross" ? `${fmtPct(r.now / r.net)} of net` : undefined, value: r.now, onClick: () => { onOutlet(r.id); onClose(); } }))}
          />
        </section>
      )}

      {metric === "fnbCost" && (
        <section className="mt-7">
          <h3 className="text-[15px]">Items that cost the most to produce</h3>
          <p className="mb-2 mt-0.5 text-xs text-steel">Choose an item to see its recipe, margin and the orders behind it.</p>
          <ul className="divide-y divide-hair border-y border-hair">
            {[...items].sort((a, b) => b.cost - a.cost).slice(0, 8).map((it) => (
              <li key={it.itemId}>
                <Link href={`/menu/${it.itemId}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:bg-cloud">
                  <span className="text-ink">{itemById[it.itemId].name}</span>
                  <span className="num flex items-center gap-3 text-graphite">{money(it.cost)} <span className="text-xs text-steel">{fmtPct(it.net > 0 ? it.cost / it.net : 0)} of its sales</span><ChevronRight size={14} className="text-fog" /></span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Drawer>
  );
}
