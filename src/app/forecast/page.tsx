"use client";
import { ChevronDown, RotateCcw } from "lucide-react";
import { useId, useState } from "react";
import { ColumnChart } from "@/components/charts";
import { Badge, Button, Delta, EmptyState, Note, PageHeader, Panel, Segmented, Stat, TableWrap, Td, Th, cn, report, rowClass } from "@/components/ui";
import { ingredientById, itemById, propertyById, supplierById } from "@/lib/data/catalog";
import { allowedProperties, can } from "@/lib/domain/access";
import { EVENT_SPILLOVER, HORIZON_DAYS, OCCUPANCY_ELASTICITY, RESERVATION_WEIGHT, type ForecastInputs, type IngredientPlan } from "@/lib/domain/forecast";
import { personName, useServerForecast, useView } from "@/lib/hooks";
import { useDemo } from "@/lib/store";
import { fmtDate, fmtMoney, fmtNum, fmtPct, fmtQty, pctChange, sum } from "@/lib/util";

function Slider({ label, value, min, max, step, onChange, display, hint }: { label: string; value: number; min: number; max: number; step: number; onChange: (n: number) => void; display: string; hint?: string }) {
  const id = useId();
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[13px] font-medium text-graphite">{label}</label>
        <span className="num text-lg tracking-[-0.02em] text-ink">{display}</span>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-2 h-2 w-full cursor-pointer appearance-none rounded-full bg-hair accent-ink" />
      {hint && <p className="mt-1 text-xs text-steel">{hint}</p>}
    </div>
  );
}

const statusOf = (p: IngredientPlan): { label: string; tone: "neg" | "warn" | "pos" | "neutral" } =>
  p.shortageDay ? { label: `Runs out ${fmtDate(p.shortageDay, true)}`, tone: "neg" } : p.lowDay ? { label: `Into safety stock ${fmtDate(p.lowDay, true)}`, tone: "warn" } : p.suggested > 0 ? { label: "Order", tone: "neutral" } : p.overstock > 0 ? { label: "More than can be used in time", tone: "warn" } : { label: "Covered", tone: "pos" };

export default function ForecastPage() {
  const { user, propertyId } = useView();
  const props = allowedProperties(user);
  const [picked, setPicked] = useState(props[0]);
  const pid = propertyId ?? picked;
  const property = propertyById[pid];
  const money = (n: number, decimals = false) => fmtMoney(n, property.currency, { decimals });
  const saved = useDemo((s) => s.forecastInputs[pid]);
  const setInputs = useDemo((s) => s.setForecastInputs);
  const approvals = useDemo((s) => s.approvals).filter((a) => a.propertyId === pid);
  const approve = useDemo((s) => s.approvePurchases);
  const withdraw = useDemo((s) => s.withdrawApproval);
  // Worked out on the server: the shared store is drawn on by every outlet, not only those this user sees.
  const { data: server } = useServerForecast(pid, saved);
  const [open, setOpen] = useState<string | null>(null);
  const [show, setShow] = useState<"order" | "all">("order");
  const mayApprove = can(user, "forecast.approve");
  if (!server) return <EmptyState title="Working out the forecast" />;
  const base = server.defaults;
  const inputs = saved ?? base;
  const update = (patch: Partial<ForecastInputs>) => setInputs(pid, { ...inputs, ...patch });
  const { forecast, baseline } = server;

  const unitsByDay = forecast.days.map((d, i) => ({ label: fmtDate(d, true), value: sum(forecast.items, (it) => it.byDay[i]) }));
  const totalUnits = sum(unitsByDay, (d) => d.value);
  const baseUnits = sum(baseline.items, (it) => it.total);
  const plans = forecast.plans.filter((p) => show === "all" || p.suggested > 0 || p.shortageDay || p.lowDay || p.overstock > 0);
  const toOrder = forecast.plans.filter((p) => p.suggested > 0);
  const pending = toOrder.filter((p) => !approvals.some((a) => a.ingredientId === p.ingredientId && Math.abs(a.qty - p.suggested) < 1e-6));
  const changed = JSON.stringify({ ...inputs, stockOverride: {} }) !== JSON.stringify({ ...base, stockOverride: {} }) || Object.keys(inputs.stockOverride).length > 0;
  const event = forecast.baseline;

  return (
    <div className="space-y-5">
      <PageHeader title="Tyll Forecast" lead={`What the next ${HORIZON_DAYS} days are likely to sell, what that uses, and what to buy so nothing runs out and nothing is thrown away.`}>
        {propertyId || props.length === 1 ? <Badge>{property.name}</Badge> : <Segmented label="Hotel" value={picked} onChange={setPicked} options={props.map((p) => ({ value: p, label: propertyById[p].name }))} />}
        <Badge>{fmtDate(forecast.days[0])} – {fmtDate(forecast.days[forecast.days.length - 1])}</Badge>
      </PageHeader>

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(320px,1fr)_2fr]">
        <Panel title="What you expect" description="Start from what is booked. Move a control and every figure on this page recalculates." action={changed ? <Button size="sm" variant="ghost" onClick={() => setInputs(pid, base)}><RotateCcw size={14} /> Back to booked figures</Button> : undefined}>
          <div className="space-y-6">
            <Slider label="Hotel occupancy, 7-day average" value={Math.round(inputs.occupancy * 100)} min={30} max={100} step={1} onChange={(n) => update({ occupancy: n / 100 })} display={`${Math.round(inputs.occupancy * 100)}%`} hint={`On the books: ${Math.round(base.occupancy * 100)}%`} />
            <Slider label="Restaurant reservations, covers" value={inputs.reservations} min={Math.round(base.reservations * 0.4)} max={Math.round(base.reservations * 1.8)} step={5} onChange={(n) => update({ reservations: n })} display={fmtNum(inputs.reservations)} hint={`Booked so far: ${fmtNum(base.reservations)}`} />
            <Slider label={event.eventName ? `${event.eventName}, ${fmtDate(event.eventDate!, true)}` : "Event attendance"} value={inputs.eventAttendance} min={0} max={600} step={10} onChange={(n) => update({ eventAttendance: n })} display={`${fmtNum(inputs.eventAttendance)} guests`} hint={event.eventName ? `Booked: ${fmtNum(base.eventAttendance)} guests. The dinner itself is catered by banqueting. This is the spill-over into bars and restaurants.` : "No event is booked in the next seven days."} />
            <Slider label="Safety stock" value={inputs.safetyDays} min={0} max={3} step={0.5} onChange={(n) => update({ safetyDays: n })} display={`${inputs.safetyDays} day${inputs.safetyDays === 1 ? "" : "s"}`} hint="Extra stock held against a busier day than forecast." />
          </div>
          <dl className="mt-6 space-y-2 rounded-2xl bg-mist p-4 text-sm">
            <div className="flex justify-between"><dt className="text-steel">Occupancy effect on demand</dt><dd className="num">×{forecast.effects.occupancy.toFixed(3)}</dd></div>
            <div className="flex justify-between"><dt className="text-steel">Reservations effect</dt><dd className="num">×{forecast.effects.reservations.toFixed(3)}</dd></div>
            <div className="flex justify-between"><dt className="text-steel">Event effect, averaged over the week</dt><dd className="num">×{forecast.effects.event.toFixed(3)}</dd></div>
          </dl>
        </Panel>

        <div className="space-y-5">
          <Panel title="Expected sales">
            <div className="mb-5 grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-4">
              <Stat label="Items forecast, 7 days" value={fmtNum(totalUnits)} delta={changed ? <Delta value={pctChange(totalUnits, baseUnits)} goodWhen="none" versus="than at booked figures" /> : undefined} sub={changed ? "vs booked figures" : "at booked figures"} />
              <Stat label="Suggested purchases" value={money(forecast.totalCost)} delta={changed ? <Delta value={pctChange(forecast.totalCost, baseline.totalCost)} goodWhen="none" versus="than at booked figures" /> : undefined} sub={`${toOrder.length} items`} />
              <Stat label="Shortage risks" tone={forecast.plans.some((p) => p.shortageDay) ? "neg" : forecast.plans.some((p) => p.lowDay) ? "warn" : undefined} value={forecast.plans.filter((p) => p.shortageDay || p.lowDay).length} sub={`${forecast.plans.filter((p) => p.shortageDay).length} run out, ${forecast.plans.filter((p) => p.lowDay).length} dip into safety stock`} />
              <Stat label="Overordering risks" tone={forecast.plans.some((p) => p.overstock > 0) ? "warn" : undefined} value={forecast.plans.filter((p) => p.overstock > 0).length} sub="more than can be used in time" />
            </div>
            <ColumnChart data={unitsByDay} format={(n) => fmtNum(n)} name="Items forecast" summary="Forecast number of menu items sold per day over the next seven days." highlight={(i) => forecast.days[i] === event.eventDate} height={200} />
            <div className="mt-5 grid gap-x-8 sm:grid-cols-2">
              {forecast.items.slice(0, 8).map((it) => (
                <div key={it.itemId} className="num flex items-baseline justify-between gap-3 border-b border-hair py-2 text-sm">
                  <span className="truncate text-ink">{itemById[it.itemId].name}</span>
                  <span className="flex shrink-0 items-center gap-2 text-graphite">{fmtNum(it.total)} <Delta value={pctChange(it.total, it.history)} goodWhen="none" versus="than the last four weeks" /></span>
                </div>
              ))}
            </div>
            <Note className="mt-3">Change shown against the same weekdays over the last four weeks.</Note>
          </Panel>
        </div>
      </div>

      <Panel
        title="Purchasing suggestions"
        description="Each quantity can be opened to see exactly how it was worked out. Enter your own stock figure if you have just counted."
        action={
          <>
            <Segmented label="Rows" size="sm" value={show} onChange={setShow} options={[{ value: "order", label: "Needs a decision" }, { value: "all", label: "All ingredients" }]} />
            {mayApprove && (
              <Button variant="primary" disabled={pending.length === 0} onClick={() => report(approve(pid, pending.map((p) => ({ ingredientId: p.ingredientId, qty: p.suggested, cost: p.cost }))), `${pending.length} suggestion${pending.length === 1 ? "" : "s"} approved. No order has been sent.`)}>
                {pending.length === 0 ? "All suggestions approved" : `Approve ${pending.length} suggestion${pending.length === 1 ? "" : "s"}, ${money(sum(pending, (p) => p.cost))}`}
              </Button>
            )}
          </>
        }
        flush
      >
        {plans.length === 0 ? <div className="px-6 pb-6"><EmptyState title="Nothing needs ordering">Stock on hand and on order covers the forecast plus safety stock.</EmptyState></div> : (
          <TableWrap>
            <table className="w-full min-w-[1100px] text-sm">
              <thead><tr><Th>Ingredient</Th><Th align="right">Stock on hand</Th><Th align="right">On order</Th><Th align="right">Forecast use</Th><Th align="right">Safety stock</Th><Th align="right">Suggested order</Th><Th align="right">Cost</Th><Th>Status</Th><Th>Approval</Th></tr></thead>
              <tbody>
                {plans.map((p) => {
                  const g = ingredientById[p.ingredientId];
                  const st = statusOf(p);
                  const isOpen = open === p.ingredientId;
                  const approval = approvals.find((a) => a.ingredientId === p.ingredientId);
                  const stale = approval && Math.abs(approval.qty - p.suggested) > 1e-6;
                  return [
                    <tr key={p.ingredientId} className={cn(rowClass, isOpen && "bg-cloud")}>
                      <Td>
                        <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : p.ingredientId)} className="flex items-center gap-2 text-left text-ink">
                          <ChevronDown size={15} className={cn("shrink-0 text-steel transition-transform duration-300 ease-tyll", isOpen && "rotate-180")} aria-hidden />{g.name}
                        </button>
                        <span className="ml-[23px] block text-xs text-steel">{supplierById[g.supplierId].name} · {g.leadDays} day lead · keeps {g.shelfLifeDays > 60 ? "over 60" : g.shelfLifeDays} days</span>
                      </Td>
                      <Td align="right">
                        <input
                          aria-label={`Stock on hand of ${g.name}`}
                          type="number" min="0" step={g.unit === "each" ? 1 : 0.1} inputMode="decimal"
                          value={inputs.stockOverride[g.id] ?? (g.unit === "each" ? Math.round(p.onHand) : Math.round(p.onHand * 10) / 10)}
                          onChange={(e) => {
                            const next = { ...inputs.stockOverride };
                            if (e.target.value === "" || Number(e.target.value) < 0) delete next[g.id];
                            else next[g.id] = Number(e.target.value);
                            update({ stockOverride: next });
                          }}
                          className={cn("num h-9 w-24 rounded-lg border px-2 text-right hover:border-fog", p.onHandIsOverride ? "border-ink" : "border-line")}
                        />
                        <span className="block text-xs text-steel">{p.onHandIsOverride ? "entered by you" : g.unit === "each" ? "units, estimated" : `${g.unit}, estimated`}</span>
                      </Td>
                      <Td align="right">{p.incoming ? fmtQty(p.incoming, g.unit) : "–"}</Td>
                      <Td align="right">{fmtQty(p.demand, g.unit)}<span className="block text-xs text-steel">{p.coverDays} day{p.coverDays === 1 ? "" : "s"}</span></Td>
                      <Td align="right">{fmtQty(p.safety, g.unit)}</Td>
                      <Td align="right" className="text-ink">{p.suggested ? fmtQty(p.suggested, g.unit) : "–"}</Td>
                      <Td align="right">{p.cost ? money(p.cost) : "–"}</Td>
                      <Td><Badge tone={st.tone}>{st.label}</Badge></Td>
                      <Td>
                        {approval ? (
                          <span className="text-xs">
                            <span className={stale ? "text-warn" : "text-pos"}>{stale ? `Approved for ${fmtQty(approval.qty, g.unit)}, now out of date` : `Approved by ${personName(approval.approvedBy).split(" ")[0]}`}</span>
                            {mayApprove && <button type="button" className="mt-0.5 block text-steel underline underline-offset-4 hover:text-ink" onClick={() => report(withdraw(approval.id), "Approval withdrawn.")}>Withdraw</button>}
                          </span>
                        ) : p.suggested > 0 ? (
                          mayApprove ? <Button size="sm" onClick={() => report(approve(pid, [{ ingredientId: p.ingredientId, qty: p.suggested, cost: p.cost }]), `${g.name} approved. No order has been sent.`)}>Approve</Button> : <span className="text-xs text-steel">awaiting a manager</span>
                        ) : <span className="text-xs text-fog">not needed</span>}
                      </Td>
                    </tr>,
                    isOpen && (
                      <tr key={`${p.ingredientId}-why`} className="border-t border-hair bg-cloud">
                        <td colSpan={9} className="px-6 pb-5 pt-2">
                          <p className="text-sm text-ink">{p.reason}</p>
                          <dl className="mt-3 max-w-[640px] divide-y divide-hair text-[13px]">
                            {p.steps.map((s, i) => (
                              <div key={i} className={cn("num flex items-baseline justify-between gap-4 py-1.5", s.sign === "=" && "border-t border-line font-medium text-ink")}>
                                <dt className="text-graphite">{s.label}</dt>
                                <dd className="shrink-0">{s.sign === "=" ? "" : `${s.sign} `}{fmtQty(s.value, g.unit)}{g.unit === "each" ? " units" : ""}</dd>
                              </div>
                            ))}
                          </dl>
                          {p.overstock > 0 && <p className="mt-3 text-[13px] text-warn">About {fmtQty(p.overstock, g.unit)} more is on hand or on order than the forecast will use within its {g.shelfLifeDays}-day shelf life.</p>}
                          <p className="num mt-3 text-xs text-steel">Forecast use by day: {p.consumption.map((c, i) => `${fmtDate(forecast.days[i], true).split(" ")[0]} ${fmtQty(c, g.unit)}`).join(" · ")}</p>
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
        <Note className="px-6 py-4">Approval records a manager&rsquo;s decision. Tyll does not place orders: no purchasing system is connected in this demo.</Note>
      </Panel>

      <Panel title="How the forecast is worked out">
        <ol className="grid gap-x-10 gap-y-3 text-sm text-graphite md:grid-cols-2">
          <li>1. Start from what each outlet sold of each item on the same weekday over the last four weeks.</li>
          <li>2. Adjust for occupancy. Room service follows occupancy almost one for one ({fmtPct(OCCUPANCY_ELASTICITY["In-room dining"], 0)}), fine dining far less ({fmtPct(OCCUPANCY_ELASTICITY["Fine dining restaurant"], 0)}).</li>
          <li>3. Adjust restaurants for reservations, at {fmtPct(RESERVATION_WEIGHT, 0)} weight, since walk-ins make up the rest.</li>
          <li>4. On an event day, add {fmtPct(EVENT_SPILLOVER, 0)} of attendance as extra guests across the outlets.</li>
          <li>5. Convert items to ingredients through the recipes.</li>
          <li>6. Order enough to cover use until the following delivery, plus safety stock, less stock on hand and on order, rounded up to whole packs.</li>
        </ol>
        <Note className="mt-4 max-w-[95ch]">This is plain arithmetic with stated assumptions, chosen so every number can be checked. No statistical or machine-learning model has been trained. Forecasts on real data need several weeks of sales and stock history before they are reliable, and holiday and seasonal effects would be added from each hotel&rsquo;s own history.</Note>
      </Panel>
    </div>
  );
}
