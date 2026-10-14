"use client";
// Finding people, asking their department, and the lending manager's decision. Used for events and everyday help alike.
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import { Choice, Steps } from "@/components/forecast/parts";
import { Badge, Button, EmptyState, Field, Note, Panel, Select, TextArea, cn, toast } from "@/components/ui";
import { propertyById } from "@/lib/data/catalog";
import { DEPTS, SKILL_LABEL, deptById, employeeById, type Skill } from "@/lib/data/workforce";
import { can } from "@/lib/domain/access";
import { personName, useView } from "@/lib/hooks";
import { fromHm, toHm, useCandidates, useSchedule, useSupport } from "@/lib/ops-hooks";
import { useMutate } from "@/lib/plan-hooks";
import type { SupportItem, SupportRequest } from "@/lib/types";
import { DEMO_TODAY, addDays, eachDay, fmtDate } from "@/lib/util";

const words = (n: number) => ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][n] ?? String(n);
const skillWord = (s: string, n = 1) => `${SKILL_LABEL[s as Skill]?.toLowerCase() ?? s}${n === 1 ? "" : "s"}`;
const itemStatus: Record<SupportItem["status"], { label: string; tone: "warn" | "pos" | "neg" | "neutral" | "ink" }> = {
  pending: { label: "Waiting for decision", tone: "warn" }, approved: { label: "Confirmed", tone: "pos" }, declined: { label: "Declined", tone: "neg" },
  alternative: { label: "Alternative suggested", tone: "ink" }, cancelled: { label: "Withdrawn", tone: "neutral" },
};

/** People free for the whole time with the skill needed, each with why Tyll thinks so. Picks become a support request. */
export function StaffFinder({ propertyId, skill, date, start, end, toDeptId, need, eventId, role, kind, onSent, initialReason = "" }: {
  propertyId: string; skill: Skill; date: string; start: number; end: number; toDeptId: string; need: number; eventId?: string; role?: string; kind?: string; onSent?: (r: SupportRequest) => void; initialReason?: string;
}) {
  const { data, loading, error } = useCandidates({ propertyId, skill, date, start, end, toDeptId });
  const mutate = useMutate();
  const [picked, setPicked] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [reason, setReason] = useState(initialReason);
  const [askDept, setAskDept] = useState("");
  const [busy, setBusy] = useState(false);
  const [all, setAll] = useState(false);
  const candidates = data?.candidates ?? [];
  // A short list first; the rest one click away.
  const shown = all ? candidates : candidates.filter((c, k) => k < 8 || picked.includes(c.employeeId));
  const deptsWithPeople = [...new Set(candidates.map((c) => c.deptId))];
  const rest = need - picked.length;
  const send = async () => {
    setBusy(true);
    const r = await mutate<{ request: SupportRequest }>("/api/support", { propertyId, toDeptId, eventId, role, skill, date, start, end, count: need, employeeIds: picked, askDeptId: rest > 0 ? askDept || deptsWithPeople[0] : undefined, reason, kind });
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    toast.done(`Request ${r.data.request.id} sent. Each person's own manager decides; nobody counts as confirmed until then.`);
    setPicked([]);
    onSent?.(r.data.request);
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-graphite">{loading && !data ? "Checking rosters, leave and other assignments…" : error ?? data?.note}</p>
      {candidates.length > 0 && (
        <ul className="divide-y divide-hair rounded-2xl border border-line">
          {shown.map((c) => {
            const on = picked.includes(c.employeeId);
            return (
              <li key={c.employeeId} className={cn("px-4 py-3", on && "bg-cloud")}>
                <div className="flex flex-wrap items-center gap-3">
                  <input type="checkbox" className="h-5 w-5 accent-ink" aria-label={`Ask for ${c.name}`} checked={on} disabled={!on && picked.length >= need}
                    onChange={() => setPicked(on ? picked.filter((x) => x !== c.employeeId) : [...picked, c.employeeId])} />
                  <button type="button" aria-expanded={open === c.employeeId} onClick={() => setOpen(open === c.employeeId ? null : c.employeeId)} className="flex flex-1 items-center gap-2 text-left">
                    <ChevronDown size={14} className={cn("shrink-0 text-steel transition-transform duration-200", open === c.employeeId && "rotate-180")} aria-hidden />
                    <span><span className="text-sm text-ink">{c.name}</span><span className="block text-xs text-steel">{c.title}, {c.deptName}</span></span>
                  </button>
                  {c.requestedElsewhere && <Badge tone="warn" className="!py-0">also asked for elsewhere</Badge>}
                  <Badge className="!py-0">free {toHm(start)} to {toHm(end)}</Badge>
                </div>
                {open === c.employeeId && (
                  <ul className="mt-2 space-y-1 pl-12 text-[13px] text-graphite">
                    {c.why.map((w, i) => <li key={i} className="flex gap-2"><Check size={14} className="mt-0.5 shrink-0 text-pos" aria-hidden />{w}</li>)}
                    <li className="text-steel">Proposed: {SKILL_LABEL[skill].toLowerCase()} for {deptById[toDeptId].name}, {fmtDate(date, true)}, {toHm(start)} to {toHm(end)}.</li>
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!all && candidates.length > shown.length && <Button size="sm" variant="ghost" onClick={() => setAll(true)}>Show all {candidates.length}</Button>}
      {(candidates.length > 0 || need > 0) && (
        <div className="space-y-3 rounded-2xl border border-line bg-paper p-4">
          <p className="text-sm text-ink">{picked.length} of {need} picked{rest > 0 && candidates.length > 0 ? `. Ask a department to choose the other ${words(rest)}.` : "."}</p>
          {rest > 0 && candidates.length > 0 && (
            <Select label="Department to ask for the rest" value={askDept || deptsWithPeople[0]} onChange={(e) => setAskDept(e.target.value)}>
              {deptsWithPeople.map((d) => <option key={d} value={d}>{deptById[d].name} ({candidates.filter((c) => c.deptId === d).length} free)</option>)}
            </Select>
          )}
          <Field label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: conference banquet service" />
          <Button variant="primary" disabled={busy || candidates.length === 0} onClick={send}>Request staff support</Button>
          {candidates.length === 0 && <Note>Nobody is free for the whole time. Try shorter hours, change the service style or staffing assumptions, or ask the general manager to review.</Note>}
        </div>
      )}
    </div>
  );
}

// ---- Staff support area --------------------------------------------------------------------------------------------

export function StaffSupport() {
  const params = useSearchParams();
  const id = params.get("request");
  const mode = params.get("mode");
  if (id) return <RequestView id={id} />;
  if (mode === "new") return <RequestHelp />;
  if (mode === "schedule") return <TeamSchedule />;
  return <SupportHome />;
}

function SupportHome() {
  const router = useRouter();
  const { user } = useView();
  const { data, error } = useSupport();
  const requests = data?.requests ?? [];
  const toDecide = requests.filter((r) => r.status === "open" && r.items.some((i) => i.status === "pending" && data!.manages.includes(i.deptId)));
  const mine = requests.filter((r) => r.requestedBy === user.id || (data?.manages.includes(r.toDeptId) && !toDecide.includes(r)));
  const row = (r: SupportRequest) => {
    const confirmed = r.items.filter((i) => i.status === "approved").length;
    return (
      <li key={r.id}>
        <button type="button" onClick={() => router.push(`/events?tab=support&request=${r.id}`)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-cloud">
          <span className="flex-1"><span className="text-sm text-ink">{r.count} {skillWord(r.skill, r.count)} for {deptById[r.toDeptId].name}</span><span className="block text-xs text-steel">{fmtDate(r.date, true)}, {toHm(r.start)} to {toHm(r.end)} · {r.id}</span></span>
          {r.priority === "urgent" && <Badge tone="warn" className="!py-0">urgent</Badge>}
          <Badge tone={r.status === "filled" ? "pos" : r.status === "cancelled" ? "neutral" : "warn"} className="!py-0">{r.status === "cancelled" ? "Withdrawn" : `${confirmed} of ${r.count} confirmed`}</Badge>
        </button>
      </li>
    );
  };
  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-2">
        {can(user, "staff.request") && (data?.canRequestFor.length ?? 0) > 0 && (
          <button type="button" onClick={() => router.push("/events?tab=support&mode=new")} className="rounded-panel border border-line bg-paper p-6 text-left shadow-panel transition-colors hover:border-fog">
            <span className="block text-xl tracking-[-0.02em]">Request extra help</span><span className="mt-1 block text-sm text-steel">Ask another department for people with the right skill.</span>
          </button>
        )}
        {(data?.manages.length ?? 0) > 0 && (
          <button type="button" onClick={() => router.push("/events?tab=support&mode=schedule")} className="rounded-panel border border-line bg-paper p-6 text-left shadow-panel transition-colors hover:border-fog">
            <span className="block text-xl tracking-[-0.02em]">Team schedule</span><span className="mt-1 block text-sm text-steel">Who is working, lent out or borrowed on a day.</span>
          </button>
        )}
      </div>
      {error ? <Panel><EmptyState title="Requests could not be loaded">{error}</EmptyState></Panel> : (
        <>
          <Panel title="Waiting for your decision" flush>
            {toDecide.length === 0 ? <p className="px-6 pb-6 text-sm text-steel">Nothing to decide.</p> : <ul className="divide-y divide-hair border-t border-hair">{toDecide.map(row)}</ul>}
          </Panel>
          <Panel title="Requests for your team" flush>
            {mine.length === 0 ? <p className="px-6 pb-6 text-sm text-steel">No requests yet.</p> : <ul className="divide-y divide-hair border-t border-hair">{mine.map(row)}</ul>}
          </Panel>
        </>
      )}
    </div>
  );
}

const HELP: { value: string; label: string; skill: Skill }[] = [
  { value: "restaurant", label: "Restaurant service", skill: "waiter" },
  { value: "bar", label: "Bar service", skill: "bartender" },
  { value: "kitchen", label: "Kitchen support", skill: "kitchen_assistant" },
  { value: "setup", label: "Event setup", skill: "setup" },
  { value: "front", label: "Front desk support", skill: "front_desk" },
  { value: "hk", label: "Housekeeping support", skill: "housekeeping" },
  { value: "bell", label: "Bell and luggage support", skill: "bell" },
  { value: "other", label: "Other task", skill: "cleaning" },
];

/** What, when, who, send: four short screens. */
function RequestHelp() {
  const router = useRouter();
  const p = useSearchParams();
  const { data } = useSupport();
  const depts = (data?.canRequestFor ?? []).filter((d) => deptById[d]);
  // Another screen can open this with the request already filled in, such as housekeeping short of people.
  const preset = HELP.find((h) => h.value === p.get("kind"));
  const [step, setStep] = useState(preset ? 3 : 1);
  const [kind, setKind] = useState(preset?.value ?? HELP[0].value);
  const [skill, setSkill] = useState<Skill>(preset?.skill ?? HELP[0].skill);
  const [dept, setDept] = useState(p.get("dept") ?? "");
  const [date, setDate] = useState(p.get("date") ?? DEMO_TODAY);
  const [start, setStart] = useState(p.get("start") ?? "18:00");
  const [end, setEnd] = useState(p.get("end") ?? "23:00");
  const [count, setCount] = useState(Math.max(1, Number(p.get("count") ?? 2)));
  const reason = p.get("reason") ?? "";
  const toDept = dept || depts[0] || "";
  if (!data) return <Panel><EmptyState title="Loading" /></Panel>;
  if (!depts.length) return <Panel><EmptyState title="You cannot request help for a department" /></Panel>;
  const propertyId = deptById[toDept].propertyId;
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3"><Button variant="ghost" size="sm" onClick={() => router.push("/events?tab=support")}><ArrowLeft size={15} /> Staff support</Button></div>
      <Steps steps={["What", "When and how many", "Who can help"]} current={step} onGo={setStep} />
      {step === 1 && (
        <Panel title="What do you need help with?">
          <div className="space-y-5">
            <Choice label="Help with" value={kind} options={HELP.map((h) => ({ value: h.value, label: h.label }))} onChange={(v) => { setKind(v); setSkill(HELP.find((h) => h.value === v)!.skill); }} />
            {kind === "other" && <Choice label="Skill needed" value={skill} options={(["cleaning", "runner", "setup", "supervisor", "chef"] as Skill[]).map((s) => ({ value: s, label: SKILL_LABEL[s] }))} onChange={setSkill} />}
            <Button variant="primary" onClick={() => setStep(2)}>Next <ArrowRight size={15} /></Button>
          </div>
        </Panel>
      )}
      {step === 2 && (
        <Panel title="When, and how much help?">
          <div className="grid gap-4 md:grid-cols-2">
            <Select label="For" value={toDept} onChange={(e) => setDept(e.target.value)}>{depts.map((d) => <option key={d} value={d}>{deptById[d].name}, {propertyById[deptById[d].propertyId].name}</option>)}</Select>
            <Select label="Date" value={date} onChange={(e) => setDate(e.target.value)}>{eachDay({ from: DEMO_TODAY, to: addDays(DEMO_TODAY, 7) }).map((d) => <option key={d} value={d}>{fmtDate(d, true)}</option>)}</Select>
            <Field label="Start" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            <Field label="End" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
            <Field label="People needed" type="number" min={1} max={10} value={count} onChange={(e) => setCount(Math.max(1, Math.min(10, Number(e.target.value))))} />
            <p className="self-end pb-3 text-sm text-graphite">Skill: <span className="text-ink">{SKILL_LABEL[skill]}</span></p>
          </div>
          <div className="mt-5 flex gap-2">
            <Button variant="ghost" onClick={() => setStep(1)}><ArrowLeft size={15} /> Back</Button>
            <Button variant="primary" disabled={fromHm(end) <= fromHm(start)} onClick={() => setStep(3)}>See who can help <ArrowRight size={15} /></Button>
          </div>
        </Panel>
      )}
      {step === 3 && (
        <Panel title="Who can help" description={`${count} ${skillWord(skill, count)} for ${deptById[toDept].name}, ${fmtDate(date, true)}, ${start} to ${end}.`}>
          <StaffFinder propertyId={propertyId} skill={skill} date={date} start={fromHm(start)} end={fromHm(end)} toDeptId={toDept} need={count} kind={HELP.find((h) => h.value === kind)!.label} initialReason={reason}
            onSent={(r) => router.push(`/events?tab=support&request=${r.id}`)} />
          <Button className="mt-4" variant="ghost" onClick={() => setStep(2)}><ArrowLeft size={15} /> Back</Button>
        </Panel>
      )}
    </div>
  );
}

/** One request: each person's status, and the actions this user may take. */
function RequestView({ id }: { id: string }) {
  const router = useRouter();
  const { user } = useView();
  const { data, error } = useSupport();
  const mutate = useMutate();
  const r = data?.requests.find((x) => x.id === id);
  if (!data) return <Panel><EmptyState title={error ?? "Loading the request"} /></Panel>;
  if (!r) return <Panel><EmptyState title="This request is not available" action={<Button onClick={() => router.push("/events?tab=support")}>Staff support</Button>}>It does not exist, or it is outside your departments.</EmptyState></Panel>;
  const confirmed = r.items.filter((i) => i.status === "approved").length;
  const stillNeeded = r.count - confirmed;
  const requester = r.requestedBy === user.id || data.manages.includes(r.toDeptId);
  const act = async (body: Record<string, unknown>, done: string) => {
    const res = await mutate(`/api/support/${r.id}`, body);
    if (!res.ok) return toast.error(res.error), false;
    toast.done(done);
    return true;
  };
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3"><Button variant="ghost" size="sm" onClick={() => router.push("/events?tab=support")}><ArrowLeft size={15} /> Staff support</Button></div>
      <Panel
        title={<span className="flex flex-wrap items-center gap-3"><span>Staff support request</span><Badge tone={r.status === "filled" ? "pos" : r.status === "cancelled" ? "neutral" : "warn"}>{r.status === "cancelled" ? "Withdrawn" : `${confirmed} of ${r.count} confirmed`}</Badge></span>}
        description={`The ${deptById[r.toDeptId].name.replace(/^The /, "")} team is requesting ${r.count} ${skillWord(r.skill, r.count)} on ${fmtDate(r.date, true)} from ${toHm(r.start)} to ${toHm(r.end)}. ${r.reason}`}
      >
        <p className="text-[15px] text-ink">{r.status === "cancelled" ? "This request was withdrawn." : stillNeeded > 0 ? `${confirmed} of ${r.count} staff confirmed. ${stillNeeded} still needed.` : "All requested staff are confirmed."}</p>
        <p className="mt-1 text-xs text-steel">{r.id} · requested by {personName(r.requestedBy)}{r.eventId ? " · for an event" : ""}{r.priority === "urgent" ? " · urgent" : ""}</p>
      </Panel>
      <div className="space-y-3">
        {r.items.map((i) => <ItemCard key={i.id} r={r} i={i} mayDecide={can(user, "staff.lend") && data.manages.includes(i.deptId) && i.status === "pending"} mayRespond={requester && i.status === "alternative"} act={act} />)}
      </div>
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <Panel title="History">
          <ul className="space-y-3">
            {r.history.slice().reverse().map((h, k) => (
              <li key={k} className="text-sm"><p className="flex flex-wrap justify-between gap-2"><span className="text-ink">{h.action}</span><span className="text-xs text-steel">{personName(h.by)} · {new Date(h.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span></p>{h.comment && <p className="text-graphite">{h.comment}</p>}</li>
            ))}
          </ul>
        </Panel>
        {requester && r.status !== "cancelled" && (
          <Panel title="Withdraw the request">
            <p className="text-sm text-graphite">Anyone already confirmed is released, and their manager sees it. The original decisions stay on record.</p>
            <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); const why = String(new FormData(e.currentTarget).get("why") ?? ""); void act({ action: "cancel", reason: why }, "Request withdrawn."); }}>
              <Field label="Reason" name="why" className="min-w-[200px] flex-1" placeholder="For example: the party cancelled" />
              <Button type="submit" variant="ghost">Withdraw</Button>
            </form>
          </Panel>
        )}
      </div>
    </div>
  );
}

function ItemCard({ r, i, mayDecide, mayRespond, act }: { r: SupportRequest; i: SupportItem; mayDecide: boolean; mayRespond: boolean; act: (b: Record<string, unknown>, done: string) => Promise<boolean> }) {
  const [mode, setMode] = useState<"" | "decline" | "alternative">("");
  const [comment, setComment] = useState("");
  const [alt, setAlt] = useState("");
  const [altStart, setAltStart] = useState(toHm(r.start));
  const [altEnd, setAltEnd] = useState(toHm(r.end));
  const { data: options } = useCandidates(mode === "alternative" || (mayDecide && !i.employeeId) ? { propertyId: r.propertyId, skill: r.skill, date: r.date, start: fromHm(altStart), end: fromHm(altEnd), toDeptId: r.toDeptId } : null);
  const ownPeople = useMemo(() => (options?.candidates ?? []).filter((c) => c.deptId === i.deptId && c.employeeId !== i.employeeId), [options, i]);
  const who = i.employeeId ? employeeById[i.employeeId] : undefined;
  const s = itemStatus[i.status];
  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[15px] text-ink">{who ? who.name : `Any suitable ${SKILL_LABEL[r.skill as Skill].toLowerCase()}`}</p>
          <p className="text-xs text-steel">{who ? `${who.title}, ` : ""}{deptById[i.deptId].name}{i.decidedBy ? ` · decided by ${personName(i.decidedBy)}` : ""}</p>
        </div>
        <Badge tone={s.tone}>{s.label}</Badge>
      </div>
      {i.comment && <p className="mt-2 text-sm text-graphite">{i.comment}</p>}
      {i.status === "alternative" && i.proposed && (
        <p className="mt-2 text-sm text-ink">Suggested instead: {employeeById[i.proposed.employeeId].name}, {toHm(i.proposed.start)} to {toHm(i.proposed.end)}.</p>
      )}
      {mayRespond && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="primary" size="sm" onClick={() => act({ action: "respond", itemId: i.id, accept: true }, "Alternative accepted. The assignment is confirmed.")}>Accept the alternative</Button>
          <Button size="sm" onClick={() => act({ action: "respond", itemId: i.id, accept: false }, "Alternative not accepted.")}>Reject</Button>
        </div>
      )}
      {mayDecide && (
        <div className="mt-4 space-y-3 border-t border-hair pt-4">
          {!i.employeeId && (
            <Select label="Choose who goes" value={alt} onChange={(e) => setAlt(e.target.value)}>
              <option value="">Choose a person from your team</option>
              {ownPeople.map((c) => <option key={c.employeeId} value={c.employeeId}>{c.name}, {c.title}</option>)}
            </Select>
          )}
          {mode === "" && (
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" size="sm" disabled={!i.employeeId && !alt} onClick={() => act({ action: "decide", itemId: i.id, decision: "approve", employeeId: i.employeeId ? undefined : alt }, "Approved. The assignment is confirmed and both schedules show it.")}>Approve</Button>
              <Button size="sm" onClick={() => setMode("decline")}>Decline</Button>
              <Button size="sm" variant="ghost" onClick={() => setMode("alternative")}>Suggest alternative</Button>
            </div>
          )}
          {mode === "decline" && (
            <div className="space-y-2">
              <TextArea label="Reason" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="For example: we are short ourselves that evening" />
              <div className="flex gap-2"><Button size="sm" variant="primary" onClick={() => act({ action: "decide", itemId: i.id, decision: "decline", comment }, "Declined.")}>Decline</Button><Button size="sm" variant="ghost" onClick={() => setMode("")}>Back</Button></div>
            </div>
          )}
          {mode === "alternative" && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="From" type="time" value={altStart} onChange={(e) => setAltStart(e.target.value)} />
                <Field label="To" type="time" value={altEnd} onChange={(e) => setAltEnd(e.target.value)} />
              </div>
              <Select label="Person" value={alt} onChange={(e) => setAlt(e.target.value)}>
                <option value="">{i.employeeId ? `${who?.name}, at these hours` : "Choose a person"}</option>
                {ownPeople.map((c) => <option key={c.employeeId} value={c.employeeId}>{c.name}, {c.title}</option>)}
              </Select>
              <Field label="Comment" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="For example: can start at 19:00" />
              <div className="flex gap-2">
                <Button size="sm" variant="primary" disabled={!alt && !i.employeeId} onClick={() => act({ action: "decide", itemId: i.id, decision: "alternative", employeeId: alt || i.employeeId, start: fromHm(altStart), end: fromHm(altEnd), comment }, "Alternative sent to the requesting manager.")}>Send suggestion</Button>
                <Button size="sm" variant="ghost" onClick={() => setMode("")}>Back</Button>
              </div>
              {ownPeople.length === 0 && <Note>Nobody else in your team is free at those hours.</Note>}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

/** A department's day: own people, who is lent out, and who is borrowed. */
function TeamSchedule() {
  const router = useRouter();
  const { data } = useSupport();
  const depts = data?.manages ?? [];
  const [dept, setDept] = useState("");
  const [date, setDate] = useState(addDays(DEMO_TODAY, 2));
  const d = dept || depts[0] || null;
  const { data: sched, error } = useSchedule(d, date);
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3"><Button variant="ghost" size="sm" onClick={() => router.push("/events?tab=support")}><ArrowLeft size={15} /> Staff support</Button></div>
      <Panel title="Team schedule">
        <div className="flex flex-wrap gap-3">
          <Select label="Department" value={d ?? ""} onChange={(e) => setDept(e.target.value)}>{depts.map((x) => <option key={x} value={x}>{DEPTS.find((y) => y.id === x)!.name}, {propertyById[deptById[x].propertyId].name}</option>)}</Select>
          <Select label="Day" value={date} onChange={(e) => setDate(e.target.value)}>{eachDay({ from: DEMO_TODAY, to: addDays(DEMO_TODAY, 7) }).map((x) => <option key={x} value={x}>{fmtDate(x, true)}</option>)}</Select>
        </div>
      </Panel>
      {error ? <Panel><EmptyState title={error} /></Panel> : !sched ? <Panel><EmptyState title="Loading" /></Panel> : (
        <>
          {sched.borrowed.length > 0 && (
            <Panel title="Borrowed from other departments">
              <ul className="space-y-2 text-sm">{sched.borrowed.map((b, k) => <li key={k} className="flex flex-wrap justify-between gap-2"><span className="text-ink">{b.name}, from {b.from}</span><span className="text-graphite">{b.time} · {b.for}</span></li>)}</ul>
            </Panel>
          )}
          <Panel title="Your team" flush>
            <ul className="divide-y divide-hair border-t border-hair">
              {sched.rows.map((row) => (
                <li key={row.employeeId} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm sm:px-6">
                  <span><span className="text-ink">{row.name}</span><span className="block text-xs text-steel">{row.title}</span></span>
                  <span className="flex flex-wrap items-center gap-2">
                    {row.leave ? <Badge className="!py-0">{row.leave}</Badge> : row.shift ? <span className="num text-graphite">{row.shift}</span> : <span className="text-steel">Off</span>}
                    {row.away.map((a, k) => <Badge key={k} tone="warn" className="!py-0">Lent out: {a}</Badge>)}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </>
      )}
    </div>
  );
}
