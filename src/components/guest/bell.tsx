"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { Choice } from "@/components/forecast/parts";
import { Timeline } from "@/components/timeline";
import { Badge, Button, EmptyState, Field, Note, Panel, Select, cn, toast } from "@/components/ui";
import { SERVICE_TARGETS } from "@/lib/domain/guest";
import { can } from "@/lib/domain/access";
import { hm, useBell, type BellRow } from "@/lib/guest-hooks";
import { personName, useView } from "@/lib/hooks";
import { useMutate } from "@/lib/plan-hooks";
import type { BellKind, BellStatus } from "@/lib/types";

export const BELL_STATUS: Record<BellStatus, { label: string; tone: "neutral" | "warn" | "pos" | "neg" | "ink" }> = {
  requested: { label: "Requested", tone: "warn" }, assigned: { label: "Assigned", tone: "ink" }, on_the_way: { label: "On the way", tone: "ink" }, collected: { label: "Collected", tone: "ink" },
  delivered: { label: "Delivered", tone: "pos" }, completed: { label: "Completed", tone: "pos" }, cancelled: { label: "Cancelled", tone: "neutral" },
};
const KIND: Record<BellKind, string> = { delivery: "Luggage delivery", pickup: "Luggage pickup", arrival: "Arrival assistance", departure: "Departure assistance" };
const NEXT: Partial<Record<BellStatus, { action: string; label: string }>> = { assigned: { action: "on_the_way", label: "I'm on my way" }, on_the_way: { action: "collected", label: "Bags collected" }, collected: { action: "delivered", label: "Bags delivered" }, delivered: { action: "complete", label: "Complete" } };

export function BellLuggage() {
  const params = useSearchParams();
  const id = params.get("task");
  return id ? <BellTaskView id={id} /> : <BellHome />;
}

function BellHome() {
  const router = useRouter();
  const { user } = useView();
  const { data, error } = useBell();
  const [making, setMaking] = useState(false);
  if (!data) return <Panel><EmptyState title={error ?? "Loading bell tasks"} /></Panel>;
  const open = data.tasks.filter((t) => !["completed", "cancelled"].includes(t.status));
  const done = data.tasks.filter((t) => t.status === "completed").slice(0, 5);
  const mayRequest = can(user, "fo.desk") || can(user, "bell.dispatch") || can(user, "concierge");
  const row = (t: BellRow) => (
    <li key={t.id}>
      <button type="button" onClick={() => router.push(`/rooms?tab=bell&task=${t.id}`)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-left hover:bg-cloud sm:px-6">
        <span className="flex-1"><span className="text-sm text-ink">Room {t.room} · {KIND[t.kind]}</span><span className="block text-xs text-steel">{t.from} to {t.to} · {t.bags} bag{t.bags === 1 ? "" : "s"} · {t.assigneeName ?? "not assigned"} · {t.id}</span></span>
        {t.overdue && <Badge tone="neg" className="!py-0">overdue, {t.age} min</Badge>}
        <Badge tone={BELL_STATUS[t.status].tone} className="!py-0">{BELL_STATUS[t.status].label}</Badge>
      </button>
    </li>
  );
  return (
    <div className="space-y-5">
      {mayRequest && (making ? <NewBell onDone={(tid) => { setMaking(false); if (tid) router.push(`/rooms?tab=bell&task=${tid}`); }} /> : <Button variant="primary" onClick={() => setMaking(true)}>Request luggage help</Button>)}
      <Panel title={`Open (${open.length})`} description={`Target: bags delivered within ${SERVICE_TARGETS.bell} minutes of the request. Demo clock ${hm(data.now)}.`} flush>
        {open.length === 0 ? <p className="px-6 pb-6 text-sm text-steel">Nothing open.</p> : <ul className="divide-y divide-hair border-t border-hair">{open.map(row)}</ul>}
      </Panel>
      {done.length > 0 && <Panel title="Recently completed" flush><ul className="divide-y divide-hair border-t border-hair">{done.map(row)}</ul></Panel>}
    </div>
  );
}

function NewBell({ onDone, room: presetRoom = "" }: { onDone: (id?: string) => void; room?: string }) {
  const mutate = useMutate();
  const [kind, setKind] = useState<BellKind>("delivery");
  const [room, setRoom] = useState(presetRoom);
  const [bags, setBags] = useState(2);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Panel title="Request luggage help">
      <form className="space-y-4" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const r = await mutate<{ task: { id: string } }>("/api/guest/bell", { kind, room, bags, note });
        setBusy(false);
        if (!r.ok) return toast.error(r.error);
        toast.done(`${r.data.task.id} sent to the bell team.`);
        onDone(r.data.task.id);
      }}>
        <Choice label="What does the guest need?" value={kind} options={(Object.keys(KIND) as BellKind[]).map((k) => ({ value: k, label: KIND[k] }))} onChange={setKind} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Room" value={room} onChange={(e) => setRoom(e.target.value)} placeholder="For example: 1211" />
          <Field label="Bags" type="number" min={1} max={20} value={bags} onChange={(e) => setBags(Math.max(1, Number(e.target.value)))} />
          <Field label="Note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </div>
        <div className="flex gap-2"><Button type="submit" variant="primary" disabled={busy}>Send to the bell team</Button><Button variant="ghost" onClick={() => onDone()}>Cancel</Button></div>
      </form>
    </Panel>
  );
}

export function BellTaskView({ id }: { id: string }) {
  const router = useRouter();
  const { user } = useView();
  const { data } = useBell();
  const mutate = useMutate();
  const [handover, setHandover] = useState("Placed in the room with the guest present");
  const [why, setWhy] = useState("");
  const t = data?.tasks.find((x) => x.id === id);
  if (!data) return <Panel><EmptyState title="Loading the task" /></Panel>;
  if (!t) return <Panel><EmptyState title="This task is not available" action={<Button onClick={() => router.push("/rooms?tab=bell")}>Bell & luggage</Button>}>It is not assigned to you, or it no longer exists.</EmptyState></Panel>;
  const act = async (body: Record<string, unknown>, done: string) => {
    const r = await mutate(`/api/guest/bell/${t.id}`, { expect: t.status, ...body });
    if (!r.ok) toast.error(r.error); else toast.done(done);
  };
  const dispatcher = can(user, "bell.dispatch");
  const assignee = user.staffId === t.assigneeId;
  const next = NEXT[t.status];
  const closed = ["completed", "cancelled"].includes(t.status);
  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" onClick={() => router.push(data.mine ? "/tasks" : "/rooms?tab=bell")}><ArrowLeft size={15} /> Back</Button>
      <Panel title={<span className="flex flex-wrap items-center gap-3"><span>Room {t.room} · {KIND[t.kind]}</span><Badge tone={BELL_STATUS[t.status].tone}>{BELL_STATUS[t.status].label}</Badge>{t.overdue && <Badge tone="neg">overdue</Badge>}</span>}
        description={`${t.id} · ${t.from} to ${t.to} · ${t.bags} bag${t.bags === 1 ? "" : "s"} · requested ${hm(t.requestedMin)} by ${personName(t.requestedBy)}`}>
        <p className="text-sm text-graphite">Assigned to: <span className="text-ink">{t.assigneeName ?? "nobody yet"}</span>{t.handover ? ` · Handover: ${t.handover}` : ""}</p>
        {!closed && (
          <div className="mt-4 space-y-3">
            {dispatcher && ["requested", "assigned", "on_the_way"].includes(t.status) && (
              <Select label={t.assigneeId ? "Reassign" : "Assign"} value="" onChange={(e) => e.target.value && act({ action: "assign", assigneeId: e.target.value }, "Assigned.")}>
                <option value="">Choose a bell attendant</option>
                {data.team.map((m) => <option key={m.id} value={m.id} disabled={!m.onShift}>{m.name}{m.onShift ? "" : " (off shift)"}</option>)}
              </Select>
            )}
            {assignee && next && next.action !== "complete" && next.action !== "delivered" && <Button variant="primary" onClick={() => act({ action: next.action }, `${next.label}.`)}>{next.label}</Button>}
            {assignee && t.status === "collected" && (
              <div className="space-y-2">
                <Select label="How were the bags handed over?" value={handover} onChange={(e) => setHandover(e.target.value)}>
                  <option>Placed in the room with the guest present</option><option>Handed to the guest in the lobby</option><option>Placed in the room, guest not present</option><option>Loaded into the guest&apos;s car</option>
                </Select>
                <Button variant="primary" onClick={() => act({ action: "delivered", handover }, "Delivered.")}>Bags delivered</Button>
                <Note>Recorded by the attendant. This is not a guest signature.</Note>
              </div>
            )}
            {(assignee || dispatcher) && t.status === "delivered" && <Button variant="primary" onClick={() => act({ action: "complete" }, "Completed. The front desk can see it.")}>Complete</Button>}
            {(dispatcher || t.requestedBy === user.id) && ["requested", "assigned", "on_the_way"].includes(t.status) && (
              <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void act({ action: "cancel", note: why }, "Cancelled."); }}>
                <Field label="Cancel because" className="min-w-[200px] flex-1" value={why} onChange={(e) => setWhy(e.target.value)} />
                <Button type="submit" variant="ghost">Cancel task</Button>
              </form>
            )}
          </div>
        )}
      </Panel>
      <Panel title="What happened">
        <Timeline items={t.history.map((h, k) => ({ key: String(k), when: hm(h.min), title: h.action, detail: `${personName(h.by)}${h.note ? ` · ${h.note}` : ""}`, tone: h.action === "Completed" ? "pos" : "neutral" }))} />
      </Panel>
    </div>
  );
}

/** A bell attendant's own tasks, with the next step one tap away. */
export function MyBellTasks() {
  const router = useRouter();
  const { data } = useBell();
  const mutate = useMutate();
  const tasks = (data?.tasks ?? []).filter((t) => !["completed", "cancelled"].includes(t.status));
  if (!data) return null;
  return (
    <Panel title="My luggage tasks">
      {tasks.length === 0 ? <p className="text-sm text-steel">Nothing assigned to you.</p> : (
        <ul className="divide-y divide-hair rounded-2xl border border-line">
          {tasks.map((t) => {
            const next = NEXT[t.status];
            return (
              <li key={t.id} className={cn("flex flex-wrap items-center gap-3 px-4 py-3", t.overdue && "bg-warn-soft")}>
                <button type="button" onClick={() => router.push(`/tasks?task=${t.id}`)} className="flex-1 text-left">
                  <span className="text-[15px] text-ink">Room {t.room} · {KIND[t.kind]}</span>
                  <span className="block text-xs text-steel">{t.from} to {t.to} · {t.bags} bags · {BELL_STATUS[t.status].label}</span>
                </button>
                {next && next.action !== "delivered" && next.action !== "complete" && <Button variant="primary" onClick={async () => { const r = await mutate(`/api/guest/bell/${t.id}`, { expect: t.status, action: next.action }); if (!r.ok) toast.error(r.error); else toast.done(next.label); }}>{next.label}</Button>}
                {(t.status === "collected" || t.status === "delivered") && <Button variant="primary" onClick={() => router.push(`/tasks?task=${t.id}`)}>{t.status === "collected" ? "Record delivery" : "Complete"}</Button>}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export { NewBell };
