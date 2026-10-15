"use client";
import { MoreDetail } from "@/components/disclosure";
import { StockAlert } from "./stock-alert";
// The outlet manager's overview: what to do today, before the bigger picture.
import Link from "next/link";
import { ArrowRight, CheckCircle2, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Delta, EmptyState, PageHeader, Panel, cn } from "@/components/ui";
import { ingredientById, itemById, outletById, propertyById } from "@/lib/data/catalog";
import { can, canOpen } from "@/lib/domain/access";
import { countVarianceValue } from "@/lib/domain/inventory";
import { buildIssues, dailyBriefing } from "@/lib/domain/issues";
import { compare, totalsByDay, totalsByOutlet, type Sel } from "@/lib/domain/metrics";
import { predictTicket } from "@/lib/domain/operations";
import { personName, useCtx, useInvestigations, usePatterns, useServerForecast, useServerStock, useView } from "@/lib/hooks";
import { useDemo } from "@/lib/store";
import { DEMO_NOW_MIN, DEMO_TODAY, addDays, fmtDate, fmtPct, fmtQty, fmtTime, fxRate, pctChange } from "@/lib/util";
import { KpiDrawer, type KpiKey } from "./kpi-drawer";
import { KpiCard, NeedsAttention, PerformanceChart } from "./parts";

interface Task {
  id: string;
  title: string;
  detail: string;
  href: string;
  urgent?: boolean;
  approval?: boolean;
}

export function ManagerOverview() {
  const { sel, money, user, propertyId } = useView();
  const ctx = useCtx();
  const investigations = useInvestigations();
  const patterns = usePatterns();
  const flowStatus = useDemo((s) => s.flowStatus);
  const flowSim = useDemo((s) => s.flowSim);
  const approvals = useDemo((s) => s.approvals);
  const savedInputs = useDemo((s) => s.forecastInputs);
  const [kpi, setKpi] = useState<{ key: KpiKey; today: boolean } | null>(null);

  const outletId = sel.outletIds[0];
  const outlet = outletById[outletId];
  const pid = propertyId ?? outlet.propertyId;
  const todaySel: Sel = useMemo(() => ({ ...sel, range: { from: DEMO_TODAY, to: DEMO_TODAY } }), [sel]);
  const c = useMemo(() => compare(ctx, sel), [ctx, sel]);
  const today = useMemo(() => compare(ctx, todaySel), [ctx, todaySel]);
  const rows = useMemo(() => totalsByOutlet(ctx, sel), [ctx, sel]);
  const chartSel = useMemo(() => (sel.range.from === sel.range.to ? { ...sel, range: { from: addDays(sel.range.to, -6), to: sel.range.to } } : sel), [sel]);
  const days = useMemo(() => totalsByDay(ctx, chartSel), [ctx, chartSel]);
  const issues = useMemo(() => buildIssues(ctx, sel, investigations, patterns, { includeStock: canOpen(user, "stock"), includeSuppliers: user.outletIds === "all", rows }), [ctx, sel, investigations, patterns, user, rows]);

  const mine = new Set([user.id, user.staffId].filter(Boolean));
  const outletIds = new Set(sel.outletIds);
  const used = useMemo(() => new Set(outlet.menu.flatMap((m) => itemById[m.itemId].recipe?.map((l) => l.ingredientId) ?? [])), [outlet]);

  // Stock and purchase figures come from the server, which counts every outlet drawing on the shared store.
  const { data: serverStock } = useServerStock(pid);
  const { data: serverForecast } = useServerForecast(can(user, "forecast.approve") ? pid : null, savedInputs[pid]);

  const tasks = useMemo<Task[]>(() => {
    const out: Task[] = [];
    for (const i of investigations) {
      if (i.status === "closed" || !i.outletId || !outletIds.has(i.outletId) || !mine.has(i.assigneeId ?? "")) continue;
      const overdue = !!i.deadline && i.deadline < DEMO_TODAY;
      out.push({ id: i.id, title: i.headline, detail: `Investigation · ${i.deadline ? `due ${fmtDate(i.deadline)}` : "no deadline"}`, href: `/investigations/${i.id}`, urgent: overdue });
    }
    const fresh = investigations.filter((i) => i.status === "new" && i.outletId && outletIds.has(i.outletId));
    if (fresh.length) out.push({ id: "assign", title: `Assign ${fresh.length} new case${fresh.length === 1 ? "" : "s"}`, detail: "Flagged and not yet given to anyone", href: "/investigations?status=open", urgent: fresh.length >= 5 });
    if (can(user, "stock.count")) {
      const done = ctx.counts.filter((x) => x.propertyId === pid && x.date === DEMO_TODAY && x.seq > 0).length;
      if (done < 5) out.push({ id: "counts", title: `Count ${5 - done} priority item${5 - done === 1 ? "" : "s"}`, detail: "Today's spot checks", href: "/stock?tab=counts" });
    }
    if (can(user, "forecast.approve") && serverForecast) {
      const pending = serverForecast.forecast.plans.filter((p) => p.suggested > 0 && used.has(p.ingredientId) && !approvals.some((a) => a.propertyId === pid && a.ingredientId === p.ingredientId));
      if (pending.length) out.push({ id: "purchases", title: `Review ${pending.length} suggested purchase${pending.length === 1 ? "" : "s"}`, detail: "Turn them into a purchase request", href: "/forecast?tab=buy", urgent: pending.some((p) => p.shortageDay || p.lowDay), approval: true });
    }
    return out.sort((a, b) => Number(!!b.urgent) - Number(!!a.urgent) || Number(!!b.approval) - Number(!!a.approval));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [investigations, ctx, pid, user, approvals, serverForecast, used]);

  const stockWarnings = useMemo(() => {
    const pos = (serverStock?.rows ?? []).filter((r) => used.has(r.ingredientId));
    const low = pos.filter((r) => r.daysCover !== null && r.daysCover < 1.5).sort((a, b) => (a.daysCover ?? 0) - (b.daysCover ?? 0)).map((r) => ({ id: r.ingredientId, title: ingredientById[r.ingredientId].name, detail: `${fmtQty(r.estimated, ingredientById[r.ingredientId].unit)} left, about ${Math.max(0, r.daysCover ?? 0).toFixed(1)} days`, tag: "Low" }));
    const lastDate = ctx.counts.filter((x) => x.propertyId === pid && x.kind === "weekly").map((x) => x.date).sort().pop();
    const short = ctx.counts
      .filter((x) => x.propertyId === pid && x.date === lastDate && used.has(x.ingredientId))
      .map((x) => ({ x, v: countVarianceValue(x, ctx.overrides) * fxRate(propertyById[pid].currency, sel.currency) }))
      .filter((x) => x.v < -50)
      .sort((a, b) => a.v - b.v)
      .slice(0, 3)
      .map(({ x, v }) => ({ id: `short-${x.ingredientId}`, title: ingredientById[x.ingredientId].name, detail: `${money(-v)} short at the ${fmtDate(x.date)} count`, tag: "Missing" }));
    return [...low, ...short].slice(0, 4);
  }, [pid, serverStock, ctx, used, sel.currency, money]);

  const service = useMemo(() => {
    const live = ctx.data.liveOrders.filter((o) => o.outletId === outletId).map((o) => ({ ...o, status: flowStatus[o.id] ?? o.status }));
    const ratio = ctx.data.prepRatios?.[outletId] ?? 1;
    const preds = live.map((o) => ({ o, p: predictTicket(o, live, flowSim, DEMO_NOW_MIN, ratio) })).filter((x) => x.p.risk !== "done");
    return { active: preds.length, late: preds.filter((x) => x.p.risk === "late"), atRisk: preds.filter((x) => x.p.risk === "at_risk") };
  }, [ctx.data, outletId, flowStatus, flowSim]);

  const t = c.now;
  const hasOps = t.operatingExpenses !== null;
  const briefingExtra = tasks.length ? `You have ${tasks.length} task${tasks.length === 1 ? "" : "s"} today.` : undefined;

  return (
    <div className="space-y-5">
      <PageHeader title={outlet.name} lead={dailyBriefing(c, rows, issues, sel, briefingExtra)}>
        <Badge>{personName(user.id)}</Badge>
        <Badge>Updated 8:55 PM today · simulated data</Badge>
      </PageHeader>
      <StockAlert />

      <div data-tour="kpis" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard label="Revenue today" value={money(today.now.net)} delta={<Delta value={pctChange(today.now.net, today.before.net)} versus="than yesterday at this time" />} sub="so far, to 8:55 PM" onClick={() => setKpi({ key: "revenue", today: true })} />
        <KpiCard label="Gross margin" value={fmtPct(t.gpMargin)} delta={<Delta value={(t.gpMargin - c.before.gpMargin) * 100} kind="pts" />} sub={`${fmtDate(sel.range.from)} – ${fmtDate(sel.range.to)}`} spark={days.map((d) => d.now.gpMargin)} onClick={() => setKpi({ key: "profit", today: false })} />
        <KpiCard label="Open issues" value={String(issues.length)} sub={`${issues.filter((i) => i.priority === "high").length} high priority`} onClick={() => setKpi({ key: "issues", today: false })} />
        <KpiCard label="My tasks" value={String(tasks.length)} sub={tasks.some((x) => x.urgent) ? "some are urgent" : "nothing urgent"} tone={tasks.some((x) => x.urgent) ? "warn" : undefined} onClick={() => document.getElementById("tasks")?.scrollIntoView({ behavior: "smooth", block: "start" })} />
      </div>

      <div data-tour="attention" className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Panel title={<span id="tasks" className="scroll-mt-24">My tasks and approvals</span>} flush>
          {tasks.length === 0 ? (
            <div className="flex items-center gap-3 px-6 pb-6 text-sm text-graphite"><CheckCircle2 size={18} className="text-pos" /> Nothing waiting for you.</div>
          ) : (
            <ul className="pb-1">
              {tasks.slice(0, 6).map((x) => (
                <li key={x.id} className="border-t border-hair first:border-t-0">
                  <Link href={x.href} className="flex items-center justify-between gap-3 px-5 py-3.5 hover:bg-cloud sm:px-6">
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-ink">{x.title}</span>
                      <span className="block text-xs text-steel">{x.detail}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">{x.approval && <Badge className="!py-0">Approval</Badge>}{x.urgent && <Badge tone="warn" className="!py-0">Urgent</Badge>}<ChevronRight size={15} className="text-fog" /></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <NeedsAttention issues={issues} money={money} title="Problems at this outlet" />
      </div>

      <MoreDetail tour="more" label="Show revenue, stock warnings and service" hideLabel="Hide details">
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.45fr_1fr]">
        <PerformanceChart days={days} money={money} hasOps={hasOps} highlightToday={sel.range.from === sel.range.to} title="Revenue and costs" />
        <div className="space-y-5">
          <Panel title="Stock warnings" action={<Link href="/stock" className="flex items-center gap-1 text-[13px] text-steel hover:text-ink">Stock <ArrowRight size={14} /></Link>} flush>
            {stockWarnings.length === 0 ? <div className="px-6 pb-5"><EmptyState title="No stock warnings" /></div> : (
              <ul className="pb-1">
                {stockWarnings.map((w) => (
                  <li key={w.id} className="flex items-center justify-between gap-3 border-t border-hair px-5 py-3 text-sm first:border-t-0 sm:px-6">
                    <span className="min-w-0"><span className="block truncate text-ink">{w.title}</span><span className="block text-xs text-steel">{w.detail}</span></span>
                    <Badge tone="warn" className="!py-0">{w.tag}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          {canOpen(user, "flow") && (
            <Panel title="Service right now" action={<Link href="/flow" className="flex items-center gap-1 text-[13px] text-steel hover:text-ink">Flow <ArrowRight size={14} /></Link>}>
              <div className="flex gap-8 text-sm">
                <span><span className="num block text-[22px] text-ink">{service.active}</span><span className="text-steel">in progress</span></span>
                <span><span className={cn("num block text-[22px]", service.late.length ? "text-neg" : "text-ink")}>{service.late.length}</span><span className="text-steel">late</span></span>
                <span><span className={cn("num block text-[22px]", service.atRisk.length ? "text-warn" : "text-ink")}>{service.atRisk.length}</span><span className="text-steel">may be late</span></span>
              </div>
              {service.late.slice(0, 2).map(({ o, p }) => (
                <p key={o.id} className="mt-3 text-[13px] text-graphite">{o.table}: ordered {fmtTime(o.placedMin)}, {Math.round(p.elapsed)} min waiting against a {p.target}-minute target.</p>
              ))}
            </Panel>
          )}
        </div>
      </div>

      </MoreDetail>

      {kpi && <KpiDrawer kpi={kpi.key} onClose={() => setKpi(null)} c={kpi.today ? today : c} rows={rows} ctx={ctx} sel={kpi.today ? todaySel : sel} investigations={investigations} money={money} onOutlet={() => undefined} />}
    </div>
  );
}
