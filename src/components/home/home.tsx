"use client";
// Overview: money lost and saved this month with its trend, the three things that need you today, and one row of small doors into each area. Nothing else.
import Link from "next/link";
import { ArrowRight, ChevronRight, Sunrise } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { MODULE_ICON, MODULE_TONE } from "@/components/theme";
import { Drawer, EmptyState, Note, OutletDot, PageHeader, Skeleton, WidgetError, cn, linkButton, textLink } from "@/components/ui";
import { StripTrend } from "@/components/charts";
import { HOURLY_RATE, OVER_ORDERING_SHARE, ROLE_HOURS, byDay, lostAndSaved, paceSaving, tyllValue, versus, wasteInCurrency, weekSums, yearly, type LeakRow } from "@/lib/domain/trends";
import { useDailyTotals, useDeliveryChecks, useUnexplained } from "@/lib/strip-data";
import { useAlertFeed } from "@/lib/alert-feed";
import { outletById, propertyById } from "@/lib/data/catalog";
import { compare, computeTotals, exceptionInSel } from "@/lib/domain/metrics";
import { topAlerts } from "@/lib/domain/top-alerts";
import { can, type ModuleId } from "@/lib/domain/access";
import { useAutoOrder } from "@/lib/plan-hooks";
import { useCtx, useInvestigations, useView } from "@/lib/hooks";
import { DEMO_NOW_MIN, DEMO_TODAY, addDays, diffDays, fmtDate, fmtMoney, fmtPct, fmtTime, fxRate, pctChange, presetRange, sum } from "@/lib/util";


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
            <p className={cn("num mt-0.5 whitespace-nowrap text-[24px] font-medium leading-tight tracking-[-0.02em] sm:mt-1.5 sm:text-[28px]", tone ? TONE[tone] : "text-ink")}>{number}</p>
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


/** What one row saved, in words. Pace savings are estimates and say so; a row above last month's pace says that plainly. */
function savedLine(r: LeakRow, money: (n: number, o?: { compact?: boolean }) => string, before: string) {
  if (r.how === "credit") return r.saved > 0 ? `${money(r.saved, { compact: true })} credited by suppliers` : "No credit recorded yet";
  if (r.how === "recovered") return r.saved > 0 ? `${money(r.saved, { compact: true })} recovered` : "Nothing recovered yet";
  void before;
  if (r.saved > 0) return `${money(r.saved, { compact: true })} less than the 30 days before, estimate`;
  if (r.saved < 0) return `${money(-r.saved, { compact: true })} more than the 30 days before`;
  return "Same as the 30 days before";
}

/** Lost and saved for each kind of loss as two bars on one scale, so the rows compare at a glance. Each row opens its records. */
function LedgerBars({ rows, lost, saved, money, before }: { rows: LeakRow[]; lost: number; saved: number; money: (n: number, o?: { compact?: boolean }) => string; before: string }) {
  const top = Math.max(...rows.map((r) => Math.max(r.lost, r.saved)), 1);
  const width = (n: number) => `${Math.max((Math.max(n, 0) / top) * 100, n > 0 ? 1.5 : 0)}%`;
  return (
    <div className="space-y-4 text-sm">
      <div className="grid grid-cols-2 gap-3 rounded-[var(--radius-control)] bg-cloud px-4 py-3">
        <div><p className="text-xs text-steel">Lost</p><p className="num mt-0.5 text-[20px] font-medium text-ink">{money(lost)}</p></div>
        <div><p className="text-xs text-steel">Saved</p><p className="num mt-0.5 text-[20px] font-medium text-pos">{money(saved)}</p></div>
      </div>
      <p className="flex items-center gap-4 text-xs text-graphite" aria-hidden>
        <span className="flex items-center gap-1.5"><span className="h-2 w-4 rounded-full bg-steel/60" />Lost</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-4 rounded-full bg-pos" />Saved</span>
      </p>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={r.href} prefetch={false} className="block rounded-[var(--radius-control)] px-2 py-2 transition-colors duration-150 hover:bg-cloud">
              <span className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 text-[13px] font-medium text-ink">{r.label}</span>
                <span className="num shrink-0 text-[13px] font-medium text-ink">{money(r.lost, { compact: true })}</span>
              </span>
              <span className="mt-1.5 block space-y-1" aria-hidden>
                <span className="block h-2 rounded-full bg-steel/60" style={{ width: width(r.lost) }} />
                {r.saved > 0 && <span className="block h-2 rounded-full bg-pos" style={{ width: width(r.saved) }} />}
              </span>
              <span className={cn("mt-1 block text-xs", r.saved > 0 ? "text-pos" : "text-graphite")}>{savedLine(r, money, before)}</span>
            </Link>
          </li>
        ))}
      </ul>
      <Note>Saved is money recovered on closed cases, credits from suppliers, and any loss that ran below the daily pace of the 30 days before, which is an estimate.</Note>
    </div>
  );
}

const signed = (change: number | null) => (change === null ? "" : `${change >= 0 ? "up" : "down"} ${fmtPct(Math.abs(change))}`);

export function Home() {
  const { user, sel, money, propertyId } = useView();
  const ctx = useCtx();
  const { plan, open, pour, error, loading } = useAlertFeed();
  const investigations = useInvestigations();
  const checks = useDeliveryChecks(plan?.propertyId ?? propertyId ?? "lis");
  // What automatic ordering placed this morning, for the Predictions card. Only for roles that order.
  const autoOrder = useAutoOrder(can(user, "purchase.create") && plan ? plan.propertyId : null).data?.auto;
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
    return { now: waste + broken + drinks, before: w.before + b.before + drinksBefore, waste, broken, drinks, drinksBefore };
  }, [wasteRows, pour, pourRate]);
  const daily = useDailyTotals();
  const dailyRevenue = daily.map(({ date, t }) => ({ date, value: Math.round(t.net) }));
  const openFlags = useMemo(() => investigations.filter((i) => i.status !== "closed" && exceptionInSel(i, sel)), [investigations, sel]);
  const flagValue = (i: (typeof openFlags)[number]) => i.exposure * fxRate(propertyById[i.propertyId].currency, sel.currency);
  const unexplained = useUnexplained(plan?.propertyId ?? propertyId ?? "lis");
  const [brief, setBrief] = useState(false);
  const [breakdown, setBreakdown] = useState<"lost" | "saved" | "value" | null>(null);
  // This month: every kind of loss Tyll measures, and what was saved on each. Each part links to its records.
  const ledger = useMemo(() => {
    // The last 30 days, compared with the 30 days before.
    const from = addDays(DEMO_TODAY, -29);
    const before = addDays(from, -30);
    const beforeDays = diffDays(from, before);
    // The pace uses full days only, so today's half day does not look like a saving.
    const nowDays = diffDays(DEMO_TODAY, from);
    const fullDay = (d: string) => d >= from && d < DEMO_TODAY;
    const lastMonth = (d: string) => d >= before && d < from;
    const wasteOf = (broken: boolean, when: (d: string) => boolean) => sum(wasteRows.filter((e) => e.broken === broken && when(e.w.date)), (e) => e.cost);
    const monthCases = investigations.filter((i) => exceptionInSel(i, sel) && i.date >= from);
    const recoveredOf = (cases: typeof monthCases) => sum(cases.filter((i) => i.status === "closed"), (i) => i.recovered * fxRate(propertyById[i.propertyId].currency, sel.currency));
    // Count cases are the stock missing at counts, so bills and counts never count the same money twice. Bought against
    // used gaps are estimates a count confirms, and the stock a count finds missing is already in its own row, so they
    // are not added as money lost.
    const bills = monthCases.filter((i) => !i.period && i.type !== "bought_not_used");
    const counts = monthCases.filter((i) => i.period);
    const drinksBefore = pour ? (pour.wine.lastMonth.gapValue + pour.spirits.lastMonth.gapValue) * pourRate : 0;
    const rows: LeakRow[] = [
      { id: "waste", label: "Food and drinks thrown away", lost: wasteOf(false, (d) => d >= from), saved: paceSaving(wasteOf(false, lastMonth), beforeDays, wasteOf(false, fullDay), nowDays), how: "pace", href: "/waste" },
      { id: "broken", label: "Glass and china broken", lost: wasteOf(true, (d) => d >= from), saved: paceSaving(wasteOf(true, lastMonth), beforeDays, wasteOf(true, fullDay), nowDays), how: "pace", href: "/waste" },
      { id: "drinks", label: "Drinks poured, not billed", lost: pour ? (pour.wine.totals.month.gapValue + pour.spirits.totals.month.gapValue) * pourRate : 0, saved: paceSaving(drinksBefore, beforeDays, pour ? (pour.wine.recentFull.gapValue + pour.spirits.recentFull.gapValue) * pourRate : 0, nowDays), how: "pace", href: "/drinks" },
      { id: "bills", label: "Flagged bills", lost: sum(bills, flagValue), saved: recoveredOf(bills), how: "recovered", href: "/money?tab=flags" },
      { id: "invoices", label: "Supplier invoice differences", lost: checks.value, saved: checks.credited, how: "credit", href: "/stock?tab=suppliers" },
      { id: "counts", label: "Stock missing at counts", lost: unexplained?.value ?? 0, saved: recoveredOf(counts), how: "recovered", href: "/stock?tab=where" },
    ];
    return { from, before, ...lostAndSaved(rows.map((r) => ({ ...r, lost: Math.round(r.lost), saved: Math.round(r.saved) }))) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wasteRows, investigations, sel, pour, pourRate, pourDaily, checks.value, checks.credited, unexplained]);
  const purchases30 = useMemo(() => sum(ctx.data.deliveries.filter((d) => d.status === "delivered" && d.date >= ledger.from), (d) => sum(d.lines, (l) => l.invoiced * l.invoicePrice)), [ctx.data.deliveries, ledger.from]);
  const value = tyllValue(ledger.saved, purchases30);
  const week = useMemo(() => compare(ctx, { ...sel, range: presetRange("week") }), [ctx, sel]);
  const today = useMemo(() => computeTotals(ctx, { ...sel, range: { from: DEMO_TODAY, to: DEMO_TODAY } }), [ctx, sel]);

  if (sel.outletIds.length === 0) return <EmptyState title="Choose an outlet to begin">Your figures appear here once you pick an outlet in the top bar.</EmptyState>;

  const items = plan?.items ?? [];
  const toOrder = items.filter((i) => i.orderQty > 0);
  const critical = items.filter((i) => i.health === "critical");
  const low = items.filter((i) => i.health === "low");
  const net = week.now.net;
  const profit = week.now.operatingProfit;
  const nextDate = toOrder.map((i) => i.orderBy ?? "").filter(Boolean).sort()[0];
  const dueToday = sum(toOrder.filter((i) => i.orderBy === DEMO_TODAY), (i) => i.cost);
  const dueWeek = sum(toOrder.filter((i) => i.orderBy && i.orderBy > DEMO_TODAY && i.orderBy <= addDays(DEMO_TODAY, 7)), (i) => i.cost);
  const dueLater = sum(toOrder, (i) => i.cost) - dueToday - dueWeek;
  const place = sel.outletIds.length === 1 ? outletById[sel.outletIds[0]].name : propertyId ? propertyById[propertyId].name : "All hotels";
  const top = topAlerts(open);
  const local = (n: number) => fmtMoney(n, propertyById[plan?.propertyId ?? "lis"].currency, { compact: true });
  const greeting = DEMO_NOW_MIN < 720 ? "Good morning" : DEMO_NOW_MIN < 1020 ? "Good afternoon" : "Good evening";

  return (
    <div className="space-y-6">
      <PageHeader title={`${greeting}, ${user.name.split(" ")[0]}`} question={top.length ? `${top.length === 1 ? "One thing needs" : `${top.length} things need`} you today.` : "Nothing needs you right now."} lead={`${place}. Updated ${fmtTime(DEMO_NOW_MIN)}, simulated data.`}>
        <button type="button" onClick={() => setBrief(true)} className={cn(linkButton("secondary"), "max-sm:hidden")}><Sunrise size={16} aria-hidden /> Morning brief</button>
      </PageHeader>


      {error && <WidgetError>The stock prediction could not load. The other figures are still current.</WidgetError>}

      {/* Two blocks side by side: the money story on the left, what needs doing today on the right. Then one row of small doors into each area. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section aria-label="Money lost and saved, last 30 days" className="min-w-0 rounded-panel border border-line bg-paper shadow-panel lg:col-span-2">
          <div className="grid grid-cols-2 gap-2 px-3 pb-3 pt-4 sm:gap-4 sm:px-4 sm:pt-5">
            {([
              { id: "lost" as const, label: "Money lost, last 30 days", value: money(ledger.lost), tone: "text-ink", note: `Since ${fmtDate(ledger.from)}, six kinds of loss` },
              { id: "saved" as const, label: "Money saved, last 30 days", value: money(ledger.saved), tone: "text-pos", note: `${fmtPct(ledger.share)} of what was lost` },
            ]).map((b, i) => (
              <button key={b.id} type="button" onClick={() => setBreakdown(b.id)} aria-haspopup="dialog"
                className={cn("group min-w-0 rounded-[var(--radius-control)] px-2 py-2 text-start transition-colors duration-150 hover:bg-cloud sm:px-3", i === 1 && "relative before:absolute before:-start-1 before:top-2 before:bottom-2 before:border-s before:border-hair sm:before:-start-2")}>
                <span className="flex items-center gap-1 text-[13px] text-steel">{b.label}<ChevronRight size={13} className="shrink-0 text-fog transition-transform duration-150 ease-tyll group-hover:translate-x-0.5 rtl:rotate-180" aria-hidden /></span>
                <span className={cn("num mt-1 block whitespace-nowrap text-[26px] font-medium leading-none tracking-[-0.02em] sm:text-[34px]", b.tone)}>{b.value}</span>
                <span className="mt-1.5 block text-xs text-graphite">{b.note}</span>
              </button>
            ))}
          </div>
          <div className="border-t border-hair px-5 pb-3 pt-3 sm:px-7">
            <StripTrend height={104} goodWhen="down" title="Money lost per day, last 30 days" points={lostDaily} format={(n) => money(n)}
              explain="Everything the hotel lost each day: waste, breakage and drinks not billed. Switch on revenue to see whether losses rise with how busy it is."
              series={[
                { id: "waste", label: "Waste", axis: "main", format: (n) => money(n), points: byDay(wasteRows.filter((e) => !e.broken), (e) => e.w.date, (e) => e.cost), goodWhen: "down" as const, explain: "Food and drinks thrown away." },
                { id: "drinks", label: "Drinks not billed", axis: "main", format: (n) => money(n), points: pourDaily.map((d) => ({ date: d.date, value: Math.round(d.value) })), goodWhen: "down" as const, explain: "Poured but not rung up." },
                { id: "revenue", label: "Revenue", axis: "revenue", format: (n) => money(n, { compact: true }), points: dailyRevenue, goodWhen: "up" as const, explain: "Net sales. If losses rise when revenue rises, busy service is the likely cause." },
              ]} summary={`Waste, breakage and drinks poured but not billed, per day. This week ${money(lostWeek.now)}, ${versus(lostWeek.now, lostWeek.before, "down").text.toLowerCase()}.`} note="waste, breakage, not billed" />
          </div>
        </section>

        <section aria-labelledby="today-title" className="flex min-w-0 flex-col rounded-panel border border-line bg-paper shadow-panel">
          <div className="flex items-baseline justify-between gap-3 px-5 pb-2 pt-5">
            <h2 id="today-title" className="text-[17px] font-medium text-ink">Needs you today</h2>
            <Link href="/alerts" prefetch={false} className={textLink}>All alerts</Link>
          </div>
          {top.length === 0 ? <p className="px-5 pb-5 text-sm text-steel">{loading ? "Checking." : "Nothing needs you right now."}</p> : (
            <ol className="flex-1">
              {top.map((a, i) => (
                <li key={a.id} className="border-t border-hair">
                  <Link href={a.next.href} prefetch={false} className="flex gap-3 px-5 py-3 transition-colors duration-150 hover:bg-cloud">
                    <span className="num mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] font-medium text-accent-ink" aria-hidden>{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-medium leading-snug text-ink">{a.what}</span>
                      <span className="mt-0.5 flex items-baseline justify-between gap-3 text-xs text-steel">
                        <span className="min-w-0 truncate"><OutletDot id={a.outletId} />{a.where}</span>
                        {a.amount !== null && <span className="shrink-0"><span className="num font-medium text-ink">{money(a.amount, { compact: true })}</span> {a.amountWord}</span>}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <div data-tour="kpis" className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
        <Card
          module="stock" title="Stock levels" picture={<Split parts={[{ n: critical.length, className: "bg-neg" }, { n: low.length, className: "bg-warn" }, { n: items.length - critical.length - low.length, className: "bg-pos" }]} />} number={`${critical.length} critical`} tone={critical.length ? "neg" : "pos"} loading={!plan && loading}
          line={`${low.length} low and ${items.length - critical.length - low.length} fine.`}
          cta="Check stock" href="/stock"
        />
        <Card
          module="drinks" title="Drinks not billed" picture={<Bars values={pourDaily.slice(-7).map((d) => d.value)} />} number={money(lostWeek.drinks, { compact: true })}
          line={`Last 7 days, ${versus(lostWeek.drinks, lostWeek.drinksBefore, "down").text.toLowerCase()}.`}
          cta="See over pouring" href="/drinks"
        />
        <Card
          module="forecast" title="Predictions" picture={<Split parts={[{ n: dueToday, className: "bg-money" }, { n: dueWeek, className: "bg-money/50" }, { n: dueLater, className: "bg-money/20" }]} />} number={local(sum(toOrder, (i) => i.cost))} loading={!plan && loading}
          line={autoOrder?.run && autoOrder.orders.length
            ? `Ordered automatically at ${autoOrder.run.time}: ${autoOrder.orders.length} ${autoOrder.orders.length === 1 ? "order" : "orders"}, ${local(sum(autoOrder.orders, (r) => sum(r.lines, (l) => l.qty * l.unitPrice)))}. ${autoOrder.orders.filter((r) => r.auto?.decision === "held").length} waiting for approval.`
            : `Buying planned to ${plan ? fmtDate(plan.period.to) : "month end"}: ${toOrder.length} items.${nextDate ? ` Next order ${nextDate === DEMO_TODAY ? "today" : fmtDate(nextDate, true)}.` : ""}`}
          cta={autoOrder?.run && autoOrder.orders.length ? "See automatic orders" : "See what to order"} href={autoOrder?.run && autoOrder.orders.length ? "/forecast?tab=auto" : "/forecast"}
        />
        <Card
          module="money" title="Revenue" picture={<Spark values={dailyRevenue.slice(-7).map((d) => d.value)} />} number={money(net, { compact: true })}
          line={`Last 7 days, ${signed(pctChange(net, week.before.net))}. ${money(profit ?? week.now.grossProfit, { compact: true })} ${profit !== null ? "profit, estimate" : "gross profit"}.`}
          cta="See revenue" href="/money"
        />
      </div>

      <Drawer open={breakdown === "lost" || breakdown === "saved"} onClose={() => setBreakdown(null)} title={breakdown === "saved" ? "Money saved, last 30 days" : "Money lost, last 30 days"} description={`Since ${fmtDate(ledger.from)}, by kind of loss. ${money(yearly(ledger.lost))} lost and ${money(yearly(ledger.saved))} saved a year at this rate, estimates. Simulated data.`}>
        <LedgerBars rows={breakdown === "saved" ? [...ledger.rows].sort((a, b) => b.saved - a.saved) : ledger.rows} lost={ledger.lost} saved={ledger.saved} money={money} before={ledger.before} />
        <button type="button" onClick={() => setBreakdown("value")} className="mt-4 flex w-full items-baseline justify-between gap-3 rounded-[var(--radius-control)] border border-line px-4 py-3 text-start text-sm transition-colors duration-150 hover:bg-cloud">
          <span><span className="block font-medium text-ink">Tyll value this year</span><span className="text-xs text-graphite">Losses stopped, less over-ordering and {value.hoursWeek} hours a week saved. Estimate.</span></span>
          <span className="num shrink-0 font-medium text-ink">{money(value.total)}</span>
        </button>
      </Drawer>

      <Drawer open={breakdown === "value"} onClose={() => setBreakdown(null)} title="Tyll value this year" description="At the rate of the last 30 days. Every part is an estimate, and the assumptions are listed. Simulated data.">
        <div className="space-y-5 text-sm">
          <div className="rounded-[var(--radius-control)] bg-cloud px-4 py-3"><p className="text-xs text-steel">Total, a year</p><p className="num mt-0.5 text-[24px] font-medium text-ink">{money(value.total)}</p></div>
          <ul className="divide-y divide-hair">
            <li className="py-2.5"><Link href="#" onClick={(e) => { e.preventDefault(); setBreakdown("saved"); }} className="flex items-baseline justify-between gap-3 hover:text-accent-ink"><span><span className="block font-medium text-ink">Losses stopped</span><span className="text-xs text-graphite">Money saved in the last 30 days, {money(ledger.saved)}, for 12 months.</span></span><span className="num shrink-0 font-medium text-pos">{money(value.stopped)}</span></Link></li>
            <li className="py-2.5"><Link href="/forecast" prefetch={false} className="flex items-baseline justify-between gap-3 hover:text-accent-ink"><span><span className="block font-medium text-ink">Less over-ordering</span><span className="text-xs text-graphite">Orders sized to the forecast instead of to par: {fmtPct(OVER_ORDERING_SHARE, 1)} of {money(purchases30)} purchases in 30 days.</span></span><span className="num shrink-0 font-medium text-ink">{money(value.ordering)}</span></Link></li>
            <li className="py-2.5"><span className="flex items-baseline justify-between gap-3"><span><span className="block font-medium text-ink">Hours saved</span><span className="text-xs text-graphite">{value.hoursWeek} hours a week across the team, at {money(HOURLY_RATE)} an hour.</span></span><span className="num shrink-0 font-medium text-ink">{money(value.hours)}</span></span></li>
          </ul>
          <section>
            <h3 className="font-medium text-ink">Hours saved a week, by role</h3>
            <table className="mt-2 w-full text-[13px]">
              <tbody>{ROLE_HOURS.map((r) => <tr key={r.role} className="border-t border-hair"><td className="py-2 pe-3"><span className="block text-ink">{r.role}</span><span className="text-xs text-steel">{r.what}</span></td><td className="num py-2 text-end font-medium text-ink">{r.hours} h</td></tr>)}</tbody>
            </table>
          </section>
          <Note>Hours are estimates from typical hotel routines, not measured in this demo. Over-ordering assumes {fmtPct(OVER_ORDERING_SHARE, 1)} of purchases. Losses stopped are the saved figures above.</Note>
        </div>
      </Drawer>

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
            <h3 className="font-medium text-ink">Last 30 days</h3>
            <p className="mt-2 text-graphite">{money(ledger.lost)} lost and {money(ledger.saved)} saved, {fmtPct(ledger.share)} of the loss.</p>
          </section>
          <Note>Sent by email at 7 AM to the managers who choose it in Settings. Figures are simulated in this demo.</Note>
        </div>
      </Drawer>

    </div>
  );
}
