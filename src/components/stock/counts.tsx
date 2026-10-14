"use client";
import { useMemo, useState } from "react";
import { ColumnChart } from "@/components/charts";
import { Badge, Button, EmptyState, Field, Note, Panel, Select, Stat, TableWrap, Td, Th, cn, report, rowClass } from "@/components/ui";
import { INGREDIENTS, ingredientById, propertyById } from "@/lib/data/catalog";
import { can } from "@/lib/domain/access";
import { countVariance, countVarianceValue, stockPosition } from "@/lib/domain/inventory";
import { personName, useCtx, useStockInputs, useUser } from "@/lib/hooks";
import { useDemo } from "@/lib/store";
import { DEMO_TODAY, fmtDate, fmtMoney, fmtQty, fmtShort, hashString, sum } from "@/lib/util";

/** Glasses that fit one dishwasher rack, for counting by rack. */
const PER_RACK: Record<string, number> = { wineglass: 25, highball: 36, plate: 18 };

export function Counts({ propertyId }: { propertyId: string }) {
  const user = useUser()!;
  const ctx = useCtx();
  const inputs = useStockInputs();
  const recordCount = useDemo((s) => s.recordCount);
  const property = propertyById[propertyId];
  const money = (n: number) => fmtMoney(n, property.currency, { decimals: Math.abs(n) < 100 });
  const mayCount = can(user, "stock.count");
  const position = useMemo(() => stockPosition(propertyId, inputs, ctx.overrides), [propertyId, inputs, ctx.overrides]);
  const [entered, setEntered] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState("");
  const [rackItem, setRackItem] = useState("highball");
  const [racks, setRacks] = useState("");
  const [loose, setLoose] = useState("");

  const mine = ctx.counts.filter((c) => c.propertyId === propertyId);
  const today = mine.filter((c) => c.date === DEMO_TODAY);
  // Five items a day, rotating, drawn from the priority list.
  const due = useMemo(() => {
    const pool = INGREDIENTS.filter((g) => g.priority && position.some((p) => p.ingredientId === g.id));
    return [...pool].sort((a, b) => hashString(`${DEMO_TODAY}${propertyId}${a.id}`) - hashString(`${DEMO_TODAY}${propertyId}${b.id}`)).slice(0, 5);
  }, [position, propertyId]);

  const weeklyDates = [...new Set(mine.filter((c) => c.kind === "weekly").map((c) => c.date))].sort();
  const lastFull = weeklyDates[weeklyDates.length - 1];
  const lastRows = mine.filter((c) => c.date === lastFull).map((c) => ({ c, v: countVariance(c), value: countVarianceValue(c, ctx.overrides) })).sort((a, b) => a.value - b.value);
  const byWeek = weeklyDates.map((d) => ({ label: fmtDate(d), value: Math.max(0, -sum(mine.filter((c) => c.date === d && ingredientById[c.ingredientId].priority), (c) => countVarianceValue(c, ctx.overrides))) }));

  const submit = (ingredientId: string, raw: string) => {
    const counted = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(counted)) return report({ ok: false, error: "Enter the quantity you counted." }, "");
    const expected = position.find((p) => p.ingredientId === ingredientId)?.estimated ?? 0;
    const g = ingredientById[ingredientId];
    const diff = counted - expected;
    if (report(recordCount({ propertyId, ingredientId, counted }), `${g.name}: counted ${fmtQty(counted, g.unit)}, expected ${fmtQty(expected, g.unit)}. ${Math.abs(diff) < 0.005 ? "No difference." : `${fmtQty(Math.abs(diff), g.unit)} ${diff < 0 ? "missing" : "more than expected"}.`}`)) {
      setEntered((e) => ({ ...e, [ingredientId]: "" }));
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[1.2fr_1fr]">
        <Panel title="Today's spot checks" description="Five priority items each day. Count first: the expected quantity is shown only after you record yours, so the count is not led by the number on screen.">
          {!mayCount ? <Note>Your role cannot record counts. Outlet and kitchen accounts can.</Note> : (
            <ul className="divide-y divide-hair">
              {due.map((g) => {
                const done = today.filter((c) => c.ingredientId === g.id).slice(-1)[0];
                return (
                  <li key={g.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <span className="min-w-[140px]"><span className="text-sm text-ink">{g.name}</span><span className="block text-xs text-steel">count in {g.unit === "each" ? "units" : g.unit}</span></span>
                    {done ? (
                      <span className="num flex items-center gap-3 text-sm">
                        <span className="text-graphite">counted {fmtQty(done.counted, g.unit)}, expected {fmtQty(done.expected, g.unit)}</span>
                        <Badge tone={countVariance(done) < -0.005 ? "warn" : "pos"}>{Math.abs(countVariance(done)) < 0.005 ? "matches" : `${countVariance(done) < 0 ? "−" : "+"}${money(Math.abs(countVarianceValue(done, ctx.overrides)))}`}</Badge>
                      </span>
                    ) : (
                      <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); submit(g.id, entered[g.id] ?? ""); }}>
                        <input aria-label={`Counted quantity of ${g.name}`} type="number" inputMode="decimal" min="0" step={g.unit === "each" ? 1 : 0.01} value={entered[g.id] ?? ""} onChange={(e) => setEntered((x) => ({ ...x, [g.id]: e.target.value }))} placeholder="0" className="num h-11 w-28 rounded-xl border border-line px-3 text-right text-base hover:border-fog" />
                        <Button type="submit" variant="primary">Record</Button>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {mayCount && (
            <form className="mt-4 flex flex-wrap items-end gap-2 border-t border-hair pt-4" onSubmit={(e) => { e.preventDefault(); if (extra) submit(extra, entered[extra] ?? ""); }}>
              <Select label="Count another item" className="w-[220px]" value={extra} onChange={(e) => setExtra(e.target.value)}>
                <option value="">Choose an item</option>
                {position.map((p) => <option key={p.ingredientId} value={p.ingredientId}>{ingredientById[p.ingredientId].name}</option>)}
              </Select>
              <Field label="Counted" className="w-28" type="number" inputMode="decimal" min="0" step="0.01" disabled={!extra} value={extra ? (entered[extra] ?? "") : ""} onChange={(e) => setEntered((x) => ({ ...x, [extra]: e.target.value }))} />
              <Button type="submit" disabled={!extra}>Record count</Button>
            </form>
          )}
        </Panel>

        <Panel title="Glassware by dishwasher rack" description="Count full racks instead of single glasses. Tyll multiplies by the rack size and adds the loose ones.">
          <form
            className="grid grid-cols-2 gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const total = (Number(racks) || 0) * PER_RACK[rackItem] + (Number(loose) || 0);
              if (racks.trim() === "" && loose.trim() === "") return report({ ok: false, error: "Enter the number of racks or loose pieces." }, "");
              const g = ingredientById[rackItem];
              if (report(recordCount({ propertyId, ingredientId: rackItem, counted: total }), `${g.name}: ${total} counted.`)) {
                setRacks("");
                setLoose("");
              }
            }}
          >
            <Select label="Item" className="col-span-2" value={rackItem} onChange={(e) => setRackItem(e.target.value)}>
              {Object.keys(PER_RACK).map((id) => <option key={id} value={id}>{ingredientById[id].name} ({PER_RACK[id]} per rack)</option>)}
            </Select>
            <Field label="Full racks" type="number" min="0" step="1" value={racks} onChange={(e) => setRacks(e.target.value)} disabled={!mayCount} />
            <Field label="Loose pieces" type="number" min="0" step="1" value={loose} onChange={(e) => setLoose(e.target.value)} disabled={!mayCount} />
            <p className="num col-span-2 text-sm text-graphite">Total: {(Number(racks) || 0) * PER_RACK[rackItem] + (Number(loose) || 0)} pieces</p>
            <Button type="submit" className="col-span-2" disabled={!mayCount}>Record glassware count</Button>
          </form>
          <Note className="mt-3">Optional. Breakage trends, linen and expiry tracking are planned.</Note>
        </Panel>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[1fr_1.4fr]">
        <Panel title="Missing stock, week by week" description="Value of priority items missing at each weekly count, at the cost on the day.">
          <div className="mb-4 grid grid-cols-2 gap-4">
            <Stat label={`Missing on ${lastFull ? fmtDate(lastFull) : "–"}`} tone="warn" value={money(byWeek[byWeek.length - 1]?.value ?? 0)} />
            <Stat label="Four weeks earlier" value={money(byWeek[byWeek.length - 5]?.value ?? 0)} />
          </div>
          <ColumnChart data={byWeek} format={(n) => fmtMoney(n, property.currency)} axisFormat={fmtShort} name="Missing at count" summary="Value of priority stock missing at each weekly count." highlight={(i) => i === byWeek.length - 1} />
        </Panel>

        <Panel title={`Last full count, ${lastFull ? fmtDate(lastFull, true) : ""}`} description="Expected against actual, largest shortfall first." flush>
          {lastRows.length === 0 ? <div className="px-6 pb-6"><EmptyState title="No count recorded" /></div> : (
            <div className="scroll-thin max-h-[440px] overflow-y-auto">
              <TableWrap>
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="sticky top-0 bg-paper"><tr><Th>Item</Th><Th align="right">Expected</Th><Th align="right">Counted</Th><Th align="right">Difference</Th><Th align="right">Value</Th></tr></thead>
                  <tbody>
                    {lastRows.map(({ c, v, value }) => {
                      const g = ingredientById[c.ingredientId];
                      return (
                        <tr key={c.id} className={rowClass}>
                          <Td className="text-ink">{g.name}</Td>
                          <Td align="right">{fmtQty(c.expected, g.unit)}</Td>
                          <Td align="right">{fmtQty(c.counted, g.unit)}</Td>
                          <Td align="right" className={cn(v < -0.005 && "text-warn")}>{Math.abs(v) < 0.005 ? "–" : `${v < 0 ? "−" : "+"}${fmtQty(Math.abs(v), g.unit)}`}</Td>
                          <Td align="right" className={cn(value < -0.5 && "text-warn")}>{Math.abs(value) < 0.5 ? "–" : `${value < 0 ? "−" : "+"}${money(Math.abs(value))}`}</Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableWrap>
            </div>
          )}
          <Note className="px-6 py-4">A shortfall is stock that left without a sale, a waste entry or a transfer. It says something is unexplained. It does not say what happened.</Note>
        </Panel>
      </div>

      {today.length > 0 && (
        <Panel title="Counts recorded today" flush>
          <TableWrap>
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr><Th>Item</Th><Th align="right">Expected</Th><Th align="right">Counted</Th><Th align="right">Value of difference</Th><Th>By</Th></tr></thead>
              <tbody>
                {today.map((c) => {
                  const g = ingredientById[c.ingredientId];
                  const value = countVarianceValue(c, ctx.overrides);
                  return (
                    <tr key={c.id} className={rowClass}>
                      <Td className="text-ink">{g.name}</Td>
                      <Td align="right">{fmtQty(c.expected, g.unit)}</Td>
                      <Td align="right">{fmtQty(c.counted, g.unit)}</Td>
                      <Td align="right" className={cn(value < -0.5 && "text-warn")}>{Math.abs(value) < 0.005 ? "–" : `${value < 0 ? "−" : "+"}${money(Math.abs(value))}`}</Td>
                      <Td>{personName(c.by)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
          <Note className="px-6 py-4">Each count becomes the new starting point for that item&rsquo;s estimated stock, and its difference is added to unexplained stock variance on the Overview.</Note>
        </Panel>
      )}
    </div>
  );
}
