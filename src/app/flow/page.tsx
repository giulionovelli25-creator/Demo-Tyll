"use client";
import { ChefHat, Martini, Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { Badge, Button, EmptyState, Meter, Note, PageHeader, Panel, Select, Stat, cn, report } from "@/components/ui";
import { itemById, outletById, outletLabel } from "@/lib/data/catalog";
import { can } from "@/lib/domain/access";
import { NEXT_STATUS, predictTicket, stationLoad, type TicketPrediction } from "@/lib/domain/operations";
import { useCtx, useView } from "@/lib/hooks";
import { useDemo } from "@/lib/store";
import type { FlowStatus, LiveOrder } from "@/lib/types";
import { DEMO_NOW_MIN, fmtTime } from "@/lib/util";

const COLUMNS: { status: FlowStatus; label: string }[] = [
  { status: "new", label: "Newly placed" },
  { status: "sent", label: "Sent to kitchen or bar" },
  { status: "preparing", label: "Being prepared" },
  { status: "ready", label: "Ready" },
  { status: "served", label: "Served" },
];
const NEXT_LABEL: Partial<Record<FlowStatus, string>> = { new: "Send", sent: "Start", preparing: "Mark ready", ready: "Mark served" };

function Range({ label, value, onChange, max = 20 }: { label: string; value: number; onChange: (n: number) => void; max?: number }) {
  const id = useId();
  return (
    <div>
      <div className="flex items-baseline justify-between"><label htmlFor={id} className="text-[13px] font-medium text-graphite">{label}</label><span className="num text-lg">+{value}</span></div>
      <input id={id} type="range" min={0} max={max} step={1} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-2 h-2 w-full cursor-pointer appearance-none rounded-full bg-hair accent-ink" />
    </div>
  );
}

export default function FlowPage() {
  const { sel, user } = useView();
  const ctx = useCtx();
  const flowStatus = useDemo((s) => s.flowStatus);
  const sim = useDemo((s) => s.flowSim);
  const setSim = useDemo((s) => s.setFlowSim);
  const setStatus = useDemo((s) => s.setFlowStatus);
  const mayUpdate = can(user, "flow.updateOrder");
  const [offset, setOffset] = useState(0);
  const [playing, setPlaying] = useState(false);
  const now = DEMO_NOW_MIN + offset;

  // The demo clock advances one minute every three seconds while it is running.
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setOffset((o) => (o >= 45 ? o : o + 1)), 3000);
    return () => clearInterval(t);
  }, [playing]);

  const tickets = useMemo<LiveOrder[]>(() => ctx.data.liveOrders.filter((o) => sel.outletIds.includes(o.outletId)).map((o) => ({ ...o, status: flowStatus[o.id] ?? o.status })), [ctx.data.liveOrders, sel.outletIds, flowStatus]);
  const outlets = useMemo(() => [...new Set(tickets.map((t) => t.outletId))], [tickets]);
  const [picked, setPicked] = useState("");
  const outletId = outlets.includes(picked) ? picked : outlets.includes("dxb-terrace") ? "dxb-terrace" : outlets[0];

  const predict = (t: LiveOrder): TicketPrediction => predictTicket(t, tickets, sim, now, ctx.data.prepRatios?.[t.outletId] ?? 1);
  const all = tickets.map((t) => ({ t, p: predict(t) }));
  const here = all.filter((x) => x.t.outletId === outletId);
  const live = here.filter((x) => x.p.risk !== "done");
  const late = live.filter((x) => x.p.risk === "late");
  const atRisk = live.filter((x) => x.p.risk === "at_risk");
  const cancelRisk = live.filter((x) => x.p.cancelRisk);
  const roomService = all.filter((x) => x.t.roomService && (x.p.risk === "late" || x.p.risk === "at_risk"));

  if (!outletId) return <EmptyState title="No outlet in this selection is serving right now">Choose another outlet or property in the top bar.</EmptyState>;
  const kitchen = stationLoad(outletId, "kitchen", tickets, sim);
  const bar = stationLoad(outletId, "bar", tickets, sim);
  const bottlenecks = outlets.flatMap((id) => (["kitchen", "bar"] as const).map((s) => stationLoad(id, s, tickets, sim))).filter((l) => l.factor >= 1.25).sort((a, b) => b.factor - a.factor);
  const cancelled = here.filter((x) => x.t.status === "cancelled").length;

  return (
    <div className="space-y-5">
      <PageHeader title="Tyll Flow" lead="Every open order, where it is, and whether it will be late. Tyll estimates the finish time from the dishes on the ticket, how busy the station is, and how long this kitchen has actually taken.">
        <Badge>Simulated live tickets</Badge>
        <Badge tone="ink">{fmtTime(now)}</Badge>
        <Button onClick={() => setPlaying((p) => !p)}>{playing ? <><Pause size={15} /> Pause the clock</> : <><Play size={15} /> Run the clock</>}</Button>
        {offset > 0 && <Button variant="ghost" onClick={() => { setOffset(0); setPlaying(false); }}><RotateCcw size={15} /> Back to 8:55 PM</Button>}
      </PageHeader>

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[2fr_1fr]">
        <Panel
          title={outletLabel(outletId)}
          description={`Target: food within ${outletById[outletId].targetMinutes} minutes of ordering, drinks within 8.`}
          action={outlets.length > 1 ? <Select label="Outlet" hideLabel className="w-[220px]" value={outletId} onChange={(e) => setPicked(e.target.value)}>{outlets.map((id) => <option key={id} value={id}>{outletLabel(id)}</option>)}</Select> : undefined}
        >
          <div className="grid grid-cols-2 gap-x-6 gap-y-6 md:grid-cols-5">
            <div>
              <p className="text-[13px] text-steel">Kitchen workload</p>
              <p className={cn("num mt-1 text-[22px]", kitchen.factor >= 1.25 && "text-warn")}>{kitchen.active} <span className="text-sm text-steel">of {kitchen.capacity}</span></p>
              <div className="mt-2"><Meter value={kitchen.active} max={kitchen.capacity * 1.6} tone={kitchen.factor >= 1.25 ? "warn" : "ink"} label={`Kitchen at ${kitchen.active} of ${kitchen.capacity} tickets`} /></div>
              <p className="num mt-1 text-xs text-steel">{kitchen.factor > 1.005 ? `tickets take ${Math.round((kitchen.factor - 1) * 100)}% longer` : "normal speed"}</p>
            </div>
            <div>
              <p className="text-[13px] text-steel">Bar workload</p>
              <p className={cn("num mt-1 text-[22px]", bar.factor >= 1.25 && "text-warn")}>{bar.active} <span className="text-sm text-steel">of {bar.capacity}</span></p>
              <div className="mt-2"><Meter value={bar.active} max={bar.capacity * 1.6} tone={bar.factor >= 1.25 ? "warn" : "ink"} label={`Bar at ${bar.active} of ${bar.capacity} tickets`} /></div>
              <p className="num mt-1 text-xs text-steel">{bar.factor > 1.005 ? `tickets take ${Math.round((bar.factor - 1) * 100)}% longer` : "normal speed"}</p>
            </div>
            <Stat label="Already late" tone={late.length ? "neg" : undefined} value={late.length} sub="past the target time" />
            <Stat label="Likely to be late" tone={atRisk.length ? "warn" : undefined} value={atRisk.length} sub="predicted past target" />
            <Stat label="Cancellation risk" tone={cancelRisk.length ? "warn" : undefined} value={cancelRisk.length} sub="waiting over 1.5 times target" />
          </div>
        </Panel>

        <Panel title="Try a busier service" description="Add tickets to a station and watch the predicted finish times move.">
          <div className="space-y-5">
            <Range label="Extra kitchen tickets" value={sim.kitchenExtra} onChange={(n) => setSim({ kitchenExtra: n })} />
            <Range label="Extra bar tickets" value={sim.barExtra} onChange={(n) => setSim({ barExtra: n })} />
          </div>
          <Note className="mt-4">Above its normal capacity, a station slows by 55% for every doubling of its queue. A demo assumption, tuned on real data in a live version.</Note>
        </Panel>
      </div>

      {(bottlenecks.length > 0 || roomService.length > 0 || cancelRisk.length > 0) && (
        <Panel title="Where to step in">
          <ul className="grid gap-x-8 gap-y-3 md:grid-cols-2">
            {bottlenecks.slice(0, 4).map((b) => (
              <li key={`${b.outletId}-${b.station}`} className="flex gap-3 text-sm">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
                <span><span className="text-ink">{b.station === "kitchen" ? "Kitchen" : "Bar"} bottleneck at {outletLabel(b.outletId)}.</span> <span className="text-graphite">{b.active} tickets against a normal {b.capacity}. Consider moving a cook or bartender across, or pausing new starters.</span></span>
              </li>
            ))}
            {roomService.slice(0, 3).map(({ t, p }) => (
              <li key={t.id} className="flex gap-3 text-sm">
                <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", p.risk === "late" ? "bg-neg" : "bg-warn")} aria-hidden />
                <span><span className="text-ink">Room service to {t.table.toLowerCase()} {p.risk === "late" ? "is late" : "may be late"}.</span> <span className="text-graphite">Ordered {Math.round(p.elapsed)} minutes ago, {Math.round(p.remaining)} still to go against a {p.target}-minute promise. A call to the guest now is better than one from them later.</span></span>
              </li>
            ))}
            {cancelRisk.slice(0, 3).map(({ t, p }) => (
              <li key={`c-${t.id}`} className="flex gap-3 text-sm">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-neg" aria-hidden />
                <span><span className="text-ink">{t.table} has waited {Math.round(p.elapsed)} minutes.</span> <span className="text-graphite">Long waits are when guests cancel or leave. Have a supervisor visit the table.</span></span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="scroll-thin -mx-4 overflow-x-auto px-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0">
        <div className="grid min-w-[1100px] grid-cols-5 gap-3">
          {COLUMNS.map((col) => {
            const cards = here.filter((x) => x.t.status === col.status).sort((a, b) => a.t.placedMin - b.t.placedMin);
            return (
              <section key={col.status} aria-label={col.label} className="rounded-panel border border-line bg-cloud p-3">
                <h2 className="flex items-center justify-between px-1.5 pb-2 text-[13px] text-steel">{col.label}<span className="num rounded-full bg-paper px-2 text-xs text-graphite">{cards.length}</span></h2>
                <ul className="space-y-2">
                  {cards.length === 0 && <li className="rounded-2xl border border-dashed border-line px-3 py-6 text-center text-xs text-fog">None</li>}
                  {cards.map(({ t, p }) => {
                    const Icon = t.station === "kitchen" ? ChefHat : Martini;
                    const next = NEXT_STATUS[t.status];
                    const done = p.risk === "done";
                    return (
                      <li key={t.id} className={cn("rounded-2xl border bg-paper p-3 shadow-panel", p.risk === "late" ? "border-neg/40" : p.risk === "at_risk" ? "border-warn/40" : "border-line")}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5 text-sm text-ink"><Icon size={15} strokeWidth={1.6} aria-label={t.station} /> {t.table}</span>
                          {!done && <Badge tone={p.risk === "late" ? "neg" : p.risk === "at_risk" ? "warn" : "pos"}>{p.risk === "late" ? "Late" : p.risk === "at_risk" ? "May be late" : "On time"}</Badge>}
                        </div>
                        <ul className="mt-2 space-y-0.5 text-[13px] text-graphite">
                          {t.items.map((i) => <li key={i.itemId}>{i.qty} × {itemById[i.itemId].name}</li>)}
                        </ul>
                        <p className="num mt-2 text-xs text-steel">Ordered {fmtTime(t.placedMin)} · {Math.round(p.elapsed)} min ago</p>
                        {!done && (
                          <>
                            <div className="mt-2"><Meter value={p.elapsed} max={Math.max(p.target, p.elapsed + p.remaining)} tone={p.risk === "late" ? "neg" : p.risk === "at_risk" ? "warn" : "ink"} label={`${Math.round(p.elapsed)} of ${p.target} minutes used`} /></div>
                            <p className="num mt-1.5 text-xs text-graphite">{t.status === "ready" ? "Waiting to be served" : `Expected ${fmtTime(now + p.remaining)}`} · target {fmtTime(t.placedMin + p.target)}</p>
                          </>
                        )}
                        {mayUpdate && next && (
                          <div className="mt-3 flex gap-1.5">
                            <Button size="sm" variant="primary" className="flex-1" onClick={() => report(setStatus(t.id, next), `${t.table} moved to ${next}.`)}>{NEXT_LABEL[t.status]}</Button>
                            <Button size="sm" variant="ghost" onClick={() => report(setStatus(t.id, "cancelled"), `${t.table} cancelled.`)}>Cancel</Button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
      <Note>{cancelled > 0 ? `${cancelled} ticket${cancelled === 1 ? "" : "s"} cancelled this service. ` : ""}Live tickets are simulated. A live version would read them from the point of sale and kitchen display. Changing a status here is saved in this browser and is not sent to any system.</Note>
    </div>
  );
}
