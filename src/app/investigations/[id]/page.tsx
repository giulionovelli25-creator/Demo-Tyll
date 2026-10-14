"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Check, CircleHelp, ListChecks, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { ChargeEvidence, OrderTimeline, OrderVersusBill, Tickets } from "@/components/order-evidence";
import { Badge, Button, Crumbs, EmptyState, Field, Note, PageHeader, Panel, Select, TextArea, cn, report } from "@/components/ui";
import { ingredientById, outletById, propertyById, staffById } from "@/lib/data/catalog";
import { can } from "@/lib/domain/access";
import { TYPE_LABEL } from "@/lib/domain/detect";
import { explain } from "@/lib/domain/explain";
import { assignablePeople, personName, useCtx, useInvestigations, useOrder, usePatterns, useUser } from "@/lib/hooks";
import { useDemo } from "@/lib/store";
import { OUTCOME_HELP, OUTCOME_LABEL, STATUS_LABEL } from "@/lib/labels";
import type { Outcome } from "@/lib/types";
import { DEMO_TODAY, addDays, fmtDate, fmtMoney, fmtQty, fmtTime } from "@/lib/util";


export default function InvestigationPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const user = useUser()!;
  const ctx = useCtx();
  const patterns = usePatterns();
  const investigations = useInvestigations();
  const inv = investigations.find((i) => i.id === decodeURIComponent(id));
  const store = useDemo();

  const [assignee, setAssignee] = useState("");
  const [deadline, setDeadline] = useState(addDays(DEMO_TODAY, 2));
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState<Outcome>("legitimate");
  const [loss, setLoss] = useState("");
  const [recovered, setRecovered] = useState("");
  const [closeNote, setCloseNote] = useState("");
  const [formError, setFormError] = useState("");

  const { order: fetchedOrder, status: orderStatus } = useOrder(inv?.orderId);
  const explanation = useMemo(() => (inv ? explain(inv, ctx.data, ctx.counts, patterns, fetchedOrder) : null), [inv, ctx, patterns, fetchedOrder]);

  if (!inv || !explanation) {
    return (
      <EmptyState title="This investigation is not available" action={<Button variant="primary" onClick={() => router.push("/investigations")}>Open the Money Back List</Button>}>
        It does not exist, or it belongs to an outlet outside your access.
      </EmptyState>
    );
  }

  const property = propertyById[inv.propertyId];
  const money = (n: number) => fmtMoney(n, property.currency, { decimals: true });
  const order = fetchedOrder;
  const charge = inv.chargeId ? ctx.data.chargesById.get(inv.chargeId) : undefined;
  const closed = inv.status === "closed";
  const people = assignablePeople(inv.outletId, inv.propertyId);
  const overdue = !closed && inv.deadline && inv.deadline < DEMO_TODAY;
  const mayAssign = can(user, "investigation.assign");
  const mayClose = can(user, "investigation.close");
  const mayReopen = can(user, "investigation.reopen");

  const submitClose = () => {
    const confirmedLoss = outcome === "confirmed_loss" ? Number(loss || inv.exposure) : outcome === "recovered" ? Number(loss || 0) : 0;
    const rec = outcome === "recovered" ? Number(recovered || inv.exposure) : outcome === "confirmed_loss" ? Number(recovered || 0) : 0;
    const result = store.closeInvestigation(inv.id, { outcome, confirmedLoss, recovered: rec, note: closeNote });
    if (result.ok) {
      setFormError("");
      setCloseNote("");
      report(result, `Closed as ${OUTCOME_LABEL[outcome].toLowerCase()}. The overview and Money Back List are updated.`);
    } else setFormError(result.error);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        crumbs={<Crumbs items={[{ label: "Money Back List", onClick: () => router.push("/investigations") }, { label: inv.id.replace("EX-", "Case ") }]} />}
        title={inv.headline}
        lead={explanation.whatHappened !== inv.headline ? explanation.whatHappened : undefined}
      >
        <Badge tone={closed ? (inv.outcome === "confirmed_loss" ? "neg" : inv.outcome === "recovered" ? "pos" : "neutral") : "warn"}>{closed ? OUTCOME_LABEL[inv.outcome!] : STATUS_LABEL[inv.status]}</Badge>
        <Badge>{TYPE_LABEL[inv.type]}</Badge>
      </PageHeader>

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[1.7fr_1fr]">
        <div className="space-y-5">
          <Panel title="Where it happened">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
              <div><dt className="text-[13px] text-steel">Hotel</dt><dd>{property.name}</dd></div>
              <div><dt className="text-[13px] text-steel">Outlet</dt><dd>{inv.outletId ? outletById[inv.outletId].name : "Property-wide"}</dd></div>
              <div><dt className="text-[13px] text-steel">Date and time</dt><dd className="num">{fmtDate(inv.date, true)}, {fmtTime(inv.min)}</dd></div>
              <div>
                <dt className="text-[13px] text-steel">Transaction</dt>
                <dd>{order ? <Link href={`/money/orders/${order.id}`} className="num underline decoration-line underline-offset-4 hover:decoration-ink">{order.id}</Link> : <span className="num">{charge?.id ?? "–"}</span>}</dd>
              </div>
              {order && <div><dt className="text-[13px] text-steel">Table or room</dt><dd>{order.table}</dd></div>}
              {inv.staffId && (
                <div>
                  <dt className="text-[13px] text-steel">POS login used</dt>
                  <dd>{staffById[inv.staffId]?.name ?? inv.staffId}</dd>
                </div>
              )}
            </dl>
            {inv.staffId && <Note className="mt-4">A POS login shows which account was signed in to the terminal. It does not establish who made the change, or why.</Note>}
          </Panel>

          <Panel title={<span id="evidence" className="scroll-mt-24">Evidence</span>} description="Taken directly from the recorded transaction. Nothing here is inferred.">
            {orderStatus === "loading" && <p className="text-sm text-steel">Loading the order records.</p>}
            {order && (
              <div className="space-y-6">
                <OrderVersusBill order={order} />
                <div>
                  <h3 className="mb-3 text-[15px]">Exact changes, in order</h3>
                  <OrderTimeline order={order} />
                </div>
                <div>
                  <h3 className="mb-3 text-[15px]">Kitchen and bar tickets</h3>
                  <Tickets order={order} />
                </div>
                {explanation.stock.length > 0 && (
                  <div>
                    <h3 className="mb-3 text-[15px]">Stock records for the items involved</h3>
                    <ul className="divide-y divide-hair rounded-2xl border border-line text-sm">
                      {explanation.stock.map((s) => {
                        const g = ingredientById[s.ingredientId];
                        return (
                          <li key={s.ingredientId} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-4 py-3">
                            <span>{g.name}<span className="ml-2 text-xs text-steel">counted {fmtDate(s.count.date)}</span></span>
                            <span className="num text-graphite">expected {fmtQty(s.count.expected, g.unit)}, counted {fmtQty(s.count.counted, g.unit)}</span>
                            <span className={cn("num", s.variance < 0 ? "text-warn" : "text-steel")}>{s.variance < 0 ? `${fmtQty(Math.abs(s.variance), g.unit)} short, ${money(Math.abs(s.value))}` : "no shortfall"}</span>
                          </li>
                        );
                      })}
                    </ul>
                    {explanation.stockNote && <Note className="mt-2 max-w-[80ch]">{explanation.stockNote}</Note>}
                  </div>
                )}
              </div>
            )}
            {charge && !order && <ChargeEvidence charge={charge} />}
            {charge && order && <div className="mt-6"><h3 className="mb-3 text-[15px]">Guest bill posting</h3><ChargeEvidence charge={charge} /></div>}
          </Panel>

          <Panel title="Tyll's explanation" action={<Badge>Assembled by rules, not a language model</Badge>}>
            <blockquote className="rounded-2xl bg-mist px-5 py-4 text-[15px] leading-relaxed text-ink">{explanation.message}</blockquote>
            <div className="mt-6 grid gap-6 md:grid-cols-2">
              <div>
                <h3 className="flex items-center gap-2 text-[15px]"><Check size={16} className="text-pos" aria-hidden /> What the records show</h3>
                <ul className="mt-2 space-y-2 text-sm text-graphite">
                  {explanation.facts.map((f, i) => <li key={i} className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-fog" aria-hidden />{f}</li>)}
                </ul>
              </div>
              <div>
                <h3 className="flex items-center gap-2 text-[15px]"><CircleHelp size={16} className="text-steel" aria-hidden /> What could explain it</h3>
                <p className="mt-1 text-xs text-steel">Possibilities to check. None of them is established.</p>
                <ul className="mt-2 space-y-2 text-sm text-graphite">
                  {explanation.possibleCauses.map((f, i) => <li key={i} className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-fog" aria-hidden />{f}</li>)}
                </ul>
              </div>
            </div>
            {explanation.patternNote && (
              <div className="mt-6 rounded-2xl border border-warn/25 bg-warn-soft px-5 py-4 text-sm text-ink">
                <p className="font-medium">A repeated pattern</p>
                <p className="mt-1 text-graphite">{explanation.patternNote}</p>
                <Link href={`/investigations?type=${inv.type}&status=all`} className="mt-2 inline-block text-[13px] underline underline-offset-4">See the similar cases</Link>
              </div>
            )}
            {!explanation.patternNote && explanation.similarAtOutlet > 0 && <Note className="mt-5">{explanation.similarAtOutlet} similar case{explanation.similarAtOutlet === 1 ? "" : "s"} at this outlet in the previous 14 days.</Note>}
          </Panel>

          <Panel title={<span className="flex items-center gap-2"><ListChecks size={18} aria-hidden /> Recommended next steps</span>}>
            <ol className="space-y-3 text-sm">
              {explanation.recommended.map((r, i) => (
                <li key={i} className="flex gap-3"><span className="num flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-mist text-xs text-graphite">{i + 1}</span><span className="pt-0.5 text-graphite">{r}</span></li>
              ))}
            </ol>
          </Panel>
        </div>

        <div className="space-y-5 xl:sticky xl:top-24">
          <Panel title="Financial impact">
            <p className="text-[13px] text-steel">{closed ? "Value that was involved" : "Potential value involved"}</p>
            <p className={cn("num mt-1 text-[30px] tracking-[-0.03em]", !closed && "text-warn")}>{money(inv.exposure)}</p>
            {closed ? (
              <dl className="mt-4 space-y-2 border-t border-hair pt-4 text-sm">
                <div className="flex justify-between"><dt className="text-steel">Confirmed loss</dt><dd className={cn("num", inv.confirmedLoss > 0 && "text-neg")}>{money(inv.confirmedLoss)}</dd></div>
                <div className="flex justify-between"><dt className="text-steel">Recovered and verified</dt><dd className={cn("num", inv.recovered > 0 && "text-pos")}>{money(inv.recovered)}</dd></div>
              </dl>
            ) : (
              <Note className="mt-2">Not a confirmed loss. It becomes one only if the outcome below says so.</Note>
            )}
          </Panel>

          <Panel title={<span id="resolve" className="scroll-mt-24">{closed ? "Outcome" : "Manage this case"}</span>}>
            {closed ? (
              <div>
                <p className="text-sm text-ink">{OUTCOME_LABEL[inv.outcome!]}</p>
                <p className="mt-1 text-[13px] text-steel">Closed {inv.closedAt ? fmtDate(inv.closedAt) : ""} by {personName(inv.closedBy)}</p>
                {mayReopen ? (
                  <Button className="mt-4" onClick={() => report(store.reopenInvestigation(inv.id), "Case reopened. Its amount counts as a potential loss again.")}><RotateCcw size={15} /> Reopen the case</Button>
                ) : (
                  <Note className="mt-3">Your role cannot reopen closed cases. A general manager, F&amp;B director or financial controller can.</Note>
                )}
              </div>
            ) : (
              <div className="space-y-6">
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div><dt className="text-[13px] text-steel">Responsible</dt><dd>{personName(inv.assigneeId)}</dd></div>
                  <div><dt className="text-[13px] text-steel">Deadline</dt><dd className={cn("num", overdue && "text-neg")}>{inv.deadline ? fmtDate(inv.deadline, true) : "Not set"}{overdue && " (overdue)"}</dd></div>
                </dl>

                {mayAssign && (
                  <form
                    className="space-y-3 border-t border-hair pt-5"
                    onSubmit={(e) => {
                      e.preventDefault();
                      report(store.assignInvestigation(inv.id, assignee || inv.assigneeId || "", deadline), "Responsibility and deadline saved.");
                    }}
                  >
                    <Select label="Assign to" value={assignee || inv.assigneeId || ""} onChange={(e) => setAssignee(e.target.value)}>
                      <option value="">Choose a person</option>
                      {people.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </Select>
                    <Field label="Deadline" type="date" min={DEMO_TODAY} value={deadline} onChange={(e) => setDeadline(e.target.value)} />
                    <div className="flex flex-wrap gap-2">
                      <Button type="submit">Save assignment</Button>
                      {inv.status !== "in_review" && <Button variant="ghost" onClick={() => report(store.startReview(inv.id), "Marked as in review.")}>Mark as in review</Button>}
                    </div>
                  </form>
                )}

                {mayClose ? (
                  <form
                    className="space-y-4 border-t border-hair pt-5"
                    onSubmit={(e) => {
                      e.preventDefault();
                      submitClose();
                    }}
                  >
                    <fieldset>
                      <legend className="mb-2 text-[13px] font-medium text-graphite">Record the outcome</legend>
                      <div className="space-y-2">
                        {(Object.keys(OUTCOME_LABEL) as Outcome[]).map((o) => (
                          <label key={o} className={cn("flex cursor-pointer gap-3 rounded-xl border px-3.5 py-3 transition-colors duration-200", outcome === o ? "border-ink bg-cloud" : "border-line hover:border-fog")}>
                            <input type="radio" name="outcome" value={o} checked={outcome === o} onChange={() => { setOutcome(o); setFormError(""); }} className="mt-1 accent-ink" />
                            <span><span className="block text-sm text-ink">{OUTCOME_LABEL[o]}</span><span className="block text-xs text-steel">{OUTCOME_HELP[o]}</span></span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    {(outcome === "confirmed_loss" || outcome === "recovered") && (
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Confirmed loss" suffix={property.currency} type="number" inputMode="decimal" step="0.01" min="0" max={inv.exposure} value={loss} placeholder={outcome === "confirmed_loss" ? inv.exposure.toFixed(2) : "0.00"} onChange={(e) => setLoss(e.target.value)} />
                        <Field label="Recovered" suffix={property.currency} type="number" inputMode="decimal" step="0.01" min="0" max={inv.exposure} value={recovered} placeholder={outcome === "recovered" ? inv.exposure.toFixed(2) : "0.00"} onChange={(e) => setRecovered(e.target.value)} />
                        <Note className="col-span-2">Together these cannot exceed the {money(inv.exposure)} involved. Leave blank to use the full amount.</Note>
                      </div>
                    )}
                    <TextArea label="What did you find?" value={closeNote} onChange={(e) => setCloseNote(e.target.value)} placeholder="For example: bar confirmed the drink was poured and served. Guest had left." error={formError || undefined} />
                    <Button type="submit" variant="primary" className="w-full">Close the investigation</Button>
                  </form>
                ) : (
                  <Note className="border-t border-hair pt-4">Your role can view this case but cannot close it.</Note>
                )}
              </div>
            )}
          </Panel>

          <Panel title="Notes and history">
            {inv.notes.length === 0 ? <p className="text-sm text-steel">No notes yet.</p> : (
              <ul className="space-y-4">
                {inv.notes.map((n, i) => (
                  <li key={i} className="text-sm">
                    <p className="text-graphite">{n.text}</p>
                    <p className="mt-0.5 text-xs text-steel">{personName(n.by)} · {fmtDate(n.at)}</p>
                  </li>
                ))}
              </ul>
            )}
            {!closed && can(user, "investigation.note") && (
              <form
                className="mt-5 space-y-3 border-t border-hair pt-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (report(store.addNote(inv.id, note), "Note added.")) setNote("");
                }}
              >
                <TextArea label="Add a note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you checked, who you spoke to" />
                <Button type="submit" size="sm">Add note</Button>
              </form>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
