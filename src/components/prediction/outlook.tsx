"use client";
// Tomorrow and the next seven days: guests per outlet, what to prep, and what the figures are based on.
// What to order lives on Stock, so it is only linked from here.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Delta, EmptyState, KeyNumber, KeyNumbers, Panel, Segmented, Skeleton, StatusPill, TableWrap, Td, Th, WidgetError, cn, linkButton, rowClass } from "@/components/ui";
import { itemById, outletById } from "@/lib/data/catalog";
import { allowedProperties, can } from "@/lib/domain/access";
import { useView } from "@/lib/hooks";
import { useOutlook } from "@/lib/plan-hooks";
import { DEMO_TODAY, addDays, fmtDate, fmtNum, fmtPct, pctChange } from "@/lib/util";

type When = "tomorrow" | "7";
const CONF = { high: { rag: "green", word: "High" }, medium: { rag: "amber", word: "Medium" }, low: { rag: "red", word: "Low" } } as const;
const PAGE = 10;

export function Outlook() {
  const { user, sel, propertyId } = useView();
  const params = useSearchParams();
  const router = useRouter();
  const when: When = params.get("when") === "7" ? "7" : "tomorrow";
  const pid = propertyId ?? allowedProperties(user)[0] ?? null;
  const outletIds = useMemo(() => sel.outletIds.filter((o) => outletById[o].propertyId === pid), [sel.outletIds, pid]);
  const { data, error } = useOutlook(pid, outletIds, when);
  const o = data?.outlook;
  const [allPrep, setAllPrep] = useState(false);
  const change = o ? pctChange(o.guests.total, o.guests.usual) : null;
  const periodWords = when === "tomorrow" ? fmtDate(addDays(DEMO_TODAY, 1), true) : `${fmtDate(addDays(DEMO_TODAY, 1))} to ${fmtDate(addDays(DEMO_TODAY, 7))}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented size="sm" label="Look ahead" value={when} onChange={(v) => router.replace(v === "7" ? "/forecast?tab=outlook&when=7" : "/forecast?tab=outlook")} options={[{ value: "tomorrow", label: "Tomorrow" }, { value: "7", label: "Next 7 days" }]} />
        <p className="text-[13px] text-steel">{periodWords}. A prediction looks ahead, so the date range above does not change it.</p>
      </div>

      {error ? <WidgetError>The prediction could not load.</WidgetError> : !o ? (
        <KeyNumbers>{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}</KeyNumbers>
      ) : (
        <>
          <KeyNumbers>
            <KeyNumber label="Expected guests" value={fmtNum(o.guests.total)} delta={<Delta value={change} versus="than usual for these weekdays" />} note="vs usual" />
            <KeyNumber label="Already booked" value={fmtPct(o.confidence.bookedShare, 0)} note={`${fmtNum(o.guests.reservations + o.guests.eventGuests)} guests`} />
            <KeyNumber label="Hotel occupancy" value={fmtPct(o.occupancy, 0)} note={o.events.length ? `${o.events.length} event${o.events.length === 1 ? "" : "s"}` : "No events"} />
            <KeyNumber label="Confidence" value={CONF[o.confidence.level].word} tone={o.confidence.level === "high" ? "pos" : o.confidence.level === "medium" ? "warn" : "neg"} note={`Same weekdays moved about ${fmtPct(o.confidence.swing, 0)}`} />
          </KeyNumbers>

          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
            <Panel title="What to prep" description="Portions of food, based on the same expected guests." flush action={can(user, "prep.plan") ? <Link href="/forecast?tab=prep" className={cn(linkButton(), "h-9 text-[13px]")}>Plan the prep</Link> : undefined}>
              {o.prep.length === 0 ? <div className="px-4 pb-6 sm:px-6"><EmptyState title="Nothing to prep">No food is expected to sell in this period.</EmptyState></div> : (
                <>
                  <ul>
                    {(allPrep ? o.prep : o.prep.slice(0, PAGE)).map((p) => (
                      <li key={p.itemId} className="flex items-center justify-between gap-4 border-t border-hair px-4 py-2 text-table sm:px-6">
                        <span className="min-w-0 text-ink">{itemById[p.itemId].name}</span>
                        <span className="num shrink-0 text-ink">{fmtNum(p.portions)} <span className="text-xs text-steel">portions</span></span>
                      </li>
                    ))}
                  </ul>
                  {o.prep.length > PAGE && <div className="border-t border-hair px-4 py-3 sm:px-6"><button type="button" onClick={() => setAllPrep((v) => !v)} className="text-[13px] font-medium text-accent-ink underline-offset-4 hover:underline">{allPrep ? "Show fewer" : `Show all ${o.prep.length} dishes`}</button></div>}
                </>
              )}
            </Panel>

            <Panel title="Guests per outlet" flush>
              <TableWrap>
                <table className="w-full min-w-[480px] text-table">
                  <thead><tr><Th>Outlet</Th><Th align="right">Booked</Th><Th align="right">Walk ins</Th><Th align="right">Events</Th><Th align="right">Total</Th><Th align="right">Vs usual</Th></tr></thead>
                  <tbody>
                    {[...o.outlets].sort((a, b) => b.guests - a.guests).map((r) => (
                      <tr key={r.outletId} className={rowClass}>
                        <Td><span className="text-ink">{outletById[r.outletId].name}</span></Td>
                        <Td align="right">{fmtNum(r.reservations)}</Td>
                        <Td align="right">{fmtNum(r.walkIns)}</Td>
                        <Td align="right">{fmtNum(r.eventGuests)}</Td>
                        <Td align="right"><span className="font-medium text-ink">{fmtNum(r.guests)}</span></Td>
                        <Td align="right"><Delta value={pctChange(r.guests, r.usual)} versus="than usual" /></Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
              <p className="flex flex-wrap items-center gap-2 px-4 py-3 text-xs text-steel sm:px-6"><StatusPill rag={CONF[o.confidence.level].rag}>{CONF[o.confidence.level].word} confidence</StatusPill> Bookings come from the reservation book. Walk ins come from the same weekdays over the last 4 weeks.</p>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
