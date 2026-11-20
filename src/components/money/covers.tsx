"use client";
// Booked against billed covers (overnight feature 6): did every seated table get a bill? Each booking the host marked
// seated in the reservation book against the bills at that table, per outlet and service. The figures come from the
// server (/api/money/covers), which keeps the reservation book; the case states come from the flags, so the open count
// here is the same as on the Money Back List.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { useMemo, useState } from "react";
import { ColumnChart, StripTrend } from "@/components/charts";
import { Section } from "@/components/disclosure";
import { Badge, Button, EmptyState, Note, Panel, Segmented, Skeleton, SummaryBar, TableWrap, Td, Th, WidgetError, cn, linkButton, rowClass, textLink } from "@/components/ui";
import { outletLabel } from "@/lib/data/catalog";
import { SERVICE_LABEL, VIA_LABEL, fmtStay, partyRange } from "@/lib/domain/covers";
import { exceptionInSel } from "@/lib/domain/metrics";
import { versus } from "@/lib/domain/trends";
import { useApi, useInvestigations, useView } from "@/lib/hooks";
import { STATUS_LABEL } from "@/lib/labels";
import type { CoverCase, CoverRow, CoversCheck } from "@/lib/server/covers";
import { fmtDate, fmtNum, fmtPct, fmtTime, sum } from "@/lib/util";

const TOP = 5;
type Meal = "lunch" | "dinner";
const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" });
const share = (a: number, b: number) => (b ? fmtPct(a / b, 1) : "None");
const guests = (n: number) => `${fmtNum(n)} ${n === 1 ? "guest" : "guests"}`;
const tables = (n: number) => `${fmtNum(n)} ${n === 1 ? "table" : "tables"}`;

export function BookedCovers() {
  const router = useRouter();
  const params = useSearchParams();
  const { sel, money } = useView();
  const all = useInvestigations();
  const days = params.get("days") === "7" ? 7 : 30;
  const meal: Meal = params.get("service") === "lunch" ? "lunch" : "dinner";
  const { data, error } = useApi<CoversCheck>(`/api/money/covers?days=${days}&outlets=${sel.outletIds.join(",")}`);
  const [everything, setEverything] = useState(false);
  const cases = useMemo(() => new Map(all.map((i) => [i.id, i])), [all]);
  // Open flags of this rule in view, whatever the period: the same list as the Money Back List.
  const open = useMemo(() => all.filter((i) => i.type === "seated_no_bill" && i.status !== "closed" && exceptionInSel(i, sel)), [all, sel]);
  const setParam = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) if (v === null) next.delete(k); else next.set(k, v);
    router.replace(`/money?${next.toString()}`, { scroll: false });
  };

  if (error) return <WidgetError>Booked against billed covers could not load.</WidgetError>;
  if (!data) return <div className="space-y-6"><Skeleton className="h-40 w-full" /><Skeleton className="h-72 w-full" /></div>;
  if (data.bookable.length === 0) {
    return (
      <EmptyState title="None of the outlets in view takes table bookings">
        {data.walkIn.map(outletLabel).join(", ")} serve walk-in and hotel guests, so there is no reservation book to compare. Choose Mercado in the outlet selector.
      </EmptyState>
    );
  }

  const t = data.total;
  const statusOf = (r: CoverCase) => cases.get(r.caseId)?.status ?? r.seedStatus;
  const rows = [...data.cases].sort((a, b) => Number(statusOf(a) === "closed") - Number(statusOf(b) === "closed") || b.atStake - a.atStake);
  const shown = everything ? rows : rows.slice(0, TOP);
  const openValue = sum(open, (i) => i.exposure);
  const period = days === 7 ? "in the 7 days before" : "in the 30 days before";
  const chartDays = data.trend.slice(-days);
  const mealRows = data.rows.filter((r) => r.service === meal);
  const mealSum = { booked: sum(mealRows, (r) => r.booked), billed: sum(mealRows, (r) => r.billed), gap: sum(mealRows, (r) => r.gap), noBillTables: sum(mealRows, (r) => r.noBillTables), leftEarly: sum(mealRows, (r) => r.leftEarly) };
  const story = data.story;
  const storyCase = story ? cases.get(story.caseId) : undefined;
  const elsewhere = t.moved + t.joined + t.leftEarlyTables;
  const R = data.rules;

  return (
    <div className="space-y-6">
      <SummaryBar
        items={[
          { label: "Seated from bookings", value: fmtNum(t.tables), compare: { text: `${guests(t.booked)}. ${fmtNum(t.noShows)} no-shows are not counted`, good: null }, onClick: () => scrollTo("covers-services") },
          { label: "Booked guests billed", value: share(t.billed, t.booked), compare: versus(t.booked ? t.billed / t.booked : 0, data.before.booked ? data.before.billed / data.before.booked : 0, "up", period), note: `${fmtNum(t.billed)} of ${guests(t.booked)}`, onClick: () => scrollTo("covers-services") },
          { label: "Tables with no bill", value: fmtNum(t.noBillTables), tone: t.noBillTables ? "warn" : "pos", compare: versus(t.noBillTables, data.before.noBillTables, "down", period), note: t.noBillTables ? `${guests(t.noBill)}, about ${money(t.value)}, an estimate` : "Every seated table had a bill", onClick: () => scrollTo("covers-list") },
          { label: "Open to check", value: money(openValue), tone: "money", compare: { text: `${open.length} open ${open.length === 1 ? "flag" : "flags"}, until checked`, good: null }, href: "/investigations?type=seated_no_bill&status=open" },
        ]}
        trend={
          <StripTrend
            goodWhen="down"
            title="Guests at tables with no bill, last 30 days"
            points={data.trend.map((d) => ({ date: d.date, value: d.noBill }))}
            format={(n) => fmtNum(n)}
            note="by the day of the service"
            explain="Guests on bookings the host marked seated whose table had no bill, nor a bill for the same party nearby, by the day of the service."
            series={[
              { id: "dinner", label: "Dinner, guests with no bill", axis: "gap", goodWhen: "down", format: (n) => fmtNum(n), points: data.trend.map((d) => ({ date: d.date, value: d.dinner.noBill })), explain: "Guests at dinner tables with no bill." },
              { id: "lunch", label: "Lunch, guests with no bill", axis: "gap", goodWhen: "down", format: (n) => fmtNum(n), points: data.trend.map((d) => ({ date: d.date, value: d.lunch.noBill })), explain: "Guests at lunch tables with no bill." },
              { id: "booked", label: "Booked guests seated", axis: "guests", goodWhen: "none", format: (n) => fmtNum(n), points: data.trend.map((d) => ({ date: d.date, value: d.booked })), explain: "Guests on bookings the host marked seated, lunch and dinner." },
              { id: "billed", label: "Booked guests billed", axis: "guests", goodWhen: "none", format: (n) => fmtNum(n), points: data.trend.map((d) => ({ date: d.date, value: d.billed })), explain: "Of those, guests whose table had a bill." },
            ]}
            summary={`Guests at seated tables with no bill, per day for the last 30 days. ${fmtNum(t.noBill)} in the period shown.`}
            footer={`${guests(sum(data.trend, (d) => d.noBill))} at tables with no bill in 30 days`}
          />
        }
        action={open.length > 0 ? <Link prefetch={false} href="/investigations?type=seated_no_bill&status=open" className={linkButton("primary")}>Review {open.length} open</Link> : undefined}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Segmented size="sm" label="Period" value={String(days) as "7" | "30"} onChange={(v) => setParam({ days: v === "30" ? null : v })} options={[{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }]} />
        <span className="text-[13px] text-steel">{fmtDate(data.from)} to {fmtDate(data.to)}. Services are checked once they close.</span>
      </div>

      {story && (
        <Section id="covers.example" forceOpen={params.get("open") === "example"} title="Worked example: a table seated with no bill" summary={`Last night at ${outletLabel(story.outletId)}. How one flag is found, step by step.`}>
          <Panel title={`Last night at ${outletLabel(story.outletId)}: a booking for ${story.party} with no bill`} description="A worked example of what Tyll looks for. The booking below is in last night's reservation book." action={storyCase && <Badge tone={storyCase.status === "closed" ? "neutral" : "warn"}>{STATUS_LABEL[storyCase.status]}</Badge>}>
            <ol className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                [fmtTime(story.bookedFor), `A booking for ${story.party} at ${fmtTime(story.bookedFor)}`, `Made ${VIA_LABEL[story.via]}${story.room ? `, by the guest in room ${story.room}` : ""}`],
                [fmtTime(story.seatedMin), `Seated at ${story.table}`, "Marked seated by the host"],
                [`${fmtTime(story.from)} to ${fmtTime(story.to)}`, `No bill at ${story.table}`, `And none for ${partyRange(story.party)} opened nearby`],
                [story.leftMin !== undefined ? fmtTime(story.leftMin) : "", "Table marked finished", story.leftMin !== undefined ? `${fmtStay(story.leftMin - story.seatedMin)} after seating, about ${money(story.value)} at the ${SERVICE_LABEL[story.service].toLowerCase()} spend per guest` : `About ${money(story.value)}`],
              ].map(([time, title, detail], i) => (
                <li key={i} className={cn("relative rounded-2xl border p-4", i === 2 ? "border-warn/40 bg-warn-soft" : "border-line")}>
                  <p className="num text-[13px] text-steel">{time}</p>
                  <p className="mt-1 text-[15px] leading-snug text-ink">{title}</p>
                  {detail && <p className="mt-1 text-xs text-steel">{detail}</p>}
                </li>
              ))}
            </ol>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-[70ch] text-sm text-graphite">Tyll flags a table the host marked seated with no bill at that table, nor for a party of that size nearby. It does not conclude why. The case shows the booking, the bills around it and what to check: whether the party paid on another table&rsquo;s bill{story.room ? ", and whether the meal can go on the guest's room" : ""}.</p>
              {storyCase && <Button onClick={() => router.push(`/investigations/${story.caseId}`)}>Open the investigation <ArrowRight size={15} className="rtl:rotate-180" /></Button>}
            </div>
          </Panel>
        </Section>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.6fr_1fr] [&>*]:min-w-0">
        <Panel
          title={`${SERVICE_LABEL[meal]}: booked guests not billed, per day`}
          description={`${fmtNum(mealSum.booked)} booked guests seated, ${fmtNum(mealSum.billed)} billed, a gap of ${fmtNum(mealSum.gap)} in the last ${days} days.`}
          action={<Segmented size="sm" label="Service" value={meal} onChange={(v) => setParam({ service: v === "dinner" ? null : v })} options={[{ value: "dinner", label: "Dinner" }, { value: "lunch", label: "Lunch" }]} />}
        >
          <ColumnChart
            data={chartDays.map((d) => ({ label: fmtDate(d.date), value: d[meal].gap }))}
            highlight={(i) => chartDays[i][meal].noBill > 0}
            format={(n) => guests(n)}
            axisFormat={(n) => fmtNum(n)}
            name="Booked guests not billed"
            tickGap={days === 7 ? 4 : 24}
            whole
            height={260}
            summary={`${SERVICE_LABEL[meal]}: booked guests not billed each day for the last ${days} days. ${fmtNum(mealSum.noBillTables)} ${mealSum.noBillTables === 1 ? "table" : "tables"} with no bill, ${fmtNum(mealSum.leftEarly)} guests left before ordering.`}
          />
          <Note className="mt-3">Coloured bars: a table with no bill, to check. Grey bars: guests who left before ordering, not flagged.</Note>
        </Panel>
        <Panel title="What Tyll checks" description="Rules agreed with the hotel. A table with no bill is a prompt to check, not proof of anyone's mistake.">
          <ul className="space-y-3 text-sm text-graphite">
            <li>{`Each booking the host marks seated is matched with the bill opened at its table, from ${R.beforeSeat} minutes before seating until the table is finished.`}</li>
            <li>{`Not flagged: a party that joined another booking at its table and paid on that bill, a party that left within ${R.leftEarly} minutes, before ordering, and a party seated elsewhere, when a bill for the same party, give or take one guest, was opened within ${R.moved} minutes.`}</li>
            <li>No-shows and cancellations never sat down, so they are not counted. Breakfast is hotel guests walking in, with no bookings.</li>
            <li>{`A table with no bill is valued at the outlet's spend per guest at that service over the ${R.spendDays} days before. An estimate.`}</li>
          </ul>
        </Panel>
      </div>

      <div id="covers-services" className="scroll-mt-24">
        <Panel title="By outlet and service" description={`Guests on seated bookings, the last ${days} days. Billed: their table had a bill. The gap is booked minus billed.`} flush>
          <ul className="divide-y divide-hair border-t border-hair sm:hidden">
            {data.rows.map((r) => (
              <li key={`${r.outletId}-${r.service}`} className="px-5 py-4">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm text-ink">{outletLabel(r.outletId)}, {SERVICE_LABEL[r.service].toLowerCase()}</p>
                  {r.noBillTables ? <Badge tone="warn">{tables(r.noBillTables)} to check</Badge> : <Badge tone="pos">Every table billed</Badge>}
                </div>
                <dl className="mt-2 grid grid-cols-3 gap-3 text-sm">
                  <div><dt className="text-xs text-steel">Booked</dt><dd className="num text-ink">{fmtNum(r.booked)}</dd></div>
                  <div><dt className="text-xs text-steel">Billed</dt><dd className="num text-ink">{fmtNum(r.billed)}</dd></div>
                  <div><dt className="text-xs text-steel">Gap</dt><dd className="num text-ink">{fmtNum(r.gap)}</dd></div>
                </dl>
                {r.noBillTables > 0 && <p className="num mt-1 text-xs text-steel">{guests(r.noBill)} with no bill, about {money(r.value)}, an estimate</p>}
              </li>
            ))}
          </ul>
          <TableWrap className="hidden sm:block">
            <table className="w-full min-w-[760px] text-sm">
              <thead><tr><Th>Outlet and service</Th><Th align="right">Tables seated</Th><Th align="right">Booked guests</Th><Th align="right">Billed</Th><Th align="right">Gap</Th><Th align="right">No bill found</Th><Th align="right">Value, an estimate</Th></tr></thead>
              <tbody>
                {data.rows.map((r: CoverRow) => (
                  <tr key={`${r.outletId}-${r.service}`} className={rowClass}>
                    <Td className="text-ink">{outletLabel(r.outletId)}, {SERVICE_LABEL[r.service].toLowerCase()}</Td>
                    <Td align="right">{fmtNum(r.tables)}</Td>
                    <Td align="right">{fmtNum(r.booked)}</Td>
                    <Td align="right">{fmtNum(r.billed)}</Td>
                    <Td align="right" className="font-medium text-ink">{fmtNum(r.gap)}{r.leftEarly > 0 && <span className="block text-xs font-normal text-steel">{fmtNum(r.leftEarly)} left before ordering</span>}</Td>
                    <Td align="right">{r.noBillTables ? <Badge tone="warn">{tables(r.noBillTables)}, {guests(r.noBill)}</Badge> : <span className="text-graphite">None</span>}</Td>
                    <Td align="right" className="text-ink">{r.value ? money(r.value) : "None"}</Td>
                  </tr>
                ))}
                {data.rows.length > 1 && (
                  <tr className="border-t border-line">
                    <Td className="font-medium text-ink">Total</Td>
                    <Td align="right" className="font-medium text-ink">{fmtNum(t.tables)}</Td>
                    <Td align="right" className="font-medium text-ink">{fmtNum(t.booked)}</Td>
                    <Td align="right" className="font-medium text-ink">{fmtNum(t.billed)}</Td>
                    <Td align="right" className="font-medium text-ink">{fmtNum(t.gap)}</Td>
                    <Td align="right" className="font-medium text-ink">{t.noBillTables ? `${tables(t.noBillTables)}, ${guests(t.noBill)}` : "None"}</Td>
                    <Td align="right" className="font-medium text-ink">{t.value ? money(t.value) : "None"}</Td>
                  </tr>
                )}
              </tbody>
            </table>
          </TableWrap>
          <div className="space-y-1.5 border-t border-hair px-5 py-3 sm:px-6">
            <Note>{`The bills of these tables count ${guests(t.billCovers)}: ${fmtNum(t.sizeChanged)} parties grew or shrank at the table, which is not a gap.`}</Note>
            {data.walkIn.length > 0 && <Note>{data.walkIn.map(outletLabel).join(", ")} take no table bookings, so there is nothing to compare. Breakfast is hotel guests walking in.</Note>}
          </div>
        </Panel>
      </div>

      <div id="covers-list" className="scroll-mt-24">
        <Panel title="Tables to check" description="Open first, largest amount first. Checked ones follow." action={<Link prefetch={false} href="/investigations?type=seated_no_bill&status=all" className="flex items-center gap-1 text-[13px] text-steel hover:text-ink">Money Back List <ArrowRight size={14} className="rtl:rotate-180" /></Link>} flush>
          {rows.length === 0 ? <div className="px-5 pb-6 sm:px-6"><EmptyState title="Every seated table in this period had a bill" /></div> : (
            <>
              <ul className="divide-y divide-hair border-t border-hair">
                {shown.map((r) => {
                  const st = statusOf(r);
                  return (
                    <li key={r.caseId}>
                      <Link prefetch={false} href={`/investigations/${r.caseId}`} className="flex flex-col gap-1.5 px-5 py-3.5 transition-colors duration-150 hover:bg-cloud sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-6">
                        <span className="min-w-0">
                          <span className="block text-sm text-ink">{r.headline}</span>
                          <span className="block text-xs text-steel">{outletLabel(r.outletId)}, {SERVICE_LABEL[r.service].toLowerCase()} · {fmtDate(r.date)}, {fmtTime(r.min)}</span>
                        </span>
                        <span className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
                          <Badge tone={st === "closed" ? "neutral" : st === "new" ? "warn" : "ink"}>{st === "closed" ? "Checked" : STATUS_LABEL[st]}</Badge>
                          <span className="num text-sm font-medium text-ink">{money(r.atStake)}<span className="block text-end text-xs font-normal text-steel">an estimate</span></span>
                          <span className={textLink}>{st === "closed" ? "View" : "Review"}</span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              {rows.length > TOP && <div className="border-t border-hair px-6 py-3"><button type="button" onClick={() => setEverything((v) => !v)} className={textLink}>{everything ? "Show the five largest" : `Show all ${rows.length} tables`}</button></div>}
            </>
          )}
        </Panel>
      </div>

      <Section id="covers.matched" flush title="Not flagged, and why" summary={`${tables(elsewhere)} matched another way, ${fmtNum(t.noShows)} no-shows, in the last ${days} days.`}>
        <ul className="divide-y divide-hair">
          {[
            ["Seated at another table", tables(t.moved), `A bill for the same party, give or take one guest, was opened elsewhere within ${R.moved} minutes of seating.`],
            ["Joined another booking", tables(t.joined), "Seated at the same table as another booking, on a bill with room for both parties."],
            ["Left before ordering", `${tables(t.leftEarlyTables)}, ${guests(t.leftEarly)}`, `The host marked the table finished within ${R.leftEarly} minutes of seating. Counted in the gap, never flagged.`],
            ["Party changed size", tables(t.sizeChanged), "The bill counts a guest more or fewer than the booking. Not a gap: guests join or cancel at the table."],
            ["No-shows", `${fmtNum(t.noShows)}, ${guests(t.noShowGuests)}`, "Booked and never seated, so never counted as booked."],
          ].map(([title, count, why]) => (
            <li key={title} className="flex flex-col gap-1 px-5 py-3.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6 sm:px-6">
              <span className="min-w-0"><span className="block text-sm text-ink">{title}</span><span className="block text-xs text-steel">{why}</span></span>
              <span className="num shrink-0 text-sm text-ink">{count}</span>
            </li>
          ))}
        </ul>
        <div className="px-5 py-3 sm:px-6"><Note>The reservation book and the bills are simulated.</Note></div>
      </Section>
    </div>
  );
}
