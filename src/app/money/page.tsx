"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { BarList, StripTrend } from "@/components/charts";
import { byDay, versus, weekSums } from "@/lib/domain/trends";
import { useDailyTotals } from "@/lib/strip-data";
import { Section, SectionLink } from "@/components/disclosure";
import { OutletFinance } from "@/components/finance/outlets";
import type { ChartPoint } from "@/components/home/chart";
import { useAlertFeed } from "@/lib/alert-feed";
import { useSection } from "@/components/module-hub";
import { CashUps } from "@/components/money/cash";
import { RoomChargeCheck } from "@/components/money/room-charges";
import { Badge, Button, EmptyState, linkButton, Field, Note, PageHeader, Panel, Segmented, Select, SummaryBar, TableWrap, Td, Th, cn, rowClass, textLink } from "@/components/ui";
import { STAFF, outletById, outletLabel, propertyById, staffById } from "@/lib/data/catalog";
import { HERO_EXCEPTION_ID } from "@/lib/data/constants";
import { canSeeOutlet } from "@/lib/domain/access";
import { BOUGHT_USED_RULES } from "@/lib/domain/bought-used";
import { POLICY, TYPE_LABEL, detectOrderException } from "@/lib/domain/detect";
import { adjustmentRate, compare, computeTotals, exceptionInSel, totalsByOutlet } from "@/lib/domain/metrics";
import { orderTotals } from "@/lib/domain/orders";
import { useApi, useCtx, useInvestigations, usePatterns, useView } from "@/lib/hooks";
import { SOURCE_LABEL, STATUS_LABEL } from "@/lib/labels";
import { useDemo } from "@/lib/store";
import type { ExceptionType, Order } from "@/lib/types";
import { DEMO_TODAY, eachDay, fmtDate, fmtMoney, fmtNum, fmtPct, fmtRange, fmtShort, fmtTime, fxRate, presetRange, sum } from "@/lib/util";

type Tab = "flags" | "mistakes" | "pour" | "outlets" | "orders" | "rooms" | "tips" | "cash";

const SUB_PAGE: Partial<Record<Tab, string>> = { orders: "All transactions", rooms: "Room charge check", tips: "Tips (preview)", cash: "Cash on hand against cash sales" };
const SUB_QUESTION: Partial<Record<Tab, [question: string, lead: string]>> = {
  cash: ["Does the cash in the drawer match the cash the till took?", "Per outlet and shift. Simulated data."],
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
  const [tab] = useSection<Tab>("/money", ["flags", "mistakes", "pour", "outlets", "orders", "rooms", "tips", "cash"], null);
  const { sel, money, currency, propertyId } = useView();
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
  const flagDaily = byDay(inSel, (i) => i.date, valueOf);
  const newFlags = weekSums(inSel, (i) => i.date, () => 1);
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
        {tab === "tips" && <Tips />}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={tab === "outlets" ? "Outlet performance" : onFlags ? "Flagged transactions" : "Revenue"} question={onFlags ? "Where is money going missing?" : tab === "outlets" ? "Which outlets are doing better or worse?" : "How much did we make?"} lead={onFlags ? "Voids, refunds, discounts, items removed from bills and room charges that broke a rule. A flag is a prompt to check, not a finding. Simulated data." : "Last 7 days against the 7 before. Profit is an estimate. Simulated data."} />
      {onFlags ? (
        <SummaryBar
          items={[
            { label: "Open flags", value: flags.length, tone: flags.length ? "warn" : "pos", compare: { text: `${pastDeadline} past their deadline`, good: pastDeadline ? false : true }, href: "/investigations?status=open" },
            { label: "Value at risk", value: money(flagValue, { compact: true }), tone: "money", compare: { text: "Open flags, until checked", good: null }, href: "/investigations?status=open" },
            { label: "New this week", value: newFlags.now, compare: versus(newFlags.now, newFlags.before, "down"), href: "/investigations?status=all" },
            { label: "Recovered", value: money(sum(inSel.filter((i) => i.status === "closed"), (i) => i.recovered * fxRate(propertyById[i.propertyId].currency, sel.currency)), { compact: true }), tone: "pos", compare: { text: "All time, as on the Money Back List", good: null }, href: "/investigations?status=closed" },
          ]}
          trend={<StripTrend goodWhen="down" title="Flagged value per day, last 30 days" points={flagDaily} format={(n) => money(n)} explain="The value of transactions that broke a rule, by the day they happened." series={[{ id: "count", label: "Flags raised", axis: "count", goodWhen: "down", format: (n) => `${Math.round(n)}`, points: byDay(inSel, (i) => i.date, () => 1), explain: "How many transactions were flagged each day." }]} summary={`Value of flagged transactions by the day they happened. Open now ${money(flagValue)}.`} note="by the day it happened" />}
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
            { label: "At risk, flags and drinks", value: money(flagValue + pourWeek, { compact: true }), tone: "money", compare: { text: "Flags and drinks, this week", good: null }, href: "/money?tab=flags" },
          ]}
          trend={<StripTrend goodWhen="up" title="Revenue per day, last 30 days" points={revenueDaily} format={(n) => money(n)} summary={`Net revenue per day. Last 7 days ${money(weekC.now.net)}.`} note={currency} explain="Net sales each day. Switch on guests and the average bill to see whether a change came from more people or bigger bills." series={revenueSeries} />}
          action={<Link href="/money?tab=orders" className={linkButton("primary")}>See transactions</Link>}
        />
      )}
      {onFlags ? (
        <>
          <Section id="revenue.flagged" forceOpen={tab === "mistakes"} title="Voids, refunds, removed items and room charges" summary={`${flags.length} flagged transactions, ${money(flagValue)} at risk`}>
            <Mistakes />
          </Section>
          <SectionLink href="/money?tab=cash" title="Cash on hand against cash sales" summary="Each outlet's drawer at the end of the shift against the bills paid in cash. Card payments are reconciled by the payment provider." />
          <SectionLink href="/money?tab=rooms" title="Room charge check" summary="Each bill signed to a room against the guest folio: missing, a different amount, the wrong room or after check-out." />
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
  const hero = all.find((i) => i.id === HERO_EXCEPTION_ID);
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
        <Panel title="What Tyll checks" description="Rules agreed with the hotel. A flag means a rule was met, nothing more.">
          <ul className="space-y-3 text-sm text-graphite">
            <li>Items removed after their ticket went to the kitchen or bar, without an approval.</li>
            <li>Items the kitchen marked ready that are not on the final bill.</li>
            <li>Discounts above {POLICY.discountMaxPct}%, or with no reason or approval.</li>
            <li>Complimentary items above {POLICY.compMaxValue} per order, or with no reason.</li>
            <li>Refunds above {Math.round(POLICY.refundMaxShare * 100)}% of a bill, late, or unexplained.</li>
            <li>Whole orders cancelled after they were sent to the kitchen or bar.</li>
            <li>Room charges missing from the guest bill, posted more than once, for a different amount, to the wrong room or after check-out.</li>
            <li>Items bought over 30 days beyond what sales, recipes and logged waste account for: more than the last delivery, at least {Math.round(BOUGHT_USED_RULES.minShare * 100)}% of use and {money(BOUGHT_USED_RULES.minValue)}. An estimate until a count.</li>
          </ul>
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
          <TableWrap>
            <table className="w-full min-w-[820px] text-sm">
              <thead><tr><Th>What Tyll found</Th><Th>Outlet</Th><Th>When</Th><Th align="right">Value involved</Th><Th>Status</Th></tr></thead>
              <tbody>
                {[...inPeriod].sort((a, b) => Number(a.status === "closed") - Number(b.status === "closed") || toDisplay(b.propertyId, b.exposure) - toDisplay(a.propertyId, a.exposure)).slice(0, 8).map((i) => (
                  <tr key={i.id} className={cn(rowClass, "cursor-pointer")} onClick={() => router.push(`/investigations/${i.id}`)}>
                    <Td><Link href={`/investigations/${i.id}`} className="text-ink underline-offset-4 hover:underline" onClick={(e) => e.stopPropagation()}>{i.headline}</Link><span className="mt-0.5 block text-xs text-steel">{TYPE_LABEL[i.type]}{i.basis === "estimate" ? ", estimate until a stock take confirms it" : i.basis === "confirmed" ? ", confirmed by a stock take" : ""}</span>{i.comparedWith && <span className="mt-0.5 line-clamp-2 block max-w-[460px] text-xs text-graphite">{i.comparedWith}</span>}</Td>
                    <Td>{i.outletId ? outletLabel(i.outletId) : (() => {
                      // Minibar, spa and laundry belong to the hotel, not an outlet: name the source, as the room charge check does.
                      const charge = i.chargeId ? ctx.data.chargesById.get(i.chargeId) : undefined;
                      return <span className="text-steel">{charge ? SOURCE_LABEL[charge.source] : propertyById[i.propertyId].name}</span>;
                    })()}</Td>
                    <Td className="num whitespace-nowrap text-graphite">{fmtDate(i.date)}, {fmtTime(i.min)}</Td>
                    <Td align="right">{money(toDisplay(i.propertyId, i.exposure))}</Td>
                    <Td><Badge tone={i.status === "closed" ? "neutral" : i.status === "new" ? "warn" : "ink"}>{STATUS_LABEL[i.status]}</Badge></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
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
  const { sel } = useView();
  const days = useMemo(() => eachDay(sel.range).reverse(), [sel.range]);
  const [date, setDate] = useState(days[0]);
  const [onlyChanged, setOnlyChanged] = useState(true);
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(40);
  const day = days.includes(date) ? date : days[0];
  const { data: fetched } = useApi<{ orders: Order[] }>(`/api/orders?date=${day}`);
  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (fetched?.orders ?? [])
      .filter((o) => sel.outletIds.includes(o.outletId))
      .map((o) => ({ o, t: orderTotals(o), flag: detectOrderException(o) }))
      .filter(({ o, t }) => (!onlyChanged || o.voided || t.original - t.net > 0.005) && (!term || `${o.id} ${o.table} ${staffById[o.staffId]?.name ?? ""}`.toLowerCase().includes(term)))
      .sort((a, b) => b.o.openMin - a.o.openMin);
  }, [fetched, sel.outletIds, onlyChanged, q]);
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
