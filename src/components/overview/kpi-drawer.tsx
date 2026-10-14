"use client";
// Everything behind each overview card. Details live here, not on the overview itself.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { BarList } from "@/components/charts";
import { Delta, Drawer, Note, Stat } from "@/components/ui";
import { INGREDIENT_PRICE_CHANGES, MENU_ITEMS, ingredientById, outletById, outletLabel, propertyById } from "@/lib/data/catalog";
import { TYPE_LABEL } from "@/lib/domain/detect";
import { exceptionInSel, type Compared, type Ctx, type OutletRow, type Sel } from "@/lib/domain/metrics";
import { ingredientCostAt } from "@/lib/domain/pricing";
import type { ExceptionType, Investigation } from "@/lib/types";
import { addDays, fmtDate, fmtNum, fmtPct, fxRate, pctChange } from "@/lib/util";
import { ProfitStrip } from "./profit-strip";
import { expensesOf, profitOf } from "./parts";

export type KpiKey = "revenue" | "expenses" | "profit" | "losses" | "issues";

type Money = (n: number, o?: { compact?: boolean; decimals?: boolean }) => string;

function Lines({ rows, money }: { rows: [string, number, string?][]; money: Money }) {
  return (
    <dl className="divide-y divide-hair border-y border-hair text-sm">
      {rows.map(([k, v, href]) => (
        <div key={k} className="flex justify-between gap-4 py-2.5">
          <dt className="text-graphite">{href ? <Link href={href} className="underline decoration-line underline-offset-4 hover:decoration-ink">{k}</Link> : k}</dt>
          <dd className="num">{money(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

const H = ({ children }: { children: React.ReactNode }) => <h3 className="mb-2 mt-7 text-[15px]">{children}</h3>;

export function KpiDrawer({ kpi, onClose, c, rows, ctx, sel, investigations, money, onOutlet }: { kpi: KpiKey | null; onClose: () => void; c: Compared; rows: OutletRow[]; ctx: Ctx; sel: Sel; investigations: Investigation[]; money: Money; onOutlet: (id: string) => void }) {
  const router = useRouter();
  const t = c.now;
  const b = c.before;
  const hasOps = t.operatingExpenses !== null;
  const byOutlet = (f: (r: OutletRow) => number, sub?: (r: OutletRow) => string | undefined, fmt: (n: number) => string = (n) => money(n, { compact: true })) =>
    rows.length > 1 ? (
      <>
        <H>By outlet</H>
        <BarList format={fmt} rows={[...rows].sort((x, y) => f(y) - f(x)).map((r) => ({ key: r.outletId, label: outletLabel(r.outletId), sub: sub?.(r), value: f(r), onClick: () => { onOutlet(r.outletId); onClose(); } }))} />
      </>
    ) : null;

  const movers = useMemo(() => {
    const out: { key: string; outletId: string; what: string; now: number; move: number; impact: number }[] = [];
    for (const r of rows) {
      if (r.now.net <= 0 || r.before.net <= 0) continue;
      const lines: [string, number, number][] = [
        ["Food and beverage cost", r.now.fnbCost / r.now.net, r.before.fnbCost / r.before.net],
        ["Discounts, comps and refunds", (r.now.gross - r.now.net) / r.now.gross, (r.before.gross - r.before.net) / r.before.gross],
        ["Recorded waste", r.now.waste / r.now.net, r.before.waste / r.before.net],
      ];
      if (r.now.labor !== null && r.before.labor !== null) lines.push(["Labor", r.now.labor / r.now.net, r.before.labor / r.before.net]);
      for (const [what, now, before] of lines) if ((now - before) * 100 >= 0.3) out.push({ key: `${r.outletId}-${what}`, outletId: r.outletId, what, now, move: (now - before) * 100, impact: (now - before) * r.now.net });
    }
    return out.sort((x, y) => y.impact - x.impact).slice(0, 5);
  }, [rows]);

  const priceRises = useMemo(() => {
    const from = addDays(sel.range.to, -29);
    return [...INGREDIENT_PRICE_CHANGES, ...ctx.overrides]
      .filter((p) => p.from >= from && p.from <= sel.range.to)
      .map((p) => ({ ...p, pct: ingredientCostAt(p.id, p.from, ctx.overrides) / ingredientCostAt(p.id, addDays(p.from, -1), ctx.overrides) - 1, items: MENU_ITEMS.filter((m) => m.recipe?.some((l) => l.ingredientId === p.id) && sel.outletIds.some((id) => outletById[id].menu.some((e) => e.itemId === m.id))) }))
      .filter((p) => p.items.length > 0 && Math.abs(p.pct) > 0.001);
  }, [ctx.overrides, sel]);

  const open = investigations.filter((i) => i.status !== "closed" && exceptionInSel(i, sel));
  const openByType = useMemo(() => {
    const m = new Map<ExceptionType, { n: number; v: number }>();
    for (const i of open) {
      const cur = m.get(i.type) ?? { n: 0, v: 0 };
      m.set(i.type, { n: cur.n + 1, v: cur.v + i.exposure * fxRate(propertyById[i.propertyId].currency, sel.currency) });
    }
    return [...m].sort((x, y) => y[1].v - x[1].v);
  }, [open, sel.currency]);

  if (!kpi) return null;
  const titles: Record<KpiKey, string> = { revenue: "Revenue", expenses: "Expenses", profit: hasOps ? "Estimated operating profit" : "Gross profit", losses: "Potential losses", issues: "Open issues" };

  return (
    <Drawer open onClose={onClose} title={titles[kpi]} wide>
      {kpi === "revenue" && (
        <>
          <Stat label="Net sales, excluding tax and service charge" value={money(t.net)} delta={<Delta value={pctChange(t.net, b.net)} />} />
          <H>From menu price to net sales</H>
          <Lines money={money} rows={[["Total at menu price", t.gross], ["Complimentary items", -t.comps], ["Discounts", -t.discounts], ["Refunds", -t.refunds], ["Net sales", t.net]]} />
          <div className="mt-6 grid grid-cols-3 gap-4">
            <Stat label="Orders" value={fmtNum(t.orders)} delta={<Delta value={pctChange(t.orders, b.orders)} />} />
            <Stat label="Guests" value={fmtNum(t.covers)} delta={<Delta value={pctChange(t.covers, b.covers)} />} />
            <Stat label="Per guest" value={money(t.covers ? t.net / t.covers : 0, { decimals: true })} delta={<Delta value={pctChange(t.covers ? t.net / t.covers : 0, b.covers ? b.net / b.covers : 0)} />} />
          </div>
          {byOutlet((r) => r.now.net, (r) => fmtPct(r.now.net / (t.net || 1), 0))}
        </>
      )}

      {kpi === "expenses" && (
        <>
          <Stat label={hasOps ? "Operating expenses, including estimates" : "Food and beverage cost"} value={money(expensesOf(t))} delta={<Delta value={pctChange(expensesOf(t), expensesOf(b))} goodWhen="down" />} sub={`${fmtPct(expensesOf(t) / (t.net || 1))} of revenue`} />
          <H>What they are made of</H>
          <Lines
            money={money}
            rows={[
              ["Recipe cost of items sold", t.theoCost],
              ["Recorded waste", t.waste, "/stock?tab=waste"],
              ["Stock missing at count", t.variance, "/stock?tab=counts"],
              ...(hasOps ? ([["Labor (estimated from rosters)", t.labor!], ["Other operating costs (allocated)", t.opex!]] as [string, number][]) : []),
            ]}
          />
          {!hasOps && <Note className="mt-2">Labor and overheads are not split by department. Choose all departments to include them.</Note>}
          {movers.length > 0 && (
            <>
              <H>Rising as a share of sales</H>
              <ul className="divide-y divide-hair border-y border-hair">
                {movers.map((m) => (
                  <li key={m.key}><button type="button" onClick={() => { onOutlet(m.outletId); onClose(); }} className="flex w-full items-center justify-between gap-3 py-2.5 text-left text-sm hover:bg-cloud">
                    <span><span className="text-ink">{m.what}</span><span className="block text-xs text-steel">{outletLabel(m.outletId)} · {fmtPct(m.now)} of sales</span></span>
                    <span className="text-right"><Delta value={m.move} kind="pts" goodWhen="down" /><span className="num block text-xs text-steel">about {money(m.impact)}</span></span>
                  </button></li>
                ))}
              </ul>
            </>
          )}
          {priceRises.length > 0 && (
            <>
              <H>Supplier price changes, last 30 days</H>
              <ul className="divide-y divide-hair border-y border-hair">
                {priceRises.map((p) => (
                  <li key={`${p.id}-${p.from}`}><Link href="/stock?tab=recipes" className="flex items-center justify-between gap-3 py-2.5 text-sm hover:bg-cloud">
                    <span><span className="text-ink">{ingredientById[p.id].name}</span><span className="block text-xs text-steel">From {fmtDate(p.from)} · {p.items.map((i) => i.name).join(", ")}</span></span>
                    <Delta value={p.pct} goodWhen="down" />
                  </Link></li>
                ))}
              </ul>
            </>
          )}
          {byOutlet((r) => expensesOf(r.now), (r) => fmtPct(expensesOf(r.now) / (r.now.net || 1), 0) + " of sales")}
        </>
      )}

      {kpi === "profit" && (
        <>
          <ProfitStrip c={c} money={money} partialDay={sel.range.from === sel.range.to} />
          <div className="mt-6 grid grid-cols-2 gap-4">
            <Stat label="Gross margin" value={fmtPct(t.gpMargin)} delta={<Delta value={(t.gpMargin - b.gpMargin) * 100} kind="pts" />} />
            {t.opMargin !== null && <Stat label="Operating margin, estimated" value={fmtPct(t.opMargin)} delta={b.opMargin !== null ? <Delta value={(t.opMargin - b.opMargin) * 100} kind="pts" /> : undefined} />}
          </div>
          {byOutlet((r) => profitOf(r.now), (r) => fmtPct(r.now.opMargin ?? r.now.gpMargin, 0))}
        </>
      )}

      {kpi === "losses" && (
        <>
          <Stat label="Value involved in open cases" value={money(openByType.reduce((s, [, v]) => s + v.v, 0))} sub="Not confirmed. A case becomes a loss only when a manager records it." />
          <H>Open cases by type</H>
          {openByType.length === 0 ? <p className="text-sm text-steel">No open cases.</p> : (
            <BarList tone="warn" format={(n) => money(n)} rows={openByType.map(([type, v]) => ({ key: type, label: TYPE_LABEL[type], sub: `${v.n} open`, value: v.v, onClick: () => router.push(`/investigations?type=${type}`) }))} />
          )}
          <H>Recorded outcomes in this period</H>
          <Lines money={money} rows={[["Confirmed losses", t.confirmedLoss, "/investigations?status=closed&outcome=confirmed_loss"], ["Revenue recovered", t.recovered, "/investigations?status=closed&outcome=recovered"]]} />
          <H>Other money lost from stock</H>
          <Lines money={money} rows={[["Recorded waste", t.waste, "/stock?tab=waste"], ["Stock missing at count", t.variance, "/stock?tab=counts"], ["Breakage, glass and plates", t.breakage, "/stock?tab=waste"]]} />
          {byOutlet((r) => open.filter((i) => i.outletId === r.outletId).reduce((s, i) => s + i.exposure * fxRate(propertyById[i.propertyId].currency, sel.currency), 0), (r) => `${open.filter((i) => i.outletId === r.outletId).length} open`)}
        </>
      )}

      {kpi === "issues" && (
        <>
          <div className="grid grid-cols-3 gap-4">
            <Stat label="Open now" value={fmtNum(open.length)} />
            <Stat label="New" value={fmtNum(open.filter((i) => i.status === "new").length)} sub="not yet assigned" />
            <Stat label="Past deadline" value={fmtNum(open.filter((i) => i.deadline && i.deadline < sel.range.to).length)} />
          </div>
          <H>By type</H>
          <BarList format={(n) => fmtNum(n)} rows={openByType.map(([type, v]) => ({ key: type, label: TYPE_LABEL[type], value: v.n, onClick: () => router.push(`/investigations?type=${type}`) }))} />
          {byOutlet((r) => open.filter((i) => i.outletId === r.outletId).length, undefined, (n) => fmtNum(n))}
          <Link href="/investigations?status=open" className="mt-6 inline-block text-sm underline underline-offset-4">Open the Money Back List</Link>
        </>
      )}
    </Drawer>
  );
}
