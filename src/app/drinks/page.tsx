"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { Section } from "@/components/disclosure";
import { MissingDrinks, useMissingDrinks } from "@/components/drinks/missing";
import { PourByItem, PourPatterns, PourWhere } from "@/components/money/pour-control";
import { PageHeader, Panel, Skeleton, SummaryBar, linkButton } from "@/components/ui";
import { useAlertFeed } from "@/lib/alert-feed";
import { outletById, propertyById } from "@/lib/data/catalog";
import { SHIFTS } from "@/lib/domain/pour";
import { useView } from "@/lib/hooks";
import type { Currency } from "@/lib/types";
import { fmtMoney, fmtNum, fxRate } from "@/lib/util";

/** Drinks control: the two things a bar loses money on without a bill showing it. Short at the top, the rest one click away. */
export default function DrinksPage() {
  const { sel, money } = useView();
  const { pour } = useAlertFeed();
  const missing = useMissingDrinks();
  const askedForMissing = useSearchParams().get("tab") === "missing";
  useEffect(() => { if (askedForMissing) document.getElementById("missing")?.scrollIntoView({ block: "center" }); }, [askedForMissing]);
  const rate = pour ? fxRate(propertyById[pour.propertyId].currency, sel.currency) : 1;
  const line = (family: "wine" | "spirits", noun: string) => pour ? `${pour[family].rows.length} ${family === "wine" ? "wines" : "spirits"}. ${fmtNum(pour[family].totals.week.gap)} ${noun} not billed this week, ${fmtMoney(pour[family].totals.week.gapValue, pour.currency as Currency)}` : "Loading";
  const below = pour ? pour.wine.outlets.reduce((n, o) => n + SHIFTS.filter((s) => o.shifts[s.id].week.flagged).length, 0) : 0;
  const first = (pour?.wine.flags.slice(0, 2) ?? []).map((f) => ({ key: f.id, title: `Over pouring at ${outletById[f.outletId].name}`, note: f.text, amount: fmtMoney(f.figures.gapValue, pour!.currency as Currency) }));
  return (
    <div className="space-y-4">
      <PageHeader title="Drinks control" question="Is the bar over pouring, and are any drinks missing?" lead="Bottles opened are simulated. Simulated data." />
      <SummaryBar
        items={[
          { label: "Wine not billed, week", value: money((pour?.wine.totals.week.gapValue ?? 0) * rate, { compact: true }), tone: "money" },
          { label: "Spirits not billed, week", value: money((pour?.spirits.totals.week.gapValue ?? 0) * rate, { compact: true }), tone: "money" },
          { label: "Missing drinks", value: missing.loading ? "…" : missing.count, tone: missing.count ? "warn" : "pos" },
        ]}
        action={missing.unexplained[0] ? <Link href={`/stock?tab=where&period=${missing.unexplained[0].p.id}`} className={linkButton("primary")}>Check the largest gap</Link> : undefined}
      />

      <section id="missing" className="scroll-mt-24">
        <Panel title="Missing drinks" description="What was sold against what was actually used, between two counts." flush><MissingDrinks /></Panel>
      </section>

      {!pour ? <Skeleton className="h-40 w-full" /> : (
        <Panel title="Over pouring" description="The largest patterns over the last 4 weeks." flush>
          {first.length === 0 ? <p className="px-4 pb-4 text-sm text-steel sm:px-6">Every outlet and shift is pouring close to standard.</p> : (
            <ul>
              {first.map((r) => (
                <li key={r.key} className="flex flex-col gap-1 border-t border-hair px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-6">
                  <span className="min-w-0"><span className="block text-sm font-medium text-ink">{r.title}</span><span className="block text-xs text-steel">{r.note}</span></span>
                  <span className="num shrink-0 text-sm font-medium text-money">{r.amount}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
      <Section id="drinks.wine" title="Wine by the glass" summary={line("wine", "glasses")} flush><PourByItem family="wine" /></Section>
      <Section id="drinks.spirits" title="Spirits" summary={line("spirits", "measures")} flush><PourByItem family="spirits" /></Section>
      <Section id="drinks.where" title="Where and when" summary={`By outlet and shift, with no names. ${below} wine ${below === 1 ? "shift" : "shifts"} below the threshold this week`} flush><PourWhere /></Section>
      <Section id="drinks.patterns" title="All patterns" summary={`${pour?.wine.flags.length ?? 0} wine and ${pour?.spirits.flags.length ?? 0} spirit patterns over the last 4 weeks`} flush><PourPatterns /></Section>
    </div>
  );
}
