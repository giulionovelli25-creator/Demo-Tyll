"use client";
// Deliveries at risk, on Predictions: which coming deliveries might arrive late, from each supplier's own record, and
// only those whose lateness would leave a service short are alerts. Everything else is one line behind "Show all".
// Predictions are labelled as predictions; the history is simulated. Nothing is sent to a supplier.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Phone } from "lucide-react";
import { useEffect, useState } from "react";
import { Section } from "@/components/disclosure";
import { Badge, Button, Drawer, Note, Panel, TableWrap, Td, Th, TextArea, cn, linkButton, rowClass, textLink, toast, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { ROLE_LABEL, outletById } from "@/lib/data/catalog";
import { can } from "@/lib/domain/access";
import { CONFIDENCE_WORD, minOf } from "@/lib/domain/late-delivery";
import { useSessionEntries, useView } from "@/lib/hooks";
import { usePlanDrafts } from "@/lib/plan-hooks";
import type { HandleHow, RiskRow } from "@/lib/server/late-delivery";
import type { MonthPlanOut } from "@/lib/server/purchasing";
import { DEMO_TODAY, addDays, fmtDate, fmtMoney, fmtQty, fmtTime } from "@/lib/util";

const FIRST = 5;
const at = (stampOrTime: string) => fmtTime(minOf(stampOrTime.length > 5 ? stampOrTime.slice(11, 16) : stampOrTime));
const day = (date: string) => (date === DEMO_TODAY ? "Today" : date === addDays(DEMO_TODAY, 1) ? "Tomorrow" : fmtDate(date, true));
const outlets = (ids: string[]) => ids.map((o) => outletById[o]?.name ?? o).join(" and ");

function badgeOf(r: RiskRow): { tone: Tone; label: string } {
  if (r.status === "arrived") return { tone: "pos", label: "Arrived" };
  if (r.status === "handled") return { tone: "pos", label: "Handled" };
  if (r.status === "alert") return { tone: r.severity === "red" ? "neg" : "warn", label: "Likely late" };
  if (r.status === "learning") return { tone: "neutral", label: "Learning this supplier" };
  if (r.status === "on_time") return { tone: "neutral", label: "Expected on time" };
  return { tone: "neutral", label: r.prediction.verdict === "likely" ? "Likely late, stock covers it" : "May be late, stock covers it" };
}

/** "Wagyu beef mince runs short before lunch: 0.4 kg left at 9:30 AM, lunch needs 1.6 kg, at Mercado and In-Room Dining." */
function impactLine(r: RiskRow): string | null {
  const i = r.items.find((x) => x.shortfall);
  if (!i?.shortfall) return null;
  const s = i.shortfall;
  return `${i.name} runs short before ${s.service}: ${fmtQty(s.have, i.unit)} left when prep starts at ${at(s.neededBy)}, ${s.service} needs about ${fmtQty(s.need, i.unit)}${i.outletIds.length ? `, at ${outlets(i.outletIds)}` : ""}.`;
}

export function DeliveriesAtRisk({ plan }: { plan: MonthPlanOut }) {
  const { user } = useView();
  const params = useSearchParams();
  const router = useRouter();
  const rows = plan.risk?.rows ?? [];
  const focus = params.get("risk");
  const [open, setOpen] = useState<string | null>(null);
  const money = (n: number) => fmtMoney(n, "EUR");
  // An alert or a warning opens its delivery here.
  useEffect(() => {
    if (!focus) return;
    const t = setTimeout(() => { setOpen(focus); document.getElementById("deliveries-at-risk")?.scrollIntoView({ block: "start", behavior: "smooth" }); }, 0);
    return () => clearTimeout(t);
  }, [focus]);
  if (!plan.risk) return null;
  const top = rows.filter((r) => r.status === "alert" || r.status === "handled").slice(0, FIRST);
  const rest = rows.filter((r) => !top.includes(r));
  const story = rows.find((r) => r.status === "alert" || r.status === "handled");
  const current = rows.find((r) => r.key === open) ?? null;
  const likely = rows.filter((r) => r.prediction.verdict === "likely" && r.status !== "arrived").length;
  const close = () => { setOpen(null); if (focus) router.replace("/forecast", { scroll: false }); };

  return (
    <section id="deliveries-at-risk" className="scroll-mt-24 space-y-4">
      <Panel title="Deliveries at risk" description="Which deliveries might arrive late? A prediction from each supplier's record over the last 12 weeks, checked against the stock each service needs. Simulated data." flush>
        {top.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-graphite sm:px-6">No delivery in the next two days is likely to be late in a way that leaves a service short.{likely ? ` ${likely} may be late, and stock covers the wait.` : ""}</p>
        ) : (
          <ul className="divide-y divide-hair border-t border-hair">
            {top.map((r) => {
              const b = badgeOf(r);
              return (
                <li key={r.key}>
                  <button type="button" onClick={() => setOpen(r.key)} className="flex w-full flex-col gap-1.5 px-5 py-4 text-start transition-colors duration-150 hover:bg-cloud sm:px-6">
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-[15px] font-medium text-ink">{r.supplier}</span>
                      <Badge tone={b.tone}>{b.label}</Badge>
                      <span className="text-[13px] text-steel">{day(r.date)} {at(r.window.from)} to {at(r.window.to)}{r.poNumber ? `, ${r.poNumber}` : ""}</span>
                    </span>
                    <span className="text-sm text-graphite">{r.prediction.sentence}</span>
                    {r.status === "handled" && r.handled ? (
                      <span className="text-[13px] text-steel">{r.handled.label} by {r.handled.byName}, {ROLE_LABEL[r.handled.role].toLowerCase()}.</span>
                    ) : (
                      <span className="text-sm text-ink">{impactLine(r)} {r.valueAtRisk > 0 && <span className="font-medium">{money(r.valueAtRisk)} of sales at risk, an estimate.</span>}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {rest.length > 0 && (
        <Section id="predictions.deliveries" title={`Show all ${rows.length} coming deliveries`} summary={`${rows.filter((r) => r.status === "covered").length} may be late with stock covering the wait, ${rows.filter((r) => r.status === "on_time").length} expected on time, ${rows.filter((r) => r.status === "learning").length} still being learned`} flush>
          <TableWrap>
            <table className="w-full text-table">
              <thead><tr><Th>Delivery</Th><Th>What the record says</Th><Th align="right">Status</Th></tr></thead>
              <tbody>
                {rest.map((r) => {
                  const b = badgeOf(r);
                  return (
                    <tr key={r.key} className={cn(rowClass, "cursor-pointer")} onClick={() => setOpen(r.key)}>
                      <Td><span className="text-ink">{r.supplier}</span><span className="block text-xs text-steel">{day(r.date)} {at(r.window.from)} to {at(r.window.to)}</span></Td>
                      <Td className="text-graphite">{r.prediction.sentence}</Td>
                      <Td align="right"><Badge tone={b.tone}>{b.label}</Badge></Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        </Section>
      )}

      {story && <WorkedExample r={story} open={params.get("open") === "late-example"} onOpen={() => setOpen(story.key)} />}

      <Drawer open={!!current} onClose={close} title={current ? `${current.supplier}, ${day(current.date).toLowerCase()} ${at(current.window.from)}` : ""} description={current ? "A prediction from the supplier's record, not a promise. Simulated data." : undefined}>
        {current && <RiskDetail r={current} mayHandle={can(user, "deliveries.handle")} mayOrder={can(user, "purchase.create")} mayReceive={can(user, "purchase.receive")} propertyId={plan.propertyId} />}
      </Drawer>
    </section>
  );
}

function RiskDetail({ r, mayHandle, mayOrder, mayReceive, propertyId }: { r: RiskRow; mayHandle: boolean; mayOrder: boolean; mayReceive: boolean; propertyId: string }) {
  const entries = useSessionEntries();
  const bump = usePlanDrafts((s) => s.bump);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<HandleHow | null>(null);
  const [note, setNote] = useState("");
  const [madeId, setMadeId] = useState<string | null>(null);
  const p = r.prediction;
  const short = r.items.filter((i) => i.shortfall);
  const covered = r.items.filter((i) => !i.shortfall);
  const money = (n: number) => fmtMoney(n, "EUR");

  const send = async (how: HandleHow, text = note) => {
    setBusy(true);
    try {
      const res = await api<{ requestId?: string }>("/api/deliveries", { method: "POST", body: { action: "handle", propertyId, key: r.key, how, note: text, ...entries } });
      if (res.requestId) { setMadeId(res.requestId); toast.done(`Draft order ${res.requestId} made at ${r.backup?.name ?? "the backup supplier"}. It needs approval; nothing is sent.`); }
      else toast.done("Saved. The alert is closed for the team.");
      setForm(null);
      setNote("");
      bump();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That could not be saved. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const arrived = async () => {
    setBusy(true);
    try { await api("/api/deliveries", { method: "POST", body: { action: "arrived", key: r.key, complete: true } }); bump(); toast.done("Arrival recorded at this time. The alert is cleared."); }
    catch (e) { toast.error(e instanceof Error ? e.message : "That could not be saved. Try again."); }
    finally { setBusy(false); }
  };
  const reopen = async () => {
    setBusy(true);
    try { await api("/api/deliveries", { method: "POST", body: { action: "reopen", key: r.key } }); bump(); toast.done("Taken back. The delivery is at risk again."); }
    catch (e) { toast.error(e instanceof Error ? e.message : "That could not be saved. Try again."); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-2xl border border-line p-3"><dt className="text-xs text-steel">Promised</dt><dd className="num mt-0.5 text-ink">{at(r.window.from)} to {at(r.window.to)}</dd></div>
        <div className="rounded-2xl border border-line p-3"><dt className="text-xs text-steel">Likely arrival</dt><dd className="num mt-0.5 text-ink">{p.verdict === "learning" ? "No prediction yet" : `About ${at(p.likelyArrival)}`}</dd></div>
        <div className="rounded-2xl border border-line p-3"><dt className="text-xs text-steel">Chance it is late</dt><dd className="num mt-0.5 text-ink">{p.chance === null ? "Not known yet" : `${Math.round(p.chance * 100)}%`}</dd></div>
        <div className="rounded-2xl border border-line p-3"><dt className="text-xs text-steel">Confidence</dt><dd className="mt-0.5 text-ink">{CONFIDENCE_WORD[p.confidence]}, {p.n} deliveries</dd></div>
      </dl>
      <p className="text-[15px] text-ink">{p.sentence}</p>

      {r.status === "arrived" && r.arrival && (
        <Note>Arrived at {at(r.arrival.at)}, recorded by {r.arrival.byName} at goods in{r.arrival.complete ? ", complete." : `, with something missing: ${r.arrival.missing}.`}</Note>
      )}

      {short.length > 0 && (
        <div>
          <h3 className="text-[15px] font-medium text-ink">What it would leave short</h3>
          <TableWrap className="mt-2">
            <table className="w-full text-table">
              <thead><tr><Th>Item</Th><Th align="right">Left at prep</Th><Th align="right">Needed</Th><Th align="right">Short</Th></tr></thead>
              <tbody>
                {short.map((i) => (
                  <tr key={i.ingredientId} className={rowClass}>
                    <Td><span className="text-ink">{i.name}</span><span className="block text-xs text-steel">{i.shortfall!.service[0].toUpperCase() + i.shortfall!.service.slice(1)} prep from {at(i.shortfall!.neededBy)}{i.dishes.length ? `: ${i.dishes.map((d) => d.name).join(", ")}` : ""}{i.outletIds.length ? `, ${outlets(i.outletIds)}` : ""}</span></Td>
                    <Td align="right">{fmtQty(i.shortfall!.have, i.unit)}</Td>
                    <Td align="right">{fmtQty(i.shortfall!.need, i.unit)}</Td>
                    <Td align="right"><span className="font-medium text-ink">{fmtQty(i.shortfall!.short, i.unit)}</span></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          {r.valueAtRisk > 0 && <p className="mt-2 text-[13px] text-graphite">About {money(r.valueAtRisk)} of sales at risk, an estimate at that service&rsquo;s sales per {short[0].unit === "kg" ? "kg" : "unit"}.</p>}
        </div>
      )}
      {covered.length > 0 && <p className="text-[13px] text-steel">Also on this delivery, covered by stock until it comes: {covered.map((i) => `${i.name} ${fmtQty(i.onDelivery, i.unit)}`).join(", ")}.</p>}

      {r.status === "handled" && r.handled && (
        <div className="rounded-2xl border border-pos/25 bg-pos-soft px-4 py-3 text-sm text-ink">
          <p><span className="font-medium">{r.handled.label}</span>, by {r.handled.byName} ({ROLE_LABEL[r.handled.role].toLowerCase()}), {new Date(r.handled.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.{r.handled.note ? ` ${r.handled.note}` : ""}</p>
          {r.handled.requestId && <Link prefetch={false} href={`/forecast?tab=approvals&request=${r.handled.requestId}`} className={cn(textLink, "mt-2")}>Open draft order {r.handled.requestId}</Link>}
          {mayHandle && <div className="mt-2"><Button size="sm" variant="ghost" onClick={() => void reopen()} disabled={busy}>Take back</Button></div>}
        </div>
      )}

      {r.status === "alert" && mayHandle && (
        <div className="space-y-3">
          <h3 className="text-[15px] font-medium text-ink">What to do</h3>
          {r.backup && mayOrder && (
            <Button variant="primary" className="w-full" disabled={busy} onClick={() => void send("backup", `Draft order at ${r.backup!.name}.`)}>
              Order {fmtQty(r.backup.qty, r.backup.unit)} from {r.backup.name}, arrives {day(r.backup.arrives).toLowerCase()}
            </Button>
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Button disabled={busy} onClick={() => setForm("called")}><Phone size={15} aria-hidden /> Call supplier</Button>
            <Button disabled={busy} onClick={() => setForm("prep")}>Adjust prep</Button>
            <Button disabled={busy} onClick={() => setForm("covered")}>Mark as handled</Button>
          </div>
          {form && (
            <div className="space-y-3 rounded-2xl border border-line p-4">
              {form === "called" && <p className="text-sm text-ink">{r.supplier}: <a href={`tel:${r.supplierPhone.replace(/\s/g, "")}`} className="num font-medium text-accent-ink underline-offset-4 hover:underline">{r.supplierPhone}</a>. In this demo no call is made.</p>}
              {form === "prep" && <p className="text-sm text-ink">Change portions or move a dish in <Link prefetch={false} href="/forecast?tab=prep" className="font-medium text-accent-ink underline-offset-4 hover:underline">Plan the prep</Link>, then record it here.</p>}
              {form !== "called" && form !== "prep" && (
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="How it was handled">
                  {(["covered", "other"] as const).map((h) => <button key={h} type="button" role="radio" aria-checked={form === h} onClick={() => setForm(h)} className={cn("h-9 rounded-full border px-4 text-[13px]", form === h ? "border-accent bg-accent-soft text-ink" : "border-line text-graphite hover:bg-cloud")}>{h === "covered" ? "Stock covers it" : "Another way"}</button>)}
                </div>
              )}
              <TextArea label={form === "called" ? "What did they say? (optional)" : form === "other" ? "What did you do?" : "Note (optional)"} value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
              <div className="flex gap-2">
                <Button variant="primary" disabled={busy || (form === "other" && note.trim().length < 3)} onClick={() => void send(form)}>Save</Button>
                <Button variant="ghost" onClick={() => { setForm(null); setNote(""); }}>Cancel</Button>
              </div>
            </div>
          )}
          <p className="text-xs text-steel">Whatever you choose is saved with your name and role, and closes the alert for Purchasing, the kitchen and the outlet. A backup order is a draft: it needs approval and is never sent from here.</p>
        </div>
      )}
      {mayReceive && r.status !== "arrived" && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <p className="text-[13px] text-graphite">Goods in records each arrival with one tap on a phone. If the van is here, record it now.</p>
          <Button size="sm" disabled={busy} onClick={() => void arrived()}>It has arrived</Button>
        </div>
      )}
      {madeId && <Link prefetch={false} href={`/forecast?tab=approvals&request=${madeId}`} className={cn(linkButton("secondary"), "w-full")}>Open draft order {madeId}</Link>}
    </div>
  );
}

/** How one alert was found, step by step, in the style of the other worked examples. */
function WorkedExample({ r, open, onOpen }: { r: RiskRow; open: boolean; onOpen: () => void }) {
  const i = r.items.find((x) => x.shortfall);
  if (!i?.shortfall) return null;
  const s = i.shortfall;
  const breakfast = i.use.breakfast;
  const steps: [string, string, string][] = [
    [`${day(r.date)} ${at(r.window.from)}`, `${r.supplier} is due with ${fmtQty(i.onDelivery, i.unit)} of ${i.name}`, `Promised ${at(r.window.from)} to ${at(r.window.to)}`],
    ["The record", r.prediction.sentence, `So it likely comes about ${at(r.prediction.likelyArrival)}. A prediction, ${CONFIDENCE_WORD[r.prediction.confidence].toLowerCase()}.`],
    ["Stock tonight", `${fmtQty(i.stockAtStart, i.unit)} left, and breakfast uses about ${fmtQty(breakfast, i.unit)}`, `${fmtQty(s.have, i.unit)} left when ${s.service} prep starts at ${at(s.neededBy)}`],
    [at(s.neededBy), `${s.service[0].toUpperCase() + s.service.slice(1)} needs about ${fmtQty(s.need, i.unit)}${i.dishes[0] ? ` for the ${i.dishes[0].name}` : ""}`, `Before the likely arrival: ${fmtQty(s.short, i.unit)} short. On time, it would be in.`],
  ];
  return (
    <Section id="predictions.late-example" forceOpen={open} title="Worked example: a late delivery that would leave a service short" summary={`${r.supplier}, ${day(r.date).toLowerCase()}. How one alert is found, step by step.`}>
      <Panel title={`${day(r.date)} at ${outlets(i.outletIds.slice(0, 1)) || "the hotel"}: ${i.name} before ${s.service}`} description="A worked example of what Tyll checks. The delivery and stock below are in tonight's records.">
        <ol className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {steps.map(([time, title, detail], n) => (
            <li key={n} className={cn("relative rounded-2xl border p-4", n === 3 ? "border-warn/40 bg-warn-soft" : "border-line")}>
              <p className="num text-[13px] text-steel">{time}</p>
              <p className="mt-1 text-[15px] leading-snug text-ink">{title}</p>
              <p className="mt-1 text-xs text-steel">{detail}</p>
            </li>
          ))}
        </ol>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-[70ch] text-sm text-graphite">Tyll alerts only because lateness is the cause. On time, the delivery arrives before {s.service} prep. Late, {s.service} runs short. Purchasing, the head chef and the restaurant manager were told this evening, and are told again at 5:00 AM if nobody has handled it. A prediction is a prompt to act, not proof the supplier will be late.</p>
          <Button onClick={onOpen}>See what to do <ArrowRight size={15} className="rtl:rotate-180" /></Button>
        </div>
      </Panel>
    </Section>
  );
}
