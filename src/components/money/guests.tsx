"use client";
// Hotel guests against outlet charges (overnight feature 7): are in-house guests' meals being charged? Each room the
// breakfast host ticked in at Mercado against its rate in the PMS and the breakfast bills, and each outlet's sales against
// the guests in house. The figures come from the server (/api/money/guests), which keeps the in-house list; the case states
// come from the flags, so the open count here is the same as on the Money Back List.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { useMemo, useState } from "react";
import { BarList, StripTrend, TrendChart } from "@/components/charts";
import { Section } from "@/components/disclosure";
import { Badge, Button, EmptyState, Note, Panel, Segmented, Skeleton, SummaryBar, TableWrap, Td, Th, WidgetError, cn, linkButton, rowClass, textLink } from "@/components/ui";
import { outletLabel } from "@/lib/data/catalog";
import { canSeeOutlet } from "@/lib/domain/access";
import { rateName } from "@/lib/domain/guests";
import { exceptionInSel } from "@/lib/domain/metrics";
import { versus } from "@/lib/domain/trends";
import { useApi, useInvestigations, useView } from "@/lib/hooks";
import { STATUS_LABEL } from "@/lib/labels";
import type { GuestCase, GuestsCheck } from "@/lib/server/guests";
import { fmtDate, fmtNum, fmtPct, fmtTime, sum } from "@/lib/util";

const TOP = 5;
const DAYS_TOP = 3;
const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" });
const guests = (n: number) => `${fmtNum(n)} ${n === 1 ? "guest" : "guests"}`;
const rooms = (n: number) => `${fmtNum(n)} ${n === 1 ? "room" : "rooms"}`;
/** A share that never rounds up to 100% while anything is left: 4,631 of 4,633 reads 99.9%, not 100.0%. */
const floorPct = (ratio: number) => fmtPct(ratio < 1 ? Math.floor(ratio * 1000) / 1000 : ratio, 1);
const breakfasts = (n: number) => `${fmtNum(n)} ${n === 1 ? "breakfast" : "breakfasts"}`;
/** A share against the period before, in words with the earlier share, never as a percentage of a percentage. */
function shareVersus(now: number, before: number | null, period: string): { text: string; good: boolean | null } | undefined {
  if (before === null) return undefined;
  const a = floorPct(now), b = floorPct(before);
  if (a === b) return { text: `Same as ${period}`, good: null };
  return now > before ? { text: `Up from ${b} ${period}`, good: true } : { text: `Down from ${b} ${period}`, good: false };
}

export function HotelGuests() {
  const router = useRouter();
  const params = useSearchParams();
  const { sel, money, user } = useView();
  const all = useInvestigations();
  const days = params.get("days") === "7" ? 7 : 30;
  const { data, error } = useApi<GuestsCheck>(`/api/money/guests?days=${days}&outlets=${sel.outletIds.join(",")}`);
  const [everything, setEverything] = useState(false);
  const [allDays, setAllDays] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const cases = useMemo(() => new Map(all.map((i) => [i.id, i])), [all]);
  // Open flags of this rule in view, whatever the period: the same list as the Money Back List.
  const open = useMemo(() => all.filter((i) => i.type === "breakfast_not_charged" && i.status !== "closed" && exceptionInSel(i, sel)), [all, sel]);
  const setParam = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) if (v === null) next.delete(k); else next.set(k, v);
    router.replace(`/money?${next.toString()}`, { scroll: false });
  };

  if (error) return <WidgetError>Hotel guests against outlet charges could not load.</WidgetError>;
  if (!data) return <div className="space-y-6"><Skeleton className="h-40 w-full" /><Skeleton className="h-72 w-full" /></div>;

  const t = data.total;
  const covered = t.included + t.charged + t.paid;
  const statusOf = (r: GuestCase) => cases.get(r.caseId)?.status ?? r.seedStatus;
  const rows = [...data.cases].sort((a, b) => Number(statusOf(a) === "closed") - Number(statusOf(b) === "closed") || b.atStake - a.atStake);
  const shown = everything ? rows : rows.slice(0, TOP);
  const openValue = sum(open, (i) => i.exposure);
  const period = days === 7 ? "in the 7 days before" : "in the 30 days before";
  const story = data.story;
  const storyCase = story ? cases.get(story.caseId) : undefined;
  const unlisted = data.unlisted.period + data.unlisted.trend + data.unlisted.before > 0;
  const ln = data.lastNight;
  const compared = data.outlets.map((o) => o.outletId);
  const outlet = picked && compared.includes(picked) ? picked : compared[0];
  const chart = data.outletTrend.filter((x) => x.outletId === outlet).slice(-days);
  const belowShown = allDays ? data.belowDays : data.belowDays.slice(0, DAYS_TOP);
  const R = data.rules;
  const nightsIn = (n: number) => fmtNum(Math.round(n / days));

  return (
    <div className="space-y-6">
      <SummaryBar
        items={[
          { label: "In house last night", value: guests(ln.guests), compare: { text: `${rooms(ln.rooms)}, ${fmtPct(ln.occupancy, 0)} occupied`, good: null }, note: `${guests(ln.guestsWithBreakfast)} on a rate with breakfast`, onClick: () => scrollTo("guests-rates") },
          ...(data.breakfastOutlet ? [
            { label: "Breakfast guests covered", value: t.guests ? floorPct(covered / t.guests) : "None", compare: t.guests && data.before?.guests ? shareVersus(covered / t.guests, (data.before.included + data.before.charged + data.before.paid) / data.before.guests, period) : undefined, note: `${fmtNum(covered)} of ${guests(t.guests)}: in the rate, charged or paid`, onClick: () => scrollTo("guests-breakfast") },
            { label: "Breakfasts not charged", value: fmtNum(t.notCharged), tone: t.notCharged ? "warn" as const : "pos" as const, compare: data.before ? versus(t.notCharged, data.before.notCharged, "down", period) : undefined, note: t.notCharged ? `${rooms(t.notChargedRooms)}, ${money(t.value)} at the breakfast price` : "Every breakfast was in the rate or charged", onClick: () => scrollTo("guests-list") },
            { label: "Open to check", value: money(openValue), tone: "money" as const, compare: { text: `${open.length} open ${open.length === 1 ? "flag" : "flags"}, until checked`, good: null }, href: "/money?tab=flags&type=breakfast_not_charged&status=open" },
          ] : []),
        ]}
        trend={data.breakfastOutlet ? (
          <StripTrend
            goodWhen="down"
            title="Breakfasts not charged, 30 days"
            points={data.trend.map((d) => ({ date: d.date, value: d.notCharged }))}
            format={(n) => fmtNum(n)}
            note="by the morning"
            explain="Guests ticked in at breakfast whose rate does not include it, with no breakfast charged to the room or paid at the table."
            series={[
              { id: "guests", label: "Guests at breakfast", axis: "guests", goodWhen: "none", format: (n) => fmtNum(n), points: data.trend.map((d) => ({ date: d.date, value: d.guests })), explain: "Guests of the rooms the host ticked in." },
              { id: "included", label: "Breakfast in the rate", axis: "guests", goodWhen: "none", format: (n) => fmtNum(n), points: data.trend.map((d) => ({ date: d.date, value: d.included })), explain: "Of those, guests whose room rate includes breakfast. Never flagged." },
              { id: "inhouse", label: "In house the night before", axis: "guests", goodWhen: "none", format: (n) => fmtNum(n), points: data.trend.map((d) => ({ date: d.date, value: d.inHouse })), explain: "Guests on the PMS in-house list the night before." },
            ]}
            summary={`Breakfasts not charged, per morning for the last 30 mornings. ${fmtNum(t.notCharged)} in the period shown.`}
            footer={`${breakfasts(sum(data.trend, (d) => d.notCharged))} not charged in 30 mornings`}
          />
        ) : undefined}
        action={open.length > 0 ? <Link prefetch={false} href="/money?tab=flags&type=breakfast_not_charged&status=open" className={linkButton("primary")}>Review {open.length} open</Link> : undefined}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Segmented size="sm" label="Period" value={String(days) as "7" | "30"} onChange={(v) => setParam({ days: v === "30" ? null : v })} options={[{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }]} />
        <span className="text-[13px] text-steel">Breakfast {fmtDate(data.from)} to this morning. Outlet sales {fmtDate(data.outletFrom)} to last night, whole days.</span>
        {unlisted && <span className="w-full text-[13px] text-steel">{data.unlisted.period + data.unlisted.before === 0 ? "Checked rooms not in this demo’s list of flags are left out of the 30 day trend." : `Checked rooms not in this demo’s list of flags are left out of these figures${data.before ? "." : ", so the period before is not compared."}`}</span>}
      </div>

      {story && (
        <Section id="guests.example" forceOpen={params.get("open") === "example"} title="Worked example: a breakfast not charged" summary={`This morning at ${outletLabel(story.outletId)}. How one flag is found, step by step.`}>
          <Panel title={`This morning at ${outletLabel(story.outletId)}: room ${story.room}, breakfast not charged`} description="A worked example of what Tyll looks for. The room below is on this morning's breakfast list." action={storyCase && <Badge tone={storyCase.status === "closed" ? "neutral" : "warn"}>{STATUS_LABEL[storyCase.status]}</Badge>}>
            <ol className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                [fmtTime(story.min), `Room ${story.room} ticked in at breakfast`, `${guests(story.guests)}, on the breakfast list`],
                ["Last night", rateName(story.rate), story.included > 0 ? `From the PMS: breakfast in the rate for ${guests(story.included)}` : "From the PMS: breakfast is not in the rate"],
                [`${fmtTime(story.from)} to ${fmtTime(story.to)}`, `No breakfast charged to room ${story.room}`, "And no breakfast bill paid at the table near the time"],
                ["Tonight", story.staysOn ? `Room ${story.room} is still in house` : `Room ${story.room} has checked out`, `About ${money(story.value)} at the breakfast price${story.staysOn ? ", it can go on the room before check-out" : ""}`],
              ].map(([time, title, detail], i) => (
                <li key={i} className={cn("relative rounded-2xl border p-4", i === 2 ? "border-warn/40 bg-warn-soft" : "border-line")}>
                  <p className="num text-[13px] text-steel">{time}</p>
                  <p className="mt-1 text-[15px] leading-snug text-ink">{title}</p>
                  {detail && <p className="mt-1 text-xs text-steel">{detail}</p>}
                </li>
              ))}
            </ol>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-[70ch] text-sm text-graphite">Tyll flags a room ticked in at breakfast whose guests the room rate does not cover, with nothing charged to the room or paid at the table. Rooms whose rate includes breakfast are never flagged. It does not conclude why. The case shows the rate, the bills around the time and what to check.</p>
              {storyCase && <Button onClick={() => router.push(`/investigations/${story.caseId}`)}>Open the investigation <ArrowRight size={15} className="rtl:rotate-180" /></Button>}
            </div>
          </Panel>
        </Section>
      )}

      {data.breakfastOutlet ? (
        <>
          <div id="guests-breakfast" className="grid scroll-mt-24 grid-cols-1 gap-5 lg:grid-cols-[1.6fr_1fr] [&>*]:min-w-0">
            <Panel title="Breakfast guests, and how each was covered" description={`${guests(t.guests)} from ${rooms(t.rooms)} at breakfast at ${outletLabel(data.breakfastOutlet)} in the last ${days} mornings.`}>
              <BarList
                format={(n) => fmtNum(n)}
                tone="warn"
                rows={[
                  { key: "included", label: "In the room rate", sub: "never flagged", value: t.included, muted: true },
                  { key: "charged", label: "Charged to the room", value: t.charged, muted: true },
                  { key: "paid", label: "Paid at the table", value: t.paid, muted: true },
                  { key: "not", label: "Not charged", sub: t.notCharged ? `${rooms(t.notChargedRooms)}, ${money(t.value)}` : undefined, value: t.notCharged, onClick: t.notCharged ? () => scrollTo("guests-list") : undefined },
                ]}
              />
              <Note className="mt-3">Grey: covered, not flagged. The rest is to check. In-Room Dining breakfasts are on their own bills, in the room charge check.</Note>
            </Panel>
            <Panel title="What Tyll checks" description="Rules agreed with the hotel. A breakfast not charged is a prompt to check, not proof of anyone's mistake.">
              <ul className="space-y-3 text-sm text-graphite">
                <li>Each room the breakfast host ticks in is read against last night&rsquo;s in-house list in the PMS: the rate, and the guests registered.</li>
                <li>Breakfast in the rate covers every registered guest, so those guests are never flagged. A guest beyond them is to charge.</li>
                <li>{`To charge is covered by breakfasts on a bill charged to the room that morning, or by breakfast bills paid at the table from ${R.paidBefore} minutes before the tick to ${R.paidAfter} minutes after, each bill counted for one room only.`}</li>
                <li>Whatever is left is flagged, at the breakfast price that morning.</li>
              </ul>
            </Panel>
          </div>

          <div id="guests-list" className="scroll-mt-24">
            <Panel title="Rooms to check" description="Open first, largest amount first. Checked ones follow." action={<Link prefetch={false} href="/money?tab=flags&type=breakfast_not_charged&status=all" className="flex items-center gap-1 text-[13px] text-steel hover:text-ink">Flagged cases <ArrowRight size={14} className="rtl:rotate-180" /></Link>} flush>
              {rows.length === 0 ? <div className="px-5 pb-6 sm:px-6"><EmptyState title="Every breakfast in this period was in the rate or charged" /></div> : (
                <>
                  <ul className="divide-y divide-hair border-t border-hair">
                    {shown.map((r) => {
                      const st = statusOf(r);
                      return (
                        <li key={r.caseId}>
                          <Link prefetch={false} href={`/investigations/${r.caseId}`} className="flex flex-col gap-1.5 px-5 py-3.5 transition-colors duration-150 hover:bg-cloud sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-6">
                            <span className="min-w-0">
                              <span className="block text-sm text-ink">{r.headline}</span>
                              <span className="block text-xs text-steel">{rateName(r.rate)} · {fmtDate(r.date)}, {fmtTime(r.min)}</span>
                            </span>
                            <span className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
                              <Badge tone={st === "closed" ? "neutral" : st === "new" ? "warn" : "ink"}>{st === "closed" ? "Checked" : STATUS_LABEL[st]}</Badge>
                              <span className="num text-sm font-medium text-ink">{money(r.atStake)}</span>
                              <span className={textLink}>{st === "closed" ? "View" : "Review"}</span>
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                  {rows.length > TOP && <div className="border-t border-hair px-6 py-3"><button type="button" onClick={() => setEverything((v) => !v)} className={textLink}>{everything ? "Show the five largest" : `Show all ${rows.length} rooms`}</button></div>}
                </>
              )}
            </Panel>
          </div>
        </>
      ) : (
        canSeeOutlet(user, R.breakfastOutletId)
          ? <EmptyState title={`Breakfast is served at ${outletLabel(R.breakfastOutletId)}`}>{`Choose ${outletLabel(R.breakfastOutletId)} in the outlet selector to see the breakfast list against the rooms’ rates. Outlet sales against the guests in house are below.`}</EmptyState>
          : <EmptyState title={`Breakfast is checked at ${outletLabel(R.breakfastOutletId)}`}>Outlet sales against the guests in house are below.</EmptyState>
      )}

      {compared.length > 0 && (
        <div id="guests-outlets" className="scroll-mt-24">
          <Panel
            title="Outlet sales against the guests in house"
            description={`Each day's sales against what the guests in house usually spend there: the guests that night times the outlet's sales per guest on the same weekday in the ${R.usualWeeks} weeks before. An estimate.`}
            action={compared.length > 1 ? <Segmented size="sm" label="Outlet" value={outlet} onChange={setPicked} options={compared.map((id) => ({ value: id, label: outletLabel(id) }))} /> : undefined}
          >
            <TrendChart
              data={chart.map((d) => ({ label: fmtDate(d.date), now: Math.round(d.sales), before: d.expected === null ? null : Math.round(d.expected) }))}
              format={(n) => money(n)}
              nowLabel="Sales"
              beforeLabel="Usual for the guests in house"
              height={240}
              summary={`${outletLabel(outlet)}: sales per day for the last ${days} days against what the guests in house usually spend there.`}
            />
            <ul className="mt-4 divide-y divide-hair border-t border-hair text-sm">
              {data.outlets.map((o) => {
                const per = o.guestNights ? o.sales / o.guestNights : 0;
                const perBefore = o.guestNightsBefore ? o.salesBefore / o.guestNightsBefore : 0;
                return (
                  <li key={o.outletId} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
                    <span className="min-w-0">
                      <span className="block text-ink">{outletLabel(o.outletId)}</span>
                      <span className="block text-xs text-steel"><span>{`${money(per)} per guest in house a night`}</span>. <span>{versus(per, perBefore, "up", period).text}</span>. <span>{`${fmtPct(o.sales ? o.toRooms / o.sales : 0, 0)} charged to rooms`}</span>.</span>
                    </span>
                    <span className="self-start sm:self-auto">{o.below ? <Badge tone="warn">{o.below} {o.below === 1 ? "day" : "days"} to look at</Badge> : <Badge tone="pos">Moves with the guests in house</Badge>}</span>
                  </li>
                );
              })}
            </ul>
            {data.belowDays.length > 0 && (
              <div className="mt-2 border-t border-hair pt-3">
                <p className="text-[13px] text-steel">{`Days to look at: sales more than ${Math.round(R.belowShare * 100)}% and ${money(R.belowMin)} below what the guests in house usually spend. A prompt to check the day's bills and room charges, not a loss.`}</p>
                <ul className="mt-2 divide-y divide-hair">
                  {belowShown.map((d) => (
                    <li key={`${d.outletId}-${d.date}`} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                      <span className="min-w-0 text-sm text-ink">{`${outletLabel(d.outletId)}, ${fmtDate(d.date, true)}: ${money(d.sales)} against about ${money(d.expected ?? 0)} for ${guests(d.guests)} in house`}</span>
                      <Link prefetch={false} href={`/money?tab=orders&date=${d.date}&outlet=${d.outletId}&from=guests`} className={cn(textLink, "shrink-0")}>See the bills</Link>
                    </li>
                  ))}
                </ul>
                {data.belowDays.length > DAYS_TOP && <button type="button" onClick={() => setAllDays((v) => !v)} className={cn(textLink, "mt-2")}>{allDays ? "Show the three largest" : `Show all ${data.belowDays.length} days`}</button>}
              </div>
            )}
            <Note className="mt-3">Banquets and Events sells to event guests, so its sales follow the events, not the guests in house.</Note>
          </Panel>
        </div>
      )}

      <div id="guests-rates" className="scroll-mt-24">
        <Section id="guests.rates" forceOpen={params.get("open") === "rates"} flush title="Rooms by rate" summary={`${fmtNum(ln.withBreakfast)} of ${rooms(ln.rooms)} last night on a rate with breakfast. Tyll never flags their registered guests.`}>
          <ul className="divide-y divide-hair sm:hidden">
            {data.rates.map((r) => (
              <li key={r.code} className="px-5 py-3.5">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm text-ink">{r.name}</p>
                  {r.breakfast ? <Badge tone="pos">Breakfast in the rate</Badge> : <Badge>Room only</Badge>}
                </div>
                <p className="num mt-1 text-xs text-steel">{`${nightsIn(r.rooms)} rooms and ${nightsIn(r.guests)} guests a night, ${guests(r.atBreakfast)} at breakfast${r.notCharged ? `, ${fmtNum(r.notCharged)} not charged` : ""}`}</p>
              </li>
            ))}
          </ul>
          <TableWrap className="hidden sm:block">
            <table className="w-full min-w-[720px] text-sm">
              <thead><tr><Th>Rate</Th><Th>Breakfast</Th><Th align="right">Rooms a night</Th><Th align="right">Guests a night</Th><Th align="right">At breakfast</Th><Th align="right">Not charged</Th></tr></thead>
              <tbody>
                {data.rates.map((r) => (
                  <tr key={r.code} className={rowClass}>
                    <Td className="text-ink">{r.name}</Td>
                    <Td>{r.breakfast ? <Badge tone="pos">In the rate</Badge> : <Badge>Not included</Badge>}</Td>
                    <Td align="right">{nightsIn(r.rooms)}</Td>
                    <Td align="right">{nightsIn(r.guests)}</Td>
                    <Td align="right">{fmtNum(r.atBreakfast)}</Td>
                    <Td align="right" className={cn(r.notCharged ? "font-medium text-ink" : "text-graphite")}>{r.notCharged ? fmtNum(r.notCharged) : "None"}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <div className="px-5 py-3 sm:px-6"><Note>{`Averages over the ${days} nights before each morning. A guest beyond those registered on a rate with breakfast is counted as not included. The in-house list, the breakfast list and the bills are simulated.`}</Note></div>
        </Section>
      </div>
    </div>
  );
}
