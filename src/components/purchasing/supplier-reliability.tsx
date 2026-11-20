"use client";
// Supplier reliability, a tab of Suppliers: which suppliers deliver late, by how much, and on which weekdays.
// From the delivery record goods in keeps (simulated history). The least reliable come first; the rest are folded.
import { useState, type ReactNode } from "react";
import { Section } from "@/components/disclosure";
import { StripTrend } from "@/components/charts";
import { Badge, PageHeader, Panel, Segmented, Skeleton, SummaryBar, WidgetError, cn } from "@/components/ui";
import { useAlertFeed } from "@/lib/alert-feed";
import { propertyById } from "@/lib/data/catalog";
import { CONFIDENCE_WORD, delayText, minOf } from "@/lib/domain/late-delivery";
import { useApi, useView } from "@/lib/hooks";
import type { ReliabilityRow } from "@/lib/server/late-delivery";
import { fmtTime } from "@/lib/util";

const TOP = 4;
/** Monday first, the way a kitchen reads its week. Index into byWeekday (Sunday first). */
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pct = (r: number | null) => (r === null ? "No deliveries" : `${Math.round(r * 100)}%`);
const windowText = (w: string) => { const [a, b] = w.split(" to "); return a && b ? `${fmtTime(minOf(a))} to ${fmtTime(minOf(b))}` : w; };

/** Lateness by weekday: one cell a day, darker the more often late. Each cell says its count, so colour is never alone. */
function WeekdayPattern({ r }: { r: ReliabilityRow }) {
  return (
    <ol className="grid grid-cols-7 gap-1" aria-label={`Late deliveries by weekday, ${r.name}`}>
      {WEEK.map((d) => {
        const c = r.byWeekday[d];
        const share = c.n ? c.late / c.n : 0;
        return (
          <li key={d} title={c.n ? `${SHORT[d]}: late on ${c.late} of ${c.n}` : `${SHORT[d]}: no deliveries`} className={cn("flex flex-col items-center rounded-lg border px-0.5 py-1.5 text-center", !c.n ? "border-dashed border-line text-fog" : share >= 0.5 ? "border-neg/30 bg-neg-soft text-ink" : share >= 0.2 ? "border-warn/30 bg-warn-soft text-ink" : "border-line bg-paper text-graphite")}>
            <span className="text-[11px] text-steel">{SHORT[d]}</span>
            <span className="num text-[12px]">{c.n ? `${c.late}/${c.n}` : "none"}</span>
          </li>
        );
      })}
    </ol>
  );
}

function SupplierCard({ r }: { r: ReliabilityRow }) {
  const learning = r.confidence === "learning";
  return (
    <li className="flex flex-col gap-3 rounded-panel border border-line bg-paper p-4 shadow-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[15px] font-medium text-ink">{r.name}</span>
        <Badge tone={learning ? "neutral" : r.confidence === "high" ? "ink" : "neutral"}>{CONFIDENCE_WORD[r.confidence]}</Badge>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-sm">
        <div><dt className="text-xs text-steel">On time</dt><dd className="num text-[20px] leading-tight text-ink">{pct(r.onTimeRate)}</dd></div>
        <div><dt className="text-xs text-steel">When late, on average</dt><dd className="num text-ink">{r.late ? delayText(r.avgDelay) : "Never late"}</dd></div>
        <div><dt className="text-xs text-steel">Deliveries</dt><dd className="num text-ink">{r.n}{r.incomplete ? <span className="block text-xs text-steel">{r.incomplete} not complete</span> : null}</dd></div>
      </dl>
      <WeekdayPattern r={r} />
      <p className="text-[13px] text-graphite">{learning ? `Learning this supplier: ${r.n} ${r.n === 1 ? "delivery" : "deliveries"} so far. Tyll predicts from 8.` : r.pattern ?? "No pattern stands out: lateness is spread across the week."}</p>
      <p className="text-xs text-steel">Usual window {windowText(r.usualWindow)}.</p>
    </li>
  );
}

export function SupplierReliability({ tabs }: { tabs?: ReactNode }) {
  const { propertyId: feedPid } = useAlertFeed();
  const { propertyId } = useView();
  const pid = feedPid ?? propertyId ?? "lis";
  const [weeks, setWeeks] = useState<"4" | "12">("12");
  const { data, error } = useApi<{ rows: ReliabilityRow[]; weeks: number }>(`/api/deliveries/reliability?propertyId=${pid}&weeks=${weeks}`);
  const rows = data?.rows ?? [];
  const known = rows.filter((r) => r.confidence !== "learning" && r.n > 0);
  const all = known.reduce((t, r) => ({ n: t.n + r.n, late: t.late + r.late, delay: t.delay + r.avgDelay * r.late }), { n: 0, late: 0, delay: 0 });
  const worst = known[0];
  const learning = rows.filter((r) => r.confidence === "learning");
  // One point a week: on time across suppliers, and the two least reliable on their own, on one scale (percent).
  const weekly = (r: ReliabilityRow) => r.weekly.map((w) => ({ date: w.from, value: w.rate === null ? null : Math.round(w.rate * 100) }));
  const overall = (known[0]?.weekly ?? []).map((w, i) => {
    const n = known.reduce((t, r) => t + r.weekly[i].n, 0);
    const on = known.reduce((t, r) => t + (r.weekly[i].rate ?? 0) * r.weekly[i].n, 0);
    return { date: w.from, value: n ? Math.round((on / n) * 100) : null };
  });
  const fmt = (n: number) => `${Math.round(n)}%`;

  return (
    <div className="space-y-6">
      <PageHeader title="Supplier reliability" question="Which suppliers deliver late?" lead={`${propertyById[pid].name}. From the arrival time goods in records for each delivery, against the window the supplier promised. Late means more than 15 minutes after the window. Simulated data.`} />
      {error ? <WidgetError>Supplier reliability could not load.</WidgetError> : !data ? <Skeleton className="h-64 w-full" /> : (
        <>
          <SummaryBar
            items={[
              { label: "On time, all suppliers", value: all.n ? `${Math.round(((all.n - all.late) / all.n) * 100)}%` : "No deliveries", compare: { text: `${all.n} deliveries in ${data.weeks} weeks`, good: null } },
              { label: "Late deliveries", value: all.late, tone: all.late ? "warn" : "pos", compare: { text: all.late ? `${delayText(all.delay / all.late)} late on average` : "None late", good: null } },
              { label: "Least reliable", value: worst ? worst.name : "None", compare: { text: worst ? `${pct(worst.onTimeRate)} on time` : "", good: null } },
              { label: "Still being learned", value: learning.length, compare: { text: learning.length ? `${learning.map((r) => r.name).join(", ")}: under 8 deliveries` : "Every supplier has a record", good: null } },
            ]}
            trend={<StripTrend goodWhen="up" title="On time per week, all suppliers" points={overall} format={fmt} summary={`Share of deliveries on time each week over ${data.weeks} weeks, all suppliers with a record.`} note="percent" series={known.slice(0, 2).map((r) => ({ id: r.supplierId, label: r.name, points: weekly(r), format: fmt, axis: "main", explain: `${r.name}: share of its deliveries on time each week.`, goodWhen: "up" as const }))} />}
          />
          {tabs}
          <Panel title="Least reliable first" description="Each supplier's on time rate, how late it is when it is late, and the weekdays it runs late. Deliveries likely to be late show on Predictions under Deliveries at risk." action={<Segmented label="Period" size="sm" value={weeks} onChange={setWeeks} options={[{ value: "4", label: "4 weeks" }, { value: "12", label: "12 weeks" }]} />}>
            <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">{rows.slice(0, TOP).map((r) => <SupplierCard key={r.supplierId} r={r} />)}</ul>
          </Panel>
          {rows.length > TOP && (
            <Section id="reliability.all" title={`Show all ${rows.length} suppliers`} summary={(() => { const more = rows.slice(TOP).filter((r) => r.confidence !== "learning" && r.onTimeRate !== null); const learn = rows.slice(TOP).length - more.length; return `${more.length} more on time from ${pct(Math.min(...more.map((r) => r.onTimeRate!)))} to ${pct(Math.max(...more.map((r) => r.onTimeRate!)))}${learn ? `, ${learn} still being learned` : ""}`; })()}>
              <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">{rows.slice(TOP).map((r) => <SupplierCard key={r.supplierId} r={r} />)}</ul>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
