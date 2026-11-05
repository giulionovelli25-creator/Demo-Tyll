"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { BarList } from "@/components/charts";
import { Section, SectionLink } from "@/components/disclosure";
import { OutletFinance } from "@/components/finance/outlets";
import type { ChartPoint } from "@/components/home/chart";
import { useAlertFeed } from "@/lib/alert-feed";
import { useSection } from "@/components/module-hub";
import { Badge, Button, Delta, EmptyState, linkButton, Field, Note, PageHeader, Panel, Segmented, Select, Stat, SummaryBar, TableWrap, Tabs, Td, Th, cn, rowClass, textLink } from "@/components/ui";
import { STAFF, outletById, outletLabel, propertyById, staffById } from "@/lib/data/catalog";
import { HERO_EXCEPTION_ID } from "@/lib/data/constants";
import { can, canSeeOutlet } from "@/lib/domain/access";
import { POLICY, ROOM_TYPES, TYPE_LABEL, detectOrderException } from "@/lib/domain/detect";
import { adjustmentRate, compare, computeTotals, exceptionInSel, totalsByOutlet, type Compared } from "@/lib/domain/metrics";
import { orderTotals } from "@/lib/domain/orders";
import { useApi, useCtx, useInvestigations, usePatterns, useView } from "@/lib/hooks";
import { SOURCE_LABEL, STATUS_LABEL } from "@/lib/labels";
import { useDemo } from "@/lib/store";
import type { ChargeSource, ExceptionType, Order } from "@/lib/types";
import { DEMO_TODAY, eachDay, fmtDate, fmtMoney, fmtNum, fmtPct, fmtRange, fmtShort, fmtTime, fxRate, pctChange, presetRange, sum } from "@/lib/util";

type Tab = "flags" | "mistakes" | "pour" | "outlets" | "orders" | "rooms" | "tips";

const SUB_PAGE: Partial<Record<Tab, string>> = { orders: "All transactions", rooms: "Room charges", tips: "Tips (preview)" };
const RevenueProfitChart = dynamic(() => import("@/components/home/chart").then((m) => m.RevenueProfitChart), { ssr: false, loading: () => <div className="h-[264px] animate-pulse rounded-[var(--radius-control)] bg-mist" /> });

/** One period: revenue with its change, and the profit next to it. */
function periodItem(label: string, c: Compared, money: (n: number, o?: { compact?: boolean }) => string) {
  const change = pctChange(c.now.net, c.before.net);
  const profit = c.now.operatingProfit ?? c.now.grossProfit;
  return {
    label,
    value: money(c.now.net, { compact: true }),
    note: <><Delta value={change} /> <span className="block sm:inline">{money(profit, { compact: true })} {c.now.operatingProfit !== null ? "profit, estimate" : "gross profit"}</span></>,
  };
}

/** The period for the detail below it. The top of the page always shows today, 7 days and 30 days. */
function Period() {
  const preset = useDemo((s) => s.preset);
  const setPreset = useDemo((s) => s.setPreset);
  return <Segmented size="sm" label="Period" value={preset} onChange={setPreset} options={[{ value: "today", label: "Today" }, { value: "yesterday", label: "Yesterday" }, { value: "week", label: "7 days" }, { value: "month", label: "30 days" }]} />;
}

/** Revenue: today, this week and this month first. Flags, outlets and transactions are one click away. */
export default function MoneyPage() {
  const [tab, setTab] = useSection<Tab>("/money", ["flags", "mistakes", "pour", "outlets", "orders", "rooms", "tips"], null);
  const { sel, user, money, currency } = useView();
  const ctx = useCtx();
  const router = useRouter();
  const investigations = useInvestigations();
  const { pour } = useAlertFeed();
  const t = useMemo(() => computeTotals(ctx, sel), [ctx, sel]);
  const dayC = useMemo(() => compare(ctx, { ...sel, range: presetRange("today") }), [ctx, sel]);
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
  const wineWeek = pour ? pour.wine.totals.week.gapValue * rate : 0;
  const pourWeek = pour ? (pour.wine.totals.week.gapValue + pour.spirits.totals.week.gapValue) * rate : 0;
  const onFlags = tab === "flags" || tab === "mistakes" || tab === "pour";
  const profitName = monthC.now.operatingProfit !== null ? "Net profit" : "Gross profit";

  // Pour Control moved to Drinks control. Old links still land in the right place.
  useEffect(() => { if (tab === "pour") router.replace("/drinks"); }, [tab, router]);
  const sub = tab ? SUB_PAGE[tab] : undefined;
  if (sub) {
    return (
      <div className="space-y-5">
        <PageHeader title={sub} />
        {tab === "orders" && <><Period /><Orders /></>}
        {tab === "rooms" && <RoomCharges />}
        {tab === "tips" && <Tips />}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Revenue" question={onFlags ? "Where is money going missing?" : "How much did we make?"} lead="Simulated data." />
      {onFlags ? (
        <SummaryBar
          items={[
            { label: "Money at risk", value: money(flagValue + pourWeek, { compact: true }), tone: "money" },
            { label: "Open flags", value: flags.length, tone: flags.length ? "warn" : "pos" },
            { label: "Recovered", value: money(t.recovered, { compact: true }), tone: "pos" },
          ]}
          action={<Link href="/investigations" className={linkButton("primary")}>Review {flags.length} flags</Link>}
        />
      ) : (
        <SummaryBar
          items={[periodItem("Today so far", dayC, money), periodItem("Last 7 days", weekC, money), periodItem("Last 30 days", monthC, money)]}
          action={<Link href="/money?tab=orders" className={linkButton("primary")}>See transactions</Link>}
        />
      )}
      <Tabs value={onFlags ? "flags" : "revenue"} onChange={(v) => setTab(v === "flags" ? "flags" : null)} tabs={[{ value: "revenue", label: "Revenue" }, { value: "flags", label: "Flags", count: flags.length }]} />
      {onFlags ? (
        <>
          <SectionLink href="/drinks" title="Over pouring and missing drinks" summary={pour ? `${pour.wine.totals.week.gap} glasses of wine not billed this week, ${money(wineWeek)}. See Drinks control.` : "See Drinks control."} />
          <Section id="revenue.flagged" defaultOpen forceOpen={tab === "mistakes"} title="Voids, refunds and removed items" summary={`${flags.length} flagged transactions, ${money(flagValue)} at risk`}>
            <Mistakes />
          </Section>
        </>
      ) : (
        <>
          <Panel title={`Revenue and ${monthC.now.operatingProfit !== null ? "estimated profit" : "gross profit"}, last ${days.length} days`}>
            <RevenueProfitChart points={points} format={(n) => money(n)} axisFormat={fmtShort} profitName={profitName} summary={`Revenue and ${profitName} per day for the last ${days.length} days, in ${currency}.`} />
          </Panel>
          <Section id="revenue.outlets" forceOpen={tab === "outlets"} title="By outlet" summary={outlets[0] ? `${outlets.length} ${outlets.length === 1 ? "outlet" : "outlets"}, ${fmtRange(sel.range)}. ${outletLabel(outlets[0].outletId)} leads with ${money(outlets[0].now.net, { compact: true })}.` : "No outlets in your selection"}>
            <Period />
            <OutletFinance />
          </Section>
          <SectionLink href="/money?tab=orders" title="All transactions" summary={`${fmtNum(t.orders)} transactions, ${fmtRange(sel.range)}. Filter by day and search.`} />
          {can(user, "finance.view") && <p><Link href="/finance?tab=invoices" className={textLink}>Supplier invoices and reconciliation</Link></p>}
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
  const inPeriod = useMemo(() => all.filter((i) => !ROOM_TYPES.includes(i.type) && i.date >= sel.range.from && i.date <= sel.range.to && exceptionInSel(i, sel)), [all, sel]);
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
  const hero = all.find((i) => i.id === HERO_EXCEPTION_ID);
  const steps = [
    ["8:42 PM", "Guest orders a burger and a Coke", ""],
    ["8:43 PM", "Both items are sent for preparation", "Kitchen and bar tickets print"],
    ["8:49 PM", "The Coke is removed from the order", "No reason, no approval"],
    ["8:51 PM", "The guest pays for the burger only", "Card, AED 98"],
  ];

  return (
    <div className="space-y-5">
      {hero && canSeeOutlet(user, "dxb-terrace") && (
        <Panel title="Tonight at The Terrace: an item removed after it was sent to the bar" description="A worked example of what Tyll looks for. The order below is in tonight's records." action={<Badge tone={hero.status === "closed" ? "neutral" : "warn"}>{STATUS_LABEL[hero.status]}</Badge>}>
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
            <Button variant="primary" onClick={() => router.push(`/investigations/${HERO_EXCEPTION_ID}`)}>Open the investigation <ArrowRight size={15} /></Button>
          </div>
        </Panel>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Panel title="Flagged by type" description="Value involved in the period. Choose a type to see its cases.">
          {byType.length === 0 ? <EmptyState title="Nothing flagged in this period" /> : (
            <BarList tone="warn" format={(n) => money(n)} rows={byType.map((t) => ({ key: t.type, label: TYPE_LABEL[t.type], sub: `${t.n} case${t.n === 1 ? "" : "s"}`, value: t.value, onClick: () => router.push(`/investigations?type=${t.type}&status=all`) }))} />
          )}
        </Panel>
        <Panel title="Adjustment rate by outlet" description="Flagged orders per 1,000 orders, so busy and quiet outlets compare fairly.">
          <BarList format={(n) => n.toFixed(1)} rows={[...rows].sort((a, b) => adjustmentRate(b.now) - adjustmentRate(a.now)).map((r) => ({ key: r.outletId, outletId: r.outletId, label: outletLabel(r.outletId), sub: `${r.now.adjustments} of ${fmtNum(r.now.orders)} orders`, value: adjustmentRate(r.now) }))} />
        </Panel>
        <Panel title="What Tyll checks" description="Rules agreed with the hotel. A flag means a rule was met, nothing more.">
          <ul className="space-y-3 text-sm text-graphite">
            <li>Items removed after their ticket went to the kitchen or bar, without an approval.</li>
            <li>Items the kitchen marked ready that are not on the final bill.</li>
            <li>Discounts above {POLICY.discountMaxPct}%, or with no reason or approval.</li>
            <li>Complimentary items above {POLICY.compMaxValue} per order, or with no reason.</li>
            <li>Refunds above {Math.round(POLICY.refundMaxShare * 100)}% of a bill, late, or unexplained.</li>
            <li>Whole orders voided after dispatch.</li>
          </ul>
        </Panel>
      </div>

      <Panel title="Repeated patterns" description={`Unapproved removals in the last ${POLICY.patternWindowDays} days that cluster under one POS login.`}>
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
                </li>
              ))}
            </ul>
            <Note className="mt-3 max-w-[90ch]">A login shows which account was signed in at the terminal. Shared logins, busy sections and training gaps all produce the same pattern, so this is a prompt to look, not a finding about a person.</Note>
          </>
        )}
      </Panel>

      <Panel title="Latest flagged orders" action={<Link href="/investigations" className="flex items-center gap-1 text-[13px] text-steel hover:text-ink">Money Back List <ArrowRight size={14} /></Link>} flush>
        {inPeriod.length === 0 ? <div className="px-5 pb-6 sm:px-6"><EmptyState title="No flagged orders in this period" /></div> : (
          <TableWrap>
            <table className="w-full min-w-[820px] text-sm">
              <thead><tr><Th>What Tyll found</Th><Th>Outlet</Th><Th>When</Th><Th align="right">Value involved</Th><Th>Status</Th></tr></thead>
              <tbody>
                {inPeriod.slice(0, 8).map((i) => (
                  <tr key={i.id} className={cn(rowClass, "cursor-pointer")} onClick={() => router.push(`/investigations/${i.id}`)}>
                    <Td><Link href={`/investigations/${i.id}`} className="text-ink underline-offset-4 hover:underline" onClick={(e) => e.stopPropagation()}>{i.headline}</Link><span className="mt-0.5 block text-xs text-steel">{TYPE_LABEL[i.type]}</span></Td>
                    <Td>{i.outletId ? outletLabel(i.outletId) : "None"}</Td>
                    <Td className="num whitespace-nowrap text-graphite">{fmtDate(i.date)}, {fmtTime(i.min)}</Td>
                    <Td align="right">{money(toDisplay(i.propertyId, i.exposure), { decimals: true })}</Td>
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
            Showing {Math.min(shown, list.length)} of {list.length} orders. Amounts in {[...new Set(sel.outletIds.map((id) => propertyById[outletById[id].propertyId].currency))].join(" and ")}.
            {list.length > shown && <button type="button" className="ms-3 underline underline-offset-4 hover:text-ink" onClick={() => setShown((n) => n + 40)}>Show 40 more</button>}
          </p>
        </>
      )}
    </Panel>
  );
}

function RoomCharges() {
  const router = useRouter();
  const { sel, money, currency } = useView();
  const ctx = useCtx();
  const all = useInvestigations();
  const charges = useMemo(
    () => ctx.data.roomCharges.filter((c) => c.date >= sel.range.from && c.date <= sel.range.to && (c.outletId ? sel.outletIds.includes(c.outletId) : sel.wholeProperties.includes(c.propertyId))),
    [ctx.data.roomCharges, sel],
  );
  const rate = (pid: string) => fxRate(propertyById[pid].currency, currency);
  const bySource = (Object.keys(SOURCE_LABEL) as ChargeSource[]).map((source) => {
    const list = charges.filter((c) => c.source === source);
    return {
      source, n: list.length,
      expected: sum(list, (c) => c.expected * rate(c.propertyId)),
      posted: sum(list, (c) => sum(c.posted, (x) => x) * rate(c.propertyId)),
      missing: list.filter((c) => c.posted.length === 0).length,
      duplicate: list.filter((c) => c.posted.length > 1).length,
      incorrect: list.filter((c) => c.posted.length === 1 && Math.abs(c.posted[0] - c.expected) > POLICY.roomChargeTolerance).length,
    };
  }).filter((s) => s.n > 0);
  const flagged = all.filter((i) => ROOM_TYPES.includes(i.type) && i.date >= sel.range.from && i.date <= sel.range.to && exceptionInSel(i, sel));
  const expected = sum(bySource, (s) => s.expected);
  const posted = sum(bySource, (s) => s.posted);
  const outletSales = sum(bySource.filter((s) => s.source === "restaurant" || s.source === "room_service"), (s) => s.expected);
  return (
    <div className="space-y-5">
      <Panel title="Charges to guest rooms" description="Each charge recorded at an outlet or by housekeeping is matched to the line on the guest bill in the property management system.">
        <div className="grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
          <Stat label="Charges checked" value={fmtNum(charges.length)} />
          <Stat label="Should be on guest bills" value={money(expected)} />
          <Stat label="Actually posted" value={money(posted)} sub={`${money(posted - expected)} difference`} />
          <Stat label="Postings flagged" tone={flagged.length ? "warn" : undefined} value={flagged.length} sub={`${flagged.filter((f) => f.status !== "closed").length} still open`} onClick={() => router.push("/investigations?type=room&status=all")} />
        </div>
        <div className="mt-6 rounded-2xl bg-mist px-5 py-4 text-sm text-graphite">
          <p className="text-ink">Revenue is counted once.</p>
          <p className="mt-1 max-w-[95ch]">The {money(outletSales)} of restaurant and room-service sales charged to rooms in this period is already inside net sales at the outlet. Posting it to a room moves it to the guest bill, and settlement at check-out clears that bill. Neither step adds revenue, so Tyll never adds room postings or check-out payments on top of outlet sales.</p>
        </div>
      </Panel>

      <Panel title="By source" flush>
        {bySource.length === 0 ? <div className="px-5 pb-6 sm:px-6"><EmptyState title="No room charges in this selection">Minibar, spa and laundry charges belong to the whole property. Choose a property with all outlets to see them.</EmptyState></div> : (
          <TableWrap>
            <table className="w-full min-w-[760px] text-sm">
              <thead><tr><Th>Source</Th><Th align="right">Charges</Th><Th align="right">Should be posted</Th><Th align="right">Posted</Th><Th align="right">Missing</Th><Th align="right">Duplicated</Th><Th align="right">Wrong amount</Th></tr></thead>
              <tbody>
                {bySource.map((s) => (
                  <tr key={s.source} className={rowClass}>
                    <Td className="text-ink">{SOURCE_LABEL[s.source]}</Td>
                    <Td align="right">{fmtNum(s.n)}</Td>
                    <Td align="right">{money(s.expected)}</Td>
                    <Td align="right">{money(s.posted)}</Td>
                    <Td align="right" className={cn(s.missing > 0 && "text-warn")}>{s.missing}</Td>
                    <Td align="right" className={cn(s.duplicate > 0 && "text-warn")}>{s.duplicate}</Td>
                    <Td align="right" className={cn(s.incorrect > 0 && "text-warn")}>{s.incorrect}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        <Note className="px-6 py-4">Minibar, spa and laundry postings are simulated for the last 21 days. Room-damage charge verification is planned and not part of this demo.</Note>
      </Panel>

      <Panel title="Flagged postings" flush>
        {flagged.length === 0 ? <div className="px-5 pb-6 sm:px-6"><EmptyState title="Every charge in this period reached the right bill" /></div> : (
          <TableWrap>
            <table className="w-full min-w-[760px] text-sm">
              <thead><tr><Th>What Tyll found</Th><Th>Hotel</Th><Th>When</Th><Th align="right">Value involved</Th><Th>Status</Th></tr></thead>
              <tbody>
                {flagged.slice(0, 12).map((i) => (
                  <tr key={i.id} className={cn(rowClass, "cursor-pointer")} onClick={() => router.push(`/investigations/${i.id}`)}>
                    <Td><Link href={`/investigations/${i.id}`} className="text-ink underline-offset-4 hover:underline" onClick={(e) => e.stopPropagation()}>{i.headline}</Link><span className="mt-0.5 block text-xs text-steel">{TYPE_LABEL[i.type]}</span></Td>
                    <Td>{propertyById[i.propertyId].name}</Td>
                    <Td className="num whitespace-nowrap text-graphite">{fmtDate(i.date)}, {fmtTime(i.min)}</Td>
                    <Td align="right">{money(i.exposure * rate(i.propertyId), { decimals: true })}</Td>
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
    <div className="space-y-5">
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
