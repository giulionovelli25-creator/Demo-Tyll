"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Search } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BarList, StripTrend } from "@/components/charts";
import { byDay, versus, weekSums } from "@/lib/domain/trends";
import { useDailyTotals } from "@/lib/strip-data";
import { Section, SectionLink } from "@/components/disclosure";
import { OutletFinance } from "@/components/finance/outlets";
import type { ChartPoint } from "@/components/home/chart";
import { useAlertFeed } from "@/lib/alert-feed";
import { useSection } from "@/components/module-hub";
import { CashUps } from "@/components/money/cash";
import { BookedCovers } from "@/components/money/covers";
import { HotelGuests } from "@/components/money/guests";
import { RoomChargeCheck } from "@/components/money/room-charges";
import { TillRuleCheck } from "@/components/money/till-rules";
import { DrinksByWaiter } from "@/components/money/waiters";
import { Badge, Button, EmptyState, linkButton, Field, Note, PageHeader, Panel, Segmented, Select, SummaryBar, TableWrap, Td, Th, cn, rowClass, textLink } from "@/components/ui";
import { STAFF, outletById, outletLabel, propertyById, staffById } from "@/lib/data/catalog";
import { HERO_EXCEPTION_ID } from "@/lib/data/constants";
import { can, canSeeOutlet } from "@/lib/domain/access";
import { BOUGHT_USED_RULES } from "@/lib/domain/bought-used";
import { POLICY, ROOM_TYPES, TYPE_LABEL, datedFlags, detectOrderException, isEstimateFlag } from "@/lib/domain/detect";
import { adjustmentRate, compare, computeTotals, exceptionInSel, totalsByOutlet } from "@/lib/domain/metrics";
import { orderTotals } from "@/lib/domain/orders";
import { useApi, useCtx, useInvestigations, usePatterns, useView } from "@/lib/hooks";
import { SOURCE_LABEL, STATUS_LABEL } from "@/lib/labels";
import { useDemo } from "@/lib/store";
import type { ExceptionType, Order } from "@/lib/types";
import { DATA_START, DEMO_TODAY, eachDay, fmtDate, fmtMoney, fmtNum, fmtPct, fmtRange, fmtShort, fmtTime, fxRate, presetRange, sum } from "@/lib/util";

type Tab = "flags" | "mistakes" | "pour" | "outlets" | "orders" | "rooms" | "tips" | "cash" | "waiters" | "till" | "covers" | "guests";

const SUB_PAGE: Partial<Record<Tab, string>> = { orders: "All transactions", rooms: "Room charge check", tips: "Tips (preview)", cash: "Cash on hand against cash sales", waiters: "Drinks per guest by waiter", till: "Till rule check", covers: "Booked against billed covers", guests: "Hotel guests against outlet charges" };
const SUB_QUESTION: Partial<Record<Tab, [question: string, lead: string]>> = {
  cash: ["Does the cash in the drawer match the cash the till took?", "Per outlet and shift. Simulated data."],
  waiters: ["Who needs coaching, and where are drinks going missing?", "Each waiter against colleagues at the same outlet on the same shift, so a busy night counts for no one. A low figure is a prompt to coach, not proof. Simulated data."],
  till: ["Did the till charge what was served?", "Bills reopened after payment, cheaper items rung up, open items and prices set by hand, and items rung twice. A flag is a prompt to check, not proof. Simulated data."],
  covers: ["Did every seated table get a bill?", "Each booking the host marked seated in the reservation book, matched with the bills at its table, per outlet and service. A table with no bill is a prompt to check, not proof. Simulated data."],
  guests: ["Are in-house guests' meals being charged?", "Each room the breakfast host ticked in against its rate in the PMS and the breakfast bills, and each outlet's sales against the guests in house. Guests whose rate includes breakfast are never flagged. A flag is a prompt to check, not proof. Simulated data."],
  rooms: ["Did every room charge reach the guest's bill?", "Each bill signed to a room, and each minibar, spa and laundry charge, matched with the guest folio in the PMS. A difference is a prompt to check, not proof. Simulated data."],
};
const RevenueProfitChart = dynamic(() => import("@/components/home/chart").then((m) => m.RevenueProfitChart), { ssr: false, loading: () => <div className="h-[264px] animate-pulse rounded-[var(--radius-control)] bg-mist" /> });

/** The period for the detail below it. The top of the page always shows today, 7 days and 30 days. */
function Period() {
  const preset = useDemo((s) => s.preset);
  const setPreset = useDemo((s) => s.setPreset);
  return <Segmented size="sm" label="Period" value={preset} onChange={setPreset} options={[{ value: "today", label: "Today" }, { value: "yesterday", label: "Yesterday" }, { value: "week", label: "7 days" }, { value: "month", label: "30 days" }]} />;
}

/** Revenue: today, this week and this month first. Flags, outlets and transactions are one click away. */
export default function MoneyPage() {
  const [tab] = useSection<Tab>("/money", ["flags", "mistakes", "pour", "outlets", "orders", "rooms", "tips", "cash", "waiters", "till", "covers", "guests"], null);
  const { sel, money, currency, propertyId, user } = useView();
  const ctx = useCtx();
  const router = useRouter();
  const investigations = useInvestigations();
  const { pour } = useAlertFeed();
  const t = useMemo(() => computeTotals(ctx, sel), [ctx, sel]);
  const weekC = useMemo(() => compare(ctx, { ...sel, range: presetRange("week") }), [ctx, sel]);
  const monthC = useMemo(() => compare(ctx, { ...sel, range: presetRange("month") }), [ctx, sel]);
  const days = useMemo(() => eachDay(presetRange("month")).slice(-14), []);
  const points = useMemo<ChartPoint[]>(() => days.map((date) => {
    const d = computeTotals(ctx, { ...sel, range: { from: date, to: date } });
    return { label: fmtDate(date), revenue: d.net, profit: d.operatingProfit ?? d.grossProfit, partial: date === DEMO_TODAY };
  }), [ctx, sel, days]);
  const outlets = useMemo(() => [...totalsByOutlet(ctx, sel)].sort((a, b) => b.now.net - a.now.net), [ctx, sel]);
  const flags = useMemo(() => investigations.filter((i) => i.status !== "closed" && exceptionInSel(i, sel)), [investigations, sel]);
  const flagValue = sum(flags, (i) => i.exposure * fxRate(propertyById[i.propertyId].currency, sel.currency));
  // The part of it that is an estimate (bought against used, cheaper item rung up, seated table with no bill), said beside the total.
  const flagEstimate = sum(flags.filter(isEstimateFlag), (i) => i.exposure * fxRate(propertyById[i.propertyId].currency, sel.currency));
  const rate = pour ? fxRate(propertyById[pour.propertyId].currency, sel.currency) : 1;
  const pourWeek = pour ? (pour.wine.totals.week.gapValue + pour.spirits.totals.week.gapValue) * rate : 0;
  const onFlags = tab === "flags" || tab === "mistakes" || tab === "pour";
  const profitName = monthC.now.operatingProfit !== null ? "Estimated operating contribution" : "Gross profit";
  const daily = useDailyTotals();
  const revenueDaily = daily.map(({ date, t: d }) => ({ date, value: Math.round(d.net) }));
  const revenueSeries = [
    { id: "guests", label: "Guests", axis: "guests", goodWhen: "up" as const, format: (n: number) => fmtNum(n), points: daily.map(({ date, t: d }) => ({ date, value: d.covers })), explain: "Covers served." },
    { id: "bill", label: "Average bill", axis: "bill", goodWhen: "up" as const, format: (n: number) => money(n), points: daily.map(({ date, t: d }) => ({ date, value: d.orders ? Math.round(d.net / d.orders) : null })), explain: "Net sales per bill." },
  ];
  const inSel = useMemo(() => investigations.filter((i) => exceptionInSel(i, sel)), [investigations, sel]);
  const valueOf = (i: (typeof inSel)[number]) => i.exposure * fxRate(propertyById[i.propertyId].currency, sel.currency);
  // Per day chart and New this week count only flags with a day of their own, as the Money Back List does.
  const dated = datedFlags(inSel);
  const flagDaily = byDay(dated, (i) => i.date, valueOf);
  const newFlags = weekSums(dated, (i) => i.date, () => 1);
  const pastDeadline = inSel.filter((i) => i.status !== "closed" && i.deadline && i.deadline < DEMO_TODAY).length;
  const weekOutlets = useMemo(() => totalsByOutlet(ctx, { ...sel, range: presetRange("week") }), [ctx, sel]);
  const best = [...weekOutlets].sort((x, y) => y.now.net - x.now.net)[0];
  const weakest = [...weekOutlets].filter((o) => o.before.net > 0).sort((x, y) => x.now.net / x.before.net - y.now.net / y.before.net)[0];
  const changeWords = (o: (typeof weekOutlets)[number]) => versus(o.now.net, o.before.net, "up", "the week before").text.toLowerCase();
  const openOutlets = () => document.getElementById("outlets")?.scrollIntoView({ block: "start", behavior: "smooth" });

  // Pour Control moved to Drinks control. Old links still land in the right place.
  useEffect(() => { if (tab === "pour") router.replace("/drinks"); }, [tab, router]);
  const sub = tab ? SUB_PAGE[tab] : undefined;
  if (sub) {
    return (
      <div className="space-y-6">
        <PageHeader title={sub} question={tab ? SUB_QUESTION[tab]?.[0] : undefined} lead={tab ? SUB_QUESTION[tab]?.[1] : undefined} />
        {tab === "cash" && <CashUps propertyId={propertyId ?? "lis"} />}
        {tab === "orders" && <><Period /><Orders /></>}
        {tab === "rooms" && <><Period /><RoomChargeCheck /></>}
        {tab === "till" && <><Period /><TillRuleCheck /></>}
        {tab === "tips" && <Tips />}
        {tab === "waiters" && <DrinksByWaiter />}
        {tab === "covers" && <BookedCovers />}
        {tab === "guests" && <HotelGuests />}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={tab === "outlets" ? "Outlet performance" : onFlags ? "Flagged transactions" : "Revenue"} question={onFlags ? "Where is money going missing?" : tab === "outlets" ? "Which outlets are doing better or worse?" : "How much did we make?"} lead={onFlags ? "Voids, refunds, discounts, items removed from bills, bills changed at the till and room charges that broke a rule. A flag is a prompt to check, not a finding. Simulated data." : "Last 7 days against the 7 before. Profit is an estimate. Simulated data."} />
      {onFlags ? (
        <SummaryBar
          items={[
            { label: "Open flags", value: flags.length, tone: flags.length ? "warn" : "pos", compare: { text: `${pastDeadline} past their deadline`, good: pastDeadline ? false : true }, href: "/investigations?status=open" },
            { label: "Value at risk", value: money(flagValue, { compact: true }), tone: "money", compare: { text: flagEstimate > 0 ? `Open flags, until checked. ${money(flagEstimate, { compact: true })} of it estimates` : "Open flags, until checked", good: null }, href: "/investigations?status=open" },
            { label: "New this week", value: newFlags.now, compare: versus(newFlags.now, newFlags.before, "down"), href: "/investigations?status=all" },
            { label: "Recovered", value: money(sum(inSel.filter((i) => i.status === "closed"), (i) => i.recovered * fxRate(propertyById[i.propertyId].currency, sel.currency)), { compact: true }), tone: "pos", compare: { text: "All time, as on the Money Back List", good: null }, href: "/investigations?status=closed" },
          ]}
          trend={<StripTrend goodWhen="down" title="Flagged value per day, last 30 days" points={flagDaily} format={(n) => money(n)} explain="The value of transactions that broke a rule, by the day they happened." series={[{ id: "count", label: "Flags raised", axis: "count", goodWhen: "down", format: (n) => `${Math.round(n)}`, points: byDay(dated, (i) => i.date, () => 1), explain: "How many transactions were flagged each day." }]} summary={`Value of flagged transactions by the day they happened. Open now ${money(flagValue)}.`} note="by the day it happened" />}
          action={<Link href="/investigations" className={linkButton("primary")}>Review {flags.length} flags</Link>}
        />
      ) : tab === "outlets" ? (
        <SummaryBar
          items={[
            { label: "Best outlet", value: best ? outletLabel(best.outletId) : "None", compare: best ? { text: `${money(best.now.net, { compact: true })}, ${changeWords(best)}`, good: best.now.net >= best.before.net } : undefined, onClick: openOutlets },
            { label: "Weakest change", value: weakest ? outletLabel(weakest.outletId) : "None", compare: weakest ? { text: changeWords(weakest), good: weakest.now.net >= weakest.before.net } : undefined, onClick: openOutlets },
            { label: "Average bill", value: money(weekC.now.orders ? weekC.now.net / weekC.now.orders : 0), compare: versus(weekC.now.orders ? weekC.now.net / weekC.now.orders : 0, weekC.before.orders ? weekC.before.net / weekC.before.orders : 0, "up", "the week before"), href: "/money?tab=orders" },
            { label: "Outlets up", value: `${weekOutlets.filter((o) => o.now.net >= o.before.net).length} of ${weekOutlets.length}`, compare: { text: "Revenue against the week before", good: null }, onClick: openOutlets },
          ]}
          trend={<StripTrend goodWhen="up" title="Revenue per day, last 30 days" points={revenueDaily} format={(n) => money(n)} summary={`Net revenue per day for the selected outlets.`} note={currency} explain="Net sales each day for the outlets in view." series={revenueSeries} />}
        />
      ) : (
        <SummaryBar
          items={[
            { label: "Revenue, 7 days", value: money(weekC.now.net, { compact: true }), compare: versus(weekC.now.net, weekC.before.net, "up", "the week before"), href: "/money?tab=orders" },
            { label: "Operating contribution, 7 days", value: money(weekC.now.operatingProfit ?? weekC.now.grossProfit, { compact: true }), compare: versus(weekC.now.operatingProfit ?? weekC.now.grossProfit, weekC.before.operatingProfit ?? weekC.before.grossProfit, "up", "the week before"), href: "/reports" },
            { label: "Guests, 7 days", value: fmtNum(weekC.now.covers), compare: versus(weekC.now.covers, weekC.before.covers, "up", "the week before"), href: "/money?tab=orders" },
            { label: "At risk, flags and drinks", value: money(flagValue + pourWeek, { compact: true }), tone: "money", compare: { text: "Flags and drinks this week, includes estimates", good: null }, href: "/money?tab=flags" },
          ]}
          trend={<StripTrend goodWhen="up" title="Revenue per day, last 30 days" points={revenueDaily} format={(n) => money(n)} summary={`Net revenue per day. Last 7 days ${money(weekC.now.net)}.`} note={currency} explain="Net sales each day. Switch on guests and the average bill to see whether a change came from more people or bigger bills." series={revenueSeries} />}
          action={<Link href="/money?tab=orders" className={linkButton("primary")}>See transactions</Link>}
        />
      )}
      {onFlags ? (
        <>
          <Section id="revenue.flagged" forceOpen={tab === "mistakes"} title="Voids, refunds, removed items, till rules and room charges" summary={`${flags.length} ${flags.length === 1 ? "flag" : "flags"}, ${money(flagValue)} at risk`}>
            <Mistakes />
          </Section>
          {can(user, "till.view") && <SectionLink href="/money?tab=till" title="Till rule check" summary="Bills reopened after payment, cheaper items rung up, open items and prices set by hand, and items rung twice." />}
          <SectionLink href="/money?tab=cash" title="Cash on hand against cash sales" summary="Each outlet's drawer at the end of the shift against the bills paid in cash. Card payments are reconciled by the payment provider." />
          <SectionLink href="/money?tab=rooms" title="Room charge check" summary="Each bill signed to a room against the guest folio: missing, a different amount, the wrong room or after check-out." />
          {can(user, "guests.view") && <SectionLink href="/money?tab=guests" title="Hotel guests against outlet charges" summary="Each room ticked in at breakfast against its rate and the breakfast bills, and each outlet's sales against the guests in house." />}
        </>
      ) : (
        <>
          <Section id="revenue.chart" title={`Revenue and ${monthC.now.operatingProfit !== null ? "estimated operating contribution" : "gross profit"}, last ${days.length} days`} summary={`${money(weekC.now.net, { compact: true })} revenue in the last 7 days, ${money(weekC.now.operatingProfit ?? weekC.now.grossProfit, { compact: true })} ${profitName.toLowerCase()}. ${fmtDate(DEMO_TODAY)} is today so far.`}>
            <RevenueProfitChart points={points} format={(n) => money(n)} axisFormat={fmtShort} profitName={profitName} summary={`Revenue and ${profitName} per day for the last ${days.length} days, in euros.`} />
          </Section>
          <div id="outlets" className="scroll-mt-24"><Section id="revenue.outlets" forceOpen={tab === "outlets"} title="Outlet performance" summary={outlets[0] ? `${outlets.length} ${outlets.length === 1 ? "outlet" : "outlets"}, ${fmtRange(sel.range)}. ${outletLabel(outlets[0].outletId)} leads with ${money(outlets[0].now.net, { compact: true })}.` : "No outlets in your selection"}>
            <Period />
            <OutletFinance />
          </Section></div>
          {can(user, "covers.view") && <SectionLink href="/money?tab=covers" title="Booked against billed covers" summary="Each table seated from the reservation book against the bills at that table, per outlet and service." />}
          {can(user, "waiters.view") && <SectionLink href="/money?tab=waiters" title="Drinks per guest by waiter" summary="Each waiter against colleagues on the same outlet and shift, with the tables that had food and no drink." />}
          <SectionLink href="/money?tab=orders" title="All transactions" summary={`${fmtNum(t.orders)} transactions, ${fmtRange(sel.range)}. Filter by day and search.`} />
        </>
      )}
    </div>
  );
}

function Mistakes() {
  const router = useRouter();
  const { sel, money, currency, user } = useView();
  const ctx = useCtx();
  const all = useInvestigations();
  const patterns = usePatterns().filter((p) => sel.outletIds.includes(p.outletId));
  const inPeriod = useMemo(() => all.filter((i) => i.date >= sel.range.from && i.date <= sel.range.to && exceptionInSel(i, sel)), [all, sel]);
  const rows = useMemo(() => totalsByOutlet(ctx, sel), [ctx, sel]);
  const toDisplay = (pid: string, n: number) => n * fxRate(propertyById[pid].currency, currency);
  const byType = useMemo(() => {
    const m = new Map<ExceptionType, { n: number; value: number }>();
    for (const i of inPeriod) {
      const cur = m.get(i.type) ?? { n: 0, value: 0 };
      m.set(i.type, { n: cur.n + 1, value: cur.value + toDisplay(i.propertyId, i.exposure) });
    }
    return [...m].map(([type, v]) => ({ type, ...v })).sort((a, b) => b.value - a.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inPeriod, currency]);
  // Room charge types joined the list, so it shows the five largest first, like every other list.
  const [allTypes, setAllTypes] = useState(false);
  const [allRules, setAllRules] = useState(false);
  // Each rule with the flag types it raises. The rules that flagged the most in the period come first; five show, the rest behind "Show all".
  const rules: { id: string; types: ExceptionType[]; text: ReactNode }[] = [
    { id: "removed", types: ["removed_after_dispatch"], text: <>Items removed after their ticket went to the kitchen or bar, without an approval.</> },
    { id: "prepared", types: ["prepared_not_charged", "bill_mismatch"], text: <>Items the kitchen marked ready that are not on the final bill.</> },
    { id: "discount", types: ["unusual_discount"], text: <>Discounts above {POLICY.discountMaxPct}%, or with no reason or approval.</> },
    { id: "comp", types: ["excessive_comp"], text: <>Complimentary items above {POLICY.compMaxValue} per order, or with no reason.</> },
    { id: "refund", types: ["unusual_refund"], text: <>Refunds above {Math.round(POLICY.refundMaxShare * 100)}% of a bill, late, or unexplained.</> },
    { id: "void", types: ["unexplained_void"], text: <>Whole orders cancelled after they were sent to the kitchen or bar.</> },
    { id: "room", types: ROOM_TYPES, text: <>Room charges missing from the guest bill, posted more than once, for a different amount, to the wrong room or after check-out.</> },
    { id: "reopened", types: ["bill_reopened"], text: <>Bills reopened after payment and closed lower, with no manager&rsquo;s approval.</> },
    { id: "cheaper", types: ["cheaper_item_rung"], text: <>Premium bottles going out faster than they are billed while the cheaper serve is billed, such as house wine for the reserve red or singles for doubles. An estimate.</> },
    { id: "price", types: ["price_override"], text: <>Open items, the misc button and prices changed by hand, more than {Math.round(POLICY.priceBelowShare * 100)}% below the menu price, with no approval.</> },
    { id: "duplicate", types: ["duplicate_ring"], text: <>The same item rung twice within {POLICY.duplicateSeconds} seconds, or {POLICY.quantityMin} or more of one item at more than {POLICY.quantityPerGuest} a guest.</> },
    { id: "seated", types: ["seated_no_bill"], text: <>Tables the host marked seated from a booking with no bill at that table, nor for the same party nearby. Valued at the outlet&rsquo;s spend per guest, an estimate.</> },
    { id: "breakfast", types: ["breakfast_not_charged"], text: <>Rooms ticked in at breakfast whose guests the room rate does not cover, with no breakfast charged to the room or paid at the table. Guests whose rate includes breakfast are never flagged.</> },
    { id: "bought", types: ["bought_not_used"], text: <>Items bought over 30 days beyond what sales, recipes and logged waste account for: more than the last delivery, at least {Math.round(BOUGHT_USED_RULES.minShare * 100)}% of use, and {money(BOUGHT_USED_RULES.minValue)} beyond the last delivery, which is the amount at risk. An estimate until a count.</> },
  ];
  const ruleValue = (r: (typeof rules)[number]) => sum(byType.filter((t) => r.types.includes(t.type)), (t) => t.value);
  const rulesShown = [...rules].sort((a, b) => ruleValue(b) - ruleValue(a));
  const hero = all.find((i) => i.id === HERO_EXCEPTION_ID);
  const flagged = [...inPeriod].sort((a, b) => Number(a.status === "closed") - Number(b.status === "closed") || toDisplay(b.propertyId, b.exposure) - toDisplay(a.propertyId, a.exposure)).slice(0, 8);
  // Two text nodes, as before, so each half keeps its translation.
  const typeLine = (i: (typeof inPeriod)[number]) => <>{TYPE_LABEL[i.type]}{i.type === "cheaper_item_rung" ? ", an estimate from bottles issued" : i.type === "seated_no_bill" ? ", an estimate at the spend per guest" : i.basis === "estimate" ? ", estimate until a stock take confirms it" : i.basis === "confirmed" ? ", confirmed by a stock take" : ""}</>;
  // Minibar, spa and laundry belong to the hotel, not an outlet: name the source, as the room charge check does.
  const whereOf = (i: (typeof inPeriod)[number]) => {
    if (i.outletId) return outletLabel(i.outletId);
    const charge = i.chargeId ? ctx.data.chargesById.get(i.chargeId) : undefined;
    return charge ? SOURCE_LABEL[charge.source] : propertyById[i.propertyId].name;
  };
  const steps = [
    ["8:42 PM", "Guest orders a burger and a Coke", ""],
    ["8:43 PM", "Both items are sent for preparation", "Kitchen and bar tickets print"],
    ["8:49 PM", "The Coke is removed from the order", "No reason, no approval"],
    ["8:51 PM", "The guest pays for the burger only", "Card, €22"],
  ];

  return (
    <div className="space-y-6">
      {hero && canSeeOutlet(user, "lis-terrace") && (
        <Section id="flags.example" title="Worked example: a Coke removed after it was sent to the bar" summary="Tonight at Mercado. How one flag is found, step by step.">
        <Panel title="Tonight at Mercado: an item removed after it was sent to the bar" description="A worked example of what Tyll looks for. The order below is in tonight's records." action={<Badge tone={hero.status === "closed" ? "neutral" : "warn"}>{STATUS_LABEL[hero.status]}</Badge>}>
          <ol className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {steps.map(([time, title, detail], i) => (
              <li key={time} className={cn("relative rounded-2xl border p-4", i === 2 ? "border-warn/40 bg-warn-soft" : "border-line")}>
                <p className="num text-[13px] text-steel">{time}</p>
                <p className="mt-1 text-[15px] leading-snug text-ink">{title}</p>
                {detail && <p className="mt-1 text-xs text-steel">{detail}</p>}
              </li>
            ))}
          </ol>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-[70ch] text-sm text-graphite">Tyll flags that the Coke was removed after its ticket went to the bar. It does not conclude why. The investigation shows the evidence and what to check.</p>
            <Button onClick={() => router.push(`/investigations/${HERO_EXCEPTION_ID}`)}>Open the investigation <ArrowRight size={15} /></Button>
          </div>
        </Panel>
        </Section>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Panel title="Flagged by type" description="Value involved in the period. Choose a type to see its cases.">
          {byType.length === 0 ? <EmptyState title="Nothing flagged in this period" /> : (
            <>
              <BarList format={(n) => money(n)} rows={(allTypes ? byType : byType.slice(0, 5)).map((t) => ({ key: t.type, label: TYPE_LABEL[t.type], sub: `${t.n} case${t.n === 1 ? "" : "s"}`, value: t.value, onClick: () => router.push(`/investigations?type=${t.type}&status=all`) }))} />
              {byType.length > 5 && <button type="button" onClick={() => setAllTypes((v) => !v)} className={cn(textLink, "mt-3")}>{allTypes ? "Show the five largest" : `Show all ${byType.length} types`}</button>}
            </>
          )}
        </Panel>
        <Panel title="Flags per 1,000 orders, by outlet" description="So busy and quiet outlets compare fairly.">
          <BarList format={(n) => n.toFixed(1)} rows={[...rows].sort((a, b) => adjustmentRate(b.now) - adjustmentRate(a.now)).map((r) => ({ key: r.outletId, outletId: r.outletId, label: outletLabel(r.outletId), sub: `${r.now.adjustments} of ${fmtNum(r.now.orders)} orders`, value: adjustmentRate(r.now) }))} />
        </Panel>
        <Panel title="What Tyll checks" description="Rules agreed with the hotel, those with the most flagged in this period first. A flag means a rule was met, nothing more.">
          <ul className="space-y-3 text-sm text-graphite">
            {(allRules ? rulesShown : rulesShown.slice(0, 5)).map((r) => <li key={r.id}>{r.text}</li>)}
          </ul>
          <button type="button" onClick={() => setAllRules((v) => !v)} className={cn(textLink, "mt-3")}>{allRules ? "Show the first five rules" : `Show all ${rules.length} rules`}</button>
        </Panel>
      </div>

      {patterns.length === 0 ? <p className="px-1 text-[13px] text-steel">No repeated pattern under one till login in the last {POLICY.patternWindowDays} days.</p> : (
      <Panel title="Repeated patterns" description={`Removals without approval in the last ${POLICY.patternWindowDays} days that cluster under one till login.`}>
        {patterns.length === 0 ? (
          <EmptyState title="No repeated pattern in this selection">Tyll looks for {POLICY.patternMinCases} or more cases under one login making up at least {Math.round(POLICY.patternMinShare * 100)}% of an outlet&rsquo;s removals.</EmptyState>
        ) : (
          <>
            <ul className="divide-y divide-hair">
              {patterns.map((p) => (
                <li key={`${p.outletId}-${p.staffId}`} className="flex flex-wrap items-center justify-between gap-4 py-3.5">
                  <div className="min-w-0">
                    <p className="text-sm text-ink">{p.cases} of {p.outletCases} removals at {outletById[p.outletId].name} under the login of {staffById[p.staffId]?.name ?? p.staffId}</p>
                    <p className="text-xs text-steel">{fmtPct(p.share, 0)} of the outlet&rsquo;s cases · {fmtPct(p.eveningShare, 0)} after 6 PM · {fmtMoney(p.value, propertyById[outletById[p.outletId].propertyId].currency)} involved</p>
                  </div>
                  <Link href={`/investigations/${p.exceptionIds[0]}`} className="flex items-center gap-1 text-[13px] text-steel hover:text-ink">Open the latest case <ArrowRight size={14} /></Link>
                  <div className="grid w-full gap-3 rounded-[var(--radius-control)] bg-cloud p-3 text-[13px] md:grid-cols-2">
                    <div><p className="font-medium text-ink">Possible reasons</p><ul className="mt-1 list-disc space-y-0.5 ps-4 text-graphite">{p.eveningShare >= 0.6 && <li>Mostly after 6 PM, when the section is busiest.</li>}<li>The login may be shared at the terminal.</li><li>The removal approval step may not be known by everyone on this section.</li></ul></div>
                    <div><p className="font-medium text-ink">How to help</p><ol className="mt-1 list-decimal space-y-0.5 ps-4 text-graphite"><li>Give each person their own till login.</li><li>Remind the section that removing an item after it is sent needs a manager&rsquo;s approval.</li></ol></div>
                  </div>
                </li>
              ))}
            </ul>
            <Note className="mt-3 max-w-[90ch]">A login shows which account was signed in at the terminal. Shared logins, busy sections and training gaps all produce the same pattern, so this is a prompt to look, not a finding about a person.</Note>
          </>
        )}
      </Panel>
      )}

      <Panel title="Flagged orders" description="Open flags first, largest amount first. Closed ones follow." action={<Link href="/investigations" className="flex items-center gap-1 text-[13px] text-steel hover:text-ink">Money Back List <ArrowRight size={14} /></Link>} flush>
        {inPeriod.length === 0 ? <div className="px-5 pb-6 sm:px-6"><EmptyState title="No flagged orders in this period" /></div> : (
          <>
          {/* Phones get one card per flag: the headline, type and amount, with the comparison held to two lines, so nothing is cut off at the edge. */}
          <ul className="divide-y divide-hair border-t border-hair sm:hidden">
            {flagged.map((i) => (
              <li key={i.id}>
                <Link prefetch={false} href={`/investigations/${i.id}`} className="block px-5 py-4 transition-colors duration-150 hover:bg-cloud">
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0 text-sm text-ink">{i.headline}</span>
                    <span className="num shrink-0 text-sm font-medium text-ink">{money(toDisplay(i.propertyId, i.exposure))}</span>
                  </span>
                  <span className="mt-0.5 block text-xs text-steel">{typeLine(i)}</span>
                  {i.comparedWith && <span className="mt-0.5 line-clamp-2 text-xs text-graphite">{i.comparedWith}</span>}
                  <span className="mt-2 flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-xs text-graphite">{whereOf(i)}, {fmtDate(i.date)}</span>
                    <Badge tone={i.status === "closed" ? "neutral" : i.status === "new" ? "warn" : "ink"}>{STATUS_LABEL[i.status]}</Badge>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <TableWrap className="hidden sm:block">
            <table className="w-full min-w-[820px] text-sm">
              <thead><tr><Th>What Tyll found</Th><Th>Outlet</Th><Th>When</Th><Th align="right">Value involved</Th><Th>Status</Th></tr></thead>
              <tbody>
                {flagged.map((i) => (
                  <tr key={i.id} className={cn(rowClass, "cursor-pointer")} onClick={() => router.push(`/investigations/${i.id}`)}>
                    <Td><Link href={`/investigations/${i.id}`} className="text-ink underline-offset-4 hover:underline" onClick={(e) => e.stopPropagation()}>{i.headline}</Link><span className="mt-0.5 block text-xs text-steel">{typeLine(i)}</span>{i.comparedWith && <span className="mt-0.5 line-clamp-2 max-w-[460px] text-xs text-graphite">{i.comparedWith}</span>}</Td>
                    <Td>{i.outletId ? whereOf(i) : <span className="text-steel">{whereOf(i)}</span>}</Td>
                    <Td className="num whitespace-nowrap text-graphite">{fmtDate(i.date)}, {fmtTime(i.min)}</Td>
                    <Td align="right">{money(toDisplay(i.propertyId, i.exposure))}</Td>
                    <Td><Badge tone={i.status === "closed" ? "neutral" : i.status === "new" ? "warn" : "ink"}>{STATUS_LABEL[i.status]}</Badge></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          </>
        )}
      </Panel>
    </div>
  );
}

function Orders() {
  const router = useRouter();
  // A tag only where there is a case to open.
  const investigations = useInvestigations();
  const cases = useMemo(() => new Set(investigations.map((i) => i.id)), [investigations]);
  const { sel, user } = useView();
  const params = useSearchParams();
  // A link can name a day (`&date=`, from hotel guests against outlet charges): it opens on that day, even outside the period.
  const asked = params.get("date");
  // ...and an outlet (`&outlet=`): the list opens on that outlet's bills only, when this role may see it.
  const askedOutlet = params.get("outlet");
  const [only, setOnly] = useState<string | null>(askedOutlet && canSeeOutlet(user, askedOutlet) ? askedOutlet : null);
  const fromGuests = params.get("from") === "guests";
  const wanted = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked >= DATA_START && asked <= DEMO_TODAY ? asked : null;
  const days = useMemo(() => {
    const list = eachDay(sel.range).reverse();
    return wanted && !list.includes(wanted) ? [...list, wanted].sort().reverse() : list;
  }, [sel.range, wanted]);
  const [date, setDate] = useState(wanted ?? days[0]);
  // A named day opens with every bill of that day, not only the changed ones.
  const [onlyChanged, setOnlyChanged] = useState(!wanted);
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(40);
  const day = days.includes(date) ? date : days[0];
  const { data: fetched } = useApi<{ orders: Order[] }>(`/api/orders?date=${day}`);
  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (fetched?.orders ?? [])
      .filter((o) => (only ? o.outletId === only : sel.outletIds.includes(o.outletId)))
      .map((o) => ({ o, t: orderTotals(o), flag: detectOrderException(o) }))
      .filter(({ o, t }) => (!onlyChanged || o.voided || t.original - t.net > 0.005) && (!term || `${o.id} ${o.table} ${staffById[o.staffId]?.name ?? ""}`.toLowerCase().includes(term)))
      .sort((a, b) => b.o.openMin - a.o.openMin);
  }, [fetched, sel.outletIds, only, onlyChanged, q]);
  return (
    <Panel title="Order history" description="The complete record of each order: created, items entered, tickets sent, changes, final bill and payment." flush>
      <div className="flex flex-wrap items-end gap-2 px-5 pb-4 sm:px-6">
        <Select label="Business date" hideLabel className="w-[170px]" value={day} onChange={(e) => { setDate(e.target.value); setShown(40); }}>
          {days.map((d) => <option key={d} value={d}>{fmtDate(d, true)}{d === DEMO_TODAY ? " (today)" : ""}</option>)}
        </Select>
        <label className="flex h-10 cursor-pointer items-center gap-2 rounded-full border border-line px-4 text-sm">
          <input type="checkbox" className="accent-[var(--color-accent)]" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} /> Only orders whose bill differs from the order
        </label>
        <div className="relative ms-auto w-full sm:w-[260px]">
          <Search size={15} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-steel" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Order number, table or login" aria-label="Search orders" className="h-10 w-full rounded-full border border-line bg-paper ps-9 pe-3 text-sm placeholder:text-fog hover:border-fog" />
        </div>
        {(only || fromGuests) && (
          <p className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-steel">
            {only && <span>{`${outletLabel(only)} only.`}</span>}
            {only && <button type="button" className={textLink} onClick={() => { setOnly(null); setShown(40); }}>Show every outlet</button>}
            {fromGuests && <Link prefetch={false} href="/money?tab=guests" className={textLink}>Back to hotel guests against outlet charges</Link>}
          </p>
        )}
      </div>
      {fetched === undefined ? <div className="px-5 pb-6 sm:px-6"><EmptyState title="Loading orders" /></div> : list.length === 0 ? <div className="px-5 pb-6 sm:px-6"><EmptyState title="No orders match">Clear the search, or untick the filter to see every order of the day.</EmptyState></div> : (
        <>
          <TableWrap>
            <table className="w-full min-w-[980px] text-sm">
              <thead><tr><Th>Order</Th><Th>Outlet</Th><Th>Opened</Th><Th>POS login</Th><Th align="right">As ordered</Th><Th align="right">Final bill</Th><Th align="right">Difference</Th><Th>What changed</Th></tr></thead>
              <tbody>
                {list.slice(0, shown).map(({ o, t, flag }) => (
                  <tr key={o.id} className={cn(rowClass, "cursor-pointer")} onClick={() => router.push(`/money/orders/${o.id}`)}>
                    <Td><Link href={`/money/orders/${o.id}`} className="num text-ink underline-offset-4 hover:underline" onClick={(e) => e.stopPropagation()}>{o.id}</Link><span className="block text-xs text-steel">{o.table}</span></Td>
                    <Td>{outletLabel(o.outletId)}</Td>
                    <Td className="num text-graphite">{fmtTime(o.openMin)}</Td>
                    <Td className="text-graphite">{staffById[o.staffId]?.name ?? o.staffId}</Td>
                    <Td align="right">{fmtNum(t.original)}</Td>
                    <Td align="right">{fmtNum(t.net, t.net % 1 ? 2 : 0)}</Td>
                    <Td align="right" className={cn(t.original - t.net > 0.005 && "text-warn")}>{t.original - t.net > 0.005 ? fmtNum(t.original - t.net, (t.original - t.net) % 1 ? 2 : 0) : "None"}</Td>
                    <Td>
                      <span className="flex flex-wrap gap-1">
                        {o.voided && <Badge>voided</Badge>}
                        {!o.voided && t.removedPost > 0 && <Badge>removed after dispatch</Badge>}
                        {!o.voided && t.removedPre > 0 && <Badge>removed before dispatch</Badge>}
                        {t.comps > 0 && <Badge>complimentary</Badge>}
                        {t.discounts > 0 && <Badge>{o.discountPct}% discount</Badge>}
                        {t.refunds > 0 && <Badge>refund</Badge>}
                        {flag && cases.has(`EX-${o.id}`) && <Badge tone="warn">flagged</Badge>}
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <p className="num border-t border-hair px-6 py-3 text-xs text-steel">
            Showing {Math.min(shown, list.length)} of {list.length} orders. Amounts in euros.
            {list.length > shown && <button type="button" className="ms-3 underline underline-offset-4 hover:text-ink" onClick={() => setShown((n) => n + 40)}>Show 40 more</button>}
          </p>
        </>
      )}
    </Panel>
  );
}

function Tips() {
  const { sel } = useView();
  const outletId = sel.outletIds[0];
  const currency = propertyById[outletById[outletId].propertyId].currency;
  const team = STAFF.filter((s) => s.outletId === outletId && s.role !== "manager").slice(0, 6);
  const [pool, setPool] = useState("4200");
  const [service, setService] = useState("18600");
  const [hours, setHours] = useState<Record<string, string>>(() => Object.fromEntries(team.map((s, i) => [s.id, String([42, 38, 40, 24, 36, 30][i] ?? 32)])));
  const [approved, setApproved] = useState(false);
  const total = sum(team, (s) => Number(hours[s.id]) || 0);
  const poolN = Math.max(0, Number(pool) || 0);
  return (
    <div className="space-y-6">
      <Panel title="Tip distribution" description="A preview of a planned feature. You can try the calculation here, but nothing on this tab is saved or sent to payroll." action={<Badge>Planned</Badge>}>
        <div className="grid gap-6 lg:grid-cols-[1fr_1.6fr] [&>*]:min-w-0">
          <div className="space-y-4">
            <p className="text-sm text-graphite">Example for {outletLabel(outletId)}, week to {fmtDate(DEMO_TODAY)}.</p>
            <Field label="Tips collected" suffix={currency} type="number" min="0" value={pool} onChange={(e) => { setPool(e.target.value); setApproved(false); }} hint="Shared by hours worked under the agreed rule." />
            <Field label="Service charge collected" suffix={currency} type="number" min="0" value={service} onChange={(e) => setService(e.target.value)} hint="Kept separate from tips and not distributed here." />
            <dl className="space-y-2 rounded-2xl bg-mist p-4 text-sm">
              <div className="flex justify-between"><dt className="text-steel">Rule</dt><dd>Equal rate per hour worked</dd></div>
              <div className="flex justify-between"><dt className="text-steel">Rate</dt><dd className="num">{fmtMoney(total ? poolN / total : 0, currency, { decimals: true })} per hour</dd></div>
              <div className="flex justify-between"><dt className="text-steel">Service charge</dt><dd className="num">{fmtMoney(Number(service) || 0, currency)} held separately</dd></div>
            </dl>
          </div>
          <div>
            <TableWrap className="rounded-2xl border border-line">
              <table className="w-full min-w-[420px] text-sm">
                <thead><tr><Th>Team member</Th><Th align="right">Hours worked</Th><Th align="right">Share</Th><Th align="right">Tips</Th></tr></thead>
                <tbody>
                  {team.map((s) => {
                    const h = Number(hours[s.id]) || 0;
                    return (
                      <tr key={s.id} className={rowClass}>
                        <Td>{s.name}<span className="block text-xs capitalize text-steel">{s.role}</span></Td>
                        <Td align="right"><input aria-label={`Hours for ${s.name}`} type="number" min="0" max="80" value={hours[s.id]} onChange={(e) => { setHours((x) => ({ ...x, [s.id]: e.target.value })); setApproved(false); }} className="num h-9 w-20 rounded-lg border border-line px-2 text-end" /></Td>
                        <Td align="right">{fmtPct(total ? h / total : 0)}</Td>
                        <Td align="right" className="text-ink">{fmtMoney(total ? (poolN * h) / total : 0, currency, { decimals: true })}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-graphite">{approved ? "Approved in this preview. A live version would record who approved and when." : "A manager approves the summary before anything is paid."}</p>
              <Button variant={approved ? "secondary" : "primary"} disabled={total === 0} onClick={() => setApproved((a) => !a)}>{approved ? "Withdraw approval" : "Approve distribution"}</Button>
            </div>
          </div>
        </div>
        <Note className="mt-5 max-w-[95ch]">Rules on tips and service charges differ between countries and between hotel policies. A live version would hold the rule agreed for each property and would need local legal review before use.</Note>
      </Panel>
    </div>
  );
}
