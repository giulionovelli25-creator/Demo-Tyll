"use client";
// Cash on hand against cash sales, per outlet and shift. Card payments are reconciled by the payment provider; the cash
// drawer is not. Each shift's count is compared with the bills the till says were paid in cash, and every flag says so.
import { useState } from "react";
import { Badge, Button, Drawer, EmptyState, Field, Note, Panel, Segmented, Skeleton, SummaryBar, TableWrap, Td, Th, WidgetError, cn, rowClass, toast } from "@/components/ui";
import { propertyById } from "@/lib/data/catalog";
import { useCash, useProcAction } from "@/lib/procurement-hooks";
import { DEMO_TODAY, addDays, fmtDate, fmtMoney } from "@/lib/util";

export function CashUps({ propertyId }: { propertyId: string }) {
  const { data, error } = useCash(propertyId);
  const act = useProcAction();
  const money = (n: number) => fmtMoney(n, propertyById[propertyId].currency);
  const [only, setOnly] = useState<"flagged" | "all">("flagged");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ outletId: "", date: addDays(DEMO_TODAY, -1), shift: "night" as "day" | "night", counted: "", note: "" });
  const save = async () => {
    try {
      const r = await act<{ check: { diff: number; flagged: boolean } }>("/api/money/cash", { ...form, outletId: form.outletId || data?.outlets[0]?.id, counted: Number(form.counted) });
      toast.done(r.check.flagged ? `Recorded. ${money(r.check.diff)} against the till: the controller is told.` : "Recorded. It matches the till within the limit.");
      setAdding(false);
    } catch (e) { toast.error(e instanceof Error ? e.message : "The cash-up could not be saved."); }
  };
  if (error) return <WidgetError>Cash-ups could not load.</WidgetError>;
  if (!data) return <Skeleton className="h-64 w-full" />;
  const rows = data.rows.filter((r) => only === "all" || r.flagged);
  return (
    <div className="space-y-6">
      <SummaryBar
        items={[
          { label: "Shifts checked", value: data.totals.shifts, compare: { text: `Last ${data.days} days, ${money(data.totals.cash)} cash on the tills`, good: null } },
          { label: "Cash differences", value: data.totals.flagged, tone: data.totals.flagged ? "warn" : "pos", compare: { text: data.totals.flagged ? `${money(Math.abs(data.totals.short))} short, ${money(data.totals.over)} over` : "Every drawer within the limit", good: data.totals.flagged ? false : true } },
        ]}
        action={data.mayRecord ? <Button variant="primary" onClick={() => setAdding(true)}>Record a cash-up</Button> : undefined}
      />
      <Panel title="Cash counted against cash sales" description="Per outlet and shift. The day shift closes bills before 16:00; the night shift from 16:00 to close." action={<Segmented label="Show" size="sm" value={only} onChange={setOnly} options={[{ value: "flagged", label: `Differences (${data.totals.flagged})` }, { value: "all", label: "Every shift" }]} />} flush>
        {rows.length === 0 ? <div className="p-6"><EmptyState title="No cash differences">Every drawer matched the till within the limit.</EmptyState></div> : (
          <TableWrap>
            <table className="w-full min-w-[900px] text-table">
              <thead><tr><Th>Outlet and shift</Th><Th align="right">Cash sales on the till</Th><Th align="right">Counted</Th><Th align="right">Difference</Th><Th>Compared with</Th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.outletId}|${r.date}|${r.shift}`} className={rowClass}>
                    <Td><span className="text-ink">{r.outlet}</span><span className="block text-xs text-steel">{fmtDate(r.date, true)}, {r.shift} shift</span>{r.flagged && <Badge tone="warn" className="mt-1">Cash {r.kind}</Badge>}</Td>
                    <Td align="right">{money(r.expected)}<span className="block text-xs text-steel">{r.bills} cash {r.bills === 1 ? "bill" : "bills"}</span></Td>
                    <Td align="right">{money(r.counted)}<span className="block text-xs text-steel">{r.source === "entered" ? `Entered by ${r.by}` : "Simulated count"}</span></Td>
                    <Td align="right" className={cn("font-medium", r.flagged ? (r.diff < 0 ? "text-neg" : "text-warn") : "text-ink")}>{r.diff === 0 ? "None" : `${r.diff > 0 ? "+" : ""}${money(r.diff)}`}</Td>
                    <Td className="max-w-[420px] text-[13px] text-graphite">{r.comparedWith}{r.note && <span className="mt-1 block text-ink">Note: {r.note}</span>}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        <Note className="px-6 py-4">Card payments are reconciled by the payment provider, so they are not checked here. A cash difference is something to check with the shift manager, not a finding about anyone: a float counted twice, a tip left in the drawer, a refund paid in cash and not recorded. Counts before Tyll are simulated.</Note>
      </Panel>
      <Drawer open={adding} onClose={() => setAdding(false)} title="Record a cash-up" description="Cash in the drawer at the end of the shift, without the float.">
        <div className="space-y-4">
          <label className="block text-[13px] font-medium text-ink">Outlet
            <select value={form.outletId || data.outlets[0]?.id} onChange={(e) => setForm({ ...form, outletId: e.target.value })} className="mt-1.5 h-10 w-full rounded-full border border-line bg-paper px-3 text-sm font-normal">{data.outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
          </label>
          <Field label="Day" type="date" value={form.date} max={DEMO_TODAY} min={addDays(DEMO_TODAY, -14)} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <Segmented label="Shift" value={form.shift} onChange={(v) => setForm({ ...form, shift: v })} options={[{ value: "day", label: "Day shift" }, { value: "night", label: "Night shift" }]} />
          <Field label="Cash counted" type="number" min="0" step="0.01" value={form.counted} onChange={(e) => setForm({ ...form, counted: e.target.value })} suffix={propertyById[propertyId].currency} />
          <Field label="Note (optional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="For example: tip left in the drawer" />
          <Button variant="primary" className="w-full" disabled={form.counted === ""} onClick={save}>Save the cash-up</Button>
        </div>
      </Drawer>
    </div>
  );
}
