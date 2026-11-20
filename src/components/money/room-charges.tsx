"use client";
// Room charge check: did every bill charged to a room reach the guest's folio, on the right room, for the right amount,
// before the guest left? The figures come from the server (/api/money/rooms); the case states come from the flags, so the
// open count here is the same as on the Money Back List.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { useMemo, useState } from "react";
import { BarList, StripTrend } from "@/components/charts";
import { Section } from "@/components/disclosure";
import { Badge, Button, EmptyState, Note, Panel, Skeleton, SummaryBar, TableWrap, Td, Th, WidgetError, cn, linkButton, rowClass, textLink } from "@/components/ui";
import { outletLabel } from "@/lib/data/catalog";
import { POLICY, ROOM_STATUS_TYPE, ROOM_TYPES, TYPE_LABEL } from "@/lib/domain/detect";
import { exceptionInSel } from "@/lib/domain/metrics";
import { ROOM_STATUS_LABEL } from "@/lib/domain/room-charges";
import { useApi, useInvestigations, useView } from "@/lib/hooks";
import { SOURCE_LABEL, STATUS_LABEL } from "@/lib/labels";
import type { RoomCheck, RoomCheckRow } from "@/lib/server/room-charges";
import { fmtDate, fmtMoney, fmtNum, fmtPct, fmtRange, fmtTime, sum } from "@/lib/util";

const TOP = 5;
const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" });

export function RoomChargeCheck() {
  const router = useRouter();
  // ?open=example opens the worked example, for a guided demo or a link from a call.
  const openExample = useSearchParams().get("open") === "example";
  const { sel, money } = useView();
  const all = useInvestigations();
  const [everything, setEverything] = useState(false);
  const url = `/api/money/rooms?from=${sel.range.from}&to=${sel.range.to}&outlets=${sel.outletIds.join(",")}&whole=${sel.wholeProperties.join(",")}`;
  const { data, error } = useApi<RoomCheck>(url);
  const cases = useMemo(() => new Map(all.map((i) => [i.id, i])), [all]);
  // Open flags of every room charge type in view, whatever the period: the same list as the Money Back List.
  const open = useMemo(() => all.filter((i) => ROOM_TYPES.includes(i.type) && i.status !== "closed" && exceptionInSel(i, sel)), [all, sel]);

  if (error) return <WidgetError>The room charge check could not load.</WidgetError>;
  if (!data) return <Skeleton className="h-72 w-full" />;
  const s = data.summary;
  const statusOf = (r: RoomCheckRow) => cases.get(r.caseId)?.status ?? r.seedStatus;
  const rows = [...data.rows].sort((a, b) => Number(statusOf(a) === "closed") - Number(statusOf(b) === "closed") || b.atStake - a.atStake);
  const shown = everything ? rows : rows.slice(0, TOP);
  const openValue = sum(open, (i) => i.exposure);
  const reasons = s.byStatus.filter((x) => x.status !== "matched" && x.n > 0).sort((a, b) => b.value - a.value);
  const story = data.story;
  const storyCase = story ? cases.get(story.caseId) : undefined;

  return (
    <div className="space-y-6">
      <SummaryBar
        items={[
          { label: "Charges checked", value: fmtNum(s.checked), compare: { text: `${money(s.charged)} charged to rooms`, good: null }, onClick: () => scrollTo("rooms-sources") },
          { label: "Posted correctly", value: s.checked ? fmtPct(s.matched / s.checked, 1) : "None", tone: "pos", compare: { text: `${fmtNum(s.matched)} of ${fmtNum(s.checked)} charges`, good: null }, onClick: () => scrollTo("rooms-sources") },
          { label: "Not matched", value: fmtNum(s.mismatched), tone: s.mismatched ? "warn" : "pos", compare: { text: s.mismatched ? `${money(s.atStake)} involved` : "Every charge reached the right bill", good: s.mismatched ? false : true }, onClick: () => scrollTo("rooms-list") },
          { label: "Open to check", value: money(openValue), tone: "money", compare: { text: `${open.length} open ${open.length === 1 ? "flag" : "flags"}, until checked`, good: null }, href: "/investigations?type=room&status=open" },
        ]}
        trend={
          <StripTrend
            goodWhen="down"
            title="Not matched per day, 30 days"
            points={data.days.map((d) => ({ date: d.date, value: d.value }))}
            format={(n) => money(n)}
            note="by the day of the charge"
            explain="Money on charges that did not match the guest bill, by the day the charge was made."
            series={[
              { id: "count", label: "Charges not matched", axis: "count", goodWhen: "down", format: (n) => fmtNum(n), points: data.days.map((d) => ({ date: d.date, value: d.mismatched })), explain: "How many charges did not match the guest bill each day." },
              { id: "checked", label: "Charges checked", axis: "checked", goodWhen: "none", format: (n) => fmtNum(n), points: data.days.map((d) => ({ date: d.date, value: d.checked })), explain: "Every charge to a room, matched or not." },
            ]}
            summary={`Value of room charges that did not match the guest bill, per day for the last 30 days. ${s.mismatched} of ${s.checked} charges did not match in the selected period.`}
          />
        }
        action={open.length > 0 ? <Link prefetch={false} href="/investigations?type=room&status=open" className={linkButton("primary")}>Review {open.length} open</Link> : undefined}
      />

      {story && (
        <Section id="rooms.example" forceOpen={openExample} title="Worked example: a dinner posted to the wrong room" summary="Last night at Mercado. How one difference is found, step by step.">
          <Panel title={`Last night at ${outletLabel(story.outletId)}: a dinner on another guest's bill`} description="A worked example of what Tyll looks for. The bill below is in last night's records." action={storyCase && <Badge tone={storyCase.status === "closed" ? "neutral" : "warn"}>{STATUS_LABEL[storyCase.status]}</Badge>}>
            <ol className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                [fmtTime(story.signedMin), `${story.covers} guests sign their dinner bill to room ${story.room}`, `${money(story.amount)}, check ${story.orderId}`],
                [fmtTime(story.postedMin), "The till sends the charge to the guest folio", `It lands on the bill of room ${story.folioRoom}`],
                [fmtTime(story.checkoutMin), `This morning, room ${story.room} checks out`, "The bill is settled without the dinner"],
                ["Today", "Tyll matches the check number on the folio", "Same check, same amount, a different room"],
              ].map(([time, title, detail], i) => (
                <li key={i} className={cn("relative rounded-2xl border p-4", i === 1 ? "border-warn/40 bg-warn-soft" : "border-line")}>
                  <p className="num text-[13px] text-steel">{time}</p>
                  <p className="mt-1 text-[15px] leading-snug text-ink">{title}</p>
                  <p className="mt-1 text-xs text-steel">{detail}</p>
                </li>
              ))}
            </ol>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-[70ch] text-sm text-graphite">Tyll flags that the bill was signed to room {story.room} and posted to room {story.folioRoom}. It does not conclude why. The case shows both sides and what to check: move the charge before room {story.folioRoom} checks out, and collect it from room {story.room}&rsquo;s card on file.</p>
              {storyCase && <Button onClick={() => router.push(`/investigations/${story.caseId}`)}>Open the investigation <ArrowRight size={15} className="rtl:rotate-180" /></Button>}
            </div>
          </Panel>
        </Section>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 [&>*]:min-w-0">
        <Panel title="Why charges did not match" description={`${fmtRange(sel.range)}. Value involved. Choose a reason to see its cases.`}>
          {reasons.length === 0 ? <EmptyState title="Every charge in this period reached the right bill" /> : (
            <BarList format={(n) => money(n)} rows={reasons.map((r) => ({ key: r.status, label: ROOM_STATUS_LABEL[r.status], sub: `${r.n} ${r.n === 1 ? "charge" : "charges"}`, value: r.value, onClick: () => router.push(`/investigations?type=${ROOM_STATUS_TYPE[r.status as keyof typeof ROOM_STATUS_TYPE]}&status=all`) }))} />
          )}
        </Panel>
        <Panel title="What Tyll checks" description="Each charge is matched to the folio line with the same check number. A difference is a prompt to check the folio, not proof of anyone's mistake.">
          <ul className="space-y-3 text-sm text-graphite">
            <li>A charge to a room with no matching line on the guest bill.</li>
            <li>A folio line for a different amount, beyond {fmtMoney(POLICY.roomChargeTolerance, "EUR", { decimals: true })} of rounding.</li>
            <li>The same charge posted more than once.</li>
            <li>A folio line on a different room from the one the bill was signed to.</li>
            <li>A posting that reached the bill after the guest had checked out.</li>
          </ul>
        </Panel>
      </div>

      <div id="rooms-list" className="scroll-mt-24">
        <Panel title="Charges to check" description="Open first, largest amount first. Checked ones follow." action={<Link prefetch={false} href="/investigations?type=room&status=all" className="flex items-center gap-1 text-[13px] text-steel hover:text-ink">Money Back List <ArrowRight size={14} className="rtl:rotate-180" /></Link>} flush>
          {rows.length === 0 ? <div className="px-5 pb-6 sm:px-6"><EmptyState title="Every charge in this period reached the right bill" /></div> : (
            <>
              {/* Phones get one card per charge, so the amount, status and action are never off screen. */}
              <ul className="divide-y divide-hair border-t border-hair sm:hidden">
                {shown.map((r) => {
                  const st = statusOf(r);
                  const visible = cases.has(r.caseId);
                  return (
                    <li key={r.chargeId} className="px-5 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <p className="min-w-0 text-sm text-ink">{r.headline}</p>
                        <span className="num shrink-0 text-sm font-medium text-ink">{money(r.atStake)}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-steel">{r.outletId ? r.where : SOURCE_LABEL[r.source]} · {fmtDate(r.date)}, {fmtTime(r.min)}</p>
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <Badge tone={st === "closed" ? "neutral" : st === "new" ? "warn" : "ink"}>{st === "closed" ? "Checked" : STATUS_LABEL[st]}</Badge>
                        {visible && <Link prefetch={false} href={`/investigations/${r.caseId}`} className={textLink}>{st === "closed" ? "View" : "Review"} <ArrowRight size={14} className="rtl:rotate-180" /></Link>}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <TableWrap className="hidden sm:block">
                <table className="w-full min-w-[820px] text-sm">
                  <thead><tr><Th>What Tyll found</Th><Th>Where</Th><Th>When</Th><Th align="right">Value involved</Th><Th>Status</Th><Th><span className="sr-only">Action</span></Th></tr></thead>
                  <tbody>
                    {shown.map((r) => {
                      const st = statusOf(r);
                      const visible = cases.has(r.caseId);
                      return (
                        <tr key={r.chargeId} className={cn(rowClass, visible && "cursor-pointer")} onClick={visible ? () => router.push(`/investigations/${r.caseId}`) : undefined}>
                          <Td><span className="text-ink">{r.headline}</span><span className="mt-0.5 block text-xs text-steel">{TYPE_LABEL[ROOM_STATUS_TYPE[r.status]]}</span><span className="mt-0.5 line-clamp-2 block max-w-[460px] text-xs text-graphite">{r.comparedWith}</span></Td>
                          <Td>{r.outletId ? r.where : SOURCE_LABEL[r.source]}</Td>
                          <Td className="num whitespace-nowrap text-graphite">{fmtDate(r.date)}, {fmtTime(r.min)}</Td>
                          <Td align="right" className="font-medium text-ink">{money(r.atStake)}</Td>
                          <Td><Badge tone={st === "closed" ? "neutral" : st === "new" ? "warn" : "ink"}>{st === "closed" ? "Checked" : STATUS_LABEL[st]}</Badge></Td>
                          <Td align="right">{visible && <Link prefetch={false} href={`/investigations/${r.caseId}`} className={textLink} onClick={(e) => e.stopPropagation()}>{st === "closed" ? "View" : "Review"}</Link>}</Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableWrap>
              {rows.length > TOP && <div className="border-t border-hair px-6 py-3"><button type="button" onClick={() => setEverything((v) => !v)} className={textLink}>{everything ? "Show the five largest" : `Show all ${rows.length} charges`}</button></div>}
            </>
          )}
        </Panel>
      </div>

      <div id="rooms-sources" className="scroll-mt-24">
        <Section id="rooms.sources" flush title="By source" summary={`${fmtNum(s.checked)} charges from outlet tills, room service, minibar, spa and laundry. ${money(data.outletSales)} of it is outlet sales, counted once.`}>
          {data.bySource.length === 0 ? <div className="p-6"><EmptyState title="No room charges in this selection">Minibar, spa and laundry charges belong to the whole hotel. Choose all outlets to see them.</EmptyState></div> : (
            <TableWrap>
              <table className="w-full min-w-[900px] text-sm">
                <thead><tr><Th>Source</Th><Th align="right">Charges</Th><Th align="right">Charged</Th><Th align="right">Posted</Th><Th align="right">Posted correctly</Th><Th align="right">Missing</Th><Th align="right">Different amount</Th><Th align="right">Posted more than once</Th><Th align="right">Wrong room</Th><Th align="right">After check-out</Th></tr></thead>
                <tbody>
                  {data.bySource.map((r) => (
                    <tr key={r.source} className={rowClass}>
                      <Td className="text-ink">{SOURCE_LABEL[r.source]}</Td>
                      <Td align="right">{fmtNum(r.n)}</Td>
                      <Td align="right">{money(r.charged)}</Td>
                      <Td align="right">{money(r.posted)}</Td>
                      <Td align="right">{fmtNum(r.counts.matched)}</Td>
                      {(["missing", "wrong_amount", "duplicate", "wrong_room", "after_checkout"] as const).map((k) => <Td key={k} align="right" className={cn(r.counts[k] > 0 && "font-medium text-ink")}>{r.counts[k] || "None"}</Td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
          <div className="space-y-2 px-6 py-4">
            <Note className="max-w-[95ch]">Revenue is counted once. Restaurant and room service charges are already inside outlet sales; posting them to a room moves them to the guest bill, and settling the bill at check-out clears it. Neither step adds revenue.</Note>
            <Note className="max-w-[95ch]">Guest folios, room numbers and check-out times are simulated, as is the PMS they come from. Minibar, spa and laundry postings cover the last 21 days. Room-damage charge verification is planned and not part of this demo.</Note>
          </div>
        </Section>
      </div>
    </div>
  );
}
