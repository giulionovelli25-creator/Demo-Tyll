"use client";
// The owner's control center: five figures, one chart, one comparison list, one list of issues.
import Link from "next/link";
import { ArrowRight, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Spark } from "@/components/charts";
import { Badge, Crumbs, Delta, EmptyState, PageHeader, Panel, cn } from "@/components/ui";
import { GROUP_NAME, PROPERTIES, itemById, outletById, propertyById } from "@/lib/data/catalog";
import { canOpen } from "@/lib/domain/access";
import { buildIssues, dailyBriefing } from "@/lib/domain/issues";
import { compare, exceptionInSel, itemPerformance, totalsByDay, totalsByOutlet, type ItemRow, type OutletRow, type Totals } from "@/lib/domain/metrics";
import { useCtx, useInvestigations, usePatterns, useView } from "@/lib/hooks";
import { useDemo } from "@/lib/store";
import { addDays, fmtPct, fmtRange, fxRate, pctChange, sum } from "@/lib/util";
import { KpiDrawer, type KpiKey } from "./kpi-drawer";
import { KpiCard, NeedsAttention, PerformanceChart, expensesOf, profitOf } from "./parts";

const marginOf = (t: Totals) => t.opMargin ?? t.gpMargin;
/** Outlets are compared on gross margin: it does not depend on how labor and overheads are allocated. */
const gross = (t: Totals) => t.gpMargin;

export function OwnerOverview() {
  const { sel, money, user, propertyId } = useView();
  const ctx = useCtx();
  const setScope = useDemo((s) => s.setScope);
  const investigations = useInvestigations();
  const patterns = usePatterns();
  const [kpi, setKpi] = useState<KpiKey | null>(null);

  const c = useMemo(() => compare(ctx, sel), [ctx, sel]);
  const rows = useMemo(() => totalsByOutlet(ctx, sel), [ctx, sel]);
  // A single day has no shape of its own, so the chart shows the week ending on it.
  const chartSel = useMemo(() => (sel.range.from === sel.range.to ? { ...sel, range: { from: addDays(sel.range.to, -6), to: sel.range.to } } : sel), [sel]);
  const days = useMemo(() => totalsByDay(ctx, chartSel), [ctx, chartSel]);
  const issues = useMemo(() => buildIssues(ctx, sel, investigations, patterns, { includeStock: canOpen(user, "stock"), rows }), [ctx, sel, investigations, patterns, user, rows]);
  const trend = useMemo(() => {
    if (sel.outletIds.length === 1) return {};
    return Object.fromEntries(sel.outletIds.map((id) => [id, totalsByDay(ctx, { ...chartSel, outletIds: [id], wholeProperties: [] }).map((d) => gross(d.now))]));
  }, [ctx, chartSel, sel.outletIds]);

  const t = c.now;
  const b = c.before;
  const hasOps = t.operatingExpenses !== null;
  const single = sel.outletIds.length === 1;
  const property = propertyId ? propertyById[propertyId] : null;
  const open = investigations.filter((i) => i.status !== "closed" && exceptionInSel(i, sel));
  const openValue = sum(open, (i) => i.exposure * fxRate(propertyById[i.propertyId].currency, sel.currency));
  const closedInPeriod = investigations.filter((i) => i.status === "closed" && i.closedAt && i.closedAt >= sel.range.from && i.closedAt <= sel.range.to && exceptionInSel(i, sel));
  const spark = (f: (x: Totals) => number) => days.map((d) => f(d.now));

  const crumbs = [
    { label: GROUP_NAME, onClick: user.propertyIds === "all" && (property || single) ? () => setScope({ propertyId: "all", outletId: "all" }) : undefined },
    ...(property ? [{ label: property.name, onClick: single && user.outletIds === "all" ? () => setScope({ outletId: "all" }) : undefined }] : []),
    ...(single ? [{ label: outletById[sel.outletIds[0]].name }] : []),
    ...(sel.dept !== "all" ? [{ label: sel.dept === "food" ? "Kitchen" : "Bar" }] : []),
  ];

  return (
    <div className="space-y-5">
      <PageHeader title={single ? outletById[sel.outletIds[0]].name : property ? property.name : GROUP_NAME} crumbs={<Crumbs items={crumbs} />} lead={dailyBriefing(c, rows, issues, sel)}>
        <Badge>{fmtRange(sel.range)}</Badge>
        <Badge>Updated 8:55 PM today · simulated data</Badge>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <KpiCard label="Revenue" value={money(t.net, { compact: true })} delta={<Delta value={pctChange(t.net, b.net)} />} sub="net sales" spark={spark((x) => x.net)} onClick={() => setKpi("revenue")} />
        <KpiCard label="Expenses" value={money(expensesOf(t), { compact: true })} delta={<Delta value={pctChange(expensesOf(t), expensesOf(b))} goodWhen="down" />} sub={hasOps ? "incl. estimates" : "F&B cost only"} spark={spark(expensesOf)} sparkGood="down" onClick={() => setKpi("expenses")} />
        <KpiCard label={hasOps ? "Est. operating profit" : "Gross profit"} value={money(profitOf(t), { compact: true })} delta={<Delta value={pctChange(profitOf(t), profitOf(b))} />} sub={`${fmtPct(marginOf(t))} margin`} spark={spark(profitOf)} onClick={() => setKpi("profit")} />
        <KpiCard label="Potential losses" tone={openValue > 0 ? "warn" : undefined} value={money(openValue, { compact: true })} delta={<Delta value={pctChange(t.flaggedCases, b.flaggedCases)} goodWhen="down" versus="new cases than the previous period" />} sub={`${open.length} open cases`} onClick={() => setKpi("losses")} />
        <KpiCard label="Open issues" value={String(issues.length)} sub={`${issues.filter((i) => i.priority === "high").length} high priority`} delta={<span className="text-xs text-steel">{open.length} cases, {issues.length - issues.filter((i) => i.kind === "investigation").length} other</span>} onClick={() => setKpi("issues")} />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.45fr_1fr]">
        <PerformanceChart days={days} money={money} hasOps={hasOps} highlightToday={sel.range.from === sel.range.to} title={sel.range.from === sel.range.to ? "Performance, last 7 days" : "Performance"} />
        <NeedsAttention issues={issues} money={money} />
      </div>

      {single ? <MenuSnapshot money={money} /> : <Comparison rows={rows} trend={trend} open={open} money={money} />}

      <section className="flex flex-wrap items-center gap-x-8 gap-y-2 rounded-panel border border-line bg-paper px-6 py-4 text-sm shadow-panel">
        <span className="text-steel">Results this period</span>
        <span><span className="num text-ink">{closedInPeriod.length}</span> <span className="text-steel">investigations closed</span></span>
        <span><span className="num text-pos">{money(t.recovered)}</span> <span className="text-steel">revenue recovered</span></span>
        <span><span className="num text-neg">{money(t.confirmedLoss)}</span> <span className="text-steel">confirmed losses</span></span>
        <span><span className="num text-ink">{open.length}</span> <span className="text-steel">still unresolved</span></span>
        <Link href="/investigations" className="ml-auto flex items-center gap-1 text-[13px] text-steel hover:text-ink">Money Back List <ArrowRight size={14} /></Link>
      </section>

      <KpiDrawer kpi={kpi} onClose={() => setKpi(null)} c={c} rows={rows} ctx={ctx} sel={sel} investigations={investigations} money={money} onOutlet={(id) => setScope({ outletId: id })} />
    </div>
  );
}

function CompRow({ label, sub, now, before, spark, issues, onClick, strong, tag, money }: { money: (n: number, o?: { compact?: boolean }) => string; label: string; sub?: string; now: Totals; before: Totals; spark?: number[]; issues: number; onClick: () => void; strong?: boolean; tag?: React.ReactNode }) {
  return (
    <li className={cn("border-t border-hair", strong && "bg-cloud")}>
      <button type="button" onClick={onClick} className="grid w-full grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))_88px_64px_16px] items-center gap-3 px-5 py-3 text-left text-sm transition-colors duration-200 hover:bg-mist sm:px-6">
        <span className="min-w-0">
          <span className={cn("block truncate", strong ? "text-ink" : "text-graphite")}>{label}</span>
          <span className="flex items-center gap-1.5 text-xs text-steel">{sub}{tag}</span>
        </span>
        <span className="num text-right">{money(now.net, { compact: true })}<span className="block"><Delta value={pctChange(now.net, before.net)} /></span></span>
        <span className="num text-right text-graphite">{money(expensesOf(now), { compact: true })}</span>
        <span className="num text-right">{fmtPct(gross(now))}<span className="block"><Delta value={(gross(now) - gross(before)) * 100} kind="pts" /></span></span>
        <span className="flex justify-center">{spark ? <Spark values={spark} width={72} height={22} /> : null}</span>
        <span className={cn("num text-right", issues > 0 ? "text-ink" : "text-fog")}>{issues}</span>
        <ChevronRight size={15} className="text-fog" aria-hidden />
      </button>
    </li>
  );
}

function Comparison({ rows, trend, open, money }: { rows: OutletRow[]; trend: Record<string, number[]>; open: { outletId?: string; propertyId: string }[]; money: (n: number, o?: { compact?: boolean }) => string }) {
  const setScope = useDemo((s) => s.setScope);
  const props = PROPERTIES.filter((p) => rows.some((r) => outletById[r.outletId].propertyId === p.id));
  const ranked = [...rows].filter((r) => r.now.net > 0).sort((a, b) => gross(b.now) - gross(a.now));
  const best = ranked[0]?.outletId;
  const worst = ranked[ranked.length - 1]?.outletId;
  const go = (scope: { propertyId?: string; outletId?: string }) => {
    setScope(scope);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const add = (a: Totals[], key: (t: Totals) => number) => a.reduce((s, x) => s + key(x), 0);
  const sumRows = (list: OutletRow[], which: "now" | "before"): Totals => {
    const ts = list.map((r) => r[which]);
    const net = add(ts, (x) => x.net);
    const gp = add(ts, (x) => x.grossProfit);
    const opList = ts.map((x) => x.operatingProfit);
    const op = opList.some((x) => x === null) ? null : add(ts, (x) => x.operatingProfit ?? 0);
    const exp = opList.some((x) => x === null) ? null : add(ts, (x) => x.operatingExpenses ?? 0);
    return { ...ts[0], net, grossProfit: gp, fnbCost: add(ts, (x) => x.fnbCost), gpMargin: net ? gp / net : 0, operatingProfit: op, operatingExpenses: exp, opMargin: op === null || !net ? null : op / net };
  };

  return (
    <Panel title={<span id="outlets" className="scroll-mt-24">{props.length > 1 ? "Properties and outlets" : "Outlets"}</span>} flush>
      <div className="scroll-thin overflow-x-auto"><div className="min-w-[720px]">
      <div className="grid grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))_88px_64px_16px] gap-3 px-5 pb-2 text-xs text-steel sm:px-6">
        <span>Name</span><span className="text-right">Revenue</span><span className="text-right">Expenses</span><span className="text-right">Gross margin</span><span className="text-center">Trend</span><span className="text-right">Issues</span><span />
      </div>
      <ul className="pb-1">
        {props.map((p) => {
          const list = rows.filter((r) => outletById[r.outletId].propertyId === p.id).sort((a, b) => b.now.net - a.now.net);
          return [
            props.length > 1 && (
              <CompRow money={money} key={p.id} strong label={p.name} sub={`${list.length} outlets`} now={sumRows(list, "now")} before={sumRows(list, "before")} issues={open.filter((i) => i.propertyId === p.id).length} onClick={() => go({ propertyId: p.id })} />
            ),
            ...list.map((r) => (
              <CompRow
                money={money}
                key={r.outletId}
                label={outletById[r.outletId].name}
                sub={outletById[r.outletId].kind}
                tag={rows.length > 2 && r.outletId === best ? <Badge tone="pos" className="!py-0">Best margin</Badge> : rows.length > 2 && r.outletId === worst ? <Badge tone="warn" className="!py-0">Lowest margin</Badge> : undefined}
                now={r.now}
                before={r.before}
                spark={trend[r.outletId]}
                issues={open.filter((i) => i.outletId === r.outletId).length}
                onClick={() => go({ outletId: r.outletId })}
              />
            )),
          ];
        })}
      </ul>
      </div></div>
    </Panel>
  );
}

function MenuList({ title, list, show, money }: { title: string; list: ItemRow[]; show: "profit" | "move"; money: (n: number, o?: { compact?: boolean }) => string }) {
  return (
    <div className="min-w-0">
      <p className="px-5 pb-1 text-[13px] text-steel sm:px-6">{title}</p>
      <ul>
        {list.map((r) => (
          <li key={r.itemId} className="border-t border-hair first:border-t-0">
            <Link href={`/menu/${r.itemId}`} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm hover:bg-cloud sm:px-6">
              <span className="truncate text-ink">{itemById[r.itemId].name}</span>
              <span className="num flex shrink-0 items-center gap-3">
                {show === "profit" ? <>{money(r.grossProfit, { compact: true })}<span className="text-xs text-steel">{fmtPct(r.margin, 0)}</span></> : <Delta value={(r.margin - r.marginBefore!) * 100} kind="pts" />}
                <ChevronRight size={14} className="text-fog" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MenuSnapshot({ money }: { money: (n: number, o?: { compact?: boolean; decimals?: boolean }) => string }) {
  const { sel } = useView();
  const ctx = useCtx();
  const items = useMemo(() => itemPerformance(ctx, sel).filter((r) => r.units > 0), [ctx, sel]);
  if (items.length === 0) return <EmptyState title="No menu sales in this period" />;
  const top = [...items].sort((a, b) => b.grossProfit - a.grossProfit).slice(0, 4);
  const falling = [...items].filter((r) => r.marginBefore !== null).sort((a, b) => a.margin - a.marginBefore! - (b.margin - b.marginBefore!)).slice(0, 4);
  return (
    <Panel title="Menu performance" action={<Link href="/menu" className="flex items-center gap-1 text-[13px] text-steel hover:text-ink">All {items.length} items <ArrowRight size={14} /></Link>} flush>
      <div className="grid grid-cols-1 gap-4 pb-2 md:grid-cols-2">
        <MenuList money={money} title="Most gross profit" list={top} show="profit" />
        <MenuList money={money} title="Margin falling fastest" list={falling} show="move" />
      </div>
    </Panel>
  );
}
