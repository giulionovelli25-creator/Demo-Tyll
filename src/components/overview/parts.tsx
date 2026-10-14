"use client";
// Building blocks shared by the owner and manager overviews.
import Link from "next/link";
import { ArrowRight, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Spark, TrendChart } from "@/components/charts";
import { Badge, Button, Delta, Drawer, EmptyState, Panel, Segmented, cn } from "@/components/ui";
import { outletById } from "@/lib/data/catalog";
import { KIND_LABEL, PRIORITY_LABEL, type Issue } from "@/lib/domain/issues";
import type { DayPoint, Totals } from "@/lib/domain/metrics";
import { personName } from "@/lib/hooks";
import { useDemo } from "@/lib/store";
import { DEMO_TODAY, fmtDate, fmtShort } from "@/lib/util";

export function KpiCard({ label, value, sub, delta, spark, sparkGood = "up", onClick, tone }: { label: string; value: string; sub?: string; delta?: React.ReactNode; spark?: number[]; sparkGood?: "up" | "down"; onClick: () => void; tone?: "warn" }) {
  return (
    <button type="button" onClick={onClick} className="group flex min-w-0 flex-col justify-between rounded-panel border border-line bg-paper p-4 text-left sm:p-5 shadow-panel transition-colors duration-300 ease-tyll hover:border-fog">
      <span className="flex items-center justify-between gap-2 text-[13px] text-steel">
        {label}
        <ChevronRight size={15} className="text-fog transition-transform duration-300 ease-tyll group-hover:translate-x-0.5 group-hover:text-ink" aria-hidden />
      </span>
      <span className={cn("num mt-2 block whitespace-nowrap text-[21px] leading-tight sm:text-[26px] tracking-[-0.03em]", tone === "warn" ? "text-warn" : "text-ink")}>{value}</span>
      <span className="mt-2 flex items-end justify-between gap-2">
        <span className="min-w-0 text-xs text-steel">
          {delta}
          {sub && <span className="mt-0.5 block truncate">{sub}</span>}
        </span>
        {spark && spark.length > 1 && <Spark values={spark} width={64} height={22} goodWhen={sparkGood} />}
      </span>
    </button>
  );
}

export type ChartMetric = "revenue" | "expenses" | "profit";

export const profitOf = (t: Totals) => t.operatingProfit ?? t.grossProfit;
export const expensesOf = (t: Totals) => t.operatingExpenses ?? t.fnbCost;

export function PerformanceChart({ days, money, title = "Performance", hasOps }: { days: DayPoint[]; money: (n: number, o?: { compact?: boolean }) => string; title?: string; hasOps: boolean; highlightToday?: boolean }) {
  const [metric, setMetric] = useState<ChartMetric>("revenue");
  const pick = (t: Totals) => (metric === "revenue" ? t.net : metric === "expenses" ? expensesOf(t) : profitOf(t));
  const data = days.map((d) => ({ label: fmtDate(d.date), now: pick(d.now), before: pick(d.before) }));
  const profitLabel = hasOps ? "Operating profit" : "Gross profit";
  return (
    <Panel
      title={title}
      action={<Segmented label="Chart measure" size="sm" value={metric} onChange={setMetric} options={[{ value: "revenue", label: "Revenue" }, { value: "expenses", label: "Expenses" }, { value: "profit", label: profitLabel }]} />}
    >
      <TrendChart data={data} format={(n) => money(n)} axisFormat={fmtShort} height={230} summary={`${metric} by day against the previous period`} />
      {days[days.length - 1]?.date === DEMO_TODAY && <p className="mt-1 text-xs text-steel">{fmtDate(DEMO_TODAY)} is today, counted to 8:55 PM in both lines.</p>}
    </Panel>
  );
}

const PRIORITY_TONE = { high: "neg", medium: "warn", low: "neutral" } as const;

export function IssueRow({ issue, money, onOutlet }: { issue: Issue; money: (n: number, o?: { decimals?: boolean }) => string; onOutlet?: (id: string) => void }) {
  return (
    <li className="border-t border-hair first:border-t-0">
      <Link
        href={issue.href}
        onClick={() => issue.kind !== "investigation" && issue.outletId && onOutlet?.(issue.outletId)}
        className="grid grid-cols-[1fr_auto] items-start gap-x-4 gap-y-1 px-5 py-3.5 transition-colors duration-200 hover:bg-cloud sm:px-6"
      >
        <span className="min-w-0">
          <span className="line-clamp-2 text-sm leading-snug text-ink">{issue.title}</span>
          <span className="mt-0.5 block truncate text-xs text-steel">{issue.location} · {KIND_LABEL[issue.kind]} · {issue.assignee ? personName(issue.assignee) : "Unassigned"}</span>
        </span>
        <span className="flex flex-col items-end gap-1">
          <span className="num text-sm text-ink">{issue.impact === null ? "–" : money(issue.impact, { decimals: issue.impact < 100 })}</span>
          <span className="flex gap-1">
            <Badge tone={PRIORITY_TONE[issue.priority]} className="!py-0">{PRIORITY_LABEL[issue.priority]}</Badge>
            <Badge className="!py-0">{issue.status}</Badge>
          </span>
        </span>
      </Link>
    </li>
  );
}

/** The five most important open issues, with the rest one click away. */
export function NeedsAttention({ issues, money, title = "Needs your attention", empty = "Nothing needs attention in this selection." }: { issues: Issue[]; money: (n: number, o?: { decimals?: boolean }) => string; title?: string; empty?: string }) {
  const [all, setAll] = useState(false);
  const setScope = useDemo((s) => s.setScope);
  const onOutlet = (id: string) => setScope({ outletId: id });
  return (
    <Panel title={title} action={issues.length > 5 ? <Button size="sm" variant="ghost" onClick={() => setAll(true)}>All {issues.length}</Button> : undefined} flush>
      {issues.length === 0 ? (
        <div className="px-5 pb-5 sm:px-6"><EmptyState title={empty} /></div>
      ) : (
        <ul className="pb-1">{issues.slice(0, 5).map((i) => <IssueRow key={i.id} issue={i} money={money} onOutlet={onOutlet} />)}</ul>
      )}
      <Drawer open={all} onClose={() => setAll(false)} title={`${issues.length} open issues`} description="Highest priority first.">
        <ul className="-mx-6">{issues.map((i) => <IssueRow key={i.id} issue={i} money={money} onOutlet={onOutlet} />)}</ul>
        <Link href="/investigations?status=open" className="mt-4 inline-flex items-center gap-1 text-sm text-steel hover:text-ink">Open the Money Back List <ArrowRight size={14} /></Link>
      </Drawer>
    </Panel>
  );
}

/** Margin change badge used in compact lists. */
export const marginDelta = (now: number, before: number) => <Delta value={(now - before) * 100} kind="pts" />;

export const outletName = (id: string) => outletById[id].name;
