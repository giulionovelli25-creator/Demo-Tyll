"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, ChevronDown, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Choice, Steps } from "@/components/forecast/parts";
import { Badge, Button, EmptyState, Field, Note, Panel, Select, TextArea, cn, toast } from "@/components/ui";
import { ingredientById, itemById, outletById, propertyById } from "@/lib/data/catalog";
import { SKILL_LABEL } from "@/lib/data/workforce";
import { can } from "@/lib/domain/access";
import { DEFAULT_RATIOS, ROLE_ORDER, SERVICES, serviceFor } from "@/lib/domain/events";
import { personName, useView } from "@/lib/hooks";
import { fromHm, toHm, useEventDetail, useEvents } from "@/lib/ops-hooks";
import { useMutate } from "@/lib/plan-hooks";
import type { EventDetail } from "@/lib/server/ops";
import type { EventRecord, EventStatus, EventType, ServiceFormat, ServiceId, StaffRatios } from "@/lib/types";
import { DEMO_TODAY, addDays, fmtDate, fmtMoney, fmtQty } from "@/lib/util";
import { StaffFinder } from "./staff";

export const STATUS: Record<EventStatus, { label: string; tone: "neutral" | "warn" | "pos" | "neg" | "ink" }> = {
  draft: { label: "Draft", tone: "neutral" }, planning: { label: "Planning", tone: "warn" }, ready: { label: "Ready", tone: "pos" },
  in_progress: { label: "In progress", tone: "ink" }, completed: { label: "Completed", tone: "neutral" }, cancelled: { label: "Cancelled", tone: "neg" },
};
const TYPES: EventType[] = ["Conference", "Wedding", "Corporate dinner", "Banquet", "Private dining", "Cocktail reception", "Hotel function"];
const FORMAT_LABEL: Record<ServiceFormat, string> = { seated: "Seated service", buffet: "Buffet", reception: "Standing reception", theatre: "Theatre, no meal service" };
const ONE: Record<keyof StaffRatios, string> = { waiter: "waiter", bartender: "bartender", chef: "chef", setup: "setup person", supervisor: "supervisor", runner: "runner", cleaning: "cleaning person" };
const ROLE_LABEL: Record<keyof StaffRatios, string> = { waiter: "Waiters", bartender: "Bartenders", chef: "Chefs", setup: "Setup staff", supervisor: "Supervisors", runner: "Runners", cleaning: "Cleaning and reset" };

export function MyEvents() {
  const router = useRouter();
  const params = useSearchParams();
  const id = params.get("event");
  const { user } = useView();
  const { data, error } = useEvents();
  if (id) return <EventPlanner id={id} />;
  const events = data?.events ?? [];
  return (
    <div className="space-y-4">
      {can(user, "events.plan") && <Button variant="primary" onClick={() => router.push("/events?tab=plan")}><Plus size={15} /> Plan an event</Button>}
      {error ? <Panel><EmptyState title="Events could not be loaded">{error}</EmptyState></Panel> : !data ? <Panel><EmptyState title="Loading events" /></Panel> : events.length === 0 ? <Panel><EmptyState title="No events yet" /></Panel> : (
        <ul className="grid gap-3 md:grid-cols-2">
          {events.map((e) => (
            <li key={e.id}>
              <button type="button" onClick={() => router.push(`/events?tab=events&event=${e.id}`)} className="w-full rounded-panel border border-line bg-paper p-5 text-left shadow-panel transition-colors hover:border-fog">
                <span className="flex flex-wrap items-center justify-between gap-2"><span className="text-lg tracking-[-0.02em] text-ink">{e.name}</span><Badge tone={STATUS[e.status].tone}>{STATUS[e.status].label}</Badge></span>
                <span className="mt-1 block text-sm text-steel">{e.type} · {fmtDate(e.date, true)}, {toHm(e.start)} to {toHm(e.end)} · {e.guests} guests · {e.venue}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Plan an event: the details first; everything else opens once a draft exists. */
export function PlanEvent() {
  return <EventPlanner id={null} />;
}

function EventPlanner({ id }: { id: string | null }) {
  const router = useRouter();
  const params = useSearchParams();
  const step = Math.min(5, Math.max(1, Number(params.get("step") ?? (id ? 5 : 1))));
  const { data, error } = useEventDetail(id);
  const go = (n: number, eventId = id) => router.push(`/events?tab=events&event=${eventId}&step=${n}`);
  if (id && !data) return <Panel><EmptyState title={error ?? "Loading the event"} action={error ? <Button onClick={() => router.push("/events?tab=events")}>My events</Button> : undefined} /></Panel>;
  const d = data?.detail;
  const e = d?.event;
  const editable = !!e && !!d?.canPlan && e.status !== "cancelled" && e.status !== "completed";
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push("/events?tab=events")}><ArrowLeft size={15} /> My events</Button>
        {e && <span className="text-sm text-steel">{e.name} · {fmtDate(e.date, true)} · <Badge tone={STATUS[e.status].tone} className="!py-0">{STATUS[e.status].label}</Badge></span>}
      </div>
      <Steps steps={["Details", "Food and drinks", "Requirements", "Staffing", "Summary"]} current={step} reachable={id ? 5 : 1} onGo={(n) => id && go(n)} />
      {step === 1 && <DetailsStep key={e?.updatedAt ?? "new"} event={e} editable={!e || editable} onSaved={(ev) => go(2, ev.id)} />}
      {d && e && step === 2 && <FoodStep key={e.updatedAt} event={e} editable={editable} onSaved={() => go(3)} />}
      {d && step === 3 && <RequirementsStep d={d} editable={editable} onNext={() => go(4)} />}
      {d && step === 4 && <StaffingStep key={d.event.updatedAt} d={d} editable={editable} onNext={() => go(5)} />}
      {d && step === 5 && <SummaryStep d={d} editable={editable} onEdit={go} />}
    </div>
  );
}

function DetailsStep({ event, editable, onSaved }: { event?: EventRecord; editable: boolean; onSaved: (e: EventRecord) => void }) {
  const { user, propertyId } = useView();
  const mutate = useMutate();
  const props = user.propertyIds === "all" ? Object.keys(propertyById) : user.propertyIds;
  const [f, setF] = useState(() => ({
    propertyId: event?.propertyId ?? propertyId ?? props[0], name: event?.name ?? "", type: event?.type ?? ("Conference" as EventType), venue: event?.venue ?? "Grand Ballroom",
    date: event?.date ?? addDays(DEMO_TODAY, 4), start: toHm(event?.start ?? 12 * 60), end: toHm(event?.end ?? 15 * 60), setup: toHm(event?.setupStart ?? 10 * 60), cleanup: toHm(event?.cleanupEnd ?? 16 * 60),
    guests: event?.guests ?? 100, format: event?.format ?? ("seated" as ServiceFormat), kitchen: event?.kitchenOutletId ?? "", dietary: event?.dietary ?? "", notes: event?.notes ?? "", price: event?.pricePerGuest ? String(event.pricePerGuest) : "",
  }));
  const kitchens = Object.values(outletById).filter((o) => o.propertyId === f.propertyId && o.menu.some((m) => itemById[m.itemId].dept === "food"));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const r = await mutate<{ event: EventRecord; notes: string[] }>("/api/events", {
      id: event?.id, propertyId: f.propertyId, name: f.name, type: f.type, venue: f.venue, date: f.date, start: fromHm(f.start), end: fromHm(f.end), setupStart: fromHm(f.setup), cleanupEnd: fromHm(f.cleanup) < fromHm(f.end) ? fromHm(f.cleanup) + 1440 : fromHm(f.cleanup),
      guests: f.guests, format: f.format, kitchenOutletId: f.kitchen || kitchens[0]?.id, dietary: f.dietary, notes: f.notes, pricePerGuest: f.price ? Number(f.price) : 0,
    });
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    toast.done(event ? `Saved. ${r.data.notes.join(" ") || "Requirements are recalculated."}` : `Draft ${r.data.event.id} saved.`);
    onSaved(r.data.event);
  };
  return (
    <Panel title={event ? "Event details" : "Create the event"} description={!event || event.status === "draft" ? "Saved as a draft until you confirm the plan. Drafts do not reserve stock or staff." : "Changes recalculate portions, stock, staffing and cost. Confirmed people are checked again if the time changes."}>
      <fieldset disabled={!editable} className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Event name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="For example: Pharma launch dinner" />
          {!event && props.length > 1 && <Select label="Hotel" value={f.propertyId} onChange={(e) => setF({ ...f, propertyId: e.target.value, kitchen: "" })}>{props.map((p) => <option key={p} value={p}>{propertyById[p].name}</option>)}</Select>}
          <Field label="Venue" value={f.venue} onChange={(e) => setF({ ...f, venue: e.target.value })} />
          <Select label="Prepared by" value={f.kitchen || kitchens[0]?.id} onChange={(e) => setF({ ...f, kitchen: e.target.value })}>{kitchens.map((k) => <option key={k.id} value={k.id}>{k.name} kitchen</option>)}</Select>
        </div>
        <Choice label="Event type" value={f.type} options={TYPES.map((t) => ({ value: t, label: t }))} onChange={(t) => setF({ ...f, type: t })} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Date" type="date" min={DEMO_TODAY} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          <Field label="Guests" type="number" min={1} value={f.guests} onChange={(e) => setF({ ...f, guests: Math.max(1, Math.round(Number(e.target.value))) })} suffix="guests" />
          <Field label="Starts" type="time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} />
          <Field label="Ends" type="time" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} />
          <Field label="Setup from" type="time" value={f.setup} onChange={(e) => setF({ ...f, setup: e.target.value })} />
          <Field label="Cleanup until" type="time" value={f.cleanup} onChange={(e) => setF({ ...f, cleanup: e.target.value })} />
          <Field label="Price per guest (optional)" type="number" min={0} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} suffix={propertyById[f.propertyId].currency} />
        </div>
        <Choice label="Service style" value={f.format} options={(Object.keys(FORMAT_LABEL) as ServiceFormat[]).map((x) => ({ value: x, label: FORMAT_LABEL[x] }))} onChange={(x) => setF({ ...f, format: x })} />
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Dietary requirements" value={f.dietary} onChange={(e) => setF({ ...f, dietary: e.target.value })} placeholder="For example: 12 vegetarian, 3 gluten-free" />
          <TextArea label="Notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </div>
      </fieldset>
      {editable && <Button className="mt-5" variant="primary" disabled={busy} onClick={save}>{event ? "Save and recalculate" : "Save draft and choose food"} <ArrowRight size={15} /></Button>}
    </Panel>
  );
}

function FoodStep({ event, editable, onSaved }: { event: EventRecord; editable: boolean; onSaved: () => void }) {
  const mutate = useMutate();
  const [services, setServices] = useState(event.services);
  const [busy, setBusy] = useState(false);
  const menu = Object.values(itemById).filter((i) => i.recipe || i.dept === "food");
  const toggle = (id: ServiceId) => setServices(services.some((s) => s.id === id) ? services.filter((s) => s.id !== id) : [...services, serviceFor(id, event.guests)]);
  const patch = (id: ServiceId, fn: (s: EventRecord["services"][number]) => EventRecord["services"][number]) => setServices(services.map((s) => (s.id === id ? fn(s) : s)));
  const save = async () => {
    setBusy(true);
    const r = await mutate("/api/events", { id: event.id, services });
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    toast.done("Food and drinks saved. Portions, ingredients and costs are recalculated.");
    onSaved();
  };
  return (
    <Panel title="Food and drinks" description="Choose every service the event includes. A conference can have coffee breaks and lunch; a wedding, dinner and drinks.">
      <div className="flex flex-wrap gap-2">
        {(Object.keys(SERVICES) as ServiceId[]).map((id) => {
          const on = services.some((s) => s.id === id);
          return <button key={id} type="button" disabled={!editable} aria-pressed={on} onClick={() => toggle(id)} className={cn("min-h-11 rounded-full border px-5 text-sm transition-colors", on ? "border-ink bg-ink text-paper" : "border-line bg-paper hover:border-fog")}>{SERVICES[id].label}</button>;
        })}
      </div>
      <div className="mt-5 space-y-4">
        {services.map((s) => (
          <div key={s.id} className="rounded-2xl border border-line p-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h3 className="text-[15px] text-ink">{SERVICES[s.id].label}</h3>
              <Field label="Guests taking this" type="number" min={0} max={event.guests} value={s.guests} disabled={!editable} onChange={(e) => patch(s.id, (x) => ({ ...x, guests: Math.max(0, Math.round(Number(e.target.value))) }))} suffix="guests" className="w-44" />
            </div>
            <ul className="mt-3 space-y-2">
              {s.items.map((it, k) => (
                <li key={it.itemId} className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="min-w-[160px] flex-1 text-ink">{itemById[it.itemId].name}</span>
                  <label className="flex items-center gap-2"><span className="sr-only">Per guest</span>
                    <input type="number" min={0} step={0.1} value={it.perGuest} disabled={!editable} onChange={(e) => patch(s.id, (x) => ({ ...x, items: x.items.map((y, j) => (j === k ? { ...y, perGuest: Math.max(0, Number(e.target.value)) } : y)) }))} className="num h-9 w-20 rounded-xl border border-line px-2 text-right" />
                    <span className="text-steel">per guest</span></label>
                  <span className="num w-24 text-right text-graphite">{Math.ceil(s.guests * it.perGuest - 1e-9)} {itemById[it.itemId].dept === "food" ? "portions" : "servings"}</span>
                  {editable && <button type="button" aria-label={`Remove ${itemById[it.itemId].name}`} onClick={() => patch(s.id, (x) => ({ ...x, items: x.items.filter((_, j) => j !== k) }))} className="rounded-full p-1.5 text-steel hover:bg-mist"><Trash2 size={14} /></button>}
                </li>
              ))}
            </ul>
            {editable && (
              <select aria-label={`Add a dish or drink to ${SERVICES[s.id].label}`} value="" onChange={(e) => e.target.value && patch(s.id, (x) => ({ ...x, items: [...x.items, { itemId: e.target.value, perGuest: 1 }] }))} className="mt-3 h-9 rounded-full border border-line bg-paper px-3 text-[13px]">
                <option value="">Add a dish or drink</option>
                {menu.filter((m) => !s.items.some((i) => i.itemId === m.id)).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            )}
          </div>
        ))}
      </div>
      {editable && <Button className="mt-5" variant="primary" disabled={busy || !services.length} onClick={save}>Save and see requirements <ArrowRight size={15} /></Button>}
    </Panel>
  );
}

function RequirementsStep({ d, editable, onNext }: { d: EventDetail; editable: boolean; onNext: () => void }) {
  const router = useRouter();
  const { user } = useView();
  const mutate = useMutate();
  const [open, setOpen] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, number>>({});
  const e = d.event;
  const food = d.portions.filter((p) => itemById[p.itemId].dept === "food");
  const drink = d.portions.filter((p) => itemById[p.itemId].dept !== "food");
  const short = d.ingredients.filter((i) => i.suggested > 0);
  const mayKitchen = editable || (can(user, "prep.plan") && user.role === "chef");
  const saveKitchen = async () => {
    const r = await mutate(`/api/events/${e.id}`, { action: "kitchen", portions: edits });
    if (!r.ok) return toast.error(r.error);
    setEdits({});
    toast.done("Portions saved. Ingredients, costs and the kitchen plan follow.");
  };
  const row = (p: EventDetail["portions"][number]) => (
    <li key={p.itemId}>
      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
        <button type="button" aria-expanded={open === p.itemId} onClick={() => setOpen(open === p.itemId ? null : p.itemId)} className="flex flex-1 items-center gap-2 text-left text-sm text-ink">
          <ChevronDown size={14} className={cn("shrink-0 text-steel transition-transform", open === p.itemId && "rotate-180")} aria-hidden />{itemById[p.itemId].name}
        </button>
        {mayKitchen && itemById[p.itemId].dept === "food" ? (
          <input aria-label={`Portions of ${itemById[p.itemId].name}`} type="number" min={0} value={edits[p.itemId] ?? p.portions} onChange={(ev) => setEdits({ ...edits, [p.itemId]: Math.max(0, Math.round(Number(ev.target.value))) })} className="num h-9 w-20 rounded-xl border border-line text-center" />
        ) : <span className="num text-sm">{p.portions}</span>}
        <span className="w-16 text-xs text-steel">{itemById[p.itemId].dept === "food" ? "portions" : "servings"}</span>
      </div>
      {open === p.itemId && (
        <div className="space-y-1 px-10 pb-3 text-[13px] text-graphite">
          {p.from.map((f, k) => <p key={k}>{SERVICES[f.service].label}: {f.guests} guests × {f.perGuest} = {Math.round(f.units * 10) / 10}</p>)}
          <p>Rounded up to {p.calculated}{p.portions !== p.calculated ? `; the kitchen set ${p.portions}` : ""}.</p>
          {(itemById[p.itemId].recipe ?? []).map((l) => <p key={l.ingredientId} className="text-steel">{ingredientById[l.ingredientId].name}: {fmtQty(l.qty, ingredientById[l.ingredientId].unit)} each, {fmtQty(l.qty * p.portions, ingredientById[l.ingredientId].unit)} in total</p>)}
        </div>
      )}
    </li>
  );
  return (
    <>
      <Panel title="What the event needs" description={`${e.guests} guests. ${food.reduce((s, p) => s + p.portions, 0)} food portions and ${drink.reduce((s, p) => s + p.portions, 0)} drink servings.`}>
        <div className="grid gap-5 lg:grid-cols-2">
          <div><h3 className="text-[13px] font-medium text-graphite">Food</h3><ul className="mt-2 divide-y divide-hair rounded-2xl border border-line">{food.map(row)}</ul></div>
          <div><h3 className="text-[13px] font-medium text-graphite">Drinks</h3><ul className="mt-2 divide-y divide-hair rounded-2xl border border-line">{drink.map(row)}</ul></div>
        </div>
        {Object.keys(edits).length > 0 && <Button className="mt-4" variant="primary" onClick={saveKitchen}>Save portions</Button>}
      </Panel>
      <Panel title="Ingredients and stock" description="Taken from the shared storeroom after the outlets' own forecast use. Stock already issued to this event is not counted again.">
        {short.length > 0 ? (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warn/25 bg-warn-soft px-5 py-4">
            <p className="text-sm text-ink">{short.length} ingredient{short.length === 1 ? "" : "s"} must be bought for this event{e.status === "draft" ? " once the plan is confirmed" : ""}.</p>
            {can(user, "purchase.create") && <Button variant="primary" onClick={() => router.push(`/forecast?tab=buy&event=${e.id}`)}>Review purchase requirement</Button>}
          </div>
        ) : <p className="mb-4 text-sm text-graphite">Stock covers this event.</p>}
        <ul className="divide-y divide-hair rounded-2xl border border-line text-sm">
          {d.ingredients.slice(0, 16).map((i) => {
            const g = ingredientById[i.ingredientId];
            return (
              <li key={i.ingredientId} className="px-4 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
                  <span className="min-w-[150px] text-ink">{g.name}</span>
                  <span className="num text-graphite">needs {fmtQty(i.need, g.unit)}</span>
                  {i.suggested > 0 ? <Badge tone="neg" className="!py-0">buy {fmtQty(i.suggested, g.unit)}</Badge> : <Badge tone="pos" className="!py-0">covered</Badge>}
                </div>
                {i.issued > 0 && <p className="mt-1 text-xs text-steel">This event needs {fmtQty(i.need, g.unit)}. {fmtQty(i.issued, g.unit)} was already issued to Banqueting, so {i.fromStore > 0 ? `${fmtQty(i.fromStore, g.unit)} more comes from the storeroom` : `${fmtQty(i.issued - i.need, g.unit)} can go back to the storeroom`}.</p>}
              </li>
            );
          })}
        </ul>
      </Panel>
      <Panel title="Kitchen">
        <p className="text-sm text-graphite">Prepared by {outletById[e.kitchenOutletId].name} kitchen. {e.status === "draft" ? "Confirm the plan to send the portions to the kitchen." : d.prep.planned ? "The portions are in the kitchen's prep plan as tasks." : "The portions appear in the kitchen's What to prep for that day, ready for the chef to review."}</p>
        {d.prep.portionsChanged && <Note className="mt-2">The kitchen has adjusted some portions. The figures above already use them.</Note>}
        {(can(user, "prep.plan") && user.role === "chef") && <Button className="mt-3" onClick={() => router.push("/forecast?tab=prep")}>Open What to prep</Button>}
      </Panel>
      {editable && <Button variant="primary" onClick={onNext}>Next: staffing <ArrowRight size={15} /></Button>}
    </>
  );
}

function StaffingStep({ d, editable, onNext }: { d: EventDetail; editable: boolean; onNext: () => void }) {
  const router = useRouter();
  const mutate = useMutate();
  const e = d.event;
  const [finding, setFinding] = useState<string | null>(null);
  const [ratios, setRatios] = useState(e.ratios);
  const [showRatios, setShowRatios] = useState(false);
  const [showTeam, setShowTeam] = useState(false);
  const money = (n: number) => fmtMoney(n, propertyById[e.propertyId].currency, { decimals: true });
  const saveRatios = async () => {
    const r = await mutate("/api/events", { id: e.id, ratios });
    if (!r.ok) return toast.error(r.error);
    toast.done("Staffing assumptions saved.");
  };
  return (
    <>
      <Panel title="Event staffing" description="Required people against confirmed people. Requests waiting for a decision are shown but never counted as cover.">
        <ul className="divide-y divide-hair rounded-2xl border border-line">
          {d.coverage.map((c) => {
            const open = Math.max(0, c.stillNeeded - c.requested);
            return (
              <li key={c.role} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                  <span className="min-w-[140px] flex-1"><span className="text-[15px] text-ink">{ROLE_LABEL[c.role]}</span><span className="block text-xs text-steel">{c.rule} · {toHm(c.window.start)} to {toHm(c.window.end)}</span></span>
                  <span className="num text-sm text-graphite">Needed {c.required}</span>
                  <span className="num text-sm text-graphite">Confirmed {c.confirmed}</span>
                  {c.requested > 0 && <span className="num text-sm text-warn">Requested {c.requested}</span>}
                  {c.stillNeeded > 0 ? <Badge tone="neg" className="!py-0">Still needed {c.stillNeeded}</Badge> : <Badge tone="pos" className="!py-0">Covered</Badge>}
                  {editable && open > 0 && e.status !== "draft" && <Button size="sm" variant={finding === c.role ? "ghost" : "primary"} onClick={() => setFinding(finding === c.role ? null : c.role)}>{finding === c.role ? "Close" : "Find available staff"}</Button>}
                </div>
                {finding === c.role && (
                  <div className="mt-4">
                    <StaffFinder propertyId={e.propertyId} skill={c.skill} date={e.date} start={c.window.start} end={c.window.end} toDeptId={`${e.propertyId}-banq`} need={open} eventId={e.id} role={c.role} kind="Event support" onSent={() => setFinding(null)} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {e.status === "draft" && <Note className="mt-3">Confirm the plan on the summary step before asking other departments for staff.</Note>}
        <p className="mt-4 text-sm text-graphite">Estimated labour {money(d.cost.labour)}{d.cost.labourExtra > 0 ? `, of which ${money(d.cost.labourExtra)} for people still to find` : ""}. Demo hourly rates, not payroll.</p>
      </Panel>
      {d.requests.length > 0 && (
        <Panel title="Support requests" flush>
          <ul className="divide-y divide-hair border-t border-hair">
            {d.requests.map((r) => (
              <li key={r.id}><button type="button" onClick={() => router.push(`/events?tab=support&request=${r.id}`)} className="flex w-full flex-wrap justify-between gap-2 px-5 py-3 text-left text-sm hover:bg-cloud sm:px-6">
                <span className="text-ink">{r.count} {SKILL_LABEL[r.skill as keyof typeof SKILL_LABEL].toLowerCase()}{r.count === 1 ? "" : "s"} · {r.id}</span>
                <span className="text-graphite">{r.status === "cancelled" ? "Withdrawn" : `${r.items.filter((i) => i.status === "approved").length} of ${r.count} confirmed`}</span>
              </button></li>
            ))}
          </ul>
        </Panel>
      )}
      <Panel title={<button type="button" aria-expanded={showTeam} onClick={() => setShowTeam(!showTeam)} className="flex items-center gap-2 text-left"><ChevronDown size={16} className={cn("transition-transform", showTeam && "rotate-180")} /> Confirmed people ({d.staff.filter((s) => s.status === "confirmed").length})</button>}>
        {showTeam ? (
          <ul className="space-y-1.5 text-sm">
            {d.staff.map((s) => <li key={s.id} className={cn("flex flex-wrap justify-between gap-2", s.status === "cancelled" && "text-steel line-through")}><span>{s.name}, {SKILL_LABEL[s.skill as keyof typeof SKILL_LABEL].toLowerCase()}</span><span className="text-graphite">{s.deptName} · {toHm(s.start)} to {toHm(s.end)}{s.cancelledReason ? ` · ${s.cancelledReason}` : ""}</span></li>)}
          </ul>
        ) : <p className="text-sm text-steel">The event&rsquo;s own team and anyone lent by other departments.</p>}
      </Panel>
      <Panel title={<button type="button" aria-expanded={showRatios} onClick={() => setShowRatios(!showRatios)} className="flex items-center gap-2 text-left"><ChevronDown size={16} className={cn("transition-transform", showRatios && "rotate-180")} /> Staffing assumptions</button>}>
        {showRatios ? (
          <div className="space-y-4">
            <p className="text-[13px] text-steel">Demo planning assumptions: guests per person, rounded up. Not universal hospitality rules. 0 means the role is not needed.</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {ROLE_ORDER.map((r) => <Field key={r} label={ROLE_LABEL[r]} type="number" min={0} value={ratios[r]} disabled={!editable} onChange={(ev) => setRatios({ ...ratios, [r]: Math.max(0, Math.round(Number(ev.target.value))) })} suffix="guests each" />)}
            </div>
            {editable && <div className="flex gap-2"><Button variant="primary" onClick={saveRatios}>Save assumptions</Button><Button variant="ghost" onClick={() => setRatios({ ...DEFAULT_RATIOS[e.format] })}>Use defaults</Button></div>}
          </div>
        ) : <p className="text-sm text-steel">1 waiter per {e.ratios.waiter} guests, 1 bartender per {e.ratios.bartender}, 1 chef per {e.ratios.chef}, 1 setup per {e.ratios.setup}.</p>}
      </Panel>
      {editable && <Button variant="primary" onClick={onNext}>Next: summary <ArrowRight size={15} /></Button>}
    </>
  );
}

function SummaryStep({ d, editable, onEdit }: { d: EventDetail; editable: boolean; onEdit: (n: number) => void }) {
  const router = useRouter();
  const mutate = useMutate();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const e = d.event;
  const money = (n: number) => fmtMoney(n, propertyById[e.propertyId].currency);
  const short = d.coverage.filter((c) => c.stillNeeded > 0);
  const buy = d.ingredients.filter((i) => i.suggested > 0);
  const status = async (to: EventStatus, extra: Record<string, unknown> = {}) => {
    const r = await mutate(`/api/events/${e.id}`, { action: "status", status: to, ...extra });
    if (!r.ok) return toast.error(r.error);
    toast.done({ planning: "Plan confirmed. Stock is reserved and the kitchen can see the portions.", ready: "Event marked ready.", cancelled: "Event cancelled. Staff are released and stock is no longer reserved." }[to as "planning" | "ready" | "cancelled"]);
  };
  const risks = [
    ...short.map((c) => ({ text: `${c.stillNeeded} more ${c.stillNeeded === 1 ? ONE[c.role] : ROLE_LABEL[c.role].toLowerCase()} needed${c.requested ? ` (${c.requested} requested, waiting for approval)` : ""}.`, action: "Find staff", go: () => onEdit(4) })),
    ...(buy.length ? [{ text: `${buy.length} ingredient${buy.length === 1 ? "" : "s"} to buy.`, action: "Review ingredients", go: () => onEdit(3) }] : []),
    ...(isCommittedLocal(e) && !d.prep.planned ? [{ text: "The kitchen has not saved a prep plan that includes this event yet.", action: "See kitchen", go: () => onEdit(3) }] : []),
  ];
  return (
    <>
      <Panel title={e.name} description={`${e.type} · ${fmtDate(e.date, true)}, ${toHm(e.start)} to ${toHm(e.end)} · ${e.guests} guests · ${e.venue}`} action={<Badge tone={STATUS[e.status].tone}>{STATUS[e.status].label}</Badge>}>
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <h3 className="text-[15px]">Operational estimate</h3>
            <dl className="mt-2 space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-steel">Food</dt><dd className="num">{money(d.cost.food)}</dd></div>
              <div className="flex justify-between"><dt className="text-steel">Drinks</dt><dd className="num">{money(d.cost.drink)}</dd></div>
              <div className="flex justify-between"><dt className="text-steel">Labour{d.cost.labourExtra > 0 ? `, including ${money(d.cost.labourExtra)} still to staff` : ""}</dt><dd className="num">{money(d.cost.labour)}</dd></div>
              <div className="flex justify-between border-t border-hair pt-2 text-ink"><dt>Total estimated operational cost</dt><dd className="num">{money(d.cost.total)}</dd></div>
              {d.cost.revenue !== null && <div className="flex justify-between"><dt className="text-steel">Agreed price, {e.guests} guests</dt><dd className="num">{money(d.cost.revenue)}</dd></div>}
              {d.cost.contribution !== null && <div className="flex justify-between"><dt className="text-steel">Estimated contribution</dt><dd className="num">{money(d.cost.contribution)}</dd></div>}
            </dl>
            <Note className="mt-2">Demo estimates: ingredient cost from recipes, labour at demo hourly rates. Not payroll, not accounting profit, no overheads.</Note>
          </div>
          <div>
            <h3 className="text-[15px]">What needs doing</h3>
            {risks.length === 0 ? <p className="mt-2 text-sm text-pos">Nothing outstanding.</p> : (
              <ul className="mt-2 space-y-2">{risks.map((r, k) => <li key={k} className="flex flex-wrap items-center justify-between gap-2 text-sm"><span className="text-graphite">{r.text}</span><Button size="sm" variant="ghost" onClick={r.go}>{r.action}</Button></li>)}</ul>
            )}
            {d.purchaseIds.length > 0 && <p className="mt-3 text-sm text-graphite">Purchase requests: {d.purchaseIds.map((id) => <button key={id} type="button" className="num mr-2 underline underline-offset-4" onClick={() => router.push(`/forecast?tab=approvals&request=${id}`)}>{id}</button>)}</p>}
          </div>
        </div>
      </Panel>
      {editable && (
        <Panel title="Next step">
          <div className="flex flex-wrap gap-2">
            {e.status === "draft" && <Button variant="primary" onClick={() => status("planning")}>Confirm the plan</Button>}
            {e.status === "planning" && <Button variant="primary" onClick={() => status("ready")}>Mark ready</Button>}
            <Button onClick={() => onEdit(1)}>Edit details</Button>
            <Button variant="ghost" onClick={() => setCancelling(!cancelling)}>Cancel event</Button>
          </div>
          {e.status === "draft" && <Note className="mt-3">Confirming reserves the event&rsquo;s stock, sends portions to the kitchen and lets you request staff.</Note>}
          {cancelling && (
            <form className="mt-4 flex flex-wrap items-end gap-2" onSubmit={(ev) => { ev.preventDefault(); void status("cancelled", { reason }); }}>
              <Field label="Why is it cancelled?" className="min-w-[220px] flex-1" value={reason} onChange={(ev) => setReason(ev.target.value)} />
              <Button type="submit" variant="primary">Cancel the event</Button>
            </form>
          )}
        </Panel>
      )}
      <Panel title="History">
        <ul className="space-y-2 text-sm">{e.history.slice().reverse().map((h, k) => <li key={k} className="flex flex-wrap justify-between gap-2"><span className="text-ink">{h.action}{h.detail ? `: ${h.detail}` : ""}</span><span className="text-xs text-steel">{personName(h.by)}</span></li>)}</ul>
      </Panel>
    </>
  );
}

const isCommittedLocal = (e: EventRecord) => e.status === "planning" || e.status === "ready" || e.status === "in_progress";
