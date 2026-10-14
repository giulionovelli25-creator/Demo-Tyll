"use client";
// Guest requests, Guest Connect, an outlet's table requests, service performance and housekeeping supplies.
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useState } from "react";
import { Choice } from "@/components/forecast/parts";
import { Timeline } from "@/components/timeline";
import { Badge, Button, EmptyState, Field, Note, Panel, Select, Stat, toast, type Tone } from "@/components/ui";
import { can } from "@/lib/domain/access";
import { SERVICE_TARGETS, venueById, type VenueKind } from "@/lib/domain/guest";
import { hm, useLiveGet } from "@/lib/guest-hooks";
import { personName, usePost, useSessionEntries, useView } from "@/lib/hooks";
import { useMutate, usePlanDrafts } from "@/lib/plan-hooks";
import type { GcStatus, GuestRequestKind, GuestRequestStatus, ServiceRequest } from "@/lib/types";
import { DEMO_TODAY, addDays } from "@/lib/util";
import type { GcRequest } from "@/lib/types";
import type { ServiceSummary, VenueOption } from "@/lib/server/guest-service";

const REQ_STATUS: Record<GuestRequestStatus, { label: string; tone: Tone }> = {
  new: { label: "New", tone: "warn" }, assigned: { label: "Assigned", tone: "ink" }, in_progress: { label: "In progress", tone: "ink" }, awaiting_confirmation: { label: "Awaiting confirmation", tone: "warn" },
  confirmed: { label: "Confirmed", tone: "pos" }, completed: { label: "Completed", tone: "pos" }, cancelled: { label: "Cancelled", tone: "neutral" }, unable: { label: "Unable to fulfil", tone: "neg" },
};
const KIND: Record<GuestRequestKind, string> = { taxi: "Taxi", restaurant: "Restaurant", spa: "Spa", activity: "Activity", assistance: "Room assistance", bell: "Luggage", general: "Other" };
export const GC_STATUS: Record<GcStatus, { label: string; tone: Tone }> = {
  pending: { label: "Waiting for the venue", tone: "warn" }, accepted: { label: "Accepted by the venue", tone: "ink" }, alternative: { label: "Another time suggested", tone: "warn" },
  confirmed: { label: "Confirmed with guest", tone: "pos" }, declined: { label: "Declined", tone: "neg" }, cancelled: { label: "Cancelled", tone: "neutral" },
};
const AVAIL = { likely: { label: "Likely available", tone: "pos" as Tone }, limited: { label: "Limited", tone: "warn" as Tone }, request: { label: "Ask the venue", tone: "neutral" as Tone }, closed: { label: "Closed then", tone: "neutral" as Tone } };
const closed = (s: string) => ["completed", "cancelled", "unable", "declined"].includes(s);
const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + (m || 0); };

type GcRow = GcRequest & { venueName: string };
const useRequests = () => useLiveGet<{ requests: ServiceRequest[]; now: number }>("/api/guest/requests");
const useGc = () => useLiveGet<{ requests: GcRow[]; now: number }>("/api/guest/connect");

// ---- Guest requests ------------------------------------------------------------------------------------------------

export function GuestRequests() {
  const id = useSearchParams().get("request");
  return id ? <RequestView id={id} /> : <RequestsHome />;
}

function RequestsHome() {
  const router = useRouter();
  const { data, error } = useRequests();
  const [making, setMaking] = useState(false);
  if (!data) return <Panel><EmptyState title={error ?? "Loading requests"} /></Panel>;
  const open = data.requests.filter((r) => !closed(r.status));
  const row = (r: ServiceRequest) => {
    const late = !closed(r.status) && r.status !== "confirmed" && data.now - r.createdMin > (SERVICE_TARGETS.request[r.kind] ?? 30);
    return (
      <li key={r.id}>
        <button type="button" onClick={() => router.push(`/rooms?tab=requests&request=${r.id}`)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-left hover:bg-cloud sm:px-6">
          <span className="flex-1"><span className="text-sm text-ink">Room {r.room} · {KIND[r.kind]}</span><span className="block text-xs text-steel">{r.details} · for {hm(r.forMin)} · {r.id}</span></span>
          {r.priority === "urgent" && <Badge tone="neg" className="!py-0">urgent</Badge>}
          {late && <Badge tone="neg" className="!py-0">waiting {data.now - r.createdMin} min</Badge>}
          <Badge tone={REQ_STATUS[r.status].tone} className="!py-0">{REQ_STATUS[r.status].label}</Badge>
        </button>
      </li>
    );
  };
  return (
    <div className="space-y-5">
      {making ? <NewRequest onDone={(rid) => { setMaking(false); if (rid) router.push(`/rooms?tab=requests&request=${rid}`); }} /> : <Button variant="primary" onClick={() => setMaking(true)}>New guest request</Button>}
      <Panel title={`Open (${open.length})`} description={`Demo clock ${hm(data.now)}. Restaurants, spa and activities are confirmed by the venue through Guest Connect.`} flush>
        {open.length === 0 ? <p className="px-6 pb-6 text-sm text-steel">Nothing open.</p> : <ul className="divide-y divide-hair border-t border-hair">{open.map(row)}</ul>}
      </Panel>
      {data.requests.length > open.length && <Panel title="Closed" flush><ul className="divide-y divide-hair border-t border-hair">{data.requests.filter((r) => closed(r.status)).slice(0, 8).map(row)}</ul></Panel>}
    </div>
  );
}

function NewRequest({ onDone }: { onDone: (id?: string) => void }) {
  const mutate = useMutate();
  const [kind, setKind] = useState<GuestRequestKind>("taxi");
  const [room, setRoom] = useState("");
  const [details, setDetails] = useState("");
  const [time, setTime] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Panel title="New guest request" description="Room number and what is needed only. No guest contact details are stored.">
      <form className="space-y-4" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const r = await mutate<{ request: { id: string } }>("/api/guest/requests", { kind, room, details, forMin: time ? toMin(time) : undefined, priority: urgent ? "urgent" : "normal" });
        setBusy(false);
        if (!r.ok) return toast.error(r.error);
        toast.done(`${r.data.request.id} created.`);
        onDone(r.data.request.id);
      }}>
        <Choice label="What does the guest need?" value={kind} options={(["taxi", "restaurant", "spa", "activity", "assistance", "general"] as GuestRequestKind[]).map((k) => ({ value: k, label: KIND[k] }))} onChange={setKind} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Room" value={room} onChange={(e) => setRoom(e.target.value)} placeholder="For example: 1211" />
          <Field label="For what time" type="time" value={time} onChange={(e) => setTime(e.target.value)} hint="Leave empty for now" />
          <Field label="Details" value={details} onChange={(e) => setDetails(e.target.value)} placeholder="For example: taxi to the airport, 2 bags" />
        </div>
        <label className="flex items-center gap-2 text-sm text-graphite"><input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /> Urgent</label>
        <div className="flex gap-2"><Button type="submit" variant="primary" disabled={busy}>Create request</Button><Button variant="ghost" onClick={() => onDone()}>Cancel</Button></div>
      </form>
    </Panel>
  );
}

function RequestView({ id }: { id: string }) {
  const router = useRouter();
  const { data } = useRequests();
  const mutate = useMutate();
  const [note, setNote] = useState("");
  const r = data?.requests.find((x) => x.id === id);
  if (!data) return <Panel><EmptyState title="Loading the request" /></Panel>;
  if (!r) return <Panel><EmptyState title="This request is not available" action={<Button onClick={() => router.push("/rooms?tab=requests")}>Guest requests</Button>} /></Panel>;
  const act = async (action: string, done: string) => {
    const res = await mutate(`/api/guest/requests/${r.id}`, { action, note, expect: r.status });
    if (!res.ok) return toast.error(res.error);
    setNote("");
    toast.done(done);
  };
  const venue = r.kind === "restaurant" || r.kind === "spa" || r.kind === "activity";
  const open = !closed(r.status);
  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" onClick={() => router.push("/rooms?tab=requests")}><ArrowLeft size={15} /> Back</Button>
      <Panel title={<span className="flex flex-wrap items-center gap-3"><span>Room {r.room} · {KIND[r.kind]}</span><Badge tone={REQ_STATUS[r.status].tone}>{REQ_STATUS[r.status].label}</Badge></span>} description={`${r.id} · ${r.details} · for ${hm(r.forMin)} · raised ${hm(r.createdMin)} by ${personName(r.createdBy)}`}>
        {r.confirmation && <p className="text-sm text-graphite">Confirmation: <span className="text-ink">{r.confirmation}</span></p>}
        {r.linkedId && <p className="mt-1 text-sm text-graphite">Guest Connect: <button type="button" className="text-ink underline" onClick={() => router.push(`/rooms?tab=connect&request=${r.linkedId}`)}>{r.linkedId}</button></p>}
        {open && (
          <div className="mt-4 space-y-3">
            {venue && !r.linkedId && <Button variant="primary" onClick={() => router.push(`/rooms?tab=connect&from=${r.id}&room=${r.room}&kind=${r.kind === "restaurant" ? "restaurant" : r.kind}`)}>Find a venue in Guest Connect</Button>}
            <div className="flex flex-wrap gap-2">
              {r.status === "new" && <Button onClick={() => act("assign", "Taken on.")}>Take this on</Button>}
              {["new", "assigned"].includes(r.status) && <Button onClick={() => act("start", "Started.")}>Start</Button>}
              {!venue && ["assigned", "in_progress"].includes(r.status) && <Button onClick={() => act("awaiting", "Waiting for confirmation.")}>Waiting for an outside confirmation</Button>}
              {["in_progress", "confirmed", "assigned"].includes(r.status) && <Button onClick={() => act("complete", "Completed.")}>Complete</Button>}
            </div>
            <Field label={r.status === "awaiting_confirmation" && !venue ? "Confirmation received, or reason" : "Note or reason"} value={note} onChange={(e) => setNote(e.target.value)} placeholder={r.kind === "taxi" ? "For example: Dubai Taxi ref 48213, car at 21:40" : ""} />
            <div className="flex flex-wrap gap-2">
              {!venue && r.status === "awaiting_confirmation" && <Button variant="primary" onClick={() => act("confirm", "Confirmation recorded.")}>Record confirmation</Button>}
              <Button variant="ghost" onClick={() => act("unable", "Marked unable to fulfil.")}>Unable to fulfil</Button>
              <Button variant="ghost" onClick={() => act("cancel", "Cancelled.")}>Cancel request</Button>
            </div>
            <Note>A request shows as confirmed only after a confirmation is recorded. Outside companies are not connected in this demo; staff type in what they were told, and it is labelled simulated.</Note>
          </div>
        )}
      </Panel>
      <Panel title="What happened"><Timeline items={r.history.map((h, k) => ({ key: String(k), when: hm(h.min), title: h.action, detail: `${personName(h.by)}${h.note ? ` · ${h.note}` : ""}` }))} /></Panel>
    </div>
  );
}

// ---- Guest Connect -------------------------------------------------------------------------------------------------

export function GuestConnect() {
  const params = useSearchParams();
  const id = params.get("request");
  return id ? <GcView id={id} back="/rooms?tab=connect" /> : <ConnectHome />;
}

function ConnectHome() {
  const router = useRouter();
  const params = useSearchParams();
  const { data } = useGc();
  const [finding, setFinding] = useState(!!params.get("from"));
  const open = (data?.requests ?? []).filter((r) => !closed(r.status) && r.status !== "cancelled");
  return (
    <div className="space-y-5">
      {finding ? <FindVenue onDone={(rid) => { setFinding(false); if (rid) router.push(`/rooms?tab=connect&request=${rid}`); }} /> : <Button variant="primary" onClick={() => setFinding(true)}>Find a table or slot</Button>}
      <Panel title={`Your requests (${open.length})`} description="A request is confirmed only after the venue accepts and you confirm with the guest." flush>
        {open.length === 0 ? <p className="px-6 pb-6 text-sm text-steel">Nothing open.</p> : <GcList rows={open} base="/rooms?tab=connect" />}
      </Panel>
    </div>
  );
}

function GcList({ rows, base }: { rows: GcRow[]; base: string }) {
  const router = useRouter();
  return (
    <ul className="divide-y divide-hair border-t border-hair">
      {rows.map((r) => (
        <li key={r.id}>
          <button type="button" onClick={() => router.push(`${base}&request=${r.id}`)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-left hover:bg-cloud sm:px-6">
            <span className="flex-1"><span className="text-sm text-ink">{r.venueName} · {r.party} at {hm(r.timeMin)}{r.date !== DEMO_TODAY ? " tomorrow" : ""}</span><span className="block text-xs text-steel">Room {r.room} · {r.id}{r.proposedMin !== undefined ? ` · suggested ${hm(r.proposedMin)}` : ""}</span></span>
            <Badge tone={GC_STATUS[r.status].tone} className="!py-0">{GC_STATUS[r.status].label}</Badge>
          </button>
        </li>
      ))}
    </ul>
  );
}

function FindVenue({ onDone }: { onDone: (id?: string) => void }) {
  const params = useSearchParams();
  const mutate = useMutate();
  const version = usePlanDrafts((s) => s.version);
  const [kind, setKind] = useState<VenueKind>((params.get("kind") as VenueKind) || "restaurant");
  const [date, setDate] = useState(DEMO_TODAY);
  const [time, setTime] = useState("21:30");
  const [party, setParty] = useState(2);
  const [room, setRoom] = useState(params.get("room") ?? "");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const { data } = usePost<{ venues: VenueOption[]; note: string }>("/api/guest/connect/venues", { kind, date, timeMin: toMin(time), party, version });
  const ask = async (v: VenueOption) => {
    setBusy(v.id);
    const r = await mutate<{ request: { id: string } }>("/api/guest/connect", { venueId: v.id, date, timeMin: toMin(time), party, room, notes, sourceRequestId: params.get("from") ?? undefined });
    setBusy(null);
    if (!r.ok) return toast.error(r.error);
    toast.done(`${r.data.request.id} sent to ${v.name}. It is not confirmed until they accept.`);
    onDone(r.data.request.id);
  };
  return (
    <Panel title="Find a table or slot" description={data?.note}>
      <div className="space-y-4">
        <Choice label="Where" value={kind} options={[{ value: "restaurant", label: "Restaurant" }, { value: "lounge", label: "Bar or lounge" }, { value: "spa", label: "Spa" }, { value: "activity", label: "Activity" }]} onChange={setKind} />
        <div className="grid gap-3 sm:grid-cols-4">
          <Select label="Day" value={date} onChange={(e) => setDate(e.target.value)}><option value={DEMO_TODAY}>Today</option><option value={addDays(DEMO_TODAY, 1)}>Tomorrow</option></Select>
          <Field label="Time" type="time" step={1800} value={time} onChange={(e) => setTime(e.target.value)} />
          <Field label="Guests" type="number" min={1} max={20} value={party} onChange={(e) => setParty(Math.max(1, Math.min(20, Number(e.target.value))))} />
          <Field label="Room" value={room} onChange={(e) => setRoom(e.target.value)} placeholder="For example: 1211" />
        </div>
        <Field label="Notes for the venue" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional, for example: anniversary, window if possible" />
        <ul className="divide-y divide-hair rounded-2xl border border-line">
          {(data?.venues ?? []).map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="min-w-[180px] flex-1"><span className="text-[15px] text-ink">{v.name}</span><span className="block text-xs text-steel">{v.note} · open {hm(v.opens)} to {hm(v.closes)}</span></span>
              <Badge tone={AVAIL[v.availability].tone} className="!py-0">{AVAIL[v.availability].label}</Badge>
              <Button variant="primary" size="sm" disabled={v.availability === "closed" || busy !== null || room.trim().length === 0} onClick={() => ask(v)}>{v.kind === "restaurant" || v.kind === "lounge" ? "Request table" : "Request slot"}</Button>
            </li>
          ))}
          {data && data.venues.length === 0 && <li className="px-4 py-3 text-sm text-steel">No venues of this kind at this hotel.</li>}
        </ul>
        <Button variant="ghost" onClick={() => onDone()}>Close</Button>
      </div>
    </Panel>
  );
}

function GcView({ id, back }: { id: string; back: string }) {
  const router = useRouter();
  const { user } = useView();
  const { data } = useGc();
  const mutate = useMutate();
  const [note, setNote] = useState("");
  const [alt, setAlt] = useState("");
  const [time, setTime] = useState("");
  const [party, setParty] = useState("");
  const r = data?.requests.find((x) => x.id === id);
  if (!data) return <Panel><EmptyState title="Loading the request" /></Panel>;
  if (!r) return <Panel><EmptyState title="This request is not available" action={<Button onClick={() => router.push(back)}>Back</Button>} /></Panel>;
  const v = venueById[r.venueId];
  const act = async (body: Record<string, unknown>, done: string) => {
    const res = await mutate(`/api/guest/connect/${r.id}`, { expect: r.status, note, ...body });
    if (!res.ok) return toast.error(res.error);
    setNote("");
    toast.done(done);
  };
  const requester = can(user, "fo.desk") || can(user, "concierge");
  const responder = can(user, "gc.respond") && !requester ? true : can(user, "gc.respond") && back.includes("tables");
  const live = ["pending", "accepted", "alternative", "confirmed"].includes(r.status);
  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" onClick={() => router.push(back)}><ArrowLeft size={15} /> Back</Button>
      <Panel title={<span className="flex flex-wrap items-center gap-3"><span>{v.name} · {r.party} at {hm(r.timeMin)}{r.date !== DEMO_TODAY ? " tomorrow" : ""}</span><Badge tone={GC_STATUS[r.status].tone}>{GC_STATUS[r.status].label}</Badge></span>}
        description={`${r.id} · room ${r.room} · asked ${hm(r.createdMin)} by ${personName(r.createdBy)}${r.notes ? ` · ${r.notes}` : ""}`}>
        {r.status === "alternative" && r.proposedMin !== undefined && <p className="text-sm text-ink">{v.name} suggested {hm(r.proposedMin)} instead.</p>}
        {responder && r.status === "pending" && (
          <div className="mt-2 space-y-3">
            <div className="flex flex-wrap gap-2"><Button variant="primary" onClick={() => act({ action: "accept" }, "Accepted. The front desk will confirm with the guest.")}>Accept</Button></div>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Suggest another time" type="time" step={1800} value={alt} onChange={(e) => setAlt(e.target.value)} className="w-40" />
              <Button disabled={!alt} onClick={() => act({ action: "alternative", timeMin: toMin(alt) }, "Suggestion sent.")}>Suggest this time</Button>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Decline because" value={note} onChange={(e) => setNote(e.target.value)} className="min-w-[220px] flex-1" />
              <Button variant="ghost" onClick={() => act({ action: "decline" }, "Declined.")}>Decline</Button>
            </div>
          </div>
        )}
        {requester && live && (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              {r.status === "alternative" && <Button variant="primary" onClick={() => act({ action: "accept_alternative" }, "New time accepted. Confirm it with the guest.")}>Accept {hm(r.proposedMin!)}</Button>}
              {r.status === "accepted" && <Button variant="primary" onClick={() => act({ action: "confirm" }, "Marked as confirmed with the guest.")}>Confirmed with the guest</Button>}
            </div>
            {r.status === "pending" && <Note>Waiting for {v.name}. Do not tell the guest it is booked yet.</Note>}
            {r.status === "accepted" && <Note>{v.name} accepted. Tell the guest, then mark it confirmed. Tyll does not send messages to guests.</Note>}
            <details className="rounded-2xl border border-line px-4 py-3">
              <summary className="cursor-pointer text-sm text-graphite">Change time or party size</summary>
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <Field label="Time" type="time" step={1800} value={time} onChange={(e) => setTime(e.target.value)} className="w-36" />
                <Field label="Guests" type="number" min={1} max={20} value={party} onChange={(e) => setParty(e.target.value)} className="w-28" />
                <Button onClick={() => act({ action: "change", timeMin: time ? toMin(time) : undefined, party: party ? Number(party) : undefined }, `Change sent to ${v.name}.`)}>Send change to venue</Button>
              </div>
              <p className="mt-2 text-xs text-steel">A change goes back to the venue to accept again.</p>
            </details>
          </div>
        )}
        {(requester || responder) && live && (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <Field label="Cancel because" value={note} onChange={(e) => setNote(e.target.value)} className="min-w-[220px] flex-1" />
            <Button variant="ghost" onClick={() => act({ action: "cancel" }, "Cancelled. Seats released.")}>Cancel request</Button>
          </div>
        )}
      </Panel>
      <Panel title="What happened"><Timeline items={r.history.map((h, k) => ({ key: String(k), when: hm(h.min), title: h.action, detail: `${personName(h.by)}${h.note ? ` · ${h.note}` : ""}` }))} /></Panel>
    </div>
  );
}

/** An outlet's inbox: requests from the front desk and concierge. */
export function TableRequests() {
  const id = useSearchParams().get("request");
  const { data, error } = useGc();
  if (id) return <GcView id={id} back="/rooms?tab=tables" />;
  if (!data) return <Panel><EmptyState title={error ?? "Loading requests"} /></Panel>;
  const pending = data.requests.filter((r) => r.status === "pending");
  const rest = data.requests.filter((r) => r.status !== "pending").slice(0, 10);
  return (
    <div className="space-y-5">
      <Panel title={`Waiting for your answer (${pending.length})`} description={`Target: answer within ${SERVICE_TARGETS.gcResponse} minutes. Accepting checks seats again.`} flush>
        {pending.length === 0 ? <p className="px-6 pb-6 text-sm text-steel">No requests waiting.</p> : <GcList rows={pending} base="/rooms?tab=tables" />}
      </Panel>
      {rest.length > 0 && <Panel title="Answered" flush><GcList rows={rest} base="/rooms?tab=tables" /></Panel>}
    </div>
  );
}

// ---- Service performance -------------------------------------------------------------------------------------------

export function ServicePerformance() {
  const router = useRouter();
  const { data, error } = useLiveGet<{ summary: ServiceSummary }>("/api/guest/service");
  if (!data) return <Panel><EmptyState title={error ?? "Loading"} /></Panel>;
  const { today: t, yesterday: y, open } = data.summary;
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "No data");
  const min = (m: number | null) => (m === null ? "No data" : `${m} min`);
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Rooms ready by arrival" value={pct(t.roomsOnTime.onTime, t.roomsOnTime.done)} sub={`${t.roomsOnTime.onTime} of ${t.roomsOnTime.done} today · yesterday ${pct(y.roomsOnTime.onTime, y.roomsOnTime.done)}`} />
        <Stat label="Requests within target" value={pct(t.requestsInTarget.inTarget, t.requestsInTarget.done)} sub={`${t.requestsInTarget.inTarget} of ${t.requestsInTarget.done} today · yesterday ${pct(y.requestsInTarget.inTarget, y.requestsInTarget.done)}`} />
        <Stat label="Average time to respond" value={min(t.avgResponse)} sub={`Yesterday ${min(y.avgResponse)}`} />
        <Stat label="Luggage delivery, average" value={min(t.bellAvg)} sub={`Target ${SERVICE_TARGETS.bell} min · yesterday ${min(y.bellAvg)}`} />
      </div>
      <Panel title="Needs attention now">
        <ul className="space-y-2 text-sm">
          <li><button type="button" className="text-ink underline-offset-2 hover:underline" onClick={() => router.push("/rooms?tab=readiness")}>{open.roomsAtRisk} arriving guest{open.roomsAtRisk === 1 ? "'s room is" : "s' rooms are"} at risk of not being ready</button></li>
          <li>{open.overdueBell} luggage task{open.overdueBell === 1 ? "" : "s"} overdue · {open.overdueRequests} guest request{open.overdueRequests === 1 ? "" : "s"} past target · {open.pendingGc} venue request{open.pendingGc === 1 ? "" : "s"} waiting for an answer</li>
          {open.staffShort && <li>Housekeeping has fewer people on shift than the rooms need.</li>}
        </ul>
      </Panel>
      <Note className="max-w-[90ch]">How these are measured: a room counts as ready by arrival if it was released as ready before the guest&rsquo;s expected arrival. Requests and luggage count from creation to completion against their target. Venue confirmations ({t.gcConfirmed} today) mean the outlet accepted, not that the guest dined. Earlier entries are demo history. Tyll does not measure guest satisfaction here, and no score is shown.</Note>
    </div>
  );
}

// ---- Housekeeping supplies -----------------------------------------------------------------------------------------

export function SuppliesPanel() {
  const router = useRouter();
  const entries = useSessionEntries();
  const version = usePlanDrafts((s) => s.version);
  const mutate = useMutate();
  const { data } = usePost<{ supplies: { ingredientId: string; name: string; unit: string; onHand: number; par: number; needed: number; openRequest?: { id: string; status: string } }[] }>("/api/guest/supplies", { ...entries, version });
  if (!data) return null;
  const short = data.supplies.filter((s) => s.needed > 0 && !s.openRequest);
  const request = async () => {
    const r = await mutate<{ request: { id: string } }>("/api/purchasing", { propertyId: "dxb", deptId: "dxb-hk", period: "3", comment: "Housekeeping supplies below par for the next three nights.", lines: short.map((s) => ({ ingredientId: s.ingredientId, qty: s.needed, suggested: s.needed, requirement: s.par, available: s.onHand })) });
    if (!r.ok) return toast.error(r.error);
    toast.done(`${r.data.request.id} drafted. Review and submit it to purchasing.`);
    router.push(`/forecast?tab=approvals&request=${r.data.request.id}`);
  };
  return (
    <Panel title="Supplies" description="Estimated stock against a three-night par. Requests go through the usual purchasing approvals.">
      <ul className="divide-y divide-hair rounded-2xl border border-line text-sm">
        {data.supplies.map((s) => (
          <li key={s.ingredientId} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <span className="flex-1 text-ink">{s.name}<span className="block text-xs text-steel">About {Math.round(s.onHand)} {s.unit} on hand · par {s.par}</span></span>
            {s.openRequest ? <button type="button" className="text-xs text-graphite underline" onClick={() => router.push(`/forecast?tab=approvals&request=${s.openRequest!.id}`)}>{s.openRequest.id} · {s.openRequest.status}</button>
              : s.needed > 0 ? <Badge tone="warn" className="!py-0">order {s.needed}</Badge> : <Badge tone="pos" className="!py-0">enough</Badge>}
          </li>
        ))}
      </ul>
      {short.length > 0 && <Button variant="primary" className="mt-4" onClick={request}>Request supplies</Button>}
    </Panel>
  );
}

/** The owner's view of guest experience: three indicators and one link, no operational buttons. */
export function GuestStrip() {
  const { user } = useView();
  const show = can(user, "rooms.view") && (user.propertyIds === "all" || user.propertyIds.includes("dxb"));
  const { data } = useLiveGet<{ summary: ServiceSummary }>(show ? "/api/guest/service" : null);
  if (!data) return null;
  const { today: t, open } = data.summary;
  return (
    <section className="flex flex-wrap items-center gap-x-8 gap-y-2 rounded-panel border border-line bg-paper px-6 py-4 text-sm shadow-panel">
      <span className="text-steel">Guest experience, Dubai today</span>
      <span><span className="num text-ink">{t.roomsOnTime.done ? `${t.roomsOnTime.onTime} of ${t.roomsOnTime.done}` : "No"}</span> <span className="text-steel">rooms ready by arrival</span></span>
      <span><span className="num text-ink">{t.requestsInTarget.done ? `${t.requestsInTarget.inTarget} of ${t.requestsInTarget.done}` : "No"}</span> <span className="text-steel">requests within target</span></span>
      <span><span className={open.roomsAtRisk ? "num text-warn" : "num text-ink"}>{open.roomsAtRisk}</span> <span className="text-steel">arrivals at risk now</span></span>
      <Link href="/rooms?tab=service" className="ml-auto flex items-center gap-1 text-[13px] text-steel hover:text-ink">Service performance <ArrowRight size={14} /></Link>
    </section>
  );
}
