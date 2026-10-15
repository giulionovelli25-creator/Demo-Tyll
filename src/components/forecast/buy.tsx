"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, ChevronDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, EmptyState, Field, Note, Panel, TextArea, cn, toast } from "@/components/ui";
import { ingredientById, outletById, propertyById } from "@/lib/data/catalog";
import { quotesFor } from "@/lib/data/purchasing-rules";
import type { Assumptions, BuyLine } from "@/lib/domain/planning";
import { usePost, useSessionEntries, useView } from "@/lib/hooks";
import { type BuyDraft, useBuyPlan, useMutate, usePlanDrafts } from "@/lib/plan-hooks";
import type { BuyPlanOut } from "@/lib/server/purchasing";
import type { PurchaseRequest } from "@/lib/types";
import { DEMO_TODAY, addDays, fmtDate, fmtMoney, fmtQty } from "@/lib/util";
import { Choice, DemandInputs, PERIOD_OPTIONS, RISK, Steps, outletOptions, propertyOptions } from "./parts";

const q = (n: number, unit: string) => (unit === "units" ? `${Math.round(n * 10) / 10} units` : fmtQty(n, unit));

/** Where the user is in What to buy, kept per user so leaving and coming back loses nothing. */
function useBuyDraft(): [BuyDraft, (patch: Partial<BuyDraft>) => void, () => void] {
  const { user, sel, propertyId } = useView();
  const params = useSearchParams();
  const saved = usePlanDrafts((s) => s.buy[user.id]);
  const set = usePlanDrafts((s) => s.setBuy);
  const props = propertyOptions(user).map((p) => p.value);
  const pid = saved?.propertyId ?? propertyId ?? props[0];
  const mine = outletOptions(user, pid);
  // Start from the outlet chosen in the top bar.
  const start: BuyDraft = { propertyId: pid, outletIds: sel.outletIds.length === 1 && mine.includes(sel.outletIds[0]) ? [sel.outletIds[0]] : mine, period: "tomorrow", step: 1, assumptions: {}, picks: {}, comment: "" };
  const draft = saved ?? start;
  const prepPlanId = params.get("prepPlan");
  // Arriving from What to prep: carry the plan's outlet, days and portions straight into the results.
  useEffect(() => {
    if (!prepPlanId || draft.prepPlanId === prepPlanId) return;
    const outlet = params.get("outlet");
    set(user.id, { ...start, outletIds: outlet && mine.includes(outlet) ? [outlet] : start.outletIds, period: (params.get("period") as BuyDraft["period"]) ?? "tomorrow", prepPlanId, step: 3 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepPlanId]);
  return [draft, (patch) => set(user.id, { ...draft, ...patch }), () => set(user.id, null)];
}

/** What to buy for the user's outlets, or, from an event, for that event. */
export function WhatToBuy() {
  const eventId = useSearchParams().get("event");
  return eventId ? <EventBuy eventId={eventId} /> : <OutletBuy />;
}

function OutletBuy() {
  const { user } = useView();
  const router = useRouter();
  const params = useSearchParams();
  const focus = params.get("focus");
  const [draft, update, clear] = useBuyDraft();
  const { data, loading, error } = useBuyPlan(draft);
  const plan = data?.plan;
  const mutate = useMutate();
  const [open, setOpen] = useState<string | null>(focus);
  const [show, setShow] = useState<"order" | "all">("order");
  const [busy, setBusy] = useState(false);
  const property = propertyById[draft.propertyId];
  const money = (n: number) => fmtMoney(n, property.currency, { decimals: true });

  // Values on screen: what the user typed, else the server's figure.
  const values: Assumptions | null = plan ? { ...plan.assumptions, ...Object.fromEntries(Object.entries(draft.assumptions).filter(([, v]) => v !== undefined)) } as Assumptions : null;
  const sources = plan ? { ...plan.sources, ...Object.fromEntries(Object.keys(draft.assumptions).filter((k) => draft.assumptions[k as keyof Assumptions] !== undefined).map((k) => [k, "manual"])) } as typeof plan.sources : null;

  const lines = useMemo(() => (plan?.lines ?? []).map((l) => {
    const pick = draft.picks[l.ingredientId];
    const quotes = quotesFor(l.ingredientId, draft.propertyId, DEMO_TODAY);
    const quote = quotes.find((x) => x.supplierId === pick?.supplierId) ?? quotes[0];
    const qty = pick?.qty ?? l.suggested;
    return { l, qty, quote, quotes, selected: pick?.selected ?? l.suggested > 0 };
  }), [plan, draft.picks, draft.propertyId]);
  const chosen = lines.filter((x) => x.selected && x.qty > 0);
  const total = chosen.reduce((s, x) => s + x.qty * x.quote.unitPrice, 0);
  const pick = (id: string, patch: Partial<BuyDraft["picks"][string]>) => update({ picks: { ...draft.picks, [id]: { ...{ selected: lines.find((x) => x.l.ingredientId === id)?.selected ?? false }, ...draft.picks[id], ...patch } } });

  const create = async (submit: boolean) => {
    if (chosen.length === 0) return toast.error("Choose at least one item with a quantity.");
    setBusy(true);
    const saved = await mutate<{ request: PurchaseRequest }>("/api/purchasing", {
      propertyId: draft.propertyId, outletIds: draft.outletIds, period: draft.period, from: draft.from, to: draft.to, comment: draft.comment, prepPlanId: draft.prepPlanId,
      lines: chosen.map(({ l, qty, quote }) => ({ ingredientId: l.ingredientId, qty, supplierId: quote.supplierId, suggested: l.suggested, requirement: l.requirement, available: l.available, incoming: l.incoming, safety: l.safety })),
    });
    if (!saved.ok) { setBusy(false); return toast.error(saved.error); }
    if (submit) {
      const sent = await mutate(`/api/purchasing/${saved.data.request.id}`, { action: "submit" });
      if (!sent.ok) { setBusy(false); return toast.error(sent.error); }
    }
    setBusy(false);
    toast.done(submit ? `Request ${saved.data.request.id} sent to Purchasing.` : `${saved.data.request.id} saved as a draft. It has not been sent.`);
    clear();
    router.push(`/forecast?tab=approvals&request=${saved.data.request.id}${submit ? "&sent=1" : ""}`);
  };

  const mine = outletOptions(user, draft.propertyId);
  return (
    <div className="space-y-5">
      <Steps steps={["Where and when", "Expected demand", "What to buy"]} current={draft.step} onGo={(n) => update({ step: n as BuyDraft["step"] })} />

      {draft.step === 1 && (
        <Panel title="Where and when">
          <div className="space-y-6">
            {propertyOptions(user).length > 1 && <Choice label="Hotel" value={draft.propertyId} options={propertyOptions(user)} onChange={(p) => update({ propertyId: p, outletIds: outletOptions(user, p), picks: {}, assumptions: {} })} />}
            <Choice label="Outlet" value={draft.outletIds.length === 1 ? draft.outletIds[0] : "all"}
              options={[...(mine.length > 1 ? [{ value: "all", label: "All my outlets" }] : []), ...mine.map((o) => ({ value: o, label: outletById[o].name }))]}
              onChange={(o) => update({ outletIds: o === "all" ? mine : [o], picks: {}, assumptions: {} })} />
            <Choice label="Period" value={draft.period} options={PERIOD_OPTIONS} onChange={(p) => update({ period: p, assumptions: {}, picks: {} })} />
            {draft.period === "custom" && (
              <div className="flex flex-wrap gap-3">
                <Field label="From" type="date" min={addDays(DEMO_TODAY, 1)} max={addDays(DEMO_TODAY, 14)} value={draft.from ?? addDays(DEMO_TODAY, 1)} onChange={(e) => update({ from: e.target.value })} />
                <Field label="To" type="date" min={draft.from ?? addDays(DEMO_TODAY, 1)} max={addDays(DEMO_TODAY, 14)} value={draft.to ?? addDays(DEMO_TODAY, 2)} onChange={(e) => update({ to: e.target.value })} />
              </div>
            )}
            <Button variant="primary" onClick={() => update({ step: 2 })}>Next: expected demand <ArrowRight size={15} /></Button>
          </div>
        </Panel>
      )}

      {draft.step === 2 && (
        <Panel title="Expected demand" description="Tyll starts from bookings, occupancy and the same weekdays in the last four weeks. Change any figure you know better.">
          {!plan || !values || !sources ? <EmptyState title={error ?? "Working out the forecast"} /> : (
            <div className="space-y-5">
              <DemandInputs baseline={plan.baseline} values={values} sources={sources} onChange={(patch) => update({ assumptions: { ...draft.assumptions, ...patch }, picks: {} })} />
              <Choice label="Safety stock" value={String(values.safetyDays)} options={[{ value: "0", label: "None" }, { value: "0.5", label: "Half a day" }, { value: "1", label: "One day" }, { value: "2", label: "Two days" }]}
                onChange={(v) => update({ assumptions: { ...draft.assumptions, safetyDays: Number(v) } })} />
              <p className="text-sm text-graphite">Expected guests: <span className="num text-ink">{Math.round(plan.guests.reservations + plan.guests.walkIns + plan.guests.eventGuests)}</span> ({Math.round(plan.guests.reservations)} booked, {Math.round(plan.guests.walkIns)} walk-in, {Math.round(plan.guests.eventGuests)} from the event){loading && <span className="ml-2 text-steel">recalculating…</span>}</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" onClick={() => update({ step: 1 })}><ArrowLeft size={15} /> Back</Button>
                <Button variant="primary" onClick={() => update({ step: 3 })}>Calculate what to buy <ArrowRight size={15} /></Button>
              </div>
              <HowItWorks />
            </div>
          )}
        </Panel>
      )}

      {draft.step === 3 && (
        <>
          <Panel
            title="What to buy"
            description={`${draft.outletIds.length === 1 ? outletById[draft.outletIds[0]].name : `${draft.outletIds.length} outlets`}, ${plan ? `${fmtDate(plan.period.from, true)}${plan.period.to !== plan.period.from ? ` to ${fmtDate(plan.period.to, true)}` : ""}` : ""}${draft.prepPlanId ? ". Includes the saved prep plan." : ""}`}
            action={<Button variant="ghost" size="sm" onClick={() => update({ step: 2 })}><ArrowLeft size={15} /> Change demand</Button>}
            flush
          >
            <div className="flex flex-wrap items-center gap-2 px-5 pb-4 sm:px-6">
              <Choice label="Show" value={show} options={[{ value: "order", label: `Needs ordering (${lines.filter((x) => x.l.suggested > 0).length})` }, { value: "all", label: `Everything used (${lines.length})` }]} onChange={setShow} />
              {loading && <span className="text-[13px] text-steel">Recalculating…</span>}
            </div>
            {!plan ? <div className="px-6 pb-6"><EmptyState title={error ?? "Working out what to buy"} /></div> : (
              <ul className="divide-y divide-hair border-t border-hair">
                {lines.filter((x) => show === "all" || x.l.suggested > 0 || x.selected).map((x) => (
                  <BuyRow key={x.l.ingredientId} x={x} money={money} open={open === x.l.ingredientId} onOpen={() => setOpen(open === x.l.ingredientId ? null : x.l.ingredientId)} onPick={(p) => pick(x.l.ingredientId, p)} />
                ))}
              </ul>
            )}
            {plan?.sharedNote && <Note className="px-6 py-4">{plan.sharedNote}</Note>}
          </Panel>

          <Panel title="Purchase request">
            <div className="space-y-4">
              <p className="text-sm text-graphite"><span className="num text-[22px] text-ink">{money(total)}</span><span className="ml-2">for {chosen.length} item{chosen.length === 1 ? "" : "s"}, at the suppliers&rsquo; quoted prices</span></p>
              <TextArea label="Comment for purchasing" value={draft.comment} onChange={(e) => update({ comment: e.target.value })} placeholder="For example: conference on Thursday, order early" />
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" disabled={busy} onClick={() => create(true)}>Send to Purchasing</Button>
                <Button disabled={busy} onClick={() => create(false)}>Save draft</Button>
              </div>
              <Note>Send to Purchasing starts the approval. Save draft keeps it to yourself. Stock rises only when the delivery is recorded; nothing goes to a supplier from this demo.</Note>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

function BuyRow({ x, money, open, onOpen, onPick }: {
  x: { l: BuyLine; qty: number; quote: { supplierId: string; name: string; unitPrice: number; leadDays: number }; quotes: { supplierId: string; name: string; unitPrice: number; leadDays: number; usual: boolean }[]; selected: boolean };
  money: (n: number) => string; open: boolean; onOpen: () => void; onPick: (p: { selected?: boolean; qty?: number; supplierId?: string }) => void;
}) {
  const { l } = x;
  const g = ingredientById[l.ingredientId];
  const risk = RISK[l.risk];
  return (
    <li className={cn("px-5 py-4 sm:px-6", open && "bg-cloud/60")}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <input type="checkbox" className="h-5 w-5 accent-ink" aria-label={`Include ${g.name}`} checked={x.selected} onChange={(e) => onPick({ selected: e.target.checked })} />
        <button type="button" aria-expanded={open} onClick={onOpen} className="flex min-w-[180px] flex-1 items-center gap-2 text-left">
          <ChevronDown size={15} className={cn("shrink-0 text-steel transition-transform duration-200", open && "rotate-180")} aria-hidden />
          <span>
            <span className="text-ink">{g.name}</span>
            <span className="block text-xs text-steel">Suggested {q(l.suggested, l.unit)} · order by {fmtDate(l.orderBy, true)}</span>
          </span>
        </button>
        <Badge tone={risk.tone} className="!py-0">{risk.label}</Badge>
        <label className="flex items-center gap-2 text-sm">
          <span className="sr-only">Quantity of {g.name}</span>
          <input type="number" inputMode="decimal" min={0} step={l.pack} value={x.qty} onChange={(e) => onPick({ qty: Math.max(0, Number(e.target.value)), selected: true })} className="num h-10 w-24 rounded-xl border border-line px-2 text-right hover:border-fog" />
          <span className="w-8 text-steel">{l.unit}</span>
        </label>
        <span className="num w-28 text-right text-ink">{money(x.qty * x.quote.unitPrice)}</span>
      </div>
      {open && (
        <div className="mt-4 grid gap-6 pl-8 lg:grid-cols-[1.3fr_1fr]">
          <div>
            <h3 className="text-[13px] font-medium text-graphite">How the suggestion is worked out</h3>
            <dl className="mt-2 text-sm">
              {l.steps.map((s, i) => (
                <div key={i} className={cn("flex justify-between gap-4 py-1", s.sign === "=" && "mt-1 border-t border-hair pt-2 text-ink")}>
                  <dt className="text-graphite">{s.label}</dt>
                  <dd className="num">{s.sign === "=" ? "" : s.sign} {q(s.value, l.unit)}</dd>
                </div>
              ))}
            </dl>
            {l.note && <Note className="mt-2">{l.note}</Note>}
            {l.shortageDay && <p className="mt-2 text-[13px] text-graphite">Without an order, the outlet runs short on {fmtDate(l.shortageDay, true)}. Lead time {g.leadDays} day{g.leadDays === 1 ? "" : "s"}, so order by {fmtDate(l.orderBy, true)}.</p>}
          </div>
          <div>
            <h3 className="text-[13px] font-medium text-graphite">Supplier</h3>
            <div className="mt-2 space-y-2">
              {x.quotes.map((s) => (
                <label key={s.supplierId} className={cn("flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm", x.quote.supplierId === s.supplierId ? "border-ink bg-paper" : "border-line hover:border-fog")}>
                  <input type="radio" name={`sup-${l.ingredientId}`} className="accent-ink" checked={x.quote.supplierId === s.supplierId} onChange={() => onPick({ supplierId: s.supplierId })} />
                  <span className="flex-1">{s.name}{s.usual && <span className="ml-1 text-xs text-steel">usual</span>}<span className="block text-xs text-steel">{s.leadDays} day{s.leadDays === 1 ? "" : "s"} lead time</span></span>
                  <span className="num">{money(s.unitPrice)} / {l.unit === "units" ? "unit" : l.unit}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

function HowItWorks() {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-hair pt-3">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex items-center gap-2 text-[13px] text-steel hover:text-ink">
        <ChevronDown size={14} className={cn("transition-transform duration-200", open && "rotate-180")} aria-hidden /> How Tyll forecasts
      </button>
      {open && (
        <ol className="mt-3 max-w-[80ch] space-y-1.5 text-[13px] text-graphite">
          <li>1. Each outlet&rsquo;s usual guests on the same weekday over the last four weeks, split into those who booked and those who walked in.</li>
          <li>2. Booked guests come from the reservation book. Hotel occupancy moves walk-ins only, so a booked hotel guest is counted once.</li>
          <li>3. About 3 in 10 event attendees also visit the outlets. The event itself is catered separately.</li>
          <li>4. Guests times what each guest usually orders gives the dishes; dishes times recipes give the ingredients, using any corrected standards from Stock.</li>
          <li>5. Suggested purchase = requirement + safety stock − usable stock − confirmed incoming − open requests, rounded up to packs. Other outlets&rsquo; use of a shared store is reserved first.</li>
          <li>This is arithmetic on past figures. No statistical or machine-learning model has been trained.</li>
        </ol>
      )}
    </div>
  );
}


/** Purchasing for one event: its ingredients after the outlets' own forecast use and any stock already issued to it. */
function EventBuy({ eventId }: { eventId: string }) {
  const router = useRouter();
  const entries = useSessionEntries();
  const version = usePlanDrafts((st) => st.version);
  const propertyId = eventId.split("-")[1]?.toLowerCase() ?? "dxb";
  const { data, error, loading } = usePost<{ plan: BuyPlanOut }>("/api/plan/buy", { propertyId, eventId, version, ...entries });
  const mutate = useMutate();
  const [picks, setPicks] = useState<Record<string, { selected: boolean; qty?: number; supplierId?: string }>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const money = (n: number) => fmtMoney(n, propertyById[propertyId].currency, { decimals: true });
  const lines = (data?.plan.lines ?? []).filter((l) => l.suggested > 0 || picks[l.ingredientId]?.selected).map((l) => {
    const p = picks[l.ingredientId];
    const quotes = quotesFor(l.ingredientId, propertyId, DEMO_TODAY);
    return { l, qty: p?.qty ?? l.suggested, quote: quotes.find((x) => x.supplierId === p?.supplierId) ?? quotes[0], quotes, selected: p?.selected ?? true };
  });
  const chosen = lines.filter((x) => x.selected && x.qty > 0);
  const create = async (submit: boolean) => {
    if (!chosen.length) return toast.error("Choose at least one item.");
    setBusy(true);
    const saved = await mutate<{ request: PurchaseRequest }>("/api/purchasing", { propertyId, eventId, comment, lines: chosen.map(({ l, qty, quote }) => ({ ingredientId: l.ingredientId, qty, supplierId: quote.supplierId, suggested: l.suggested, requirement: l.requirement, available: l.available, incoming: l.incoming, safety: l.safety })) });
    if (!saved.ok) { setBusy(false); return toast.error(saved.error); }
    if (submit) { const sent = await mutate(`/api/purchasing/${saved.data.request.id}`, { action: "submit" }); if (!sent.ok) { setBusy(false); return toast.error(sent.error); } }
    setBusy(false);
    toast.done(`${saved.data.request.id} ${submit ? "sent to Purchasing" : "saved as a draft"} for the event.`);
    router.push(`/forecast?tab=approvals&request=${saved.data.request.id}`);
  };
  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" onClick={() => router.push(`/events?tab=events&event=${eventId}&step=3`)}><ArrowLeft size={15} /> Back to the event</Button>
      <Panel title="What to buy for this event" description="The event's ingredients, less stock already issued to it, after the outlets' own forecast use of the shared storeroom." flush>
        {!data ? <div className="px-6 pb-6"><EmptyState title={error ?? "Working out the event's needs"} /></div> : lines.length === 0 ? <div className="px-6 pb-6"><EmptyState title="Nothing to buy">Stock covers this event.</EmptyState></div> : (
          <ul className="divide-y divide-hair border-t border-hair">
            {lines.map((x) => <BuyRow key={x.l.ingredientId} x={x} money={money} open={open === x.l.ingredientId} onOpen={() => setOpen(open === x.l.ingredientId ? null : x.l.ingredientId)} onPick={(p) => setPicks({ ...picks, [x.l.ingredientId]: { ...picks[x.l.ingredientId], selected: picks[x.l.ingredientId]?.selected ?? x.selected, ...p } })} />)}
          </ul>
        )}
        {loading && <p className="px-6 pb-3 text-[13px] text-steel">Recalculating…</p>}
        {data?.plan.sharedNote && <Note className="px-6 py-4">{data.plan.sharedNote}</Note>}
      </Panel>
      {lines.length > 0 && (
        <Panel title="Purchase request">
          <p className="text-sm text-graphite"><span className="num text-[22px] text-ink">{money(chosen.reduce((t, x) => t + x.qty * x.quote.unitPrice, 0))}</span><span className="ml-2">for {chosen.length} item{chosen.length === 1 ? "" : "s"}</span></p>
          <TextArea className="mt-3" label="Comment for purchasing" value={comment} onChange={(e) => setComment(e.target.value)} />
          <div className="mt-3 flex flex-wrap gap-2"><Button variant="primary" disabled={busy} onClick={() => create(true)}>Send to Purchasing</Button><Button disabled={busy} onClick={() => create(false)}>Save draft</Button></div>
          <Note className="mt-3">Stock rises only when the delivery is received. Nothing is sent to a supplier from this demo.</Note>
        </Panel>
      )}
    </div>
  );
}
