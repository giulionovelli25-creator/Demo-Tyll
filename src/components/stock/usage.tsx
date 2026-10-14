"use client";
// One outlet stock period: the calculation, what could explain a difference, the records behind it, and the corrections a
// manager can make. Used by Where Did It Go? and by the investigation page, so both always show the same figures.
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { RecordFields, Timeline, type TimelineItem } from "@/components/timeline";
import { Badge, Button, Field, Note, Panel, Select, cn, report } from "@/components/ui";
import { ingredientById, itemById, outletById, propertyById } from "@/lib/data/catalog";
import { can } from "@/lib/domain/access";
import { BOTTLE_L, bottles, causesFor, periodVariance, qtyPerUnit, qtyWords, stepsFor, summaryFor, type Cause, type CauseStatus, type Variance } from "@/lib/domain/variance";
import { personName, useCtx, useUser } from "@/lib/hooks";
import { useDemo } from "@/lib/store";
import type { UsagePeriod, WasteReason } from "@/lib/types";
import { DEMO_TODAY, eachDay, fmtDate, fmtMoney, fmtTime } from "@/lib/util";

/** The period's figures with every correction made so far. */
export function useUsage(p: UsagePeriod) {
  const ctx = useCtx();
  return useMemo(() => {
    const v = periodVariance(p, ctx.adjust);
    return { v, causes: causesFor(p, v) };
  }, [p, ctx.adjust]);
}

const when = (date: string, min: number) => `${fmtDate(date)}, ${min >= 1440 ? "close" : fmtTime(min)}`;
const isWine = (p: UsagePeriod) => p.ingredientId === "wine";
const moneyOf = (p: UsagePeriod) => (n: number) => fmtMoney(n, propertyById[p.propertyId].currency, { decimals: true });

/** Quantity as counted, with bottles alongside litres for wine. */
function Qty({ p, n, sign }: { p: UsagePeriod; n: number; sign?: "+" | "−" | "±" }) {
  const s = sign === "±" ? (n < 0 ? "−" : "+") : sign ?? "";
  const q = qtyWords(Math.abs(n), p.ingredientId);
  return (
    <span className="num">
      {s}{s && " "}{q}
      {isWine(p) && Math.abs(n) > 0 && <span className="ml-1.5 text-xs text-steel">{bottles(Math.abs(n))} bottle{bottles(Math.abs(n)) === 1 ? "" : "s"}</span>}
    </span>
  );
}

function Line({ label, children, strong, tone, sub }: { label: ReactNode; children: ReactNode; strong?: boolean; tone?: "warn" | "pos"; sub?: ReactNode }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 py-1.5", strong && "border-t border-hair pt-2.5")}>
      <dt className={cn(strong ? "text-ink" : "text-graphite")}>{label}{sub && <span className="block text-xs text-steel">{sub}</span>}</dt>
      <dd className={cn(strong && "text-[15px] text-ink", tone === "warn" && "text-warn", tone === "pos" && "text-pos")}>{children}</dd>
    </div>
  );
}

/** Actual use from the counts against expected use from sales, and the difference. */
export function UsageFigures({ p, v }: { p: UsagePeriod; v: Variance }) {
  const money = moneyOf(p);
  const ctx = useCtx();
  const top = p.sales.slice().sort((a, b) => b.units - a.units)[0];
  const main = top ? itemById[top.itemId].name : "items";
  const perUnit = top ? qtyPerUnit(top.qtyPerUnit, top.itemId, p.ingredientId, p.to.date, ctx.adjust.recipes) : 0;
  const unitWord = { each: p.ingredientId === "coke" ? "per can" : "per unit", kg: "per kg", l: "per litre" }[ingredientById[p.ingredientId].unit] ?? "per unit";
  return (
    <div className="space-y-5">
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="text-[15px]">From the stock counts</h3>
          <dl className="mt-2 text-sm">
            <Line label="Opening count" sub={when(p.from.date, p.from.min)}><Qty p={p} n={v.opening} />{v.openingWas !== undefined && <span className="ml-2 text-xs text-steel line-through">{qtyWords(v.openingWas, p.ingredientId)}</span>}</Line>
            <Line label="Received from the main storeroom"><Qty p={p} n={v.received} sign="+" /></Line>
            {v.transfers !== 0 && <Line label="Transfers"><Qty p={p} n={v.transfers} sign="±" /></Line>}
            <Line label="Closing count" sub={when(p.to.date, p.to.min)}><Qty p={p} n={v.closing} sign="−" />{v.closingWas !== undefined && <span className="ml-2 text-xs text-steel line-through">{qtyWords(v.closingWas, p.ingredientId)}</span>}</Line>
            <Line label="Actual use" strong><Qty p={p} n={v.actual} /></Line>
          </dl>
        </div>
        <div>
          <h3 className="text-[15px]">From sales and recipes</h3>
          <dl className="mt-2 text-sm">
            <Line label={`${v.soldUnits} ${isWine(p) ? `glass${v.soldUnits === 1 ? "" : "es"}` : p.ingredientId === "coke" ? (v.soldUnits === 1 ? "can" : "cans") : "portions"} recorded`} sub={v.compedUnits ? `including ${v.compedUnits} complimentary` : new Set(p.sales.map((s) => s.itemId)).size > 1 ? `across ${new Set(p.sales.map((s) => s.itemId)).size} menu items` : main}>
              <span className="num text-steel">× {isWine(p) ? `${Math.round(perUnit * 1000)} ml` : qtyWords(perUnit, p.ingredientId)}</span>
            </Line>
            <Line label="Expected use"><Qty p={p} n={v.expected} /></Line>
            <Line label="Recorded waste and breakage"><Qty p={p} n={v.waste + v.breakage} sign="+" /></Line>
            <Line label="Use the records explain" strong><Qty p={p} n={v.expected + v.waste + v.breakage} /></Line>
          </dl>
        </div>
      </div>
      <div className={cn("flex flex-wrap items-baseline justify-between gap-3 rounded-2xl px-5 py-4", v.significant && v.unexplained > 0 ? "border border-warn/25 bg-warn-soft" : "bg-mist")}>
        <div>
          <p className="text-[13px] text-steel">Unexplained difference</p>
          <p className="num text-[26px] tracking-[-0.02em] text-ink"><Qty p={p} n={v.unexplained} sign={v.unexplained < 0 ? "−" : undefined} /></p>
          <p className="text-xs text-steel">Actual use less the use the records explain. Counting can be out by up to {qtyWords(v.tolerance, p.ingredientId)}.</p>
        </div>
        <div className="text-right">
          <p className="text-[13px] text-steel">Estimated cost at today&rsquo;s price</p>
          <p className={cn("num text-[22px]", v.significant && v.unexplained > 0 && "text-warn")}>{money(Math.max(0, v.value))}</p>
          <p className="text-xs text-steel">{money(p.unitCost)} {unitWord}. Not a confirmed loss.</p>
        </div>
      </div>
    </div>
  );
}

const STATUS: Record<CauseStatus, { label: string; tone: "pos" | "warn" | "neutral" }> = {
  supported: { label: "The records point to this", tone: "warn" },
  against: { label: "The records make this unlikely", tone: "pos" },
  open: { label: "Needs checking", tone: "neutral" },
};

/** Possible causes. Each opens to the records that bear on it and how to check it. */
export function UsageCauses({ p, causes }: { p: UsagePeriod; causes: Cause[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div>
      <p className="text-xs text-steel">Possibilities to check, each with what the records show. None is established until a manager verifies it.</p>
      <ul className="mt-3 divide-y divide-hair rounded-2xl border border-line">
        {causes.map((c) => {
          const isOpen = open === c.id;
          return (
            <li key={c.id}>
              <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : c.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-cloud">
                <span className="flex-1 text-ink">{c.title}</span>
                {c.upTo !== undefined && c.upTo > 0 && <span className="num hidden text-xs text-steel sm:inline">up to {qtyWords(c.upTo, p.ingredientId)}</span>}
                <Badge tone={STATUS[c.status].tone} className="!py-0">{STATUS[c.status].label}</Badge>
                <ChevronDown size={14} className={cn("shrink-0 text-steel transition-transform duration-200", isOpen && "rotate-180")} aria-hidden />
              </button>
              {isOpen && (
                <div className="space-y-2 px-4 pb-4 text-[13px]">
                  <ul className="space-y-1.5 text-graphite">{c.evidence.map((e, i) => <li key={i} className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-fog" aria-hidden />{e}</li>)}</ul>
                  <p className="text-ink"><span className="text-steel">How to check: </span>{c.check}</p>
                  {c.id === "not_charged" && p.removals.length > 0 && (
                    <ul className="flex flex-wrap gap-2 pt-1">{p.removals.map((r) => <li key={`${r.orderId}-${r.itemId}`}><Link href={`/money/orders/${r.orderId}`} className="num rounded-full border border-line px-3 py-1 text-xs hover:border-fog">{r.orderId}</Link></li>)}</ul>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-hair first:border-t-0">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 py-3 text-left text-sm hover:text-ink">
        <span className="flex-1 text-ink">{title}</span>
        <span className="num text-xs text-steel">{count}</span>
        <ChevronDown size={14} className={cn("shrink-0 text-steel transition-transform duration-200", open && "rotate-180")} aria-hidden />
      </button>
      {open && <div className="pb-4 text-[13px]">{children}</div>}
    </div>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <p className="text-steel">{children}</p>;

/** Every record behind the figures, grouped and closed until opened. */
export function UsageRecords({ p, v }: { p: UsagePeriod; v: Variance }) {
  const ctx = useCtx();
  const recounts = ctx.adjust.recounts.filter((r) => r.checkId === p.from.id || r.checkId === p.to.id);
  const byItem = new Map<string, { units: number; comped: number; days: Set<string>; qty: number }>();
  for (const s of p.sales) {
    const x = byItem.get(s.itemId) ?? { units: 0, comped: 0, days: new Set<string>(), qty: 0 };
    x.units += s.units;
    x.comped += s.comped;
    x.days.add(s.date);
    x.qty += s.units * qtyPerUnit(s.qtyPerUnit, s.itemId, p.ingredientId, s.date, ctx.adjust.recipes);
    byItem.set(s.itemId, x);
  }
  const q = (n: number) => qtyWords(n, p.ingredientId);
  return (
    <div>
      <Section title="Stock counts" count={2 + recounts.length}>
        <ul className="space-y-1.5">
          {[p.from, p.to].map((c, i) => (
            <li key={c.id} className="flex flex-wrap justify-between gap-x-4"><span>{i === 0 ? "Opening" : "Closing"} count, {when(c.date, c.min)}, {personName(c.by)}</span><span className="num">{q(c.counted)}{isWine(p) && ` (${bottles(c.counted)} bottles)`}</span></li>
          ))}
          {recounts.map((r) => <li key={r.id} className="flex flex-wrap justify-between gap-x-4 text-ink"><span>Recount of the {r.checkId === p.from.id ? "opening" : "closing"} count, {fmtDate(r.date)}, {personName(r.by)}: {r.reason}</span><span className="num">{q(r.counted)}</span></li>)}
        </ul>
        {isWine(p) && <Note className="mt-2">Open bottles are counted to the nearest tenth. Each count can be out by up to {Math.round(0.075 * 1000)} ml.</Note>}
      </Section>
      <Section title="Received from the main storeroom" count={q(v.received)}>
        {p.issues.length === 0 ? <Empty>Nothing was issued in this period.</Empty> : <ul className="space-y-1.5">{p.issues.map((m) => <li key={m.id} className="flex justify-between gap-4"><span>{when(m.date, m.min)}, issue note {m.id}</span><span className="num">{q(m.qty)}</span></li>)}</ul>}
      </Section>
      <Section title="Transfers" count={p.transfers.length ? q(v.transfers) : "none"}>
        {p.transfers.length === 0 ? <Empty>No transfers in or out were recorded.</Empty> : <ul className="space-y-1.5">{p.transfers.map((m) => <li key={m.id} className="flex justify-between gap-4"><span>{when(m.date, m.min)}, {m.counterparty}</span><span className="num">{m.qty < 0 ? "−" : "+"}{q(Math.abs(m.qty))}</span></li>)}</ul>}
      </Section>
      <Section title="Sales recorded in the POS" count={`${v.soldUnits} sold`}>
        <table className="w-full">
          <thead><tr className="text-left text-xs text-steel"><th className="py-1 font-medium">Item</th><th className="py-1 text-right font-medium">Sold</th><th className="py-1 text-right font-medium">Complimentary</th><th className="py-1 text-right font-medium">Expected use</th></tr></thead>
          <tbody>
            {[...byItem].map(([itemId, x]) => (
              <tr key={itemId} className="num border-t border-hair">
                <td className="py-1.5"><Link href={`/menu/${itemId}`} className="underline decoration-line underline-offset-4 hover:decoration-ink">{itemById[itemId].name}</Link></td>
                <td className="py-1.5 text-right">{x.units}</td>
                <td className="py-1.5 text-right">{x.comped || "–"}</td>
                <td className="py-1.5 text-right">{q(x.qty)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      <Section title="Sent for preparation, then removed or voided" count={p.removals.length || "none"}>
        {p.removals.length === 0 ? <Empty>No line using this item was removed after it was sent.</Empty> : (
          <ul className="space-y-1.5">
            {p.removals.map((r) => (
              <li key={`${r.orderId}-${r.itemId}`} className="flex flex-wrap justify-between gap-x-4">
                <span><Link href={`/money/orders/${r.orderId}`} className="num underline decoration-line underline-offset-4 hover:decoration-ink">{r.orderId}</Link>: {r.qty} × {itemById[r.itemId].name}, sent {fmtTime(r.sentMin)}, {r.how} {fmtTime(r.removedMin)} on {fmtDate(r.date)}</span>
                <span className="num">{q(r.qty * r.qtyPerUnit)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Waste and breakage" count={v.waste + v.breakage ? q(v.waste + v.breakage) : "none"}>
        {p.waste.length + v.sessionWaste.length === 0 ? <Empty>No waste or breakage was recorded for this item at this outlet in the period.</Empty> : (
          <ul className="space-y-1.5">
            {p.waste.map((w) => <li key={w.id} className="flex justify-between gap-4"><span>{fmtDate(w.date)}, {w.reason}, {personName(w.by)}</span><span className="num">{q(w.qty)}</span></li>)}
            {v.sessionWaste.map((w) => <li key={w.id} className="flex justify-between gap-4 text-ink"><span>{fmtDate(w.date)}, {w.reason}, {personName(w.by)}{w.late ? ", late entry for this period" : ""}</span><span className="num">{q(w.qty)}</span></li>)}
          </ul>
        )}
      </Section>
    </div>
  );
}

/** The period as a sequence of events. Each opens to its record. */
export function UsageTimeline({ p, v }: { p: UsagePeriod; v: Variance }) {
  const ctx = useCtx();
  const q = (n: number) => qtyWords(n, p.ingredientId);
  type Ev = TimelineItem & { at: string };
  const at = (date: string, min: number) => `${date} ${String(min).padStart(4, "0")}`;
  const items: Ev[] = [
    { key: "open", at: at(p.from.date, p.from.min), when: when(p.from.date, p.from.min), title: `Opening count: ${q(v.opening)}`, body: <RecordFields rows={[["Counted by", personName(p.from.by)], ["Kind", p.from.kind === "close" ? "close of service" : "shift handover"], ["Recorded", q(p.from.counted)]]} /> },
    ...p.issues.map((m): Ev => ({ key: m.id, at: at(m.date, m.min), when: when(m.date, m.min), title: `${q(m.qty)} received from the main storeroom`, body: <RecordFields rows={[["Issue note", m.id], ["From", m.counterparty]]} /> })),
    ...p.transfers.map((m): Ev => ({ key: m.id, at: at(m.date, m.min), when: when(m.date, m.min), title: `${q(Math.abs(m.qty))} ${m.qty < 0 ? "sent out" : "received"}`, detail: m.counterparty })),
    ...eachDay({ from: p.from.date, to: p.to.date }).flatMap((d): Ev[] => {
      const day = p.sales.filter((s) => s.date === d);
      const units = day.reduce((s, x) => s + x.units, 0);
      if (!units) return [];
      // Sales sit within the period: after the opening count on its day, before the closing count on its day.
      const atMin = d === p.to.date ? Math.min(1439, p.to.min) - 1 : 1439;
      return [{ key: `sales-${d}`, at: at(d, atMin), when: fmtDate(d), title: `${units} sold in the POS`, detail: d === p.from.date ? "after the opening count" : d === p.to.date ? "up to the closing count" : undefined,
        body: <RecordFields rows={day.map((s) => [itemById[s.itemId].name, `${s.units}${s.comped ? `, ${s.comped} complimentary` : ""}`] as [string, string])} /> }];
    }),
    ...p.removals.map((r): Ev => ({
      key: `${r.orderId}-${r.itemId}`, at: at(r.date, r.removedMin), when: when(r.date, r.removedMin), tone: "warn", flag: "not on the bill",
      title: `${itemById[r.itemId].name} ${r.how === "voided" ? "voided" : "removed"} after it was sent, ${r.orderId}`,
      body: <RecordFields rows={[["Sent for preparation", fmtTime(r.sentMin)], [r.how === "voided" ? "Voided" : "Removed", fmtTime(r.removedMin)], ["Stock used", q(r.qty * r.qtyPerUnit)], ["What this shows", "The item was probably made. Whether it was served is not recorded."]]} />,
      href: `/money/orders/${r.orderId}`, hrefLabel: "Open the order history",
    })),
    ...p.waste.map((w): Ev => ({ key: w.id, at: at(w.date, 1438), when: fmtDate(w.date), title: `${q(w.qty)} logged as ${w.reason}`, detail: personName(w.by) })),
    ...v.sessionWaste.map((w): Ev => ({ key: w.id, at: at(w.date, 1438), when: fmtDate(w.date), title: `${q(w.qty)} logged as ${w.reason}${w.late ? " (late entry)" : ""}`, detail: personName(w.by), tone: "pos" })),
    { key: "close", at: at(p.to.date, p.to.min), when: when(p.to.date, p.to.min), title: `Closing count: ${q(v.closing)}`, tone: v.significant && v.unexplained > 0 ? "warn" : "neutral", flag: v.significant && v.unexplained > 0 ? `${q(v.unexplained)} unexplained` : undefined,
      body: <RecordFields rows={[["Counted by", personName(p.to.by)], ["Expected from the records", q(v.opening + v.received + v.transfers - v.expected - v.waste - v.breakage)], ["Counted", q(v.closing)]]} /> },
    ...ctx.adjust.recounts.filter((r) => r.checkId === p.to.id || r.checkId === p.from.id).map((r): Ev => ({ key: r.id, at: `${DEMO_TODAY} 9999-${r.seq}`, when: `${fmtDate(r.date)}, now`, title: `Recount: ${q(r.counted)}`, detail: `${personName(r.by)}: ${r.reason}`, tone: "pos" })),
  ];
  items.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return <Timeline items={items} />;
}

const REASONS: { value: WasteReason; label: string }[] = [
  { value: "waste", label: "Waste" }, { value: "spoilage", label: "Spoilage" }, { value: "breakage", label: "Breakage or spillage" }, { value: "other", label: "Other, such as a tasting" },
];

/** Corrections a manager can make from the evidence: a recount, a late waste entry, and, where authorised, the standard quantity. */
export function UsageTools({ p }: { p: UsagePeriod }) {
  const user = useUser()!;
  const recount = useDemo((s) => s.recordRecount);
  const logWaste = useDemo((s) => s.logWaste);
  const setStandard = useDemo((s) => s.setStandardQty);
  const ctx = useCtx();
  const g = ingredientById[p.ingredientId];
  const wine = isWine(p);
  // Wine is counted in bottles and tenths; everything else in its own unit.
  const toUnit = (s: string) => (wine ? Number(s) * BOTTLE_L : Number(s));
  const unitLabel = wine ? "bottles" : p.ingredientId === "coke" ? "cans" : g.unit === "each" ? "units" : g.unit;

  const [which, setWhich] = useState<"to" | "from">("to");
  const [counted, setCounted] = useState("");
  const [why, setWhy] = useState("");
  const [wQty, setWQty] = useState("");
  const [wReason, setWReason] = useState<WasteReason>("spoilage");
  const [wDate, setWDate] = useState(p.to.date);
  const mainItem = p.sales.slice().sort((a, b) => b.units - a.units)[0]?.itemId;
  const base = mainItem ? itemById[mainItem].recipe?.find((l) => l.ingredientId === p.ingredientId)?.qty ?? 0 : 0;
  const current = mainItem ? qtyPerUnit(base, mainItem, p.ingredientId, p.to.date, ctx.adjust.recipes) : 0;
  const scale = g.unit === "each" ? 1 : 1000;
  const [std, setStd] = useState("");
  const [stdFrom, setStdFrom] = useState(p.from.date);
  const [stdWhy, setStdWhy] = useState("");
  const preview = useMemo(() => {
    const n = Number(std) / scale;
    if (!mainItem || !std || !Number.isFinite(n) || n <= 0) return null;
    return periodVariance(p, { ...ctx.adjust, recipes: [...ctx.adjust.recipes, { id: "preview", itemId: mainItem, ingredientId: p.ingredientId, qty: n, from: stdFrom, reason: "", by: "", seq: 1e9 }] });
  }, [std, stdFrom, mainItem, p, ctx.adjust, scale]);
  const days = eachDay({ from: p.from.date, to: p.to.date }).filter((d) => d <= DEMO_TODAY);
  const q = (n: number) => qtyWords(n, p.ingredientId);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {can(user, "stock.count") && (
        <form className="space-y-3" onSubmit={(e) => {
          e.preventDefault();
          const n = toUnit(counted);
          if (report(recount({ checkId: which === "to" ? p.to.id : p.from.id, outletId: p.outletId, ingredientId: p.ingredientId, counted: n, reason: why }), `Recount saved. The ${which === "to" ? "closing" : "opening"} count is now ${q(n)}; the original stays on record.`)) { setCounted(""); setWhy(""); }
        }}>
          <h3 className="text-[15px]">Record a recount</h3>
          <Select label="Count to correct" value={which} onChange={(e) => setWhich(e.target.value as "to" | "from")}>
            <option value="to">Closing count, {when(p.to.date, p.to.min)}</option>
            <option value="from">Opening count, {when(p.from.date, p.from.min)}</option>
          </Select>
          <Field label="Counted" suffix={unitLabel} type="number" inputMode="decimal" min="0" step={wine ? 0.1 : g.unit === "each" ? 1 : 0.05} value={counted} onChange={(e) => setCounted(e.target.value)} />
          <Field label="Why recount?" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="For example: a case was in the back fridge" />
          <Button type="submit" size="sm">Save recount</Button>
        </form>
      )}
      {can(user, "stock.logWaste") && (
        <form className="space-y-3" onSubmit={(e) => {
          e.preventDefault();
          const n = toUnit(wQty);
          if (report(logWaste({ outletId: p.outletId, ingredientId: p.ingredientId, qty: n, reason: wReason, date: wDate, periodId: p.id }), `${cap(q(n))} logged as ${wReason} for this period. The difference is updated.`)) setWQty("");
        }}>
          <h3 className="text-[15px]">Log waste that was missed</h3>
          <Field label="Quantity" suffix={unitLabel} type="number" inputMode="decimal" min="0" step={wine ? 0.1 : g.unit === "each" ? 1 : 0.05} value={wQty} onChange={(e) => setWQty(e.target.value)} />
          <Select label="Reason" value={wReason} onChange={(e) => setWReason(e.target.value as WasteReason)}>
            {REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </Select>
          <Select label="Day it happened" value={wDate} onChange={(e) => setWDate(e.target.value)}>
            {days.map((d) => <option key={d} value={d}>{fmtDate(d, true)}</option>)}
          </Select>
          <Button type="submit" size="sm">Log for this period</Button>
        </form>
      )}
      {mainItem && g.unit !== "each" && (
        <div className="space-y-3">
          <h3 className="text-[15px]">{wine ? "Standard pour" : `Recipe quantity, ${itemById[mainItem].name}`}</h3>
          <p className="text-sm text-graphite">
            Tyll expects <span className="num text-ink">{`${Math.round(current * scale)} ${g.unit === "kg" ? "g" : "ml"}`}</span> a {wine ? "glass" : "portion"}
            {wine && <span className="text-steel"> ({Math.round(BOTTLE_L / current * 10) / 10} glasses a bottle)</span>}.
          </p>
          {can(user, "stock.editPrices") ? (
            <form className="space-y-3" onSubmit={(e) => {
              e.preventDefault();
              if (report(setStandard({ itemId: mainItem, ingredientId: p.ingredientId, qty: Number(std) / scale, from: stdFrom, reason: stdWhy }), "Standard changed. Expected use is recalculated from that date.")) { setStd(""); setStdWhy(""); }
            }}>
              <Field label={`New standard (${g.unit === "kg" ? "g" : "ml"})`} type="number" inputMode="decimal" min="1" value={std} onChange={(e) => setStd(e.target.value)} />
              <Field label="Wrong since" type="date" max={DEMO_TODAY} value={stdFrom} onChange={(e) => setStdFrom(e.target.value)} />
              <Field label="Why?" value={stdWhy} onChange={(e) => setStdWhy(e.target.value)} placeholder="For example: the menu serves 175 ml" />
              {preview && <p className="text-[13px] text-graphite">With this standard, expected use would be <span className="num text-ink">{q(preview.expected)}</span> and the difference <span className="num text-ink">{q(preview.unexplained)}</span>.</p>}
              <Button type="submit" size="sm">Change the standard</Button>
            </form>
          ) : (
            <Note>Only an F&amp;B director, general manager or owner can change a standard quantity.</Note>
          )}
        </div>
      )}
    </div>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Where this period's outlet sits, for headers. */
export const periodPlace = (p: UsagePeriod) => `${outletById[p.outletId].name}, ${when(p.from.date, p.from.min)} to ${when(p.to.date, p.to.min)}`;

/** The left column of a usage investigation: the same evidence as Where did it go?, with the corrections a manager can make. */
export function UsageCaseBody({ p }: { p: UsagePeriod }) {
  const { v, causes } = useUsage(p);
  return (
    <>
      <Panel title="What happened?" action={<Badge>Assembled by rules, not a language model</Badge>}>
        <p className="max-w-[80ch] text-[15px] leading-relaxed text-ink">{summaryFor(p, v)}</p>
        <div className="mt-6"><UsageFigures p={p} v={v} /></div>
      </Panel>
      <Panel title="What happened, in order" description="Open an event to see its record."><UsageTimeline p={p} v={v} /></Panel>
      <Panel title="What might explain it?"><UsageCauses p={p} causes={causes} /></Panel>
      <Panel title="What the records show"><UsageRecords p={p} v={v} /></Panel>
      <Panel title="Check and correct" description="Corrections are added to the records and never replace them. The figures update straight away."><UsageTools p={p} /></Panel>
      <Panel title="What to do next">
        <ol className="space-y-3 text-sm">
          {stepsFor(p, v).map((s, i) => <li key={i} className="flex gap-3"><span className="num flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-mist text-xs text-graphite">{i + 1}</span><span className="pt-0.5 text-graphite">{s}</span></li>)}
        </ol>
      </Panel>
    </>
  );
}
