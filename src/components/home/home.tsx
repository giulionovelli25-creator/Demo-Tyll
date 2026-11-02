"use client";
// Overview: five cards, each with one number, one line and one button. Detail lives on the page each card links to.
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowRight, Wine } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { EmptyState, PageHeader, Panel, Skeleton, WidgetError, cn, linkButton } from "@/components/ui";
import { useAlertFeed } from "@/lib/alert-feed";
import { ingredientById, outletById, propertyById } from "@/lib/data/catalog";
import { compare, computeTotals, exceptionInSel } from "@/lib/domain/metrics";
import { useCtx, useInvestigations, useView } from "@/lib/hooks";
import { useDemo } from "@/lib/store";
import { DEMO_NOW_MIN, DEMO_TODAY, addDays, eachDay, fmtDate, fmtPct, fmtRange, fmtShort, fmtTime, fxRate, pctChange, sum } from "@/lib/util";
import type { ChartPoint } from "./chart";

const RevenueProfitChart = dynamic(() => import("./chart").then((m) => m.RevenueProfitChart), { ssr: false, loading: () => <Skeleton className="h-[264px] w-full" /> });

type Tone = "neg" | "warn" | "pos" | "money" | undefined;
const TONE: Record<string, string> = { neg: "text-neg", warn: "text-warn", pos: "text-pos", money: "text-money" };

function Card({ title, number, tone, line, cta, href, urgent, loading, wide }: { title: string; number: ReactNode; tone?: Tone; line: ReactNode; cta: string; href: string; urgent?: boolean; loading?: boolean; wide?: boolean }) {
  return (
    <section aria-label={title} className={cn("flex min-w-0 items-center gap-3 rounded-panel border border-line bg-paper p-3 shadow-panel transition-shadow duration-200 ease-tyll hover:shadow-lift sm:flex-col sm:items-stretch sm:gap-0 sm:p-4 lg:col-span-2 min-[87.5rem]:col-span-1", wide && "lg:col-span-3")}>
      <div className="min-w-0 flex-1">
        <h2 className="text-[13px] text-steel">{title}</h2>
        {loading ? (
          <div className="space-y-2 pt-2" aria-hidden><Skeleton className="h-8 w-2/3" /><Skeleton className="h-4 w-full" /></div>
        ) : (
          <>
            <p className={cn("num text-[26px] font-medium leading-tight tracking-[-0.02em] whitespace-nowrap sm:mt-1 sm:text-[32px] lg:text-display min-[87.5rem]:text-[28px]", tone ? TONE[tone] : "text-ink")}>{number}</p>
            <p className="text-[13px] leading-snug text-graphite sm:mt-1 sm:min-h-[2.5em]">{line}</p>
          </>
        )}
      </div>
      <Link key={urgent ? "urgent" : "calm"} href={href} className={cn(linkButton(urgent ? "primary" : "quiet"), "shrink-0 px-3 text-[13px] sm:mt-3 sm:w-full sm:px-4 sm:text-sm")}>{cta} <ArrowRight size={15} className="hidden sm:block" aria-hidden /></Link>
    </section>
  );
}

const signed = (change: number | null) => (change === null ? "" : `${change >= 0 ? "up" : "down"} ${fmtPct(Math.abs(change))}`);

export function Home() {
  const { sel, money, propertyId, currency } = useView();
  const ctx = useCtx();
  const preset = useDemo((s) => s.preset);
  const { plan, pour, error, loading } = useAlertFeed();
  const investigations = useInvestigations();
  const selected = useMemo(() => compare(ctx, sel), [ctx, sel]);
  const today = useMemo(() => computeTotals(ctx, { ...sel, range: { from: DEMO_TODAY, to: DEMO_TODAY } }), [ctx, sel]);
  const yesterday = useMemo(() => computeTotals(ctx, { ...sel, range: { from: addDays(DEMO_TODAY, -1), to: addDays(DEMO_TODAY, -1) } }), [ctx, sel]);
  const flags = useMemo(() => investigations.filter((i) => i.status !== "closed" && exceptionInSel(i, sel)), [investigations, sel]);
  const flagValue = sum(flags, (i) => i.exposure * fxRate(propertyById[i.propertyId].currency, sel.currency));
  const chartDays = useMemo(() => {
    const from = addDays(sel.range.to, -13);
    return eachDay({ from: sel.range.from < from ? sel.range.from : from, to: sel.range.to });
  }, [sel.range]);
  const points = useMemo<ChartPoint[]>(() => chartDays.map((date) => {
    const t = computeTotals(ctx, { ...sel, range: { from: date, to: date } });
    return { label: fmtDate(date), revenue: t.net, profit: t.operatingProfit ?? t.grossProfit, partial: date === DEMO_TODAY };
  }), [ctx, sel, chartDays]);

  if (sel.outletIds.length === 0) return <EmptyState title="Choose an outlet to begin">Your figures appear here once you pick an outlet in the top bar.</EmptyState>;

  const rangeLabel = preset === "today" ? "today so far" : preset === "yesterday" ? "yesterday" : preset === "week" ? "last 7 days" : preset === "month" ? "last 30 days" : fmtRange(sel.range);
  const items = plan?.items ?? [];
  const dueToday = items.filter((i) => i.orderBy === DEMO_TODAY && i.nextQty > 0);
  const critical = items.filter((i) => i.health === "critical").sort((a, b) => (a.daysUntilOut ?? 99) - (b.daysUntilOut ?? 99));
  const low = items.filter((i) => i.health === "low");
  const first = critical[0];
  const rate = pour ? fxRate(propertyById[pour.propertyId].currency, sel.currency) : 1;
  const pourWeek = pour ? (pour.wine.totals.week.gapValue + pour.spirits.totals.week.gapValue) * rate : 0;
  const atRisk = flagValue + pourWeek;
  const net = selected.now.net;
  const profit = selected.now.operatingProfit;
  const lost = today.waste + today.breakage;
  const lostBefore = yesterday.waste + yesterday.breakage;
  const place = sel.outletIds.length === 1 ? outletById[sel.outletIds[0]].name : propertyId ? propertyById[propertyId].name : "All hotels";
  const profitName = profit !== null ? "Net profit" : "Gross profit";
  const topPour = pour?.wine.flags[0];

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader title="Overview" question="What needs me right now?" lead={`${place}. Updated ${fmtTime(DEMO_NOW_MIN)}, simulated data.`}>
        <Link href="/alerts" className={cn(linkButton(), "hidden sm:inline-flex")}>See all alerts</Link>
      </PageHeader>

      {error && <WidgetError>The stock prediction could not load. The other figures are still current.</WidgetError>}

      <div data-tour="kpis" className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-6 min-[87.5rem]:grid-cols-5">
        <Card
          title="Order today" number={dueToday.length} tone={dueToday.length ? "neg" : "pos"} urgent={dueToday.length > 0} loading={!plan && loading}
          line={first ? `${ingredientById[first.ingredientId].name} runs out first, ${first.daysUntilOut === 0 ? "today" : fmtDate(first.runOutDate!, true)}.` : "Nothing has to go in today."}
          cta="Review order" href="/stock#order"
        />
        <Card
          title="Money at risk" number={money(atRisk, { compact: true })} tone={atRisk > 0 ? "money" : undefined} urgent={atRisk > 0} loading={!pour && !flags.length}
          line={`${flags.length} open flags, plus ${money(pourWeek, { compact: true })} of over pouring this week.`}
          cta="Review flags" href="/money"
        />
        <Card
          title="Stock status" number={critical.length} tone={critical.length ? "neg" : "pos"} loading={!plan && loading}
          line={`${critical.length === 1 ? "item" : "items"} critical, ${low.length} low, ${items.length - critical.length - low.length} fine.`}
          cta="See stock" href="/stock"
        />
        <Card
          wide title={`Revenue and profit, ${rangeLabel}`} number={money(net, { compact: true })}
          line={`${signed(pctChange(net, selected.before.net))} on the period before. ${profit !== null ? `${money(profit, { compact: true })} net profit` : `${money(selected.now.grossProfit, { compact: true })} gross profit`}, ${fmtPct(selected.now.gpMargin)} margin.`}
          cta="See by outlet" href="/money?tab=outlets"
        />
        <Card
          wide title="Waste and breakage today" number={money(lost, { compact: true })} tone={lost > lostBefore && lost > 0 ? "warn" : undefined}
          line={`${money(today.waste)} waste, ${money(today.breakage)} breakage. ${signed(pctChange(lost, lostBefore))} on yesterday.`}
          cta="See what was lost" href="/waste"
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[2fr_1fr]">
        <Panel title={`Revenue and ${profitName.toLowerCase()}, last ${chartDays.length} days`} description={profit !== null ? "Net profit is an estimate after food, drink, staff and running costs. Today is so far." : "Gross profit, because a department filter is on. Today is so far."}>
          <RevenueProfitChart points={points} format={(n) => money(n)} axisFormat={fmtShort} profitName={profitName} summary={`Revenue and ${profitName} per day for the last ${chartDays.length} days, in ${currency}.`} />
        </Panel>
        <section aria-label="Pour Control" className="flex min-w-0 flex-col rounded-panel border border-line bg-paper p-4 shadow-panel">
          <h2 className="flex items-center gap-2 text-[13px] text-steel"><Wine size={15} aria-hidden /> Pour Control, this week</h2>
          {!pour ? <div className="space-y-2 pt-2" aria-hidden><Skeleton className="h-9 w-1/2" /><Skeleton className="h-4 w-full" /></div> : (
            <>
              <p className={cn("num mt-1 text-display font-medium tracking-[-0.02em]", pour.wine.totals.week.gapValue > 0 ? "text-money" : "text-ink")}>{money(pour.wine.totals.week.gapValue * rate, { compact: true })}</p>
              <p className="mt-1 text-[13px] leading-snug text-graphite">{pour.wine.totals.week.gap} glasses of wine not billed. {topPour ? topPour.text : "Every outlet is pouring close to standard."}</p>
            </>
          )}
          <Link href="/money?tab=pour" className={cn(linkButton("quiet"), "mt-3 w-full")}>See Pour Control <ArrowRight size={15} aria-hidden /></Link>
        </section>
      </div>

      <p data-tour="more" className="text-center text-[13px]"><Link href="/performance" className="font-medium text-accent-ink underline-offset-4 hover:underline">See full performance: outlets, trends and guest results</Link></p>
    </div>
  );
}
