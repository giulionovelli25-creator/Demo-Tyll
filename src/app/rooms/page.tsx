"use client";
import Link from "next/link";
import { ArrowRight, Sparkles, Star } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Button, EmptyState, Note, PageHeader, Panel, Segmented, Select, Stat, TableWrap, Td, Th, cn, report, rowClass } from "@/components/ui";
import { propertyById } from "@/lib/data/catalog";
import { allowedProperties, can, hasWholeProperty } from "@/lib/domain/access";
import { ROOM_TYPES } from "@/lib/domain/detect";
import { assessArrival, roomReadyAt, type ArrivalRisk } from "@/lib/domain/operations";
import { useCtx, useInvestigations, useView } from "@/lib/hooks";
import { useDemo } from "@/lib/store";
import type { Room } from "@/lib/types";
import { DEMO_NOW_MIN, fmtTime } from "@/lib/util";

const RISK: Record<ArrivalRisk, { label: string; tone: "pos" | "warn" | "neg" | "neutral" }> = {
  ready: { label: "Room ready", tone: "pos" },
  ok: { label: "Ready in time", tone: "neutral" },
  tight: { label: "Tight", tone: "warn" },
  late: { label: "Guest will wait", tone: "neg" },
  waiting: { label: "Guest is waiting", tone: "neg" },
  blocked: { label: "Room unavailable", tone: "neg" },
};
const now = DEMO_NOW_MIN;
const inMinutes = (min: number) => {
  const d = Math.round(min - now);
  return d === 0 ? "now" : d > 0 ? `in ${d} min` : `${-d} min ago`;
};

export default function RoomsPage() {
  const { user, propertyId } = useView();
  const ctx = useCtx();
  const store = useDemo();
  const investigations = useInvestigations();
  const props = allowedProperties(user).filter((p) => hasWholeProperty(user, p));
  const [picked, setPicked] = useState(props[0]);
  const pid = propertyId && props.includes(propertyId) ? propertyId : picked;
  const mayManage = can(user, "rooms.manage");
  const [attendantFor, setAttendantFor] = useState<Record<string, string>>({});

  const rooms = useMemo(() => ctx.data.rooms.filter((r) => r.propertyId === pid).map((r) => ({ ...r, ...store.roomState[r.id] }) as Room), [ctx.data.rooms, pid, store.roomState]);
  const attendants = ctx.data.attendants.filter((a) => a.propertyId === pid);
  const arrivals = useMemo(
    () => ctx.data.arrivals.filter((a) => a.propertyId === pid).map((a) => ({ ...a, status: store.arrivalState[a.id] ?? a.status })).filter((a) => a.status !== "checked_in").map((a) => assessArrival(a, rooms.find((r) => r.number === a.room), now)).sort((a, b) => a.arrival.etaMin - b.arrival.etaMin),
    [ctx.data.arrivals, pid, store.arrivalState, rooms],
  );
  const requests = ctx.data.requests.filter((r) => r.propertyId === pid && !store.requestsDone[r.id]);

  if (!pid) return <EmptyState title="Rooms needs access to a whole hotel">Your account is limited to one outlet. A general manager or owner account can open this module.</EmptyState>;
  const property = propertyById[pid];
  const by = (s: Room["status"]) => rooms.filter((r) => r.status === s);
  const dirty = by("dirty").sort((a, b) => Number(b.priority) - Number(a.priority));
  const cleaning = by("cleaning");
  const ready = by("ready");
  const atRisk = arrivals.filter((a) => a.risk === "late" || a.risk === "waiting" || a.risk === "tight");
  const urgent = arrivals.find((a) => a.risk === "late") ?? arrivals.find((a) => a.risk === "waiting");
  const delayed = cleaning.filter((r) => now - (r.cleaningStartedMin ?? now) > r.cleanMinutes);
  const moneyAlerts = investigations.filter((i) => i.propertyId === pid && ROOM_TYPES.includes(i.type) && i.status !== "closed");
  const busy = (id: string) => cleaning.filter((r) => r.attendantId === id);
  const free = attendants.filter((a) => busy(a.id).length === 0);
  const name = (id?: string) => attendants.find((a) => a.id === id)?.name ?? "Unassigned";

  const prioritise = (room: Room) => report(store.updateRoom(room.id, { priority: true }), `Room ${room.number} prioritised. A second attendant is sent and the ready time is updated.`);
  const start = (room: Room) => {
    const attendantId = attendantFor[room.id] ?? free[0]?.id ?? attendants[0].id;
    report(store.updateRoom(room.id, { status: "cleaning", attendantId, cleaningStartedMin: now }), `${name(attendantId)} started room ${room.number}.`);
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Tyll Rooms" lead="Front office and housekeeping on one screen: who is arriving, which rooms are not ready, and which room to clean next so that no guest waits.">
        {props.length > 1 && !propertyId ? <Segmented label="Hotel" value={picked} onChange={setPicked} options={props.map((p) => ({ value: p, label: propertyById[p].name }))} /> : <Badge>{property.name}</Badge>}
        <Badge>Interactive preview, simulated rooms</Badge>
        <Badge tone="ink">{fmtTime(now)}</Badge>
      </PageHeader>

      {urgent && urgent.room && (
        <section className="rounded-panel border border-warn/35 bg-warn-soft px-6 py-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="max-w-[80ch]">
              <h2 className="text-lg text-ink">
                {urgent.risk === "waiting" ? `${urgent.arrival.guest} is waiting for room ${urgent.room.number}.` : `${urgent.arrival.guest} arrives ${inMinutes(urgent.arrival.etaMin)}. Room ${urgent.room.number} is still ${urgent.room.status === "cleaning" ? "being cleaned" : "waiting to be cleaned"}.`}
              </h2>
              <p className="mt-1 text-sm text-graphite">
                At the current pace the room is ready at {fmtTime(urgent.readyAt!)}, {Math.abs(Math.round(urgent.slack!))} minutes {urgent.risk === "waiting" ? "from the guest's arrival" : "after the guest arrives"}. Tyll recommends prioritising this room: with a second attendant it would be ready at about {fmtTime(roomReadyAt({ ...urgent.room, priority: true }, now)!)}.
              </p>
            </div>
            {mayManage ? <Button variant="primary" onClick={() => prioritise(urgent.room!)}><Sparkles size={15} /> Prioritise room {urgent.room.number}</Button> : <Badge>View only for your role</Badge>}
          </div>
        </section>
      )}

      <Panel title="Front office">
        <div className="grid grid-cols-2 gap-x-6 gap-y-6 md:grid-cols-4 xl:grid-cols-8">
          <Stat label="Arrivals still expected" value={arrivals.length} />
          <Stat label="Departures due" value={by("departure_due").length} />
          <Stat label="Rooms available" tone="pos" value={ready.length} />
          <Stat label="Guests waiting" tone={arrivals.some((a) => a.arrival.status === "waiting") ? "neg" : undefined} value={arrivals.filter((a) => a.arrival.status === "waiting").length} />
          <Stat label="Check-ins, next hour" value={arrivals.filter((a) => a.arrival.etaMin - now <= 60).length} sub="front desk workload" />
          <Stat label="Possible delays" tone={atRisk.length ? "warn" : undefined} value={atRisk.length} sub="room may not be ready" />
          <Stat label="Open guest requests" value={requests.length} />
          <div>
            <Link href="/money?tab=rooms" className="group -m-2 block rounded-xl p-2 hover:bg-mist">
              <span className="text-[13px] text-steel">Room charge alerts</span>
              <span className={cn("num mt-1 block text-[22px]", moneyAlerts.length > 0 && "text-warn")}>{moneyAlerts.length}</span>
              <span className="flex items-center gap-1 text-xs text-steel">open in Tyll Money <ArrowRight size={12} /></span>
            </Link>
          </div>
        </div>
      </Panel>

      <Panel title="Arrivals and their rooms" description="Each arrival is matched to its room's cleaning status. The ready time is the estimate housekeeping is working to." flush>
        {arrivals.length === 0 ? <div className="px-6 pb-6"><EmptyState title="Everyone expected has checked in" /></div> : (
          <TableWrap>
            <table className="w-full min-w-[900px] text-sm">
              <thead><tr><Th>Guest</Th><Th>Room</Th><Th>Arrives</Th><Th>Room status</Th><Th>Ready at</Th><Th>Outlook</Th><Th> </Th></tr></thead>
              <tbody>
                {arrivals.map(({ arrival, room, readyAt, slack, risk }) => (
                  <tr key={arrival.id} className={rowClass}>
                    <Td><span className="flex items-center gap-1.5 text-ink">{arrival.guest}{arrival.vip && <Star size={13} className="fill-ink" aria-label="VIP" />}</span></Td>
                    <Td className="num">{arrival.room}<span className="block text-xs text-steel">{room?.type}</span></Td>
                    <Td className="num">{fmtTime(arrival.etaMin)}<span className="block text-xs text-steel">{inMinutes(arrival.etaMin)}</span></Td>
                    <Td>{room ? ({ ready: "Ready", cleaning: `Being cleaned by ${name(room.attendantId)}`, dirty: "Waiting to be cleaned", occupied: "Occupied", departure_due: "Guest not yet departed", out_of_order: "Out of order" } as const)[room.status] : "–"}{room?.priority && room.status !== "ready" && <Badge tone="ink" className="ml-2 !py-0">priority</Badge>}</Td>
                    <Td className="num">{room?.status === "ready" ? "Now" : readyAt ? fmtTime(readyAt) : "–"}{slack !== null && room?.status !== "ready" && <span className="block text-xs text-steel">{slack >= 0 ? `${Math.round(slack)} min to spare` : `${Math.round(-slack)} min short`}</span>}</Td>
                    <Td><Badge tone={RISK[risk].tone}>{RISK[risk].label}</Badge></Td>
                    <Td align="right">
                      {mayManage && room && (room.status === "ready"
                        ? <Button size="sm" onClick={() => { if (report(store.setArrivalStatus(arrival.id, "checked_in"), `${arrival.guest} checked in to room ${room.number}.`)) store.updateRoom(room.id, { status: "occupied" }); }}>Check in</Button>
                        : (risk === "late" || risk === "waiting" || risk === "tight") && !room.priority && (room.status === "cleaning" || room.status === "dirty")
                          ? <Button size="sm" onClick={() => prioritise(room)}>Prioritise</Button>
                          : null)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-3">
        <Panel title={`Waiting to be cleaned, ${dirty.length}`} description="Priority rooms first.">
          {dirty.length === 0 ? <p className="text-sm text-steel">No rooms are waiting.</p> : (
            <ul className="space-y-2">
              {dirty.map((r) => {
                const arriving = arrivals.find((a) => a.arrival.room === r.number);
                return (
                  <li key={r.id} className={cn("rounded-2xl border p-3", r.priority ? "border-ink" : "border-line")}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="num text-[15px] text-ink">{r.number}<span className="ml-2 text-xs text-steel">{r.type}</span></span>
                      {r.priority && <Badge tone="ink">Priority</Badge>}
                    </div>
                    <p className="num mt-1 text-xs text-steel">{arriving ? `Guest arrives ${fmtTime(arriving.arrival.etaMin)} · ` : ""}ready about {fmtTime(roomReadyAt(r, now)!)}</p>
                    {mayManage && (
                      <div className="mt-2.5 flex flex-wrap items-center gap-2">
                        <Select label={`Attendant for room ${r.number}`} hideLabel className="min-w-[130px] flex-1" value={attendantFor[r.id] ?? free[0]?.id ?? attendants[0].id} onChange={(e) => setAttendantFor((x) => ({ ...x, [r.id]: e.target.value }))}>
                          {attendants.map((a) => <option key={a.id} value={a.id}>{a.name}{busy(a.id).length ? ` (on ${busy(a.id).map((x) => x.number).join(", ")})` : ""}</option>)}
                        </Select>
                        <Button size="sm" variant="primary" onClick={() => start(r)}>Start</Button>
                        {!r.priority && <Button size="sm" variant="ghost" onClick={() => prioritise(r)}>Prioritise</Button>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title={`Being cleaned, ${cleaning.length}`} description={delayed.length ? `${delayed.length} running past the standard time.` : "All within the standard time."}>
          {cleaning.length === 0 ? <p className="text-sm text-steel">No rooms are being cleaned.</p> : (
            <ul className="space-y-2">
              {cleaning.map((r) => {
                const elapsed = now - (r.cleaningStartedMin ?? now);
                const over = elapsed > r.cleanMinutes;
                return (
                  <li key={r.id} className={cn("rounded-2xl border p-3", over ? "border-warn/50" : r.priority ? "border-ink" : "border-line")}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="num text-[15px] text-ink">{r.number}<span className="ml-2 text-xs text-steel">{r.type}</span></span>
                      {over ? <Badge tone="warn">Delayed</Badge> : r.priority ? <Badge tone="ink">Priority</Badge> : null}
                    </div>
                    <p className="num mt-1 text-xs text-steel">{name(r.attendantId)}{r.priority ? " and a second attendant" : ""} · started {Math.round(elapsed)} min ago · ready about {fmtTime(roomReadyAt(r, now)!)}</p>
                    {mayManage && (
                      <div className="mt-2.5 flex gap-2">
                        <Button size="sm" variant="primary" onClick={() => report(store.updateRoom(r.id, { status: "ready", priority: false }), `Room ${r.number} is ready for a guest.`)}>Mark ready</Button>
                        {!r.priority && <Button size="sm" variant="ghost" onClick={() => prioritise(r)}>Prioritise</Button>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <div className="space-y-5">
          <Panel title="Housekeeping team">
            <ul className="divide-y divide-hair">
              {attendants.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="text-ink">{a.name}</span>
                  <span className="num text-graphite">{busy(a.id).length ? `Room ${busy(a.id).map((r) => r.number).join(", ")}` : <span className="text-pos">Free</span>}</span>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title={`Guest requests, ${requests.length}`}>
            {requests.length === 0 ? <p className="text-sm text-steel">No open requests.</p> : (
              <ul className="divide-y divide-hair">
                {requests.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span><span className="text-ink">{r.text}</span><span className="num block text-xs text-steel">Room {r.room} · {r.department.replace("_", " ")} · {now - r.raisedMin} min ago{now - r.raisedMin > 30 ? " · needs attention" : ""}</span></span>
                    {mayManage && <Button size="sm" onClick={() => report(store.completeRequest(r.id), `Request for room ${r.room} completed.`)}>Done</Button>}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
      <Note>Showing three floors in turnover this evening, {ready.length} of {rooms.length} rooms ready. Room status, arrivals and requests are simulated. A live version would read them from the property management and housekeeping systems. Estimated times use a standard clean of 32 minutes for a room and 50 for a suite.</Note>
    </div>
  );
}
