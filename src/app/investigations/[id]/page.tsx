"use client";
import Link from "next/link";
import { useEarnPilot } from "@/lib/pilot";
import { useParams, useRouter } from "next/navigation";
import { Check, CircleHelp, ListChecks, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { ChargeEvidence, OrderTimeline, OrderVersusBill, Tickets } from "@/components/order-evidence";
import { UsageCaseBody } from "@/components/stock/usage";
import { Badge, Button, EmptyState, Field, Note, PageHeader, Panel, Select, TextArea, cn, report } from "@/components/ui";
import { ingredientById, outletById, propertyById, staffById } from "@/lib/data/catalog";
import { can } from "@/lib/domain/access";
import { TYPE_LABEL, chargedToGuest } from "@/lib/domain/detect";
import { explain } from "@/lib/domain/explain";
import { causesFor, periodVariance } from "@/lib/domain/variance";
import { BoughtUsedSum, CountLine } from "@/components/stock/bought-used";
import { BOUGHT_USED_CAUSES } from "@/lib/domain/bought-used";
import { assignablePeople, personName, useCtx, useInvestigations, useOrder, usePatterns, useUser } from "@/lib/hooks";
import { useDemo } from "@/lib/store";
import { AMOUNT_OUTCOMES, GUEST_OUTCOME_HELP, OUTCOME_HELP, OUTCOME_LABEL, STATUS_LABEL, STOCK_OUTCOME_HELP } from "@/lib/labels";
import type { BookingEvidence, BoughtUsedEvidence, MixEvidence, Outcome } from "@/lib/types";
import { COVER_RULES, VIA_LABEL, fmtStay, partyRange } from "@/lib/domain/covers";
import { cheapName, mixLabelById, mixValue } from "@/lib/domain/till-rules";
import { DEMO_TODAY, addDays, fmtDate, fmtMoney, fmtQty, fmtTime } from "@/lib/util";
import { isPastDeadline } from "@/lib/domain/deadline";


const SHORTFALL_CAUSES = ["Counting error", "Waste or breakage not logged", "Delivery shorter than recorded", "Portions or recipe differ from the standard", "Transfer not recorded", "Stock taken without authorisation"];

export default function InvestigationPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const user = useUser()!;
  const ctx = useCtx();
  const patterns = usePatterns();
  const investigations = useInvestigations();
  const inv = investigations.find((i) => i.id === decodeURIComponent(id));
  useEarnPilot(!!inv);
  const store = useDemo();

  const [assignee, setAssignee] = useState("");
  const [deadline, setDeadline] = useState(addDays(DEMO_TODAY, 2));
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState<Outcome>("legitimate");
  const [loss, setLoss] = useState("");
  const [recovered, setRecovered] = useState("");
  const [closeNote, setCloseNote] = useState("");
  const [formError, setFormError] = useState("");
  const [cause, setCause] = useState("");
  const [action, setAction] = useState("");

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
  const overdue = isPastDeadline(inv.deadline, closed);
  const mayAssign = can(user, "investigation.assign");
  const mayClose = can(user, "investigation.close");
  const mayReopen = can(user, "investigation.reopen");
  const stockCase = inv.type === "stock_shortfall";
  const usage = inv.type === "usage_variance" && inv.period ? inv.period : null;
  const bought = inv.type === "bought_not_used" && inv.boughtUsed && inv.ingredientId ? { ...inv.boughtUsed, ingredientId: inv.ingredientId } : null;
  const mix = inv.type === "cheaper_item_rung" && inv.mix ? inv.mix : null;
  const booking = inv.type === "seated_no_bill" && inv.booking ? inv.booking : null;
  const stockAny = stockCase || !!usage || !!bought;
  // A stock case asks for the cause the manager verified. The choices are the possibilities Tyll listed.
  const causeOptions = usage ? causesFor(usage, periodVariance(usage, ctx.adjust)).map((c) => c.title) : stockCase ? SHORTFALL_CAUSES : bought ? BOUGHT_USED_CAUSES.map((c) => c.title.replace(/\.$/, "")) : [];
  // An order whose removed item falls inside a stock period with a case: the two investigations share evidence.
  const linkedStock = inv.orderId ? investigations.filter((i) => i.id !== inv.id && i.period?.removals.some((r) => r.orderId === inv.orderId)) : [];
  // Every recorded action on this case, newest first, from the audit trail.
  const history = store.audit.filter((a) => a.detail === inv.id || a.detail.startsWith(`${inv.id} `) || a.detail.startsWith(`${inv.id}:`));
  const stockRecords = explanation.stock.length > 0 && (
    <div>
      <h3 className="mb-3 text-[15px]">{stockCase ? "The count" : "Stock records for the items involved"}</h3>
      <ul className="divide-y divide-hair rounded-2xl border border-line text-sm">
        {explanation.stock.map((s) => {
          const g = ingredientById[s.ingredientId];
          return (
            <li key={s.ingredientId} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-4 py-3">
              <span>{g.name}<span className="ms-2 text-xs text-steel">counted {fmtDate(s.count.date)} by {personName(s.count.by)}</span></span>
              <span className="num text-graphite">expected {fmtQty(s.count.expected, g.unit)}, counted {fmtQty(s.count.counted, g.unit)}</span>
              <span className={cn("num", s.variance < 0 ? "text-warn" : "text-steel")}>{s.variance < 0 ? `${fmtQty(Math.abs(s.variance), g.unit)} short, ${money(Math.abs(s.value))}` : "no shortfall"}</span>
            </li>
          );
        })}
      </ul>
      {explanation.stockNote && <Note className="mt-2 max-w-[80ch]">{explanation.stockNote}</Note>}
      {stockCase && <Link href={`/stock?tab=inventory&item=${explanation.stock[0].ingredientId}`} className="mt-3 inline-block text-[13px] underline underline-offset-4">See this item in inventory</Link>}
    </div>
  );

  const submitClose = () => {
    const confirmedLoss = outcome === "confirmed_loss" ? Number(loss || inv.exposure) : outcome === "recovered" ? Number(loss || 0) : 0;
    // Recovered money on a stock case must be entered: it is never assumed from the amount at stake.
    const rec = outcome === "recovered" ? Number(recovered || (stockAny ? 0 : inv.exposure)) : outcome === "confirmed_loss" ? Number(recovered || 0) : 0;
    const result = store.closeInvestigation(inv.id, { outcome, confirmedLoss, recovered: rec, note: closeNote, verifiedCause: cause, correctiveAction: action });
    if (result.ok) {
      setFormError("");
      setCloseNote("");
      setCause("");
      setAction("");
      report(result, `Closed as ${OUTCOME_LABEL[outcome].toLowerCase()}. The overview and Money Back List are updated.`);
    } else setFormError(result.error);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={inv.headline}
        lead={!usage && explanation.whatHappened !== inv.headline ? explanation.whatHappened : undefined}
      >
        <Badge tone={closed ? (inv.outcome === "confirmed_loss" ? "neg" : inv.outcome === "recovered" ? "pos" : "neutral") : "warn"}>{closed ? OUTCOME_LABEL[inv.outcome!] : STATUS_LABEL[inv.status]}</Badge>
        <Badge>{TYPE_LABEL[inv.type]}</Badge>
        {inv.basis && <Badge tone={inv.basis === "confirmed" ? "ink" : "neutral"}>{inv.basis === "confirmed" ? "Confirmed by a stock take" : mix ? "Estimate from bottles issued" : booking ? "Estimate at the spend per guest" : "Estimate until a stock take"}</Badge>}
      </PageHeader>
      {inv.comparedWith && <p className="rounded-panel border border-line bg-paper px-5 py-3 text-[13px] leading-relaxed text-graphite shadow-panel sm:px-6"><span className="font-medium text-ink">What it was compared against. </span>{inv.comparedWith.replace(/^Compared with /, "")}</p>}

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[1.7fr_1fr]">
        <div className="space-y-5">
          <Panel title="Where it happened">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
              <div><dt className="text-[13px] text-steel">Hotel</dt><dd>{property.name}</dd></div>
              <div><dt className="text-[13px] text-steel">Outlet</dt><dd>{inv.outletId ? outletById[inv.outletId].name : "Property-wide"}</dd></div>
              <div><dt className="text-[13px] text-steel">{stockCase ? "Count date" : usage ? "Counted" : bought || mix ? "Checked" : "Date and time"}</dt><dd className="num">{fmtDate(inv.date, true)}{stockCase ? "" : `, ${fmtTime(inv.min)}`}</dd></div>
              <div>
                <dt className="text-[13px] text-steel">Transaction</dt>
                <dd>{order ? <Link href={`/money/orders/${order.id}`} className="num underline decoration-line underline-offset-4 hover:decoration-ink">{order.id}</Link> : usage ? <Link href={`/stock?tab=where&period=${usage.id}`} className="underline decoration-line underline-offset-4 hover:decoration-ink">{ingredientById[usage.ingredientId].name} stock period</Link> : stockCase ? <Link href="/stock?tab=counts" className="underline decoration-line underline-offset-4 hover:decoration-ink">Stock count, {fmtDate(inv.date)}</Link> : bought ? <Link prefetch={false} href={`/stock?tab=bought&item=${bought.ingredientId}`} className="underline decoration-line underline-offset-4 hover:decoration-ink">Bought against used, 30 days</Link> : mix ? <Link prefetch={false} href="/money?tab=till" className="underline decoration-line underline-offset-4 hover:decoration-ink">Till rule check, 7 days of bottles</Link> : booking ? <Link prefetch={false} href="/money?tab=covers" className="underline decoration-line underline-offset-4 hover:decoration-ink">Booking {booking.bookingId}</Link> : <span className="num">{charge?.id ?? "None"}</span>}</dd>
              </div>
              {order && <div><dt className="text-[13px] text-steel">Table or room</dt><dd>{order.table}</dd></div>}
              {booking && <div><dt className="text-[13px] text-steel">Table</dt><dd>{booking.table}</dd></div>}
              {inv.staffId && (
                <div>
                  <dt className="text-[13px] text-steel">POS login used</dt>
                  <dd>{staffById[inv.staffId]?.name ?? inv.staffId}</dd>
                </div>
              )}
            </dl>
            {inv.staffId && <Note className="mt-4">A POS login shows which account was signed in to the terminal. It does not establish who made the change, or why.</Note>}
          </Panel>

          {linkedStock.map((s) => (
            <Panel key={s.id} title="Linked stock investigation">
              <p className="text-sm text-graphite">
                This order&rsquo;s removed item falls inside a stock period at {s.outletId ? outletById[s.outletId].name : property.name} where use is higher than sales explain: <Link href={`/investigations/${s.id}`} className="text-ink underline underline-offset-4">{s.headline}</Link>.
              </p>
              <Note className="mt-2">The removal is one possible explanation for part of that difference. Neither record shows that the item was served.</Note>
            </Panel>
          ))}

          {usage ? <UsageCaseBody p={usage} /> : (<>

          <Panel title={<span id="evidence" className="scroll-mt-24">Evidence</span>} description={stockCase ? "Taken directly from the stock count. Nothing here is inferred." : bought ? "Taken from supplier deliveries, till sales with their recipes, and the waste log. No stock count is used, so the gap is an estimate." : mix ? "Taken from the bottles issued to the bar and the till sales of the same week. No count of the open bottles is used, so the gap is an estimate." : booking ? "Taken from the reservation book and the bills of the same day. The value is an estimate at the outlet's spend per guest." : "Taken directly from the recorded transaction. Nothing here is inferred."}>
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
                {stockRecords}
              </div>
            )}
            {stockCase && stockRecords}
            {mix && <MixWeek m={mix} money={(n) => fmtMoney(n, property.currency)} />}
            {booking && <BookingFacts b={booking} value={inv.exposure} money={(n) => fmtMoney(n, property.currency)} />}
            {bought && <BoughtEvidence b={bought} money={(n) => fmtMoney(n, property.currency)} mayCount={can(user, "stock.count")} />}
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
          </>)}
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
                {inv.verifiedCause && <p className="mt-3 text-sm"><span className="text-steel">Verified cause: </span>{inv.verifiedCause}</p>}
                {inv.correctiveAction && <p className="mt-1 text-sm"><span className="text-steel">Corrective action: </span>{inv.correctiveAction}</p>}
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
                        {(Object.keys(OUTCOME_LABEL) as Outcome[]).filter((o) => !chargedToGuest(inv) || !AMOUNT_OUTCOMES.includes(o)).map((o) => (
                          <label key={o} className={cn("flex cursor-pointer gap-3 rounded-xl border px-3.5 py-3 transition-colors duration-200", outcome === o ? "border-ink bg-cloud" : "border-line hover:border-fog")}>
                            <input type="radio" name="outcome" value={o} checked={outcome === o} onChange={() => { setOutcome(o); setFormError(""); }} className="mt-1 accent-[var(--color-accent)]" />
                            <span><span className="block text-sm text-ink">{OUTCOME_LABEL[o]}</span><span className="block text-xs text-steel">{(stockCase || bought ? STOCK_OUTCOME_HELP : chargedToGuest(inv) ? GUEST_OUTCOME_HELP : OUTCOME_HELP)[o]}</span></span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    {(outcome === "confirmed_loss" || outcome === "recovered") && (
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Confirmed loss" suffix={property.currency} type="number" inputMode="decimal" step="0.01" min="0" max={inv.exposure} value={loss} placeholder={outcome === "confirmed_loss" ? inv.exposure.toFixed(2) : "0.00"} onChange={(e) => setLoss(e.target.value)} />
                        <Field label="Recovered" suffix={property.currency} type="number" inputMode="decimal" step="0.01" min="0" max={inv.exposure} value={recovered} placeholder={outcome === "recovered" && !stockAny ? inv.exposure.toFixed(2) : "0.00"} onChange={(e) => setRecovered(e.target.value)} />
                        <Note className="col-span-2">{stockAny ? `Together these cannot exceed the ${money(inv.exposure)} involved. Enter only what has been recovered and checked, such as a supplier credit.` : `Together these cannot exceed the ${money(inv.exposure)} involved. Leave blank to use the full amount.`}</Note>
                      </div>
                    )}
                    {stockAny && outcome !== "inconclusive" && (
                      <Select label="Verified cause" value={cause} onChange={(e) => { setCause(e.target.value); setFormError(""); }}>
                        <option value="">Choose what you confirmed</option>
                        {causeOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                        <option value="Another cause, described in the note">Another cause, described in the note</option>
                      </Select>
                    )}
                    {stockAny && <Field label="Corrective action" value={action} onChange={(e) => setAction(e.target.value)} placeholder="For example: pour measures issued to the bar" />}
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
            {history.length > 0 && (
              <ul className="mb-5 space-y-2 border-b border-hair pb-4">
                {history.map((a, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-3 text-[13px]">
                    <span className="text-graphite">{a.action}</span>
                    <span className="shrink-0 text-xs text-steel">{personName(a.userId)} · {fmtDate(DEMO_TODAY)}</span>
                  </li>
                ))}
              </ul>
            )}
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

/** The 30 day figures behind a bought against used flag. */
function BoughtEvidence({ b, money, mayCount }: { b: BoughtUsedEvidence & { ingredientId: string }; money: (n: number) => string; mayCount: boolean }) {
  return (
    <div>
      <BoughtUsedSum r={b} money={money} />
      <div className="mt-3"><CountLine ingredientId={b.ingredientId} c={b.lastCount} mayCount={mayCount} /></div>
      <Note className="mt-2 max-w-[80ch]">Stock still on the shelf is part of the gap until a count confirms it. A gap does not show what happened to the stock.</Note>
      <Link prefetch={false} href={`/stock?tab=bought&item=${b.ingredientId}`} className="mt-3 inline-block text-[13px] underline underline-offset-4">See this item in Bought against used</Link>
    </div>
  );
}

/** The week behind a cheaper item flag: bottles issued against what was billed, beside the weeks before. */
function MixWeek({ m, money }: { m: MixEvidence; money: (n: number) => string }) {
  const l = mixLabelById[m.labelId];
  const wine = m.rule === "premium";
  const rows: [string, number, number, string?][] = [
    ["Bottles issued to the bar", m.bottles, m.before.bottles],
    [wine ? `${l.name}, glasses billed` : "Measures billed, a double as two", m.billed, m.before.billed],
    [wine ? `${cheapName(l)}, glasses billed` : "Singles billed", m.cheapBilled, m.before.cheapBilled],
  ];
  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-2xl border border-line">
        <table className="w-full text-sm">
          <thead><tr className="text-[13px] text-steel"><th className="px-4 py-2 text-start font-normal">{l.name}, {fmtDate(m.from)} to {fmtDate(m.to)}</th><th className="px-4 py-2 text-end font-normal">This week</th><th className="px-4 py-2 text-end font-normal">A week before</th></tr></thead>
          <tbody className="divide-y divide-hair border-t border-hair">
            {rows.map(([label, now, before]) => <tr key={label}><td className="px-4 py-2.5">{label}</td><td className="num px-4 py-2.5 text-end text-ink">{now}</td><td className="num px-4 py-2.5 text-end text-graphite">{Math.round(before * 10) / 10}</td></tr>)}
          </tbody>
        </table>
      </div>
      <p className="num flex flex-wrap justify-between gap-2 rounded-2xl bg-mist px-4 py-3 text-sm"><span>{m.bottles} bottles give about {m.bottles * m.perBottle} {l.unit}, {m.gap} more than the bills account for</span><span className="font-medium text-ink">{money(Math.round(mixValue(m)))}, an estimate</span></p>
      <Note className="max-w-[80ch]">One open bottle can always be part used, so a gap under two bottles is never flagged. Bottles issued and the bills are simulated.</Note>
      <Link prefetch={false} href="/money?tab=till" className="inline-block text-[13px] underline underline-offset-4">See the till rule check</Link>
    </div>
  );
}

/** The booking behind a seated table with no bill, and the bills around it. */
function BookingFacts({ b, value, money }: { b: BookingEvidence; value: number; money: (n: number) => string }) {
  const sizes = [...new Set(b.nearby.map((o) => o.covers))].sort((x, y) => x - y);
  const facts: [string, string][] = [
    ["Booking", `${b.bookingId}, for ${b.party} at ${fmtTime(b.bookedFor)}`],
    ["Made", `${VIA_LABEL[b.via].charAt(0).toUpperCase()}${VIA_LABEL[b.via].slice(1)}${b.room ? `, by the guest in room ${b.room}` : ""}`],
    ["Seated", `${b.table} at ${fmtTime(b.seatedMin)}`],
    ["Finished", b.leftMin === undefined ? "Not recorded" : `${fmtTime(b.leftMin)}, after ${fmtStay(b.leftMin - b.seatedMin)}`],
  ];
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        {facts.map(([k, v]) => <div key={k}><dt className="text-[13px] text-steel">{k}</dt><dd className="text-ink">{v}</dd></div>)}
      </dl>
      <p className="num flex flex-wrap justify-between gap-2 rounded-2xl bg-mist px-4 py-3 text-sm"><span>No bill at {b.table} opened from {fmtTime(b.from)} to {fmtTime(b.to)}</span><span className="font-medium text-ink">{money(value)}, an estimate</span></p>
      <div>
        <h3 className="mb-2 text-[15px]">Bills at {b.table} that day</h3>
        {b.atTable.length === 0 ? <p className="text-sm text-graphite">None.</p> : (
          <ul className="divide-y divide-hair rounded-2xl border border-line text-sm">
            {b.atTable.map((o) => (
              <li key={o.orderId} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-4 py-2.5">
                <Link prefetch={false} href={`/money/orders/${o.orderId}`} className="num underline decoration-line underline-offset-4 hover:decoration-ink">{o.orderId}</Link>
                <span className="num text-graphite">{fmtTime(o.openMin)} to {fmtTime(o.closeMin)}, {o.covers} {o.covers === 1 ? "guest" : "guests"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-sm text-graphite">{b.nearby.length ? `${b.nearby.length} ${b.nearby.length === 1 ? "bill was" : "bills were"} opened elsewhere within ${COVER_RULES.moved} minutes of seating, for ${sizes.join(" or ")} ${sizes.length === 1 && sizes[0] === 1 ? "guest" : "guests"}: none for ${partyRange(b.party)}.` : `No bill was opened elsewhere within ${COVER_RULES.moved} minutes of seating.`}</p>
      <Note className="max-w-[80ch]">{`Valued at the spend per guest at this service over the ${COVER_RULES.spendDays} days before, ${money(b.spendPerGuest)}. The reservation book and the bills are simulated.`}</Note>
      <Link prefetch={false} href="/money?tab=covers" className="inline-block text-[13px] underline underline-offset-4">See booked against billed covers</Link>
    </div>
  );
}
