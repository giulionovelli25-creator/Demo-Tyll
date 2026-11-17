"use client";
// Overview: the four main features as large cards, one chart, and the three things that matter most today. Nothing else.
import Link from "next/link";
import { ArrowRight, Sunrise } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { MODULE_ICON, MODULE_TONE } from "@/components/theme";
import { Drawer, EmptyState, Note, OutletDot, PageHeader, Panel, Skeleton, SummaryBar, WidgetError, cn, linkButton, textLink } from "@/components/ui";
import { StripTrend } from "@/components/charts";
import { byDay, versus, wasteInCurrency, weekSums } from "@/lib/domain/trends";
import { useDailyTotals, useDeliveryChecks, useUnexplained } from "@/lib/strip-data";
import { useAlertFeed } from "@/lib/alert-feed";
import { outletById, propertyById } from "@/lib/data/catalog";
import { compare, computeTotals, exceptionInSel } from "@/lib/domain/metrics";
import { topAlerts } from "@/lib/domain/top-alerts";
import type { ModuleId } from "@/lib/domain/access";
import { useCtx, useInvestigations, useView } from "@/lib/hooks";
import { DEMO_NOW_MIN, DEMO_TODAY, addDays, eachDay, fmtDate, fmtMoney, fmtPct, fmtTime, fxRate, pctChange, presetRange, sum } from "@/lib/util";
import type { ChartPoint } from "./chart";


type Tone = "neg" | "warn" | "pos" | "money" | undefined;
const TONE: Record<string, string> = { neg: "text-neg", warn: "text-warn", pos: "text-pos", money: "text-money" };

/** Each card's small picture: the shape behind its number. The line of text beside it says the same in words. */
function Spark({ values }: { values: number[] }) {
  const top = Math.max(...values, 1);
  const low = Math.min(...values);
  const span = top - low || 1;
  const points = values.map((v, i) => `${(i / Math.max(values.length - 1, 1)) * 100},${26 - ((v - low) / span) * 22}`).join(" ");
  return <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="h-5 w-full" aria-hidden><polyline points={points} fill="none" stroke="var(--color-accent-ink)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}

function Bars({ values }: { values: number[] }) {
  const top = Math.max(...values, 1);
  return (
    <div className="flex h-5 items-end gap-1" aria-hidden>
      {values.map((v, i) => <span key={i} className={cn("flex-1 rounded-t-[3px]", i === values.length - 1 ? "bg-money" : "bg-money/30")} style={{ height: `${Math.max((v / top) * 100, 6)}%` }} />)}
    </div>
  );
}

function Split({ parts }: { parts: { n: number; className: string }[] }) {
  return (
    <div className="flex h-5 items-center" aria-hidden>
      <div className="flex h-2 w-full gap-0.5">
        {parts.filter((p) => p.n > 0).map((p, i) => <span key={i} className={cn("rounded-full", p.className)} style={{ flexGrow: p.n, flexBasis: 0 }} />)}
      </div>
    </div>
  );
}

function Card({ module, title, number, tone, line, cta, href, picture, loading }: { module: ModuleId; title: string; number: ReactNode; tone?: Tone; line: ReactNode; cta: string; href: string; picture?: ReactNode; loading?: boolean }) {
  const Icon = MODULE_ICON[module];
  return (
    <section aria-label={title} data-mod={MODULE_TONE[module]} className="relative flex min-w-0 items-center gap-3 rounded-panel border border-line bg-paper p-3 shadow-panel transition-shadow duration-200 ease-tyll hover:shadow-lift sm:flex-col sm:items-stretch sm:gap-0 sm:p-4">
      <div className="min-w-0 flex-1">
        <h2 className="flex items-center gap-2 text-[15px] font-medium text-ink"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft"><Icon size={15} aria-hidden /></span>{title}</h2>
        {loading ? (
          <div className="space-y-2 pt-2" aria-hidden><Skeleton className="h-8 w-2/3" /><Skeleton className="h-4 w-full" /></div>
        ) : (
          <>
            <p className={cn("num mt-0.5 whitespace-nowrap text-[24px] font-medium leading-tight tracking-[-0.02em] sm:mt-2 sm:text-[30px]", tone ? TONE[tone] : "text-ink")}>{number}</p>
            <p className="text-[13px] leading-snug text-graphite sm:mt-1 sm:min-h-[2.5em]">{line}</p>
            {picture && <div className="mt-2 hidden sm:block">{picture}</div>}
          </>
        )}
      </div>
      {/* The whole card opens the page, and the button says where it goes. */}
      <Link href={href} className={cn(linkButton("secondary"), "shrink-0 px-3 text-[13px] after:absolute after:inset-0 after:rounded-panel after:content-[''] sm:mt-3 sm:w-full sm:px-4 sm:text-sm")}>{cta} <ArrowRight size={15} className="hidden sm:block" aria-hidden /></Link>
    </section>
  );
}

const signed = (change: number | null) => (change === null ? "" : `${change >= 0 ? "up" : "down"} ${fmtPct(Math.abs(change))}`);
const POINTS = 14;

export function Home() {
  const { user, sel, money, propertyId } = useView();
  const ctx = useCtx();
  const { plan, open, pour, error, loading } = useAlertFeed();
  const investigations = useInvestigations();
  const checks = useDeliveryChecks(plan?.propertyId ?? propertyId ?? "dxb");
  const wasteRows = useMemo(() => wasteInCurrency(ctx, sel.outletIds, sel.currency), [ctx, sel.outletIds, sel.currency]);
  const pourRate = pour ? fxRate(propertyById[pour.propertyId].currency, sel.currency) : 1;
  const pourDaily = useMemo(() => (pour?.wine.daily ?? []).map((d, i) => ({ date: d.date, value: (d.gapValue + (pour?.spirits.daily[i]?.gapValue ?? 0)) * pourRate })), [pour, pourRate]);
  const lostDaily = useMemo(() => {
    const w = byDay(wasteRows, (e) => e.w.date, (e) => e.cost);
    const p = new Map(pourDaily.map((d) => [d.date, d.value]));
    return w.map((d) => ({ date: d.date, value: Math.round(d.value + (p.get(d.date) ?? 0)) }));
  }, [wasteRows, pourDaily]);
  // The week's totals come from the same figures as Waste and breakage and Over pouring, so the parts add up to the total.
  const lostWeek = useMemo(() => {
    const w = weekSums(wasteRows.filter((e) => !e.broken), (e) => e.w.date, (e) => e.cost);
    const b = weekSums(wasteRows.filter((e) => e.broken), (e) => e.w.date, (e) => e.cost);
    const drinksNow = pour ? (pour.wine.totals.week.gapValue + pour.spirits.totals.week.gapValue) * pourRate : 0;
    const drinksBefore = pour ? (pour.wine.lastWeek.gapValue + pour.spirits.lastWeek.gapValue) * pourRate : 0;
    const [waste, broken, drinks] = [Math.round(w.now), Math.round(b.now), Math.round(drinksNow)];
    return { now: waste + broken + drinks, before: w.before + b.before + drinksBefore, waste, broken, drinks };
  }, [wasteRows, pour, pourRate]);
  const daily = useDailyTotals();
  const dailyRevenue = daily.map(({ date, t }) => ({ date, value: Math.round(t.net) }));
  const openFlags = useMemo(() => investigations.filter((i) => i.status !== "closed" && exceptionInSel(i, sel)), [investigations, sel]);
  const flagValue = (i: (typeof openFlags)[number]) => i.exposure * fxRate(propertyById[i.propertyId].currency, sel.currency);
  const unexplained = useUnexplained(plan?.propertyId ?? propertyId ?? "dxb");
  const [brief, setBrief] = useState(false);
  // Everything Tyll has found since the first of the month, each part linked to its records.
  const found = useMemo(() => {
    const from = `${DEMO_TODAY.slice(0, 8)}01`;
    const monthCases = investigations.filter((i) => exceptionInSel(i, sel) && i.date >= from);
    const flagged = sum(monthCases, flagValue);
    const drinks = pour ? (pour.wine.totals.month.gapValue + pour.spirits.totals.month.gapValue) * pourRate : 0;
    const parts = [
      { label: "flagged bills", value: flagged, href: "/money?tab=flags" },
      { label: "drinks not billed", value: drinks, href: "/drinks" },
      { label: "supplier invoice differences", value: checks.value, href: "/stock?tab=suppliers" },
      { label: "stock missing at counts", value: unexplained?.value ?? 0, href: "/stock?tab=where" },
    ].filter((p) => p.value > 0);
    const recovered = sum(monthCases.filter((i) => i.status === "closed"), (i) => i.recovered * fxRate(propertyById[i.propertyId].currency, sel.currency));
    return { from, parts, total: sum(parts, (p) => p.value), recovered };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [investigations, sel, pour, pourRate, checks.value, unexplained]);
  const week = useMemo(() => compare(ctx, { ...sel, range: presetRange("week") }), [ctx, sel]);
  const today = useMemo(() => computeTotals(ctx, { ...sel, range: { from: DEMO_TODAY, to: DEMO_TODAY } }), [ctx, sel]);
  const points = useMemo<(ChartPoint & { lost: number })[]>(() => eachDay({ from: addDays(DEMO_TODAY, -(POINTS - 1)), to: DEMO_TODAY }).map((date) => {
    const t = computeTotals(ctx, { ...sel, range: { from: date, to: date } });
    return { label: fmtDate(date), revenue: t.net, profit: t.operatingProfit ?? t.grossProfit, partial: date === DEMO_TODAY, lost: t.waste + t.breakage };
  }), [ctx, sel]);

  if (sel.outletIds.length === 0) return <EmptyState title="Choose an outlet to begin">Your figures appear here once you pick an outlet in the top bar.</EmptyState>;

  const items = plan?.items ?? [];
  const toOrder = items.filter((i) => i.orderQty > 0);
  const critical = items.filter((i) => i.health === "critical");
  const low = items.filter((i) => i.health === "low");
  const nextDate = toOrder.map((i) => i.orderBy ?? "").filter(Boolean).sort()[0];
  const lost = today.waste + today.breakage;
  const net = week.now.net;
  const profit = week.now.operatingProfit;
  const place = sel.outletIds.length === 1 ? outletById[sel.outletIds[0]].name : propertyId ? propertyById[propertyId].name : "All hotels";
  const top = topAlerts(open);
  const dueToday = sum(toOrder.filter((i) => i.orderBy === DEMO_TODAY), (i) => i.cost);
  const dueWeek = sum(toOrder.filter((i) => i.orderBy && i.orderBy > DEMO_TODAY && i.orderBy <= addDays(DEMO_TODAY, 7)), (i) => i.cost);
  const dueLater = sum(toOrder, (i) => i.cost) - dueToday - dueWeek;
  const dueTodayItems = toOrder.filter((i) => i.orderBy === DEMO_TODAY);
  const local = (n: number) => fmtMoney(n, propertyById[plan?.propertyId ?? "dxb"].currency, { compact: true });
  // The biggest part of this week's loss, said in one plain sentence.
  const biggest = [{ word: "drinks poured but not billed", value: lostWeek.drinks, where: pour?.wine.flags[0] ? ` at ${outletById[pour.wine.flags[0].outletId].name}` : "" }, { word: "food and drinks thrown away", value: lostWeek.waste, where: "" }, { word: "glass and china broken", value: lostWeek.broken, where: "" }].sort((a, b) => b.value - a.value)[0];
  const headline = lostWeek.now > 0 ? `This week ${money(lostWeek.now, { compact: true })} was lost. The largest part is ${biggest.word}${biggest.where}: ${money(biggest.value, { compact: true })}.` : "Nothing was lost this week.";
  const greeting = DEMO_NOW_MIN < 720 ? "Good morning" : DEMO_NOW_MIN < 1020 ? "Good afternoon" : "Good evening";

  return (
    <div className="space-y-6">
      <PageHeader title={`${greeting}, ${user.name.split(" ")[0]}`} question={top.length ? `${top.length === 1 ? "One thing needs" : `${top.length} things need`} you today.` : "Nothing needs you right now."} lead={`${place}. Updated ${fmtTime(DEMO_NOW_MIN)}, simulated data.`}>
        <button type="button" onClick={() => setBrief(true)} className={cn(linkButton("secondary"), "max-sm:hidden")}><Sunrise size={16} aria-hidden /> Morning brief</button>
      </PageHeader>


      {error && <WidgetError>The stock prediction could not load. The other figures are still current.</WidgetError>}

      {/* One block: what Tyll found this month, the one sentence that matters, then this week's numbers and the trend. */}
      <SummaryBar
        header={
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <p className="text-[13px] text-steel">Tyll found this month, since {fmtDate(found.from)}</p>
              <p className="num mt-1 text-[32px] font-medium leading-none tracking-[-0.02em] text-ink">{money(found.total)}</p>
              <p className="mt-3 max-w-[64ch] text-[15px] leading-snug text-graphite">{headline}</p>
              <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
                {found.parts.map((p) => <li key={p.label}><Link href={p.href} prefetch={false} className="text-[13px] text-steel underline-offset-4 hover:text-ink hover:underline"><span className="num font-medium text-ink">{money(p.value, { compact: true })}</span> {p.label}</Link></li>)}
              </ul>
            </div>
            <div className="shrink-0 lg:text-end">
              <p className="text-[13px] text-steel">Recovered so far</p>
              <p className="num mt-1 text-[22px] font-medium leading-none text-pos">{money(found.recovered)}</p>
              <p className="mt-1 text-xs text-steel">From closed cases</p>
            </div>
          </div>
        }
        items={[
          { label: "Lost this week", value: money(lostWeek.now, { compact: true }), tone: "money", compare: versus(lostWeek.now, lostWeek.before, "down"), note: "Waste, breakage and drinks not billed", href: "/waste" },
          { label: "To order today", value: dueTodayItems.length, compare: { text: dueTodayItems.length ? `${local(sum(dueTodayItems, (i) => i.nextCost))} for the next delivery` : nextDate ? `Next order ${fmtDate(nextDate, true)}` : "Nothing due", good: null }, href: "/forecast" },
          { label: "Open flags", value: openFlags.length, tone: openFlags.length ? "warn" : "pos", compare: { text: `${money(sum(openFlags, flagValue), { compact: true })} to check`, good: null }, href: "/money?tab=flags" },
        ]}
        trend={<StripTrend goodWhen="down" title="Money lost per day, last 30 days" points={lostDaily} format={(n) => money(n)}
          explain="Everything the hotel lost each day: waste, breakage and drinks not billed. Switch on revenue to see whether losses rise with how busy it is."
          series={[
            { id: "waste", label: "Waste", axis: "main", format: (n) => money(n), points: byDay(wasteRows.filter((e) => !e.broken), (e) => e.w.date, (e) => e.cost), goodWhen: "down" as const, explain: "Food and drinks thrown away." },
            { id: "drinks", label: "Drinks not billed", axis: "main", format: (n) => money(n), points: pourDaily.map((d) => ({ date: d.date, value: Math.round(d.value) })), goodWhen: "down" as const, explain: "Poured but not rung up." },
            { id: "revenue", label: "Revenue", axis: "revenue", format: (n) => money(n, { compact: true }), points: dailyRevenue, goodWhen: "up" as const, explain: "Net sales. If losses rise when revenue rises, busy service is the likely cause." },
          ]} summary={`Waste, breakage and drinks poured but not billed, per day. This week ${money(lostWeek.now)}.`} note="waste, breakage, not billed" />}
      />

      <div data-tour="kpis" className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
        <Card
          module="waste" title="Log waste" picture={<Bars values={points.slice(-7).map((p) => p.lost)} />} number={money(lost, { compact: true })}
          line={`Lost today: ${money(today.waste, { compact: true })} wasted, ${money(today.breakage, { compact: true })} broken.`}
          cta="Log waste" href="/waste"
        />
        <Card
          module="stock" title="Stock levels" picture={<Split parts={[{ n: critical.length, className: "bg-neg" }, { n: low.length, className: "bg-warn" }, { n: items.length - critical.length - low.length, className: "bg-pos" }]} />} number={`${critical.length} critical`} tone={critical.length ? "neg" : "pos"} loading={!plan && loading}
          line={`${low.length} low and ${items.length - critical.length - low.length} fine.`}
          cta="Check stock" href="/stock"
        />
        <Card
          module="forecast" title="Predictions" picture={<Split parts={[{ n: dueToday, className: "bg-money" }, { n: dueWeek, className: "bg-money/50" }, { n: dueLater, className: "bg-money/20" }]} />} number={fmtMoney(sum(toOrder, (i) => i.cost), propertyById[plan?.propertyId ?? "dxb"].currency, { compact: true })} loading={!plan && loading}
          line={`Buying planned to ${plan ? fmtDate(plan.period.to) : "month end"}: ${toOrder.length} items.${nextDate ? ` Next order ${nextDate === DEMO_TODAY ? "today" : fmtDate(nextDate, true)}.` : ""}`}
          cta="See what to order" href="/forecast"
        />
        <Card
          module="money" title="Revenue" picture={<Spark values={points.slice(-7).map((p) => p.revenue)} />} number={money(net, { compact: true })}
          line={`Last 7 days, ${signed(pctChange(net, week.before.net))}. ${money(profit ?? week.now.grossProfit, { compact: true })} ${profit !== null ? "profit, estimate" : "gross profit"}.`}
          cta="See revenue" href="/money"
        />
      </div>


      <div>
        <Panel title="Start here" action={<Link href="/alerts" className={textLink}>See all alerts</Link>} flush>
          {top.length === 0 ? <p className="px-5 pb-5 text-sm text-steel sm:px-6">{loading ? "Checking." : "Nothing needs you right now."}</p> : (
            <ul>
              {top.map((a) => (
                <li key={a.id} className="border-t border-hair px-5 py-2 sm:px-6">
                  <Link href={a.next.href} prefetch={false} className="-my-1 block rounded-md py-1 underline-offset-4 hover:underline">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="text-[14px] font-medium leading-snug text-ink">{a.what}</span>
                      {a.amount !== null && <span className="num shrink-0 text-[13px] font-medium text-ink">{money(a.amount, { compact: true })}</span>}
                    </span>
                    <span className="mt-0.5 flex items-baseline justify-between gap-3 text-xs text-steel"><span><OutletDot id={a.outletId} />{a.where}</span>{a.amount !== null && <span className="shrink-0">{a.amountWord}</span>}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Drawer open={brief} onClose={() => setBrief(false)} title={`Morning brief, ${fmtDate(addDays(DEMO_TODAY, 1), true)}`} description="What a manager reads at 7 AM. In this demo it is a preview: nothing is sent.">
        <div className="space-y-5 text-sm">
          <section>
            <h3 className="font-medium text-ink">Yesterday</h3>
            <ul className="mt-2 space-y-1.5 text-graphite">
              <li>Lost {money(today.waste + today.breakage + (pourDaily[pourDaily.length - 1]?.value ?? 0))}: {money(today.waste)} waste, {money(today.breakage)} breakage, {money(pourDaily[pourDaily.length - 1]?.value ?? 0)} drinks not billed.</li>
              <li>Revenue {money(today.net, { compact: true })} from {today.covers} guests.</li>
              <li>{openFlags.length} flagged {openFlags.length === 1 ? "bill" : "bills"} still open, {money(sum(openFlags, flagValue))} until checked.</li>
            </ul>
          </section>
          <section>
            <h3 className="font-medium text-ink">Three things to do today</h3>
            <ol className="mt-2 list-decimal space-y-1.5 ps-5 text-graphite">{top.slice(0, 3).map((a) => <li key={a.id}>{a.what}{a.amount !== null ? `, ${money(a.amount, { compact: true })} ${a.amountWord}` : ""}.</li>)}</ol>
          </section>
          <section>
            <h3 className="font-medium text-ink">This month so far</h3>
            <p className="mt-2 text-graphite">Tyll found {money(found.total)} and {money(found.recovered)} has been recovered.</p>
          </section>
          <Note>Sent by email at 7 AM to the managers who choose it in Settings. Figures are simulated in this demo.</Note>
        </div>
      </Drawer>

    </div>
  );
}
