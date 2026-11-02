"use client";
// Overview: the four main features as large cards, one chart, and the three things that matter most today. Nothing else.
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { MODULE_ICON, MODULE_TONE } from "@/components/theme";
import { EmptyState, OutletDot, PageHeader, Panel, Skeleton, WidgetError, cn, linkButton, textLink } from "@/components/ui";
import { useAlertFeed } from "@/lib/alert-feed";
import { outletById, propertyById } from "@/lib/data/catalog";
import { compare, computeTotals } from "@/lib/domain/metrics";
import { topAlerts } from "@/lib/domain/top-alerts";
import type { ModuleId } from "@/lib/domain/access";
import { useCtx, useView } from "@/lib/hooks";
import { DEMO_NOW_MIN, DEMO_TODAY, addDays, eachDay, fmtDate, fmtMoney, fmtPct, fmtShort, fmtTime, pctChange, presetRange, sum } from "@/lib/util";
import type { ChartPoint } from "./chart";

const RevenueProfitChart = dynamic(() => import("./chart").then((m) => m.RevenueProfitChart), { ssr: false, loading: () => <Skeleton className="h-[172px] w-full" /> });

type Tone = "neg" | "warn" | "pos" | "money" | undefined;
const TONE: Record<string, string> = { neg: "text-neg", warn: "text-warn", pos: "text-pos", money: "text-money" };

/** Each card's small picture: the shape behind its number. The line of text beside it says the same in words. */
function Spark({ values }: { values: number[] }) {
  const top = Math.max(...values, 1);
  const low = Math.min(...values);
  const span = top - low || 1;
  const points = values.map((v, i) => `${(i / Math.max(values.length - 1, 1)) * 100},${26 - ((v - low) / span) * 22}`).join(" ");
  return <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="h-7 w-full" aria-hidden><polyline points={points} fill="none" stroke="var(--color-accent-ink)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}

function Bars({ values }: { values: number[] }) {
  const top = Math.max(...values, 1);
  return (
    <div className="flex h-7 items-end gap-1" aria-hidden>
      {values.map((v, i) => <span key={i} className={cn("flex-1 rounded-t-[3px]", i === values.length - 1 ? "bg-money" : "bg-money/30")} style={{ height: `${Math.max((v / top) * 100, 6)}%` }} />)}
    </div>
  );
}

function Split({ parts }: { parts: { n: number; className: string }[] }) {
  return (
    <div className="flex h-7 items-center" aria-hidden>
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
        <h2 className="flex items-center gap-2 text-[14px] font-medium text-accent-ink"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft"><Icon size={15} aria-hidden /></span>{title}</h2>
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
      <Link href={href} className={cn(linkButton("quiet"), "shrink-0 px-3 text-[13px] after:absolute after:inset-0 after:rounded-panel after:content-[''] sm:mt-3 sm:w-full sm:px-4 sm:text-sm")}>{cta} <ArrowRight size={15} className="hidden sm:block" aria-hidden /></Link>
    </section>
  );
}

const signed = (change: number | null) => (change === null ? "" : `${change >= 0 ? "up" : "down"} ${fmtPct(Math.abs(change))}`);
const POINTS = 14;

export function Home() {
  const { user, sel, money, propertyId, currency } = useView();
  const ctx = useCtx();
  const { plan, open, error, loading } = useAlertFeed();
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
  const profitName = profit !== null ? "Net profit" : "Gross profit";
  const top = topAlerts(open);
  const dueToday = sum(toOrder.filter((i) => i.orderBy === DEMO_TODAY), (i) => i.cost);
  const dueWeek = sum(toOrder.filter((i) => i.orderBy && i.orderBy > DEMO_TODAY && i.orderBy <= addDays(DEMO_TODAY, 7)), (i) => i.cost);
  const dueLater = sum(toOrder, (i) => i.cost) - dueToday - dueWeek;
  const greeting = DEMO_NOW_MIN < 720 ? "Good morning" : DEMO_NOW_MIN < 1020 ? "Good afternoon" : "Good evening";

  return (
    <div className="space-y-4">
      <PageHeader title={`${greeting}, ${user.name.split(" ")[0]}`} question={top.length ? `${top.length === 1 ? "One thing needs" : `${top.length} things need`} you today.` : "Nothing needs you right now."} lead={`${place}. Updated ${fmtTime(DEMO_NOW_MIN)}, simulated data.`} />

      {error && <WidgetError>The stock prediction could not load. The other figures are still current.</WidgetError>}

      <div data-tour="kpis" className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 xl:grid-cols-4">
        <Card
          module="waste" title="Log waste" picture={<Bars values={points.slice(-7).map((p) => p.lost)} />} number={money(lost, { compact: true })}
          line={`Lost today: ${money(today.waste, { compact: true })} wasted, ${money(today.breakage, { compact: true })} broken.`}
          cta="Log waste" href="/waste"
        />
        <Card
          module="stock" title="Stock" picture={<Split parts={[{ n: critical.length, className: "bg-neg" }, { n: low.length, className: "bg-warn" }, { n: items.length - critical.length - low.length, className: "bg-pos" }]} />} number={`${critical.length} critical`} tone={critical.length ? "neg" : "pos"} loading={!plan && loading}
          line={`${low.length} low and ${items.length - critical.length - low.length} fine.`}
          cta="Check stock" href="/stock"
        />
        <Card
          module="forecast" title="Predictions" picture={<Split parts={[{ n: dueToday, className: "bg-money" }, { n: dueWeek, className: "bg-money/50" }, { n: dueLater, className: "bg-money/20" }]} />} number={fmtMoney(sum(toOrder, (i) => i.cost), propertyById[plan?.propertyId ?? "dxb"].currency, { compact: true })} loading={!plan && loading}
          line={`${toOrder.length} items to order by ${plan ? fmtDate(plan.period.to) : "month end"}.${nextDate ? ` Next order ${nextDate === DEMO_TODAY ? "today" : fmtDate(nextDate, true)}.` : ""}`}
          cta="See what to order" href="/forecast"
        />
        <Card
          module="money" title="Revenue" picture={<Spark values={points.slice(-7).map((p) => p.revenue)} />} number={money(net, { compact: true })}
          line={`Last 7 days, ${signed(pctChange(net, week.before.net))}. ${money(profit ?? week.now.grossProfit, { compact: true })} ${profit !== null ? "profit, estimate" : "gross profit"}.`}
          cta="See revenue" href="/money"
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[3fr_2fr]">
        <Panel title={`Revenue and ${profit !== null ? "estimated profit" : "gross profit"}, last ${POINTS} days`} >
          <RevenueProfitChart small points={points} format={(n) => money(n)} axisFormat={fmtShort} profitName={profitName} summary={`Revenue and ${profitName} per day for the last ${POINTS} days, in ${currency}.`} />
        </Panel>
        <Panel title="Start here" action={<Link href="/alerts" className={textLink}>See all alerts</Link>} flush>
          {top.length === 0 ? <p className="px-5 pb-5 text-sm text-steel sm:px-6">{loading ? "Checking." : "Nothing needs you right now."}</p> : (
            <ul>
              {top.map((a) => (
                <li key={a.id} className="border-t border-hair px-5 py-3 sm:px-6">
                  <Link href={a.next.href} className="-my-1 block rounded-md py-1 underline-offset-4 hover:underline">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="text-[14px] font-medium leading-snug text-ink">{a.what}</span>
                      {a.amount !== null && <span className="num shrink-0 text-[13px] font-medium text-money">{money(a.amount, { compact: true })}</span>}
                    </span>
                    <span className="mt-0.5 flex items-baseline justify-between gap-3 text-xs text-steel"><span><OutletDot id={a.outletId} />{a.where}</span>{a.amount !== null && <span className="shrink-0">{a.amountWord}</span>}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
