"use client";
// Tyll Staff: a phone-first view for frontline work. Same sign-in, same server records and the same calculations as
// the management screens; each person sees only the actions their job needs.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, BedDouble, Check, ChefHat, ClipboardCheck, ConciergeBell, GlassWater, Luggage, Minus, PackageCheck, Plus, Trash2, type LucideIcon } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { BellTaskView } from "@/components/guest/bell";
import { RoomDetail } from "@/components/guest/rooms";
import { Badge, Button, EmptyState, Field, Note, cn, toast } from "@/components/ui";
import { INGREDIENTS, ingredientById, itemById, outletById, propertyById } from "@/lib/data/catalog";
import { allowedOutlets, allowedProperties, can } from "@/lib/domain/access";
import { wasteCost } from "@/lib/domain/inventory";
import { hm, useBell, useLiveGet, useRoomsBoard } from "@/lib/guest-hooks";
import { personName, useCtx, useView } from "@/lib/hooks";
import { REASON_LABEL } from "@/lib/labels";
import { useOpsAlerts } from "@/lib/ops-hooks";
import { useMutate, usePrepPlans } from "@/lib/plan-hooks";
import { useShared } from "@/lib/shared-stock";
import type { PurchaseRequest, ServiceRequest, User, WasteReason } from "@/lib/types";
import { DEMO_TODAY, fmtMoney, fmtQty } from "@/lib/util";

type Do = "waste" | "breakage" | "prep" | "rooms" | "bell" | "requests" | "count" | "receive";

interface Action { id: Do; label: string; icon: LucideIcon }

/** The quick actions this person's job allows. Some roles have two or three; that is intended. */
export function staffActions(user: User): Action[] {
  const outlets = allowedOutlets(user).length > 0;
  return ([
    can(user, "stock.logWaste") && outlets && { id: "waste", label: "Log waste", icon: Trash2 },
    can(user, "stock.logWaste") && outlets && { id: "breakage", label: "Log breakage", icon: GlassWater },
    can(user, "prep.complete") && user.role === "employee" && outlets && { id: "prep", label: "Prep tasks", icon: ChefHat },
    can(user, "hk.clean") && user.deptId === "dxb-hk" && { id: "rooms", label: "My rooms", icon: BedDouble },
    can(user, "bell.task") && user.deptId === "dxb-bell" && { id: "bell", label: "Luggage tasks", icon: Luggage },
    can(user, "concierge") && { id: "requests", label: "Guest requests", icon: ConciergeBell },
    can(user, "stock.count") && (user.role === "storekeeper" || outlets) && { id: "count", label: "Stock count", icon: ClipboardCheck },
    can(user, "purchase.receive") && { id: "receive", label: "Deliveries", icon: PackageCheck },
  ].filter(Boolean) as Action[]);
}

function Screen({ title, back = "/staff", children }: { title: string; back?: string; children: ReactNode }) {
  return (
    <div className="space-y-4">
      <Link href={back} className="inline-flex h-11 items-center gap-2 rounded-full pr-3 text-[15px] text-graphite hover:text-ink"><ArrowLeft size={18} /> Back</Link>
      <h1 className="text-[26px] leading-tight tracking-[-0.02em]">{title}</h1>
      {children}
    </div>
  );
}

const Big = ({ children, className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button type="button" {...p} className={cn("flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-ink px-5 text-[17px] font-medium text-paper transition-transform duration-300 ease-tyll active:scale-[0.98] disabled:opacity-40", className)}>{children}</button>
);

export function StaffApp() {
  const params = useSearchParams();
  const { user } = useView();
  const what = params.get("do") as Do | null;
  const allowed = staffActions(user).map((a) => a.id);
  if (what && !allowed.includes(what)) return <Screen title="Not available"><EmptyState title="This action is not part of your job in Tyll." /></Screen>;
  if (what === "waste" || what === "breakage") return <QuickLog kind={what} />;
  if (what === "prep") return <PrepTasks />;
  if (what === "rooms") return params.get("room") ? <RoomDetail roomId={params.get("room")!} back="/staff?do=rooms" /> : <MyRoomsMobile />;
  if (what === "bell") return params.get("task") ? <BellTaskView id={params.get("task")!} back="/staff?do=bell" /> : <BellMobile />;
  if (what === "requests") return <RequestsMobile />;
  if (what === "count") return <CountMobile />;
  if (what === "receive") return <ReceiveMobile />;
  return <StaffHome />;
}

// ---- Home ----------------------------------------------------------------------------------------------------------

function StaffHome() {
  const { user } = useView();
  const actions = staffActions(user);
  const tasks = useMyTasks(user);
  const alerts = useOpsAlerts().data?.alerts ?? [];
  const mine = useShared((s) => s.waste).filter((w) => w.byUser === user.id).sort((a, b) => b.seq - a.seq).slice(0, 3);
  const counts = useShared((s) => s.counts).filter((c) => c.byUser === user.id).slice(-2).reverse();
  return (
    <div className="space-y-7">
      <div>
        <p className="text-[15px] text-steel">Good evening</p>
        <h1 className="text-[28px] leading-tight tracking-[-0.02em]">{user.name.split(" ")[0]}</h1>
      </div>
      <section aria-labelledby="t-tasks">
        <h2 id="t-tasks" className="mb-2 text-[13px] font-medium text-graphite">Your tasks</h2>
        {tasks.length === 0 ? <p className="rounded-2xl border border-line px-4 py-4 text-[15px] text-steel">Nothing assigned to you right now.</p> : (
          <ul className="divide-y divide-hair overflow-hidden rounded-2xl border border-line bg-paper">
            {tasks.map((t) => <li key={t.key}><Link href={t.href} className="flex min-h-14 items-center gap-3 px-4 py-3"><span className="flex-1"><span className="block text-[15px] text-ink">{t.title}</span><span className="block text-[13px] text-steel">{t.sub}</span></span>{t.badge && <Badge tone={t.tone ?? "ink"} className="!py-0">{t.badge}</Badge>}</Link></li>)}
          </ul>
        )}
      </section>
      <section aria-labelledby="t-quick">
        <h2 id="t-quick" className="mb-2 text-[13px] font-medium text-graphite">Quick actions</h2>
        {actions.length === 0 ? <p className="text-[15px] text-steel">No quick actions for your role.</p> : (
          <ul className="grid grid-cols-2 gap-3">
            {actions.map((a) => <li key={a.id}><Link href={`/staff?do=${a.id}`} className="flex h-24 flex-col justify-between rounded-2xl border border-line bg-paper p-4 transition-colors hover:border-fog"><a.icon size={22} strokeWidth={1.6} aria-hidden /><span className="text-[15px] text-ink">{a.label}</span></Link></li>)}
          </ul>
        )}
      </section>
      <section aria-labelledby="t-updates">
        <h2 id="t-updates" className="mb-2 text-[13px] font-medium text-graphite">Updates</h2>
        <ul className="space-y-2 text-[15px]">
          {alerts.slice(0, 3).map((a) => <li key={a.id} className="rounded-2xl bg-mist px-4 py-3">{a.text}</li>)}
          {mine.map((w) => <li key={w.id} className="rounded-2xl border border-line px-4 py-3"><span className="text-ink">Saved: {fmtQty(w.qty, w.ingredientId ? ingredientById[w.ingredientId].unit : "each")} {w.ingredientId ? ingredientById[w.ingredientId].name : itemById[w.itemId!].name}</span><span className="block text-[13px] text-steel">{REASON_LABEL[w.reason].en} · {outletById[w.outletId].name} · {w.at.slice(11, 16)}</span></li>)}
          {counts.map((c) => <li key={c.id} className="rounded-2xl border border-line px-4 py-3"><span className="text-ink">Count: {ingredientById[c.ingredientId].name}, {fmtQty(c.counted, ingredientById[c.ingredientId].unit)}</span><span className="block text-[13px] text-steel">{c.status === "submitted" ? "Waiting for a manager" : c.status === "accepted" ? "Accepted" : `Rejected${c.reviewNote ? `: ${c.reviewNote}` : ""}`}</span></li>)}
          {alerts.length === 0 && mine.length === 0 && counts.length === 0 && <li className="text-steel">No updates.</li>}
        </ul>
      </section>
    </div>
  );
}

interface TaskRow { key: string; title: string; sub: string; href: string; badge?: string; tone?: "warn" | "ink" | "pos" | "neg" }

function useMyTasks(user: User): TaskRow[] {
  const prep = usePrepPlans().data;
  const rooms = useRoomsBoard(can(user, "hk.clean") && user.deptId === "dxb-hk").data;
  const bell = useBell(can(user, "bell.task") && user.deptId === "dxb-bell").data;
  const out: TaskRow[] = [];
  if (user.role === "employee") {
    for (const p of prep?.plans ?? []) for (const t of p.tasks.filter((x) => x.assigneeId === user.id && !x.done)) out.push({ key: t.id, title: `Prepare ${t.portions} ${itemById[t.itemId].name.toLowerCase()}`, sub: `${outletById[p.outletId].name}${t.startedAt ? " · started" : ""}`, href: "/staff?do=prep", badge: t.startedAt ? "In progress" : "To do" });
  }
  for (const r of (rooms?.board.rooms ?? []).filter((x) => ["vacant_dirty", "cleaning", "inspection"].includes(x.status))) out.push({ key: r.roomId, title: `Room ${r.number}`, sub: `${r.type}${r.arrival ? ` · guest due ${hm(r.arrival.etaMin)}` : ""}`, href: `/staff?do=rooms&room=${r.roomId}`, badge: r.status === "cleaning" ? "Cleaning" : r.status === "inspection" ? "Awaiting inspection" : r.priority ? "Priority" : "To clean", tone: r.priority ? "warn" : "ink" });
  for (const t of (bell?.tasks ?? []).filter((x) => !["completed", "cancelled"].includes(x.status))) out.push({ key: t.id, title: `Room ${t.room} · ${t.bags} bags`, sub: `${t.from} to ${t.to}`, href: `/staff?do=bell&task=${t.id}`, badge: t.overdue ? "Overdue" : t.status.replace("_", " "), tone: t.overdue ? "neg" : "ink" });
  return out;
}

// ---- Waste and breakage --------------------------------------------------------------------------------------------

const REASONS: Record<"waste" | "breakage", WasteReason[]> = { waste: ["waste", "spoilage", "other"], breakage: ["breakage", "damaged"] };

function QuickLog({ kind }: { kind: "waste" | "breakage" }) {
  const { user } = useView();
  const ctx = useCtx();
  const mutate = useMutate();
  const outlets = allowedOutlets(user);
  const [outletId, setOutletId] = useState(outlets[0]);
  const [pick, setPick] = useState<{ kind: "ingredient" | "dish"; id: string } | null>(null);
  const [term, setTerm] = useState("");
  const [qty, setQty] = useState(1);
  const [reason, setReason] = useState<WasteReason>(REASONS[kind][0]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ label: string; cost: number; at: string } | null>(null);
  const outlet = outletById[outletId];
  const currency = propertyById[outlet.propertyId].currency;
  const items = useMemo(() => {
    if (kind === "breakage") return INGREDIENTS.filter((g) => g.dept === "glassware").map((g) => ({ kind: "ingredient" as const, id: g.id, name: g.name }));
    const used = new Set(outlet.menu.flatMap((m) => itemById[m.itemId].recipe?.map((l) => l.ingredientId) ?? []));
    return [
      ...outlet.menu.filter((m) => itemById[m.itemId].recipe).map((m) => ({ kind: "dish" as const, id: m.itemId, name: itemById[m.itemId].name })),
      ...INGREDIENTS.filter((g) => used.has(g.id)).map((g) => ({ kind: "ingredient" as const, id: g.id, name: g.name })),
    ];
  }, [kind, outlet]);
  const shown = items.filter((i) => i.name.toLowerCase().includes(term.toLowerCase())).slice(0, 24);
  const unit = pick?.kind === "ingredient" ? ingredientById[pick.id].unit : "each";
  const step = unit === "each" ? 1 : 0.5;
  const title = kind === "waste" ? "Log waste" : "Log breakage";

  if (saved) return (
    <Screen title={title}>
      <div className="rounded-2xl border border-line px-5 py-8 text-center" role="status">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-pos-soft text-pos"><Check size={28} /></span>
        <p className="mt-4 text-[20px]">Saved</p>
        <p className="mt-1 text-[15px] text-graphite">{saved.label} · {fmtMoney(saved.cost, currency, { decimals: true })}</p>
        <p className="mt-1 text-[13px] text-steel">{user.name} · {saved.at}. Stock is updated for your manager too.</p>
      </div>
      <Big onClick={() => { setSaved(null); setPick(null); setQty(1); setNote(""); }}>Log another</Big>
    </Screen>
  );

  if (!pick) return (
    <Screen title={title}>
      {outlets.length > 1 && (
        <label className="block text-[13px] text-graphite">Outlet
          <select className="mt-1 h-12 w-full rounded-2xl border border-line bg-paper px-3 text-[15px]" value={outletId} onChange={(e) => setOutletId(e.target.value)}>{outlets.map((o) => <option key={o} value={o}>{outletById[o].name}</option>)}</select>
        </label>
      )}
      {kind === "waste" && <Field label="Find an item" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="For example: chicken" />}
      <ul className="grid grid-cols-2 gap-2">
        {shown.map((i) => <li key={`${i.kind}-${i.id}`}><button type="button" onClick={() => setPick(i)} className="flex min-h-16 w-full items-center rounded-2xl border border-line bg-paper px-4 py-3 text-left text-[15px] hover:border-fog">{i.name}</button></li>)}
      </ul>
      {shown.length === 0 && <p className="text-[15px] text-steel">No item matches. Try another word.</p>}
    </Screen>
  );

  const label = `${fmtQty(qty, unit)} ${unit === "each" ? "× " : ""}${pick.kind === "dish" ? itemById[pick.id].name : ingredientById[pick.id].name}`;
  return (
    <Screen title={pick.kind === "dish" ? itemById[pick.id].name : ingredientById[pick.id].name} back={`/staff?do=${kind}`}>
      <p className="-mt-2 text-[15px] text-steel">{outlet.name}</p>
      <div className="flex items-center justify-between rounded-2xl border border-line p-2">
        <button type="button" aria-label="Less" onClick={() => setQty((q) => Math.max(step, Math.round((q - step) * 100) / 100))} className="flex h-14 w-14 items-center justify-center rounded-xl bg-mist"><Minus size={22} /></button>
        <label className="flex flex-col items-center"><span className="sr-only">Quantity</span><input inputMode="decimal" className="w-24 bg-transparent text-center text-[32px] tracking-[-0.02em] outline-none" value={qty} onChange={(e) => setQty(Number(e.target.value) || 0)} /><span className="text-[13px] text-steel">{unit === "each" ? (pick.kind === "dish" ? "portions" : "units") : unit}</span></label>
        <button type="button" aria-label="More" onClick={() => setQty((q) => Math.round((q + step) * 100) / 100)} className="flex h-14 w-14 items-center justify-center rounded-xl bg-mist"><Plus size={22} /></button>
      </div>
      <fieldset>
        <legend className="mb-2 text-[13px] text-graphite">Reason</legend>
        <div className="flex flex-wrap gap-2">{REASONS[kind].map((r) => <button key={r} type="button" aria-pressed={reason === r} onClick={() => setReason(r)} className={cn("h-11 rounded-full border px-4 text-[15px]", reason === r ? "border-ink bg-ink text-paper" : "border-line")}>{REASON_LABEL[r].en}</button>)}</div>
      </fieldset>
      <Field label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === "breakage" ? "For example: dropped tray at table 12" : ""} />
      <Big disabled={busy || qty <= 0} onClick={async () => {
        setBusy(true);
        const r = await mutate<{ entry: { at: string } }>("/api/stock/waste", { outletId, qty, reason, note, ...(pick.kind === "dish" ? { itemId: pick.id } : { ingredientId: pick.id }) });
        setBusy(false);
        if (!r.ok) return toast.error(r.error);
        const cost = wasteCost({ id: "", outletId, date: DEMO_TODAY, qty, reason, by: "", synced: true, seq: 0, ...(pick.kind === "dish" ? { itemId: pick.id } : { ingredientId: pick.id }) }, ctx.overrides);
        setSaved({ label, cost, at: r.data.entry.at.slice(11, 16) });
      }}>Save {label}</Big>
    </Screen>
  );
}

// ---- Kitchen -------------------------------------------------------------------------------------------------------

function PrepTasks() {
  const { user } = useView();
  const { data } = usePrepPlans();
  const mutate = useMutate();
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const tasks = (data?.plans ?? []).flatMap((p) => p.tasks.filter((t) => t.assigneeId === user.id).map((t) => ({ p, t }))).sort((a, b) => Number(a.t.done) - Number(b.t.done));
  const act = async (planId: string, taskId: string, body: Record<string, unknown>, done: string) => {
    const r = await mutate("/api/plan/prep", { action: "task", planId, taskId, ...body });
    if (!r.ok) return toast.error(r.error);
    toast.done(done);
    setProblem(null); setNote("");
  };
  if (!data) return <Screen title="Prep tasks"><p className="text-steel">Loading</p></Screen>;
  return (
    <Screen title="Prep tasks">
      {tasks.length === 0 ? <EmptyState title="No prep tasks assigned to you">The chef assigns tasks in What to Prep.</EmptyState> : (
        <ul className="space-y-3">
          {tasks.map(({ p, t }) => (
            <li key={t.id} className={cn("rounded-2xl border border-line p-4", t.done && "opacity-60")}>
              <p className="text-[17px] text-ink">Prepare {itemById[t.itemId].name}</p>
              <p className="text-[15px] text-graphite">Required: <span className="num">{t.portions}</span> portions · {outletById[p.outletId].name}</p>
              <p className="text-[13px] text-steel">{t.done ? `Done at ${t.doneAt?.slice(11, 16)}` : t.startedAt ? `Started at ${t.startedAt.slice(11, 16)}` : "Not started"}{t.issue ? ` · Problem: ${t.issue.note}` : ""}</p>
              {!t.done && (
                <div className="mt-3 space-y-2">
                  {!t.startedAt ? <Big onClick={() => act(p.id, t.id, { op: "start" }, "Started.")}>Start</Big> : <Big onClick={() => act(p.id, t.id, { op: "complete", done: true }, "Marked complete. The chef can see it.")}>Mark complete</Big>}
                  {problem === t.id ? (
                    <div className="space-y-2">
                      <Field label="What is missing or wrong?" value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: only 3 kg chicken in the walk-in" />
                      <Button size="lg" className="w-full" onClick={() => act(p.id, t.id, { op: "report", note }, "Reported to the chef.")}>Send to the chef</Button>
                    </div>
                  ) : <Button size="lg" variant="ghost" className="w-full" onClick={() => setProblem(t.id)}>Report missing ingredient</Button>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}

// ---- Housekeeping and bell -----------------------------------------------------------------------------------------

function MyRoomsMobile() {
  const { data } = useRoomsBoard();
  const rooms = (data?.board.rooms ?? []).filter((r) => ["vacant_dirty", "cleaning", "inspection"].includes(r.status)).sort((a, b) => Number(b.status === "cleaning") - Number(a.status === "cleaning") || Number(b.priority) - Number(a.priority));
  return (
    <Screen title="My rooms">
      {!data ? <p className="text-steel">Loading</p> : rooms.length === 0 ? <EmptyState title="No rooms assigned to you" /> : (
        <ul className="space-y-2">
          {rooms.map((r) => (
            <li key={r.roomId}><Link href={`/staff?do=rooms&room=${r.roomId}`} className="flex min-h-16 items-center gap-3 rounded-2xl border border-line bg-paper px-4 py-3">
              <span className="flex-1"><span className="block text-[17px] text-ink">Room {r.number}</span><span className="block text-[13px] text-steel">{r.type}{r.arrival ? ` · guest due ${hm(r.arrival.etaMin)}` : ""}</span></span>
              <Badge tone={r.priority ? "warn" : "ink"} className="!py-0">{r.status === "cleaning" ? "Cleaning" : r.status === "inspection" ? "Awaiting inspection" : r.priority ? "Priority" : "To clean"}</Badge>
            </Link></li>
          ))}
        </ul>
      )}
    </Screen>
  );
}

function BellMobile() {
  const { data } = useBell();
  const tasks = (data?.tasks ?? []).filter((t) => !["completed", "cancelled"].includes(t.status));
  return (
    <Screen title="Luggage tasks">
      {!data ? <p className="text-steel">Loading</p> : tasks.length === 0 ? <EmptyState title="No luggage tasks assigned to you" /> : (
        <ul className="space-y-2">
          {tasks.map((t) => (
            <li key={t.id}><Link href={`/staff?do=bell&task=${t.id}`} className={cn("flex min-h-16 items-center gap-3 rounded-2xl border border-line bg-paper px-4 py-3", t.overdue && "border-warn/40")}>
              <span className="flex-1"><span className="block text-[17px] text-ink">Room {t.room} · {t.bags} bags</span><span className="block text-[13px] text-steel">{t.from} to {t.to}</span></span>
              <Badge tone={t.overdue ? "neg" : "ink"} className="!py-0">{t.status.replace("_", " ")}</Badge>
            </Link></li>
          ))}
        </ul>
      )}
    </Screen>
  );
}

// ---- Guest requests ------------------------------------------------------------------------------------------------

const REQ_NEXT: Partial<Record<ServiceRequest["status"], { action: string; label: string }>> = { new: { action: "assign", label: "Take this on" }, assigned: { action: "start", label: "Start" }, in_progress: { action: "complete", label: "Complete" }, confirmed: { action: "complete", label: "Complete" } };

function RequestsMobile() {
  const { data } = useLiveGet<{ requests: ServiceRequest[]; now: number }>("/api/guest/requests");
  const mutate = useMutate();
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [making, setMaking] = useState(false);
  const [room, setRoom] = useState("");
  const [details, setDetails] = useState("");
  const list = (data?.requests ?? []).filter((r) => !["completed", "cancelled", "unable"].includes(r.status));
  const act = async (r: ServiceRequest, action: string, done: string) => {
    const res = await mutate(`/api/guest/requests/${r.id}`, { action, note, expect: r.status });
    if (!res.ok) return toast.error(res.error);
    toast.done(done); setNote("");
  };
  return (
    <Screen title="Guest requests">
      {making ? (
        <div className="space-y-3 rounded-2xl border border-line p-4">
          <Field label="Room" inputMode="numeric" value={room} onChange={(e) => setRoom(e.target.value)} />
          <Field label="What does the guest need?" value={details} onChange={(e) => setDetails(e.target.value)} placeholder="For example: taxi to the airport at 06:00" />
          <Big onClick={async () => { const r = await mutate("/api/guest/requests", { kind: /taxi/i.test(details) ? "taxi" : "general", room, details }); if (!r.ok) return toast.error(r.error); toast.done("Request created."); setMaking(false); setRoom(""); setDetails(""); }}>Create request</Big>
          <Button variant="ghost" className="w-full" onClick={() => setMaking(false)}>Cancel</Button>
        </div>
      ) : <Big onClick={() => setMaking(true)}>New request</Big>}
      <ul className="space-y-2">
        {list.map((r) => {
          const next = REQ_NEXT[r.status];
          return (
            <li key={r.id} className="rounded-2xl border border-line bg-paper p-4">
              <button type="button" className="w-full text-left" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
                <span className="block text-[17px] text-ink">Room {r.room} · {r.details}</span>
                <span className="block text-[13px] text-steel">{r.id} · {r.status.replace(/_/g, " ")}{r.priority === "urgent" ? " · urgent" : ""}</span>
              </button>
              {open === r.id && (
                <div className="mt-3 space-y-2">
                  {next && <Big onClick={() => act(r, next.action, `${next.label}: done.`)}>{next.label}</Big>}
                  <Field label="Outcome or reason" value={note} onChange={(e) => setNote(e.target.value)} placeholder={r.kind === "taxi" ? "For example: Dubai Taxi ref 48213" : ""} />
                  {r.status === "awaiting_confirmation" && r.kind === "taxi" && <Button size="lg" className="w-full" onClick={() => act(r, "confirm", "Confirmation recorded.")}>Record confirmation</Button>}
                  {["assigned", "in_progress"].includes(r.status) && r.kind === "taxi" && <Button size="lg" className="w-full" onClick={() => act(r, "awaiting", "Waiting for confirmation.")}>Waiting for the taxi company</Button>}
                  <div className="grid grid-cols-2 gap-2">
                    <Button size="lg" variant="ghost" onClick={() => act(r, "escalate", "Escalated.")}>Escalate</Button>
                    <Button size="lg" variant="ghost" onClick={() => act(r, "unable", "Marked unable to fulfil.")}>Unable</Button>
                  </div>
                  <Note>Confirmed only when you record what the outside company told you. Tyll does not contact guests.</Note>
                </div>
              )}
            </li>
          );
        })}
        {data && list.length === 0 && <li className="text-steel">No open requests.</li>}
      </ul>
    </Screen>
  );
}

// ---- Counts and deliveries -----------------------------------------------------------------------------------------

function CountMobile() {
  const { user } = useView();
  const mutate = useMutate();
  const propertyId = allowedProperties(user)[0];
  const [term, setTerm] = useState("");
  const [pick, setPick] = useState<string | null>(null);
  const [counted, setCounted] = useState("");
  const [review, setReview] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const items = INGREDIENTS.filter((g) => g.dept !== "supplies" && g.name.toLowerCase().includes(term.toLowerCase())).slice(0, 24);
  if (done) return (
    <Screen title="Stock count">
      <div className="rounded-2xl border border-line px-5 py-8 text-center" role="status"><span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-pos-soft text-pos"><Check size={28} /></span><p className="mt-4 text-[20px]">Count submitted</p><p className="mt-1 text-[15px] text-graphite">{done}</p><p className="mt-1 text-[13px] text-steel">A manager reviews it before stock changes.</p></div>
      <Big onClick={() => { setDone(null); setPick(null); setCounted(""); setReview(false); }}>Count another item</Big>
    </Screen>
  );
  if (!pick) return (
    <Screen title="Stock count">
      <p className="-mt-2 text-[15px] text-steel">{propertyById[propertyId].name}, main store</p>
      <Field label="Find an item" value={term} onChange={(e) => setTerm(e.target.value)} />
      <ul className="grid grid-cols-2 gap-2">{items.map((g) => <li key={g.id}><button type="button" onClick={() => setPick(g.id)} className="flex min-h-16 w-full items-center rounded-2xl border border-line px-4 py-3 text-left text-[15px]">{g.name}</button></li>)}</ul>
    </Screen>
  );
  const g = ingredientById[pick];
  return (
    <Screen title={g.name} back="/staff?do=count">
      {!review ? (
        <>
          <Field label={`Counted quantity (${g.unit})`} inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} autoFocus />
          <Big disabled={!counted || Number(counted) < 0} onClick={() => setReview(true)}>Review</Big>
        </>
      ) : (
        <>
          <p className="rounded-2xl bg-mist px-4 py-4 text-[17px]">{g.name}: <span className="num">{fmtQty(Number(counted), g.unit)}</span></p>
          <Big onClick={async () => {
            const r = await mutate<{ count: { status: string } }>("/api/stock/counts", { propertyId, ingredientId: pick, counted: Number(counted) });
            if (!r.ok) return toast.error(r.error);
            setDone(`${g.name}: ${fmtQty(Number(counted), g.unit)}`);
          }}>Submit count</Big>
          <Button size="lg" variant="ghost" className="w-full" onClick={() => setReview(false)}>Change</Button>
        </>
      )}
    </Screen>
  );
}

function ReceiveMobile() {
  const params = useSearchParams();
  const router = useRouter();
  const id = params.get("order");
  const { data } = useLiveGet<{ requests: PurchaseRequest[] }>("/api/purchasing");
  const orders = (data?.requests ?? []).filter((r) => r.status === "approved");
  if (id) return <ReceiveOrder id={id} />;
  return (
    <Screen title="Deliveries">
      <p className="-mt-2 text-[15px] text-steel">Approved orders expected at your hotel.</p>
      {!data ? <p className="text-steel">Loading</p> : orders.length === 0 ? <EmptyState title="No deliveries expected" /> : (
        <ul className="space-y-2">
          {orders.map((r) => <li key={r.id}><button type="button" onClick={() => router.push(`/staff?do=receive&order=${r.id}`)} className="flex min-h-16 w-full items-center gap-3 rounded-2xl border border-line bg-paper px-4 py-3 text-left"><span className="flex-1"><span className="block text-[17px] text-ink">{r.poNumber}</span><span className="block text-[13px] text-steel">{r.lines.length} item{r.lines.length === 1 ? "" : "s"} · {r.lines.map((l) => ingredientById[l.ingredientId].name).slice(0, 2).join(", ")}</span></span><Badge className="!py-0">Expected</Badge></button></li>)}
        </ul>
      )}
    </Screen>
  );
}

function ReceiveOrder({ id }: { id: string }) {
  const router = useRouter();
  const { user } = useView();
  const mutate = useMutate();
  const { data } = useLiveGet<{ request: PurchaseRequest }>(`/api/purchasing/${id}`);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  if (!data) return <Screen title="Delivery" back="/staff?do=receive"><p className="text-steel">Loading</p></Screen>;
  const r = data.request;
  if (r.status !== "approved") return (
    <Screen title={r.poNumber ?? r.id} back="/staff?do=receive"><EmptyState title={r.status === "received" ? "Already received" : "Not expected"}>{r.status === "received" ? "This delivery was recorded. Recording it again would count the stock twice." : "Only approved orders can be received."}</EmptyState></Screen>
  );
  return (
    <Screen title={r.poNumber ?? r.id} back="/staff?do=receive">
      <p className="-mt-2 text-[15px] text-steel">Enter what actually arrived. Note anything damaged, missing or wrong.</p>
      <ul className="space-y-3">
        {r.lines.map((l) => {
          const g = ingredientById[l.ingredientId];
          const v = qty[l.ingredientId] ?? String(l.qty);
          return (
            <li key={l.ingredientId} className="space-y-2 rounded-2xl border border-line p-4">
              <p className="text-[17px] text-ink">{g.name}</p>
              <p className="text-[13px] text-steel">Ordered {fmtQty(l.qty, g.unit)}</p>
              <Field label={`Received (${g.unit})`} inputMode="decimal" value={v} onChange={(e) => setQty({ ...qty, [l.ingredientId]: e.target.value })} />
              {Number(v) !== l.qty && <Field label="What happened?" value={notes[l.ingredientId] ?? ""} onChange={(e) => setNotes({ ...notes, [l.ingredientId]: e.target.value })} placeholder="For example: 2 kg short; one box damaged" />}
            </li>
          );
        })}
      </ul>
      <Big disabled={busy} onClick={async () => {
        setBusy(true);
        const res = await mutate(`/api/purchasing/${r.id}`, { action: "receive", received: r.lines.map((l) => ({ ingredientId: l.ingredientId, qty: Number(qty[l.ingredientId] ?? l.qty), note: notes[l.ingredientId] })) });
        setBusy(false);
        if (!res.ok) return toast.error(res.error);
        toast.done("Delivery recorded. Stock is updated; purchasing and finance can see it.");
        router.push("/staff?do=receive");
      }}>Confirm receipt</Big>
      <p className="text-[13px] text-steel">Received by {personName(user.id)}. A delivery is recorded once.</p>
    </Screen>
  );
}
