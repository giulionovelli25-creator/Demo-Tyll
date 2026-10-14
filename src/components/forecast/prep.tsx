"use client";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Minus, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Button, EmptyState, Note, Panel, cn, toast } from "@/components/ui";
import { ingredientById, itemById, outletById } from "@/lib/data/catalog";
import { can } from "@/lib/domain/access";
import { ingredientsFor, type Assumptions, type Meal } from "@/lib/domain/planning";
import { personName, useCtx, useView } from "@/lib/hooks";
import { type PrepDraft, useMutate, usePlanDrafts, usePrepSuggest } from "@/lib/plan-hooks";
import type { PrepOut } from "@/lib/server/purchasing";
import type { PrepPlan } from "@/lib/types";
import { fmtDate, fmtQty } from "@/lib/util";
import { Choice, DemandInputs, PERIOD_OPTIONS, Steps, outletOptions, propertyOptions } from "./parts";

const MEAL_LABEL: Record<Meal, string> = { all: "All day", breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };

function usePrepDraft(): [PrepDraft, (patch: Partial<PrepDraft>) => void] {
  const { user, sel } = useView();
  const saved = usePlanDrafts((s) => s.prep[user.id]);
  const set = usePlanDrafts((s) => s.setPrep);
  const outlets = propertyOptions(user).flatMap((p) => outletOptions(user, p.value));
  const first = sel.outletIds.length === 1 && outlets.includes(sel.outletIds[0]) ? sel.outletIds[0] : outlets[0];
  // A head chef with one kitchen goes straight to tomorrow's plan.
  const draft: PrepDraft = saved ?? { outletId: first, period: "tomorrow", meal: "all", step: outlets.length === 1 ? 2 : 1, assumptions: {}, portions: {} };
  return [draft, (patch) => set(user.id, { ...draft, ...patch })];
}

export function WhatToPrep() {
  const { user } = useView();
  const router = useRouter();
  const ctx = useCtx();
  const [draft, update] = usePrepDraft();
  const { data, loading, error } = usePrepSuggest(draft);
  const prep = data?.prep;
  const mutate = useMutate();
  const [busy, setBusy] = useState(false);
  const mayPlan = can(user, "prep.plan");
  const outlets = propertyOptions(user).flatMap((p) => outletOptions(user, p.value));

  // Portions: the user's edits, else the saved plan, else Tyll's suggestion.
  const portions = useMemo(() => {
    if (!prep) return {} as Record<string, number>;
    const out: Record<string, number> = {};
    for (const id of new Set([...Object.keys(prep.suggested), ...Object.keys(prep.plan?.portions ?? {})])) out[id] = draft.portions[id] ?? prep.plan?.portions[id] ?? prep.suggested[id] ?? 0;
    return out;
  }, [prep, draft.portions]);
  // Ingredients follow the portions straight away, through the recipes and any corrected standards.
  const needs = useMemo(() => {
    if (!prep) return [];
    const m = ingredientsFor(Object.entries(portions).map(([itemId, units]) => ({ itemId, date: prep.period.from, units })), ctx.adjust.recipes);
    return [...m].map(([g, need]) => {
      const other = prep.otherUse[g] ?? 0;
      const available = prep.available[g] ?? 0;
      return { g, need, other, available, short: Math.max(0, need + other - available) };
    }).sort((a, b) => b.short - a.short || b.need - a.need);
  }, [prep, portions, ctx.adjust.recipes]);
  const shortages = needs.filter((n) => n.short > 1e-6);
  const changed = prep ? Object.keys(portions).some((k) => portions[k] !== (prep.plan?.portions[k] ?? prep.suggested[k] ?? 0)) || !prep.plan : false;
  const byCategory = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const id of Object.keys(portions).sort((a, b) => (portions[b] ?? 0) - (portions[a] ?? 0))) {
      const c = itemById[id].category;
      out.set(c, [...(out.get(c) ?? []), id]);
    }
    return [...out];
  }, [portions]);

  const save = async (): Promise<PrepPlan | null> => {
    if (!prep) return null;
    setBusy(true);
    const r = await mutate<{ plan: PrepPlan }>("/api/plan/prep", { action: "save", outletId: draft.outletId, period: draft.period, meal: draft.meal, portions, suggested: prep.suggested });
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return null; }
    update({ portions: {} });
    return r.data.plan;
  };

  return (
    <div className="space-y-5">
      <Steps steps={["Period", "Kitchen plan", "Kitchen checklist"]} current={draft.step} onGo={(n) => update({ step: n as PrepDraft["step"] })} />

      {draft.step === 1 && (
        <Panel title="What are you preparing for?">
          <div className="space-y-6">
            {outlets.length > 1 && <Choice label="Kitchen" value={draft.outletId} options={outlets.map((o) => ({ value: o, label: outletById[o].name }))} onChange={(o) => update({ outletId: o, portions: {}, assumptions: {} })} />}
            <Choice label="Period" value={draft.period} options={PERIOD_OPTIONS.filter((p) => p.value !== "custom")} onChange={(p) => update({ period: p, portions: {} })} />
            <Choice label="Meal" value={draft.meal} options={(prep?.meals ?? ["all", "breakfast", "lunch", "dinner"]).map((m) => ({ value: m, label: MEAL_LABEL[m] }))} onChange={(m) => update({ meal: m, portions: {} })} />
            <Button variant="primary" onClick={() => update({ step: 2 })}>See the kitchen plan <ArrowRight size={15} /></Button>
          </div>
        </Panel>
      )}

      {draft.step === 2 && (
        !prep ? <Panel><EmptyState title={error ?? "Working out the kitchen plan"} /></Panel> : (
          <>
            <Panel
              title={`${fmtDate(prep.period.from, true)}${prep.period.to !== prep.period.from ? ` to ${fmtDate(prep.period.to, true)}` : ""}: ${MEAL_LABEL[prep.meal].toLowerCase()} at ${outletById[prep.outletId].name}`}
              description={prep.plan ? `Saved by ${personName(prep.plan.updatedBy)}. Change any portion count and save again.` : "Tyll's suggestion from past sales, bookings and occupancy. Adjust anything you know better."}
              action={<Button variant="ghost" size="sm" onClick={() => update({ step: 1 })}><ArrowLeft size={15} /> Change period</Button>}
            >
              <div className="grid gap-6 lg:grid-cols-2">
                {byCategory.map(([cat, ids]) => (
                  <div key={cat}>
                    <h3 className="text-[13px] font-medium text-graphite">{cat}</h3>
                    <ul className="mt-2 divide-y divide-hair rounded-2xl border border-line">
                      {ids.map((id) => {
                        const n = portions[id] ?? 0;
                        const s = prep.suggested[id] ?? 0;
                        return (
                          <li key={id} className="flex items-center gap-3 px-4 py-2.5">
                            <span className="flex-1 text-sm text-ink">{itemById[id].name}{n !== s && <span className="block text-xs text-steel">Tyll suggests {s}</span>}</span>
                            {mayPlan ? (
                              <span className="flex items-center gap-1">
                                <button type="button" aria-label={`Fewer ${itemById[id].name}`} onClick={() => update({ portions: { ...draft.portions, [id]: Math.max(0, n - 5) } })} className="flex h-9 w-9 items-center justify-center rounded-full border border-line hover:bg-mist"><Minus size={14} /></button>
                                <input aria-label={`Portions of ${itemById[id].name}`} type="number" min={0} value={n} onChange={(e) => update({ portions: { ...draft.portions, [id]: Math.max(0, Math.round(Number(e.target.value))) } })} className="num h-9 w-16 rounded-xl border border-line text-center hover:border-fog" />
                                <button type="button" aria-label={`More ${itemById[id].name}`} onClick={() => update({ portions: { ...draft.portions, [id]: n + 5 } })} className="flex h-9 w-9 items-center justify-center rounded-full border border-line hover:bg-mist"><Plus size={14} /></button>
                              </span>
                            ) : <span className="num text-sm">{n}</span>}
                            <span className="w-14 text-right text-xs text-steel">portions</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
              {loading && <p className="mt-3 text-[13px] text-steel">Recalculating…</p>}
            </Panel>

            {prep.events.length > 0 && <EventPortions events={prep.events} mayPlan={mayPlan} />}

            <Panel title="Ingredients needed" description="Updates as you change portions. Available stock is what this kitchen can use after other outlets' share of the storeroom, plus deliveries already due.">
              {shortages.length > 0 ? (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warn/25 bg-warn-soft px-5 py-4">
                  <p className="text-sm text-ink">{shortages.length} ingredient{shortages.length === 1 ? " is" : "s are"} short for this plan.</p>
                  {can(user, "purchase.create") && (
                    <Button variant="primary" disabled={busy} onClick={async () => {
                      const plan = await save();
                      if (plan) router.push(`/forecast?tab=buy&prepPlan=${plan.id}&outlet=${plan.outletId}&period=${draft.period}`);
                    }}>Request missing ingredients</Button>
                  )}
                </div>
              ) : <p className="mb-4 text-sm text-graphite">Stock covers this plan.</p>}
              <ul className="divide-y divide-hair rounded-2xl border border-line text-sm">
                {needs.slice(0, 14).map((n) => {
                  const g = ingredientById[n.g];
                  return (
                    <li key={n.g} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-2.5">
                      <span className="min-w-[160px] text-ink">{g.name}</span>
                      <span className="num text-graphite">{fmtQty(n.need, g.unit)} for this plan</span>
                      <span className="num text-steel">{fmtQty(n.available, g.unit)} available</span>
                      {n.short > 1e-6 ? <Badge tone="neg" className="!py-0">{fmtQty(n.short, g.unit)} short</Badge> : <Badge tone="pos" className="!py-0">covered</Badge>}
                    </li>
                  );
                })}
              </ul>
              <Note className="mt-3">Shortages also count what the kitchen will use for other meals and drinks in the same period.</Note>
            </Panel>

            {mayPlan && (
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" disabled={busy} onClick={async () => { if (await save()) { toast.done("Prep plan saved. The kitchen checklist is updated."); update({ step: 3 }); } }}>{changed ? "Save the prep plan" : "Open the kitchen checklist"}</Button>
              </div>
            )}
            <AdjustDemand prep={prep} draft={draft} update={update} />
          </>
        )
      )}

      {draft.step === 3 && <Checklist plan={prep?.plan ?? null} assignees={data?.assignees ?? []} onBack={() => update({ step: 2 })} eventNames={Object.fromEntries((prep?.events ?? []).map((e) => [e.id, e.name]))} />}
    </div>
  );
}

function AdjustDemand({ prep, draft, update }: { prep: NonNullable<ReturnType<typeof usePrepSuggest>["data"]>["prep"]; draft: PrepDraft; update: (p: Partial<PrepDraft>) => void }) {
  const [open, setOpen] = useState(false);
  const values = { ...prep.assumptions, ...Object.fromEntries(Object.entries(draft.assumptions).filter(([, v]) => v !== undefined)) } as Assumptions;
  const sources = { ...prep.sources, ...Object.fromEntries(Object.keys(draft.assumptions).filter((k) => draft.assumptions[k as keyof Assumptions] !== undefined).map((k) => [k, "manual"])) } as typeof prep.sources;
  return (
    <Panel title={<button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="text-left">Change expected guests</button>} description={open ? "New figures change Tyll's suggestion. Portions you typed stay as they are." : undefined}>
      {open ? <DemandInputs baseline={prep.baseline} values={values} sources={sources} onChange={(patch) => update({ assumptions: { ...draft.assumptions, ...patch } })} /> : (
        <button type="button" onClick={() => setOpen(true)} className="text-[13px] text-steel underline underline-offset-4 hover:text-ink">Reservations, walk-ins, occupancy and events</button>
      )}
    </Panel>
  );
}

/** The plan as a simple list of jobs, each with who does it and whether it is done. */
export function Checklist({ plan, assignees, onBack, eventNames = {} }: { plan: PrepPlan | null; assignees: { id: string; name: string }[]; onBack?: () => void; eventNames?: Record<string, string> }) {
  const { user } = useView();
  const mutate = useMutate();
  if (!plan) return <Panel><EmptyState title="No prep plan saved yet" action={onBack && <Button onClick={onBack}>Make the plan</Button>}>Save a plan to turn it into a checklist.</EmptyState></Panel>;
  const act = async (taskId: string, body: Record<string, unknown>) => {
    const r = await mutate("/api/plan/prep", { action: "task", planId: plan.id, taskId, ...body });
    if (!r.ok) toast.error(r.error);
  };
  const done = plan.tasks.filter((t) => t.done).length;
  return (
    <Panel title={`Kitchen checklist, ${outletById[plan.outletId].name}`} description={`${fmtDate(plan.period.from, true)}${plan.period.to !== plan.period.from ? ` to ${fmtDate(plan.period.to, true)}` : ""}. ${done} of ${plan.tasks.length} done.`}
      action={onBack && <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft size={15} /> Edit the plan</Button>}>
      <ul className="divide-y divide-hair rounded-2xl border border-line">
        {plan.tasks.slice().sort((a, b) => Number(a.done) - Number(b.done) || b.portions - a.portions).map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <input type="checkbox" className="h-5 w-5 accent-ink" aria-label={`Done: ${itemById[t.itemId].name}`} checked={t.done} disabled={!can(user, "prep.complete")} onChange={(e) => act(t.id, { op: "complete", done: e.target.checked })} />
            <span className={cn("flex-1 text-[15px]", t.done ? "text-steel line-through" : "text-ink")}>Prepare {t.portions} {itemById[t.itemId].name.toLowerCase()} portion{t.portions === 1 ? "" : "s"}{t.eventId && <span className="ml-2 text-[13px] text-steel">for {eventNames[t.eventId] ?? "an event"}</span>}
              {(t.done || t.startedAt || t.issue) && <span className="block text-xs text-steel no-underline">{t.done && t.doneBy ? `Done by ${personName(t.doneBy)}${t.doneAt ? ` at ${t.doneAt.slice(11, 16)}` : ""}` : t.startedAt ? `Started at ${t.startedAt.slice(11, 16)}` : ""}{t.issue ? ` · Problem reported by ${personName(t.issue.by)}: ${t.issue.note}` : ""}</span>}</span>
            {can(user, "prep.plan") ? (
              <select aria-label={`Who prepares ${itemById[t.itemId].name}`} value={t.assigneeId ?? ""} onChange={(e) => act(t.id, { op: "assign", assigneeId: e.target.value })} className="h-9 rounded-full border border-line bg-paper px-3 text-[13px] hover:border-fog">
                <option value="">Not assigned</option>
                {assignees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            ) : <span className="text-[13px] text-steel">{assignees.find((a) => a.id === t.assigneeId)?.name ?? "Not assigned"}</span>}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** Events this kitchen prepares in the period. The chef can change portions; the event's ingredients and costs follow. */
function EventPortions({ events, mayPlan }: { events: PrepOut["events"]; mayPlan: boolean }) {
  const mutate = useMutate();
  const [edits, setEdits] = useState<Record<string, Record<string, number>>>({});
  return (
    <Panel title="Events" description="Confirmed events this kitchen prepares. Their ingredients are reserved separately, so they are not in the figures below. Saving the plan adds them to the checklist.">
      <div className="space-y-4">
        {events.map((e) => (
          <div key={e.id}>
            <h3 className="text-[15px] text-ink">{e.name} <span className="text-sm text-steel">· {fmtDate(e.date, true)} · {e.guests} guests</span></h3>
            <ul className="mt-2 divide-y divide-hair rounded-2xl border border-line">
              {e.dishes.map((d) => (
                <li key={d.itemId} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="flex-1 text-ink">{itemById[d.itemId].name}{d.portions !== d.calculated && <span className="block text-xs text-steel">event plan says {d.calculated}</span>}</span>
                  {mayPlan ? <input aria-label={`Event portions of ${itemById[d.itemId].name}`} type="number" min={0} value={edits[e.id]?.[d.itemId] ?? d.portions} onChange={(ev) => setEdits({ ...edits, [e.id]: { ...edits[e.id], [d.itemId]: Math.max(0, Math.round(Number(ev.target.value))) } })} className="num h-9 w-20 rounded-xl border border-line text-center" /> : <span className="num">{d.portions}</span>}
                  <span className="w-14 text-right text-xs text-steel">portions</span>
                </li>
              ))}
            </ul>
            {edits[e.id] && (
              <Button className="mt-2" size="sm" onClick={async () => {
                const r = await mutate(`/api/events/${e.id}`, { action: "kitchen", portions: edits[e.id] });
                if (!r.ok) return toast.error(r.error);
                setEdits({ ...edits, [e.id]: undefined as unknown as Record<string, number> });
                toast.done("Event portions updated. The event's ingredients and costs follow.");
              }}>Save event portions</Button>
            )}
          </div>
        ))}
      </div>
    </Panel>
  );
}
