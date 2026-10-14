"use client";
// Sales: opportunities, proposals and confirmed business. Confirming hands the business to Events as one event record.
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useState } from "react";
import { PropertyPicker } from "@/components/finance/finance";
import { Timeline } from "@/components/timeline";
import { Badge, Button, EmptyState, Field, Note, Panel, Segmented, Select, Stat, TextArea, cn, toast, type Tone } from "@/components/ui";
import { propertyById } from "@/lib/data/catalog";
import { allowedProperties, can } from "@/lib/domain/access";
import { SERVICES } from "@/lib/domain/events";
import { useLiveGet } from "@/lib/guest-hooks";
import { personName, useView } from "@/lib/hooks";
import { useMutate } from "@/lib/plan-hooks";
import type { OppView, SalesPerformance } from "@/lib/server/sales";
import type { OppStatus, OppType, ProposalStatus, ServiceFormat, ServiceId } from "@/lib/types";
import { DEMO_TODAY, addDays, fmtMoney } from "@/lib/util";

export const OPP_STATUS: Record<OppStatus, { label: string; tone: Tone }> = {
  new: { label: "New", tone: "warn" }, contacted: { label: "Contacted", tone: "ink" }, proposal_needed: { label: "Proposal needed", tone: "warn" }, proposal_sent: { label: "Proposal sent", tone: "ink" },
  confirmed: { label: "Confirmed", tone: "pos" }, lost: { label: "Lost", tone: "neutral" },
};
const PRP_STATUS: Record<ProposalStatus, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" }, discount_pending: { label: "Discount needs approval", tone: "warn" }, changes_requested: { label: "Changes requested", tone: "warn" }, ready: { label: "Ready to send", tone: "ink" },
  sent: { label: "Sent, awaiting decision", tone: "ink" }, accepted: { label: "Accepted by customer", tone: "pos" }, confirmed: { label: "Confirmed", tone: "pos" }, declined: { label: "Declined", tone: "neutral" }, superseded: { label: "Replaced", tone: "neutral" },
};
const TYPES: OppType[] = ["Conference", "Group booking", "Wedding", "Private dining", "Banquet", "Corporate hospitality"];
const hm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + (m || 0); };

function useSalesProperty() {
  const { user, propertyId } = useView();
  const props = allowedProperties(user);
  const [p, setP] = useState(propertyId ?? props[0]);
  return { propertyId: p, setPropertyId: setP, props };
}
const useSales = (propertyId: string) => useLiveGet<{ opps: OppView[]; people: { id: string; name: string }[]; policy: Record<string, { discountApprovalAbove: number; approverLabel: string }> }>(`/api/sales?propertyId=${propertyId}`);

// ---- Opportunities -------------------------------------------------------------------------------------------------

export function Opportunities() {
  const params = useSearchParams();
  const id = params.get("opp");
  const { propertyId, setPropertyId, props } = useSalesProperty();
  if (id) return <OppDetail id={id} propertyId={propertyId} />;
  return <OppList propertyId={propertyId} setPropertyId={setPropertyId} props={props} />;
}

function OppList({ propertyId, setPropertyId, props }: { propertyId: string; setPropertyId: (p: string) => void; props: string[] }) {
  const router = useRouter();
  const { user } = useView();
  const { data, error } = useSales(propertyId);
  const [show, setShow] = useState<"open" | "all">("open");
  const [making, setMaking] = useState(false);
  if (!data) return <Panel><EmptyState title={error ?? "Loading opportunities"} /></Panel>;
  const money = (n: number) => fmtMoney(n, propertyById[propertyId].currency);
  const list = data.opps.filter((o) => show === "all" || !["confirmed", "lost"].includes(o.status));
  return (
    <div className="space-y-5">
      <PropertyPicker value={propertyId} onChange={setPropertyId} props={props} />
      {can(user, "sales.work") && (making ? <OppForm propertyId={propertyId} people={data.people} onDone={(id) => { setMaking(false); if (id) router.push(`/events?tab=opportunities&opp=${id}`); }} /> : <Button variant="primary" onClick={() => setMaking(true)}>New opportunity</Button>)}
      <Panel title="Opportunities" description="Potential business. Expected values are sales estimates, not revenue." action={<Segmented size="sm" label="Show" value={show} onChange={setShow} options={[{ value: "open", label: "Open" }, { value: "all", label: "All" }]} />} flush>
        {list.length === 0 ? <p className="px-6 pb-6 text-sm text-steel">No opportunities here.</p> : (
          <ul className="divide-y divide-hair border-t border-hair">
            {list.map((o) => (
              <li key={o.id}>
                <button type="button" onClick={() => router.push(`/events?tab=opportunities&opp=${o.id}`)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-left hover:bg-cloud sm:px-6">
                  <span className="min-w-[200px] flex-1"><span className="text-sm text-ink">{o.customer} · {o.type}</span><span className="block text-xs text-steel">{o.id} · {o.expectedDate} · {o.guests} guests · {o.ownerName}{o.nextAction ? ` · Next: ${o.nextAction}${o.nextActionDue ? ` by ${o.nextActionDue}` : ""}` : ""}</span></span>
                  <span className="num text-sm">{o.value ? money(o.value) : "No value"}</span>
                  <Badge tone={OPP_STATUS[o.status].tone} className="!py-0">{OPP_STATUS[o.status].label}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function OppForm({ propertyId, people, onDone, opp }: { propertyId: string; people: { id: string; name: string }[]; onDone: (id?: string) => void; opp?: OppView }) {
  const mutate = useMutate();
  const { user } = useView();
  const [f, setF] = useState({ type: opp?.type ?? "Conference", customer: opp?.customer ?? "", expectedDate: opp?.expectedDate ?? addDays(DEMO_TODAY, 21), guests: String(opp?.guests ?? 120), value: String(opp?.value ?? ""), ownerId: opp?.ownerId ?? user.id, nextAction: opp?.nextAction ?? "", nextActionDue: opp?.nextActionDue ?? "", notes: opp?.notes ?? "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Panel title={opp ? "Edit opportunity" : "New opportunity"} description="Organisation or display name only. Do not enter personal contact details.">
      <form className="space-y-4" onSubmit={async (e) => {
        e.preventDefault();
        const r = await mutate<{ opp: { id: string } }>("/api/sales", { id: opp?.id, propertyId, ...f, guests: Number(f.guests), value: Number(f.value || 0) });
        if (!r.ok) return toast.error(r.error);
        toast.done(opp ? "Saved." : `${r.data.opp.id} created.`);
        onDone(r.data.opp.id);
      }}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Select label="Type of business" value={f.type} onChange={set("type")}>{TYPES.map((t) => <option key={t}>{t}</option>)}</Select>
          <Field label="Organisation" value={f.customer} onChange={set("customer")} placeholder="For example: Meridian Pharma" />
          <Field label="Expected date" type="date" value={f.expectedDate} onChange={set("expectedDate")} />
          <Field label="Approximate guests" type="number" value={f.guests} onChange={set("guests")} />
          <Field label={`Expected value (${propertyById[propertyId].currency})`} type="number" value={f.value} onChange={set("value")} />
          <Select label="Salesperson" value={f.ownerId} onChange={set("ownerId")}>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
          <Field label="Next action" value={f.nextAction} onChange={set("nextAction")} placeholder="For example: send proposal" />
          <Field label="Next action due" type="date" value={f.nextActionDue} onChange={set("nextActionDue")} />
        </div>
        <TextArea label="Notes" value={f.notes} onChange={set("notes")} />
        <div className="flex gap-2"><Button type="submit" variant="primary">{opp ? "Save" : "Create opportunity"}</Button><Button variant="ghost" onClick={() => onDone()}>Cancel</Button></div>
      </form>
    </Panel>
  );
}

function OppDetail({ id, propertyId }: { id: string; propertyId: string }) {
  const router = useRouter();
  const { user } = useView();
  const mutate = useMutate();
  const { data } = useSales(propertyId);
  const [editing, setEditing] = useState(false);
  const [lost, setLost] = useState("");
  const o = data?.opps.find((x) => x.id === id);
  if (!data) return <Panel><EmptyState title="Loading" /></Panel>;
  if (!o) return <Panel><EmptyState title="This opportunity is not available" action={<Button onClick={() => router.push("/events?tab=opportunities")}>All opportunities</Button>} /></Panel>;
  const money = (n: number) => fmtMoney(n, o.currency);
  const work = can(user, "sales.work") && !["confirmed", "lost"].includes(o.status);
  const setStatus = async (status: OppStatus, extra: Record<string, unknown> = {}) => {
    const r = await mutate("/api/sales", { id: o.id, status, ...extra });
    if (!r.ok) toast.error(r.error); else toast.done(`Marked ${OPP_STATUS[status].label.toLowerCase()}.`);
  };
  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" onClick={() => router.push("/events?tab=opportunities")}><ArrowLeft size={15} /> All opportunities</Button>
      {editing ? <OppForm propertyId={o.propertyId} people={data.people} opp={o} onDone={() => setEditing(false)} /> : (
        <Panel title={<span className="flex flex-wrap items-center gap-3"><span>{o.customer} · {o.type}</span><Badge tone={OPP_STATUS[o.status].tone}>{OPP_STATUS[o.status].label}</Badge></span>}
          description={`${o.id} · ${propertyById[o.propertyId].name} · expected ${o.expectedDate} · ${o.guests} guests · ${o.ownerName}`}>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div><dt className="text-steel">Expected value (estimate)</dt><dd className="num text-ink">{o.value ? money(o.value) : "Not set"}</dd></div>
            <div><dt className="text-steel">Next action</dt><dd className="text-ink">{o.nextAction || "None"}{o.nextActionDue ? `, by ${o.nextActionDue}` : ""}</dd></div>
            {o.notes && <div className="sm:col-span-2"><dt className="text-steel">Notes</dt><dd className="text-ink">{o.notes}</dd></div>}
            {o.lostReason && <div><dt className="text-steel">Lost because</dt><dd>{o.lostReason}</dd></div>}
          </dl>
          {o.event && <p className="mt-3 text-sm">Event: <span className="text-ink">{o.event.id} · {o.event.status === "planning" ? "confirmed, in planning" : o.event.status}</span></p>}
          {work && (
            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" onClick={() => router.push(`/events?tab=proposals&opp=${o.id}&new=1`)}>Create proposal</Button>
                <Button onClick={() => setEditing(true)}>Edit</Button>
                {o.status === "new" && <Button onClick={() => setStatus("contacted")}>Mark contacted</Button>}
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Lost because" value={lost} onChange={(e) => setLost(e.target.value)} className="min-w-[220px] flex-1" />
                <Button variant="ghost" onClick={() => setStatus("lost", { lostReason: lost })}>Mark lost</Button>
              </div>
            </div>
          )}
          {o.proposals.length > 0 && <Button className="mt-4" onClick={() => router.push(`/events?tab=proposals&opp=${o.id}`)}>Proposals ({o.proposals.length})</Button>}
        </Panel>
      )}
      <Panel title="What happened"><Timeline items={o.history.map((h, k) => ({ key: String(k), when: h.at.slice(0, 16).replace("T", " "), title: h.action, detail: `${personName(h.by)}${h.note ? ` · ${h.note}` : ""}` }))} /></Panel>
    </div>
  );
}

// ---- Proposals -----------------------------------------------------------------------------------------------------

export function Proposals() {
  const params = useSearchParams();
  const router = useRouter();
  const id = params.get("opp");
  const { propertyId, setPropertyId, props } = useSalesProperty();
  const { data, error } = useSales(propertyId);
  if (id) return <OppProposals oppId={id} propertyId={propertyId} create={params.get("new") === "1"} />;
  if (!data) return <Panel><EmptyState title={error ?? "Loading proposals"} /></Panel>;
  const money = (n: number, c: string) => fmtMoney(n, c as "AED");
  const rows = data.opps.flatMap((o) => o.proposals.filter((p) => p.status !== "superseded").map((p) => ({ o, p })));
  return (
    <div className="space-y-5">
      <PropertyPicker value={propertyId} onChange={setPropertyId} props={props} />
      <Panel title="Proposals" description="Quotes prepared for customers. A proposal is never confirmed just because it was saved." flush>
        {rows.length === 0 ? <p className="px-6 pb-6 text-sm text-steel">No proposals yet. Create one from an opportunity.</p> : (
          <ul className="divide-y divide-hair border-t border-hair">
            {rows.map(({ o, p }) => (
              <li key={p.id}>
                <button type="button" onClick={() => router.push(`/events?tab=proposals&opp=${o.id}`)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-left hover:bg-cloud sm:px-6">
                  <span className="min-w-[200px] flex-1"><span className="text-sm text-ink">{o.customer} · {p.guests} guests · {p.date}</span><span className="block text-xs text-steel">{p.id} v{p.version} · valid until {p.validUntil}{p.discountPct ? ` · ${p.discountPct}% discount` : ""}</span></span>
                  <span className="num text-sm">{money(p.costing.price, o.currency)}</span>
                  <Badge tone={PRP_STATUS[p.status].tone} className="!py-0">{PRP_STATUS[p.status].label}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function OppProposals({ oppId, propertyId, create }: { oppId: string; propertyId: string; create: boolean }) {
  const router = useRouter();
  const { user } = useView();
  const mutate = useMutate();
  const { data } = useSales(propertyId);
  const [editing, setEditing] = useState<string | "new" | null>(create ? "new" : null);
  const [note, setNote] = useState("");
  const o = data?.opps.find((x) => x.id === oppId);
  if (!data) return <Panel><EmptyState title="Loading" /></Panel>;
  if (!o) return <Panel><EmptyState title="This opportunity is not available" action={<Button onClick={() => router.push("/events?tab=proposals")}>All proposals</Button>} /></Panel>;
  const money = (n: number) => fmtMoney(n, o.currency);
  const policy = data.policy[o.propertyId];
  const act = async (pid: string, status: string, action: string, done: string) => {
    const r = await mutate<{ eventId?: string }>(`/api/sales/proposals/${pid}`, { action, note, expect: status });
    if (!r.ok) return toast.error(r.error);
    setNote("");
    toast.done(done);
  };
  const current = o.proposals.filter((p) => p.status !== "superseded");
  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" onClick={() => router.push(`/events?tab=opportunities&opp=${o.id}`)}><ArrowLeft size={15} /> {o.customer}</Button>
      {can(user, "sales.work") && o.status !== "lost" && (editing ? (
        <ProposalForm key={editing} o={o} base={editing === "new" ? current[0] : o.proposals.find((p) => p.id === editing)} id={editing === "new" ? undefined : editing} limit={policy.discountApprovalAbove} onDone={() => setEditing(null)} />
      ) : <Button variant="primary" onClick={() => setEditing("new")}>{current.length ? "New version" : "Create proposal"}</Button>)}
      {o.proposals.map((p) => {
        const c = p.costing;
        const mine = can(user, "sales.work");
        return (
          <Panel key={p.id} title={<span className="flex flex-wrap items-center gap-3"><span>{p.id} · version {p.version}</span><Badge tone={PRP_STATUS[p.status].tone}>{PRP_STATUS[p.status].label}</Badge></span>}
            description={`${p.date} · ${hm(p.start)} to ${hm(p.end)} · ${p.guests} guests · ${p.venue} · ${p.format} · ${p.services.map((s) => SERVICES[s].label).join(", ")} · valid until ${p.validUntil}`}>
            <div className="grid gap-3 sm:grid-cols-4">
              <Stat label="Selling price" value={money(c.price)} sub={p.discountPct ? `${p.discountPct}% discount on ${money(c.priceBeforeDiscount)}` : `${money(p.pricePerGuest)} per guest`} />
              <Stat label="Estimated direct cost" value={money(c.directCost)} sub={`Food ${money(c.food)} · drinks ${money(c.drink)} · labour ${money(c.labour)}`} />
              <Stat label="Estimated contribution" value={money(c.contribution)} sub={c.price ? `${Math.round((c.contribution / c.price) * 100)}% of price` : undefined} tone={c.contribution < 0 ? "neg" : undefined} />
              <Stat label="Discount rule" value={p.needsApproval ? "Needs approval" : "Within limit"} sub={`Above ${policy.discountApprovalAbove}%: ${policy.approverLabel.toLowerCase()}`} tone={p.needsApproval ? "warn" : undefined} />
            </div>
            <Note className="mt-3">Costs use the event calculation from Tyll Events: recipes, current prices and demo staffing rates. Not included: {c.excluded.join("; ").toLowerCase()}.</Note>
            {p.extras.length > 0 && <p className="mt-2 text-sm text-graphite">Extras: {p.extras.map((x) => `${x.label} ${money(x.amount)}`).join(", ")}</p>}
            {p.approval && <p className="mt-2 text-sm text-graphite">Discount {p.approval.decision} by {personName(p.approval.by)}{p.approval.note ? `: ${p.approval.note}` : ""}</p>}
            {p.acceptance && <p className="mt-2 text-sm text-graphite">Acceptance recorded by {personName(p.acceptance.by)}: {p.acceptance.note}</p>}
            {p.eventId && <p className="mt-2 text-sm text-ink">Event {p.eventId} is in Tyll Events.</p>}
            {!["superseded", "confirmed", "declined"].includes(p.status) && (
              <div className="mt-4 space-y-3">
                <Field label="Note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={p.status === "sent" ? "For example: signed proposal received from the client on 14 October" : p.status === "discount_pending" ? "Reason for your decision" : "Optional"} />
                <div className="flex flex-wrap gap-2">
                  {p.status === "discount_pending" && can(user, "sales.approve") && p.createdBy !== user.id && (<>
                    <Button variant="primary" onClick={() => act(p.id, p.status, "approve", "Discount approved.")}>Approve discount</Button>
                    <Button onClick={() => act(p.id, p.status, "changes", "Changes requested.")}>Request changes</Button>
                    <Button variant="ghost" onClick={() => act(p.id, p.status, "reject", "Discount rejected.")}>Reject</Button>
                  </>)}
                  {p.status === "discount_pending" && !can(user, "sales.approve") && <Note>Waiting for the {policy.approverLabel.toLowerCase()}.</Note>}
                  {mine && ["draft", "changes_requested", "ready", "discount_pending"].includes(p.status) && <Button onClick={() => setEditing(p.id)}>Edit</Button>}
                  {mine && p.status === "ready" && <Button variant="primary" onClick={() => act(p.id, p.status, "mark_sent", "Marked as sent. Tyll does not email customers.")}>Mark as sent to customer</Button>}
                  {mine && p.status === "sent" && <Button variant="primary" onClick={() => act(p.id, p.status, "record_acceptance", "Acceptance recorded.")}>Record customer acceptance</Button>}
                  {mine && ["sent", "accepted"].includes(p.status) && <Button variant="ghost" onClick={() => act(p.id, p.status, "record_decline", "Decline recorded.")}>Record decline</Button>}
                  {mine && p.status === "accepted" && <Button variant="primary" onClick={() => act(p.id, p.status, "confirm", o.eventId ? `Business confirmed; ${o.eventId} updated.` : "Business confirmed; the event is now in Tyll Events.")}>Confirm business</Button>}
                </div>
                {p.status === "accepted" && <Note>Confirming creates the event in Tyll Events{o.eventId ? ` (or updates ${o.eventId})` : ""}, so operations can plan stock and staff. It happens once.</Note>}
              </div>
            )}
            <details className="mt-4"><summary className="cursor-pointer text-sm text-graphite">History</summary>
              <Timeline items={p.history.map((h, k) => ({ key: String(k), when: h.at.slice(0, 16).replace("T", " "), title: h.action, detail: `${personName(h.by)}${h.note ? ` · ${h.note}` : ""}` }))} />
            </details>
          </Panel>
        );
      })}
      {o.proposals.length === 0 && !editing && <Panel><EmptyState title="No proposals yet" /></Panel>}
    </div>
  );
}

function ProposalForm({ o, base, id, limit, onDone }: { o: OppView; base?: OppView["proposals"][number]; id?: string; limit: number; onDone: () => void }) {
  const mutate = useMutate();
  const [f, setF] = useState({
    date: base?.date ?? (o.expectedDate <= addDays(DEMO_TODAY, 60) ? o.expectedDate : addDays(DEMO_TODAY, 30)), start: hm(base?.start ?? 9 * 60), end: hm(base?.end ?? 17 * 60), guests: String(base?.guests ?? o.guests),
    venue: base?.venue ?? "Grand Ballroom", format: (base?.format ?? (o.type === "Conference" ? "buffet" : "seated")) as ServiceFormat, services: base?.services ?? ((o.type === "Conference" ? ["coffee_break", "lunch_buffet", "soft_drinks"] : ["three_course", "soft_drinks"]) as ServiceId[]),
    pricePerGuest: String(base?.pricePerGuest ?? ""), discountPct: String(base?.discountPct ?? 0), validUntil: base?.validUntil ?? addDays(DEMO_TODAY, 14), notes: base?.notes ?? "",
    extraLabel: base?.extras[0]?.label ?? "", extraAmount: String(base?.extras[0]?.amount ?? ""),
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const toggle = (s: ServiceId) => setF({ ...f, services: f.services.includes(s) ? f.services.filter((x) => x !== s) : [...f.services, s] });
  const over = Number(f.discountPct) > limit;
  return (
    <Panel title={id ? `Edit ${id}` : "New proposal"} description="Prices in the hotel's currency. Costs are estimated when you save.">
      <form className="space-y-4" onSubmit={async (e) => {
        e.preventDefault();
        const r = await mutate<{ proposal: { id: string; status: string } }>("/api/sales/proposals", {
          id, oppId: o.id, date: f.date, start: toMin(f.start), end: toMin(f.end), guests: Number(f.guests), venue: f.venue, format: f.format, services: f.services,
          pricePerGuest: Number(f.pricePerGuest), discountPct: Number(f.discountPct || 0), validUntil: f.validUntil, notes: f.notes,
          extras: f.extraLabel && f.extraAmount ? [{ label: f.extraLabel, amount: Number(f.extraAmount) }] : [],
        });
        if (!r.ok) return toast.error(r.error);
        toast.done(r.data.proposal.status === "discount_pending" ? `${r.data.proposal.id} saved. The discount was sent for approval.` : `${r.data.proposal.id} saved.`);
        onDone();
      }}>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Event date" type="date" value={f.date} onChange={set("date")} />
          <Field label="Starts" type="time" value={f.start} onChange={set("start")} />
          <Field label="Ends" type="time" value={f.end} onChange={set("end")} />
          <Field label="Guests" type="number" value={f.guests} onChange={set("guests")} />
          <Field label="Venue" value={f.venue} onChange={set("venue")} />
          <Select label="Service style" value={f.format} onChange={set("format")}><option value="seated">Seated</option><option value="buffet">Buffet</option><option value="reception">Reception</option><option value="theatre">Theatre</option></Select>
          <Field label={`Price per guest (${o.currency})`} type="number" value={f.pricePerGuest} onChange={set("pricePerGuest")} />
          <Field label="Discount %" type="number" value={f.discountPct} onChange={set("discountPct")} hint={over ? `Above ${limit}%: needs approval` : `Up to ${limit}% without approval`} />
          <Field label="Optional service" value={f.extraLabel} onChange={set("extraLabel")} placeholder="For example: AV package" />
          <Field label={`Its price (${o.currency})`} type="number" value={f.extraAmount} onChange={set("extraAmount")} />
          <Field label="Valid until" type="date" value={f.validUntil} onChange={set("validUntil")} />
        </div>
        <fieldset>
          <legend className="mb-2 text-[13px] font-medium text-graphite">Food and drink packages</legend>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(SERVICES) as ServiceId[]).map((s) => <button key={s} type="button" aria-pressed={f.services.includes(s)} onClick={() => toggle(s)} className={cn("rounded-full border px-3 py-1.5 text-sm", f.services.includes(s) ? "border-ink bg-ink text-paper" : "border-line text-graphite hover:bg-cloud")}>{SERVICES[s].label}</button>)}
          </div>
        </fieldset>
        <TextArea label="Notes" value={f.notes} onChange={set("notes")} />
        <div className="flex gap-2"><Button type="submit" variant="primary">{over ? "Save and request discount approval" : "Save proposal"}</Button><Button variant="ghost" onClick={onDone}>Cancel</Button></div>
      </form>
    </Panel>
  );
}

// ---- Confirmed business --------------------------------------------------------------------------------------------

export function ConfirmedBusiness() {
  const router = useRouter();
  const { user } = useView();
  const { propertyId, setPropertyId, props } = useSalesProperty();
  const { data } = useSales(propertyId);
  const perf = useLiveGet<{ performance: SalesPerformance }>(`/api/sales/performance?propertyId=${propertyId}`).data?.performance;
  const money = (n: number) => fmtMoney(n, propertyById[propertyId].currency);
  const confirmed = (data?.opps ?? []).filter((o) => o.status === "confirmed");
  return (
    <div className="space-y-5">
      <PropertyPicker value={propertyId} onChange={setPropertyId} props={props} />
      {perf && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Open pipeline" value={money(perf.pipeline)} sub={`${perf.openCount} open opportunities · potential, not revenue`} />
          <Stat label="Awaiting customer decision" value={money(perf.awaitingValue)} sub={`${perf.awaitingDecision} proposal${perf.awaitingDecision === 1 ? "" : "s"} sent`} />
          <Stat label="Confirmed business" value={money(perf.confirmedValue)} sub={`${perf.confirmedCount} confirmed · contract value, not yet revenue`} />
          <Stat label="Won and lost" value={`${perf.won} won · ${perf.lost} lost`} />
        </div>
      )}
      <Panel title="Confirmed business" description="Each deal links to one event record. Revenue is recognised by accounting after the event, and cash is not tracked here." flush>
        {confirmed.length === 0 ? <p className="px-6 pb-6 text-sm text-steel">Nothing confirmed yet.</p> : (
          <ul className="divide-y divide-hair border-t border-hair">
            {confirmed.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 sm:px-6">
                <span className="min-w-[200px] flex-1"><span className="text-sm text-ink">{o.customer} · {o.type}</span><span className="block text-xs text-steel">{o.id}{o.event ? ` · ${o.event.id} · ${o.event.date} · ${o.event.guests} guests` : ""}</span></span>
                {o.event && <Badge tone={o.event.status === "ready" ? "pos" : "ink"} className="!py-0">{o.event.status === "planning" ? "In planning" : o.event.status === "ready" ? "Ready" : o.event.status}</Badge>}
                {o.event && o.event.staffStillNeeded > 0 && <Badge tone="warn" className="!py-0">{o.event.staffStillNeeded} staff still needed</Badge>}
                <span className="num text-sm">{o.value ? money(o.value) : "Price not recorded"}</span>
                {o.event && can(user, "events.plan") && <Button size="sm" onClick={() => router.push(`/events?tab=events&event=${o.event!.id}`)}>Open event</Button>}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/** One line on the Overview: business confirmed this month, as contract value. Not counted as revenue. */
export function BusinessStrip() {
  const { user, propertyId } = useView();
  const { data } = useLiveGet<{ summary: { propertyId: string; currency: "AED" | "QAR"; value: number; count: number }[] }>(can(user, "sales.view") ? "/api/sales/summary" : null);
  const rows = (data?.summary ?? []).filter((r) => !propertyId || r.propertyId === propertyId);
  if (!rows.length) return null;
  return (
    <section className="flex flex-wrap items-center gap-x-8 gap-y-2 rounded-panel border border-line bg-paper px-6 py-4 text-sm shadow-panel">
      <span className="text-steel">Confirmed new business, October</span>
      {rows.map((r) => <span key={r.propertyId}><span className="num text-ink">{fmtMoney(r.value, r.currency)}</span> <span className="text-steel">{propertyById[r.propertyId].name.replace("Grand Resort ", "")}, {r.count} deal{r.count === 1 ? "" : "s"}</span></span>)}
      <span className="text-xs text-steel">Contract value, not yet revenue</span>
      <Link href="/events?tab=confirmed" className="ml-auto flex items-center gap-1 text-[13px] text-steel hover:text-ink">Confirmed business <ArrowRight size={14} /></Link>
    </section>
  );
}
