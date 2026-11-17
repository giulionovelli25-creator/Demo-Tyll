"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Section } from "@/components/disclosure";
import { MissingDrinks, useMissingDrinks } from "@/components/drinks/missing";
import { PatternDetail, PourByItem, PourPatterns, PourWhere, WhoWasOn } from "@/components/money/pour-control";
import { PageHeader, Panel, Skeleton, SummaryBar, linkButton } from "@/components/ui";
import { StripTrend } from "@/components/charts";
import { versus } from "@/lib/domain/trends";
import { useAlertFeed } from "@/lib/alert-feed";
import { outletById, propertyById } from "@/lib/data/catalog";
import { SHIFTS } from "@/lib/domain/pour";
import { useView } from "@/lib/hooks";
import type { Currency } from "@/lib/types";
import { fmtMoney, fmtNum, fxRate } from "@/lib/util";

const DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SHIFT_WORD: Record<string, string> = { day: "day shift", evening: "evening shift", late: "late shift" };

/** Over pouring (was Drinks control): the two things a bar loses money on without a bill showing it. Short at the top, the rest one click away. */
export default function DrinksPage() {
  const { sel, money } = useView();
  const { pour } = useAlertFeed();
  const missing = useMissingDrinks();
  const askedForMissing = useSearchParams().get("tab") === "missing";
  useEffect(() => { if (askedForMissing) document.getElementById("missing")?.scrollIntoView({ block: "center" }); }, [askedForMissing]);
  const rate = pour ? fxRate(propertyById[pour.propertyId].currency, sel.currency) : 1;
  const line = (family: "wine" | "spirits", noun: string) => pour ? `${pour[family].rows.length} ${family === "wine" ? "wines" : "spirits"}. ${fmtNum(pour[family].totals.week.gap)} ${noun} not billed this week, ${fmtMoney(pour[family].totals.week.gapValue, pour.currency as Currency)}` : "Loading";
  const below = pour ? pour.wine.outlets.reduce((n, o) => n + SHIFTS.filter((s) => o.shifts[s.id].week.flagged).length, 0) : 0;
  const top = [...(pour?.wine.flags ?? []).map((f) => ({ f, family: "wine" as const })), ...(pour?.spirits.flags ?? []).map((f) => ({ f, family: "spirits" as const }))].sort((x, y) => y.f.figures.gapValue - x.f.figures.gapValue).slice(0, 2);
  const local = (n: number) => money(n * rate);
  const weekValue = (pour?.wine.totals.week.gapValue ?? 0) + (pour?.spirits.totals.week.gapValue ?? 0);
  const lastWeekValue = (pour?.wine.lastWeek.gapValue ?? 0) + (pour?.spirits.lastWeek.gapValue ?? 0);
  const rows = [...(pour?.wine.rows ?? []).map((r) => ({ ...r, family: "wine" as const })), ...(pour?.spirits.rows ?? []).map((r) => ({ ...r, family: "spirits" as const }))].sort((x, y) => y.periods.week.gapValue - x.periods.week.gapValue);
  const worst = rows[0] && rows[0].periods.week.gapValue > 0 ? rows[0] : null;
  const patterns = (pour?.wine.flags.length ?? 0) + (pour?.spirits.flags.length ?? 0);
  const daily = (pour?.wine.daily ?? []).map((d, i) => ({ date: d.date, value: Math.round((d.gapValue + (pour?.spirits.daily[i]?.gapValue ?? 0)) * rate) }));
  const [opened, setOpened] = useState<string | null>(null);
  const go = (id: string) => { setOpened(id); requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" })); };
  return (
    <div className="space-y-6">
      <PageHeader title="Over pouring" question="Is the bar over pouring, and are any drinks missing?" lead="Bottles opened are simulated. Simulated data." />
      <SummaryBar
        items={[
          { label: "Not billed this week", value: local(weekValue), tone: "money", compare: versus(weekValue, lastWeekValue, "down"), onClick: () => go("sec-wine") },
          { label: "Worst item", value: worst?.name ?? "None", compare: { text: worst ? `${fmtNum(worst.periods.week.gap)} ${worst.family === "wine" ? "glasses" : "measures"} not billed, ${local(worst.periods.week.gapValue)}` : "Every item pours to standard", good: worst ? null : true }, onClick: worst ? () => go(worst.family === "wine" ? "sec-wine" : "sec-spirits") : undefined },
          { label: "Flagged patterns", value: patterns, tone: patterns ? "warn" : "pos", compare: { text: `${below} wine ${below === 1 ? "shift" : "shifts"} below the threshold this week`, good: null }, onClick: () => go("sec-patterns") },
          { label: "Missing drinks", value: missing.loading ? "…" : missing.count, tone: missing.count ? "warn" : "pos", compare: { text: "Used but not sold, between counts", good: null }, onClick: () => go("missing") },
        ]}
        trend={<StripTrend goodWhen="down" title="Value not billed per day, last 30 days" points={daily} format={money}
          explain="Wine and spirits poured but not rung up, at selling value, per day. Switch on wine, spirits or a shift to see where a peak comes from."
          series={[
            { id: "wine", label: "Wine", axis: "main", format: money, points: (pour?.wine.daily ?? []).map((d) => ({ date: d.date, value: Math.round(d.gapValue * rate) })), goodWhen: "down" as const, explain: "Wine by the glass." },
            { id: "spirits", label: "Spirits", axis: "main", format: money, points: (pour?.spirits.daily ?? []).map((d) => ({ date: d.date, value: Math.round(d.gapValue * rate) })), goodWhen: "down" as const, explain: "Spirits by the measure." },
            ...(["day", "evening"] as const).map((sh) => ({ id: sh, label: `${sh[0].toUpperCase()}${sh.slice(1)} shift`, axis: "main", goodWhen: "down" as const, format: money, points: (pour?.wine.daily ?? []).map((d, i) => ({ date: d.date, value: Math.round((d.shifts[sh] + (pour?.spirits.daily[i]?.shifts[sh] ?? 0)) * rate) })), explain: sh === "day" ? "Until 5 PM." : sh === "evening" ? "5 PM to 10 PM." : "After 10 PM." })),
          ]} summary={`Wine and spirits poured but not billed, by selling value, per day. This week ${local(weekValue)}.`} note="bottles opened simulated" />}
        action={missing.unexplained[0] ? <Link href={`/stock?tab=where&period=${missing.unexplained[0].p.id}`} className={linkButton("primary")}>Check the largest gap</Link> : undefined}
      />

      {!pour ? <Skeleton className="h-40 w-full" /> : (
        <Section id="drinks.top" title="Where the most is lost" summary={top[0] ? `${outletById[top[0].f.outletId].name}, ${DAY[top[0].f.weekday]} ${SHIFT_WORD[top[0].f.shift]}: ${local(top[0].f.figures.gapValue)} not billed. Team, reasons and how to help inside.` : "Every outlet and shift pours close to standard."} flush>
        <Panel description="The two largest patterns over the last 4 weeks: glasses a bottle should give at the house measure, against glasses billed." flush>
          {top.length === 0 ? <p className="px-4 pb-4 text-sm text-steel sm:px-6">Every outlet and shift is pouring close to standard.</p> : (
            <ul>
              {top.map(({ f, family }) => {
                const noun = family === "wine" ? "glasses" : "measures";
                const max = Math.max(f.figures.expected, f.figures.sold, 1);
                return (
                  <li key={f.id} className="border-t border-hair px-4 py-4 sm:px-6">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                      <p className="text-sm font-medium text-ink">{outletById[f.outletId].name}, {DAY[f.weekday]} {SHIFT_WORD[f.shift]}</p>
                      <p className="num text-sm font-medium text-ink">{fmtNum(f.figures.gap)} {noun} not billed, {local(f.figures.gapValue)}</p>
                    </div>
                    <dl className="mt-3 grid gap-2 text-[13px]">
                      <div className="grid grid-cols-[96px_1fr_auto] items-center gap-3">
                        <dt className="text-steel">Expected</dt>
                        <dd className="h-2.5 rounded-full bg-hair" aria-hidden><span className="block h-full rounded-full bg-accent-ink" style={{ width: `${(f.figures.expected / max) * 100}%` }} /></dd>
                        <dd className="num text-end text-ink">{fmtNum(f.figures.expected)} {noun} from {fmtNum(f.figures.opened, 1)} bottles</dd>
                      </div>
                      <div className="grid grid-cols-[96px_1fr_auto] items-center gap-3">
                        <dt className="text-steel">Billed</dt>
                        <dd className="h-2.5 rounded-full bg-hair" aria-hidden><span className="block h-full rounded-full bg-fog" style={{ width: `${(f.figures.sold / max) * 100}%` }} /></dd>
                        <dd className="num text-end text-ink">{fmtNum(f.figures.sold)} {noun} sold</dd>
                      </div>
                    </dl>
                    <div className="mt-3"><PatternDetail flag={f} /></div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
        </Section>
      )}

      {pour?.staff && pour.staff.length > 0 && (
        <Section id="drinks.who" title="Who was on, day by day" summary={(() => { const lead = pour.staff.flatMap((v) => v.people.filter((p) => p.z >= 3).map((p) => `${p.name} at ${outletById[v.outletId].name}`))[0]; return lead ? `${lead} stands out against the rota. Chart and table inside.` : "Nobody stands out against the rota."; })()} flush>
          <p className="px-4 pt-4 text-[13px] text-steel sm:px-6">What was not billed each day, set against the rota. Hover a day to see who was on; choose a person to see their days.</p>
          <WhoWasOn />
        </Section>
      )}

      <div id="missing" className="scroll-mt-24">
        <Section id="drinks.missing" forceOpen={opened === "missing"} title="Missing drinks" summary={missing.loading ? "Loading" : `${missing.count} ${missing.count === 1 ? "drink" : "drinks"} used but not sold between the last two counts`} flush><MissingDrinks /></Section>
      </div>
      <div id="sec-wine" className="scroll-mt-24"><Section id="drinks.wine" forceOpen={opened === "sec-wine"} title="Wine by the glass" summary={line("wine", "glasses")} flush><PourByItem family="wine" /></Section></div>
      <div id="sec-spirits" className="scroll-mt-24"><Section id="drinks.spirits" forceOpen={opened === "sec-spirits"} title="Spirits" summary={line("spirits", "measures")} flush><PourByItem family="spirits" /></Section></div>
      <Section id="drinks.where" title="Where and when" summary={`By outlet and shift, with no names. ${below} wine ${below === 1 ? "shift" : "shifts"} below the threshold this week`} flush><PourWhere /></Section>
      <div id="sec-patterns" className="scroll-mt-24"><Section id="drinks.patterns" forceOpen={opened === "sec-patterns"} title="All patterns" summary={`${pour?.wine.flags.length ?? 0} wine and ${pour?.spirits.flags.length ?? 0} spirit patterns over the last 4 weeks`} flush><PourPatterns /></Section></div>
      <p className="px-1 text-xs text-steel">Glasses sold come from the till. Bottles opened are simulated in this demo, because the till does not record them, and the one house wine is shared across labels. A gap means generous pours, glasses not rung up or breakage. Tyll never says which.</p>
    </div>
  );
}
