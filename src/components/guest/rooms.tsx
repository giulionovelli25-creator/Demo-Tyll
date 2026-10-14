"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ChevronDown, Star } from "lucide-react";
import { useState } from "react";
import { Badge, Button, EmptyState, Field, Note, Panel, Select, cn, toast } from "@/components/ui";
import { HK_RULES } from "@/lib/domain/guest";
import { can } from "@/lib/domain/access";
import { hm, useLiveGet, useRoomsBoard } from "@/lib/guest-hooks";
import { personName, useView } from "@/lib/hooks";
import { useMutate } from "@/lib/plan-hooks";
import type { RoomView } from "@/lib/server/guest";
import type { HkStatus } from "@/lib/types";
import { DEMO_TODAY } from "@/lib/util";

export const HK_LABEL: Record<HkStatus, { label: string; tone: "neutral" | "warn" | "pos" | "neg" | "ink" }> = {
  occupied: { label: "Occupied", tone: "neutral" }, vacant_dirty: { label: "Vacant, needs cleaning", tone: "warn" }, cleaning: { label: "Cleaning in progress", tone: "ink" },
  inspection: { label: "Awaiting inspection", tone: "warn" }, ready: { label: "Ready", tone: "pos" }, out_of_service: { label: "Out of service", tone: "neg" },
};
const RISK = { ready: ["Room ready", "pos"], on_time: ["Ready in time", "neutral"], tight: ["Tight", "warn"], late: ["May be late", "neg"], waiting: ["Guest waiting", "neg"], unknown: ["Not known", "neutral"] } as const;
const who = (id?: string) => (id ? personName(id) : "");

/** Today's arrivals, exceptions first. Clicking one opens its room. */
export function RoomReadiness() {
  const router = useRouter();
  const params = useSearchParams();
  const { data, error } = useRoomsBoard();
  const roomId = params.get("room");
  if (roomId) return <RoomDetail roomId={roomId} />;
  if (!data) return <Panel><EmptyState title={error ?? "Loading rooms"} /></Panel>;
  const b = data.board;
  const arrivals = b.rooms.filter((r) => r.arrival).sort((x, y) => order(x) - order(y) || x.arrival!.etaMin - y.arrival!.etaMin);
  const late = arrivals.filter((r) => ["late", "waiting"].includes(r.arrival!.risk));
  const counts = { ready: b.rooms.filter((r) => r.status === "ready").length, cleaning: b.rooms.filter((r) => r.status === "cleaning").length, dirty: b.rooms.filter((r) => r.status === "vacant_dirty").length, inspection: b.rooms.filter((r) => r.status === "inspection").length };
  return (
    <div className="space-y-5">
      <Panel title="Today's arrivals" description={`Demo clock ${hm(b.now)}. Estimates use recorded room status and stated planning times; they are not guarantees.`}>
        <p className="text-[15px] text-ink">{late.length ? `${late.length} arriving guest${late.length === 1 ? "" : "s"} may have to wait for their room.` : "Every arriving guest's room should be ready in time."}</p>
        <p className="mt-1 text-sm text-steel">{counts.ready} rooms ready · {counts.cleaning} being cleaned · {counts.dirty} waiting to be cleaned{counts.inspection ? ` · ${counts.inspection} awaiting inspection` : ""}</p>
      </Panel>
      <Panel flush>
        <ul className="divide-y divide-hair">
          {arrivals.map((r) => {
            const a = r.arrival!;
            const [label, tone] = RISK[a.risk];
            return (
              <li key={r.roomId}>
                <button type="button" onClick={() => router.push(`/rooms?tab=readiness&room=${r.roomId}`)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5 text-left hover:bg-cloud sm:px-6">
                  <span className="num w-14 text-lg tracking-[-0.02em] text-ink">{r.number}</span>
                  <span className="min-w-[160px] flex-1"><span className="text-sm text-ink">{a.guest}{a.vip && <Star size={13} className="ml-1 inline text-warn" aria-label="VIP" />}</span><span className="block text-xs text-steel">Arriving {hm(a.etaMin)} · {r.type}</span></span>
                  <span className="text-xs text-steel">{HK_LABEL[r.status].label}{r.estimate.readyAt !== null && r.status !== "ready" ? ` · ready about ${hm(r.estimate.readyAt)}` : ""}</span>
                  <Badge tone={tone} className="!py-0">{label}{a.delay && a.delay > 0 && a.risk !== "ready" ? `, ${a.delay} min` : ""}</Badge>
                </button>
              </li>
            );
          })}
        </ul>
      </Panel>
    </div>
  );
}
const order = (r: RoomView) => ({ waiting: 0, late: 1, tight: 2, unknown: 3, on_time: 4, ready: 5 })[r.arrival!.risk];

/** One room: why Tyll thinks what it thinks, and what each role can do about it. */
export function RoomDetail({ roomId, back = "/rooms?tab=readiness" }: { roomId: string; back?: string }) {
  const router = useRouter();
  const { user } = useView();
  const { data } = useRoomsBoard();
  const mutate = useMutate();
  const [note, setNote] = useState("");
  const [issue, setIssue] = useState("");
  const [showMove, setShowMove] = useState(false);
  const [open, setOpen] = useState(false);
  const room = data?.board.rooms.find((r) => r.roomId === roomId);
  const { data: alts } = useLiveGet<{ rooms: { roomId: string; number: string; floor: number }[] }>(showMove && room ? `/api/guest/rooms?alternativesFor=${roomId}` : null);
  if (!data) return <Panel><EmptyState title="Loading the room" /></Panel>;
  if (!room) return <Panel><EmptyState title="This room is not available" action={<Button onClick={() => router.push(back)}>Back</Button>}>It is not assigned to you, or it is outside your hotel.</EmptyState></Panel>;
  const b = data.board;
  const act = async (body: Record<string, unknown>, done: string) => {
    const r = await mutate("/api/guest/rooms", { roomId, expect: room.status, ...body });
    if (!r.ok) return toast.error(r.error), false;
    toast.done(done);
    return true;
  };
  const manager = can(user, "hk.manage");
  const desk = can(user, "fo.desk");
  const mine = user.staffId && (room.housekeeperId === user.staffId || room.helperId === user.staffId);
  const supervisor = user.staffId === "HK-09";
  const a = room.arrival;
  const free = b.housekeepers.filter((h) => h.id !== room.housekeeperId);
  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" onClick={() => router.push(back)}><ArrowLeft size={15} /> Back</Button>
      <Panel title={<span className="flex flex-wrap items-center gap-3"><span className="num">Room {room.number}</span><Badge tone={HK_LABEL[room.status].tone}>{HK_LABEL[room.status].label}</Badge>{room.priority && <Badge tone="warn">Priority</Badge>}</span>}
        description={`${room.type} · floor ${room.floor} · ${room.occupancy === "occupied" ? "guest in house" : room.occupancy === "due_out" ? "due to check out" : "vacant"}`}>
        {a && (
          <p className={cn("text-[15px]", ["late", "waiting"].includes(a.risk) ? "text-neg" : "text-ink")}>
            {a.risk === "ready" ? `Ready for ${a.guest}, arriving ${hm(a.etaMin)}.` : a.risk === "waiting" ? `${a.guest} is already here. Estimated ready about ${room.estimate.readyAt !== null ? hm(room.estimate.readyAt) : "unknown"}.` : a.risk === "late" ? `Room ${room.number} may not be ready for the expected arrival: ${a.delay} minutes after ${a.guest}'s ${hm(a.etaMin)} arrival.` : `Expected arrival ${hm(a.etaMin)}; estimated ready ${room.estimate.readyAt !== null ? hm(room.estimate.readyAt) : "unknown"}.`}
          </p>
        )}
        <div className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <div><span className="text-steel">Housekeeper </span>{room.housekeeperName ?? "not assigned"}{room.helperName ? ` + ${room.helperName}` : ""}</div>
          <div><span className="text-steel">Estimated ready </span>{room.status === "ready" ? `${hm(room.readyMin ?? b.now)} (released)` : room.estimate.readyAt !== null ? `about ${hm(room.estimate.readyAt)}` : "not known"}</div>
          {a && <div><span className="text-steel">Arrival </span>{hm(a.etaMin)}{a.vip ? ", VIP" : ""}</div>}
        </div>
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="mt-4 flex items-center gap-2 text-[13px] text-steel hover:text-ink"><ChevronDown size={14} className={cn("transition-transform", open && "rotate-180")} /> Why this estimate</button>
        {open && (
          <ul className="mt-2 space-y-1 text-[13px] text-graphite">
            {room.estimate.steps.map((s, i) => <li key={i}>· {s}</li>)}
            <li className="text-steel">Planning times: standard room {HK_RULES.cleanMinutes.standard} min, suite {HK_RULES.cleanMinutes.suite} min, inspection {HK_RULES.inspectMinutes} min ({HK_RULES.priorityInspectMinutes} if priority). Demo assumptions.</li>
          </ul>
        )}
        {room.issues.filter((i) => !i.resolved).map((i, k) => <Note key={k} className="mt-3">{i.supply ? "Missing supply" : "Problem"} reported by {who(i.by)} at {hm(i.min)}: {i.text}</Note>)}
      </Panel>

      {(desk || manager || mine || supervisor) && (
        <Panel title="What you can do">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {(desk || manager) && !room.priority && ["vacant_dirty", "cleaning", "inspection"].includes(room.status) && <Button variant="primary" onClick={() => act({ action: "priority", note }, "Priority cleaning requested. Housekeeping can see it now.")}>Prioritise cleaning</Button>}
              {(mine || manager) && room.status === "vacant_dirty" && room.housekeeperId && <Button variant="primary" onClick={() => act({ action: "start" }, "Cleaning started.")}>Start cleaning</Button>}
              {(mine || manager) && room.status === "cleaning" && <Button variant="primary" onClick={() => act({ action: "cleaned" }, b.inspectionRequired ? "Cleaned. It waits for inspection before it is ready." : "Cleaned and ready.")}>Mark cleaned</Button>}
              {(supervisor || manager) && room.status === "inspection" && <Button variant="primary" onClick={() => act({ action: "inspect", pass: true }, "Inspected. The room is ready and the front desk can see it.")}>Pass inspection</Button>}
              {(supervisor || manager) && room.status === "inspection" && <Button onClick={() => { if (note.length < 3) return toast.error("Write what needs doing again in the note below."); void act({ action: "inspect", pass: false, note }, "Sent back to cleaning."); }}>Fail inspection</Button>}
              {desk && a && room.status !== "ready" && <Button onClick={() => setShowMove(!showMove)}>See another ready room</Button>}
              {manager && <Button variant="ghost" onClick={() => router.push(`/events?tab=support&mode=new&kind=hk&dept=dxb-hk&date=${DEMO_TODAY}&start=${hm(b.now)}&end=23:00&count=1&reason=${encodeURIComponent(`Room ${room.number} for an arrival at ${a ? hm(a.etaMin) : "tonight"}`)}`)}>Request housekeeping support</Button>}
            </div>
            {manager && ["vacant_dirty", "cleaning"].includes(room.status) && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Select label={room.housekeeperId ? "Reassign to" : "Assign to"} value="" onChange={(e) => e.target.value && act({ action: "assign", housekeeperId: e.target.value }, "Assigned.")}>
                  <option value="">Choose someone on shift</option>
                  {b.housekeepers.map((h) => <option key={h.id} value={h.id}>{h.name}{h.borrowed ? " (borrowed)" : ""} · {h.rooms} room{h.rooms === 1 ? "" : "s"}</option>)}
                </Select>
                {room.housekeeperId && <Select label="Add a second person" value="" onChange={(e) => e.target.value && act({ action: "helper", housekeeperId: e.target.value }, "Help added. The estimate is updated.")}>
                  <option value="">Choose someone on shift</option>
                  {free.map((h) => <option key={h.id} value={h.id}>{h.name}{h.borrowed ? " (borrowed)" : ""} · {h.rooms} room{h.rooms === 1 ? "" : "s"}</option>)}
                </Select>}
              </div>
            )}
            <Field label="Note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: VIP arriving early" />
            {(mine || manager) && (
              <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); const supply = (new FormData(e.currentTarget).get("supply") as string) === "on"; void act({ action: "issue", note: issue, supply }, "Reported. Housekeeping can see it.").then((ok) => ok && setIssue("")); }}>
                <Field label="Report a problem or missing supply" className="min-w-[220px] flex-1" value={issue} onChange={(e) => setIssue(e.target.value)} placeholder="For example: no bath towels on the trolley" />
                <label className="flex h-11 items-center gap-2 text-sm"><input type="checkbox" name="supply" className="accent-ink" /> Missing supply</label>
                <Button type="submit">Report</Button>
              </form>
            )}
            {showMove && (
              <div className="rounded-2xl border border-line p-4">
                <p className="text-sm text-ink">Ready rooms of the same type with no arrival</p>
                {!alts ? <p className="text-sm text-steel">Checking…</p> : alts.rooms.length === 0 ? <p className="mt-1 text-sm text-steel">None at the moment. Keep the priority on this room, or escalate to the duty manager.</p> : (
                  <ul className="mt-2 flex flex-wrap gap-2">{alts.rooms.map((x) => <li key={x.roomId}><Button size="sm" onClick={async () => { const r = await mutate("/api/guest/arrivals", { arrivalId: a!.id, roomId: x.roomId }); if (!r.ok) toast.error(r.error); else { toast.done(`${a!.guest} moved to room ${x.number}.`); router.push(`/rooms?tab=readiness&room=${x.roomId}`); } }}>Move to {x.number}</Button></li>)}</ul>
                )}
                <Note className="mt-2">Moving a guest is your decision; Tyll never moves anyone by itself.</Note>
              </div>
            )}
          </div>
        </Panel>
      )}

      <Panel title="History">
        <ul className="space-y-2 text-sm">{room.history.slice().reverse().map((h, k) => <li key={k} className="flex flex-wrap justify-between gap-2"><span className="text-ink">{h.action}{h.note ? `: ${h.note}` : ""}</span><span className="num text-xs text-steel">{hm(h.min)} · {who(h.by)}</span></li>)}</ul>
      </Panel>
    </div>
  );
}

/** The housekeeping manager's day: what needs doing, who is doing it, and whether there are enough people. */
export function HousekeepingBoard() {
  const router = useRouter();
  const params = useSearchParams();
  const { data, error } = useRoomsBoard();
  const mutate = useMutate();
  const roomId = params.get("room");
  if (roomId) return <RoomDetail roomId={roomId} back="/rooms?tab=housekeeping" />;
  if (!data) return <Panel><EmptyState title={error ?? "Loading rooms"} /></Panel>;
  const b = data.board;
  const groups: { title: string; rooms: RoomView[] }[] = [
    { title: "Priority", rooms: b.rooms.filter((r) => r.priority && r.status !== "ready") },
    { title: "Waiting, not assigned", rooms: b.rooms.filter((r) => !r.priority && r.status === "vacant_dirty" && !r.housekeeperId) },
    { title: "Waiting, assigned", rooms: b.rooms.filter((r) => !r.priority && r.status === "vacant_dirty" && r.housekeeperId) },
    { title: "Cleaning in progress", rooms: b.rooms.filter((r) => !r.priority && r.status === "cleaning") },
    { title: "Awaiting inspection", rooms: b.rooms.filter((r) => !r.priority && r.status === "inspection") },
  ];
  const problems = b.rooms.filter((r) => r.issues.some((i) => !i.resolved));
  return (
    <div className="space-y-5">
      {b.shortage && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warn/25 bg-warn-soft px-5 py-4">
          <p className="text-sm text-ink">{b.shortage.rooms} rooms must be turned around before their guests arrive. That needs about {b.shortage.neededPeople} people; {b.shortage.people} {b.shortage.people === 1 ? "is" : "are"} on shift.</p>
          <Button variant="primary" onClick={() => router.push(`/events?tab=support&mode=new&kind=hk&dept=dxb-hk&date=${DEMO_TODAY}&start=${hm(b.now)}&end=23:00&count=${b.shortage!.neededPeople - b.shortage!.people}&reason=${encodeURIComponent(`${b.shortage!.rooms} rooms to turn around before arrivals tonight`)}`)}>Request extra help</Button>
        </div>
      )}
      <Panel title="On shift" description="Pending staff requests are not counted until approved.">
        <ul className="flex flex-wrap gap-2 text-sm">{b.housekeepers.map((h) => <li key={h.id} className="rounded-full border border-line px-3 py-1.5">{h.name}{h.borrowed && <span className="text-steel"> · borrowed</span>} <span className="text-steel">· {h.rooms}</span></li>)}</ul>
      </Panel>
      {groups.filter((g) => g.rooms.length).map((g) => (
        <Panel key={g.title} title={`${g.title} (${g.rooms.length})`} flush>
          <ul className="divide-y divide-hair border-t border-hair">
            {g.rooms.map((r) => (
              <li key={r.roomId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 sm:px-6">
                <button type="button" onClick={() => router.push(`/rooms?tab=housekeeping&room=${r.roomId}`)} className="flex min-w-[200px] flex-1 items-center gap-3 text-left">
                  <span className="num w-14 text-lg text-ink">{r.number}</span>
                  <span className="text-sm"><span className="text-ink">{r.housekeeperName ?? "Not assigned"}</span><span className="block text-xs text-steel">{r.type}{r.arrival ? ` · arrival ${hm(r.arrival.etaMin)}` : ""}{r.estimate.readyAt !== null ? ` · ready about ${hm(r.estimate.readyAt)}` : ""}</span></span>
                </button>
                {r.arrival && ["late", "waiting"].includes(r.arrival.risk) && <Badge tone="neg" className="!py-0">may be late</Badge>}
                {r.status === "vacant_dirty" && (
                  <select aria-label={`Assign room ${r.number}`} value="" onChange={async (e) => { if (!e.target.value) return; const res = await mutate("/api/guest/rooms", { roomId: r.roomId, expect: r.status, action: "assign", housekeeperId: e.target.value }); if (!res.ok) toast.error(res.error); else toast.done(`Room ${r.number} assigned.`); }} className="h-9 rounded-full border border-line bg-paper px-3 text-[13px]">
                    <option value="">{r.housekeeperId ? "Reassign" : "Assign"}</option>
                    {b.housekeepers.map((h) => <option key={h.id} value={h.id}>{h.name} · {h.rooms}</option>)}
                  </select>
                )}
                {r.status === "inspection" && <Button size="sm" onClick={async () => { const res = await mutate("/api/guest/rooms", { roomId: r.roomId, expect: "inspection", action: "inspect", pass: true }); if (!res.ok) toast.error(res.error); else toast.done(`Room ${r.number} released as ready.`); }}>Pass inspection</Button>}
              </li>
            ))}
          </ul>
        </Panel>
      ))}
      {problems.length > 0 && (
        <Panel title="Reported problems">
          <ul className="space-y-2 text-sm">{problems.map((r) => <li key={r.roomId}><button type="button" className="text-left underline-offset-4 hover:underline" onClick={() => router.push(`/rooms?tab=housekeeping&room=${r.roomId}`)}>Room {r.number}: {r.issues.filter((i) => !i.resolved).map((i) => i.text).join("; ")}</button></li>)}</ul>
        </Panel>
      )}
    </div>
  );
}

/** A housekeeper's own rooms, one tap per step. */
export function MyRooms() {
  const router = useRouter();
  const { data } = useRoomsBoard();
  const mutate = useMutate();
  const rooms = (data?.board.rooms ?? []).filter((r) => ["vacant_dirty", "cleaning", "inspection"].includes(r.status)).sort((a, b) => Number(b.status === "cleaning") - Number(a.status === "cleaning") || Number(b.priority) - Number(a.priority) || a.number.localeCompare(b.number));
  if (!data) return null;
  const step = async (roomId: string, status: string, action: string, done: string) => {
    const r = await mutate("/api/guest/rooms", { roomId, expect: status, action });
    if (!r.ok) toast.error(r.error); else toast.done(done);
  };
  return (
    <Panel title="My rooms" description={rooms.length ? "In order: the room in progress, then priority rooms." : undefined}>
      {rooms.length === 0 ? <p className="text-sm text-steel">No rooms assigned to you right now.</p> : (
        <ul className="divide-y divide-hair rounded-2xl border border-line">
          {rooms.map((r, i) => (
            <li key={r.roomId} className={cn("flex flex-wrap items-center gap-3 px-4 py-3", i === 0 && "bg-cloud")}>
              <button type="button" onClick={() => router.push(`/tasks?room=${r.roomId}`)} className="flex-1 text-left">
                <span className="num text-xl text-ink">{r.number}</span>{r.priority && <Badge tone="warn" className="ml-2 !py-0">Priority</Badge>}
                <span className="block text-xs text-steel">{r.type} · {HK_LABEL[r.status].label}{r.arrival ? ` · guest arriving ${hm(r.arrival.etaMin)}` : ""}</span>
              </button>
              {r.status === "vacant_dirty" && <Button variant="primary" onClick={() => step(r.roomId, r.status, "start", `Room ${r.number}: cleaning started.`)}>Start</Button>}
              {r.status === "cleaning" && <Button variant="primary" onClick={() => step(r.roomId, r.status, "cleaned", `Room ${r.number} cleaned.`)}>Done</Button>}
              {r.status === "inspection" && <Badge>Waiting for inspection</Badge>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
