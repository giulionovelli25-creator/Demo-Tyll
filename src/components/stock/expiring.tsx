"use client";
// Expiring soon: batches on the shelf that expire in the next days, what they are worth, and what to do about each,
// by fixed rules. Stock is used first expiring, first out, so the batch to use first is marked.
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { useState } from "react";
import { Badge, EmptyState, Note, Panel, Segmented, Skeleton, SummaryBar, TableWrap, Td, Th, WidgetError, cn, linkButton, rowClass } from "@/components/ui";
import { outletById, outletsOfProperty, propertyById } from "@/lib/data/catalog";
import { Button, Select, toast } from "@/components/ui";
import { can } from "@/lib/domain/access";
import { api } from "@/lib/api";
import { personName, useSessionEntries, useView } from "@/lib/hooks";
import { usePlanDrafts } from "@/lib/plan-hooks";
import { useExpiring } from "@/lib/procurement-hooks";
import type { ExpiryRow } from "@/lib/server/expiry";
import { fmtDate, fmtMoney, fmtNum } from "@/lib/util";

const KIND: Record<string, { label: string; tone: "neutral" | "warn" | "pos" | "neg" | "ink" | "accent" }> = {
  use_first: { label: "Use first", tone: "pos" }, transfer: { label: "Transfer", tone: "accent" }, special: { label: "Special", tone: "accent" }, staff_meal: { label: "Staff meal", tone: "accent" }, waste: { label: "Expired", tone: "neg" },
};
const when = (d: number) => (d < 0 ? `Expired ${-d} ${d === -1 ? "day" : "days"} ago` : d === 0 ? "Today" : d === 1 ? "Tomorrow" : `In ${d} days`);

export function Expiring({ propertyId }: { propertyId: string }) {
  const [days, setDays] = useState("3");
  const { data, error } = useExpiring(propertyId, Number(days));
  const money = (n: number) => fmtMoney(n, propertyById[propertyId].currency);
  return (
    <div className="space-y-6">
      {error ? <WidgetError>Expiry could not load.</WidgetError> : !data ? <Skeleton className="h-64 w-full" /> : (
        <>
          <UseToday rows={data.rows.filter((r) => r.daysLeft <= 1)} money={money} propertyId={propertyId} />
          <SummaryBar
            items={[
              { label: "Batches expiring", value: data.totals.batches, compare: { text: `Within ${days} ${days === "1" ? "day" : "days"}, ${money(data.totals.value)}`, good: null } },
              { label: "At risk", value: data.totals.atRisk, tone: data.totals.atRisk ? "warn" : "pos", compare: { text: data.totals.atRisk ? `${money(data.totals.atRiskValue)} normal use will not finish in time` : "Normal use finishes every batch", good: data.totals.atRisk ? false : true } },
              { label: "Expired on the shelf", value: data.totals.expired, tone: data.totals.expired ? "neg" : "pos", compare: { text: data.totals.expired ? "Remove and log as waste, reason Expired" : "None", good: data.totals.expired ? false : true } },
            ]}
            action={data.totals.expired ? <Link prefetch={false} href="/waste" className={linkButton("primary")}>Log expired stock</Link> : undefined}
          />
          <Panel title="Batches by use-by date" description="The first expiring batch of each item is the one to use first." action={<Segmented label="Within" size="sm" value={days} onChange={setDays} options={[{ value: "1", label: "1 day" }, { value: "2", label: "2 days" }, { value: "3", label: "3 days" }, { value: "7", label: "7 days" }]} />} flush>
            {data.rows.length === 0 ? <div className="p-6"><EmptyState title="Nothing expires in this window">Every batch on the shelf keeps longer.</EmptyState></div> : (
              <TableWrap>
                <table className="w-full min-w-[920px] text-table">
                  <thead><tr><Th>Item</Th><Th>Batch</Th><Th>Use by</Th><Th align="right">Left</Th><Th align="right">Value</Th><Th>Suggested</Th></tr></thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <tr key={`${r.ingredientId}|${r.batch}|${r.expiry}`} className={cn(rowClass, r.daysLeft < 0 && "bg-neg-soft/40")}>
                        <Td><span className="text-ink">{r.name}</span>{r.first && r.daysLeft >= 0 && r.action.kind !== "use_first" && <Badge tone="ink" className="ms-2">Use first</Badge>}</Td>
                        <Td><span className="num text-graphite">{r.batch}</span><span className="block text-xs text-steel">Received {fmtDate(r.received, true)}, {r.source}</span></Td>
                        <Td><span className={cn(r.daysLeft < 0 ? "font-medium text-neg" : r.daysLeft <= 1 ? "font-medium text-warn" : "text-ink")}>{when(r.daysLeft)}</span><span className="block text-xs text-steel">{fmtDate(r.expiry, true)}</span><span className="block text-xs text-steel">{r.useBy === "label" ? "From the label" : `Received plus ${r.shelfLifeDays} days shelf life`}</span></Td>
                        <Td align="right">{fmtNum(r.left, r.left % 1 ? 1 : 0)} {r.unit}</Td>
                        <Td align="right" className="num text-ink">{money(r.value)}</Td>
                        <Td><Badge tone={KIND[r.action.kind].tone}>{KIND[r.action.kind].label}</Badge><span className="mt-1 block max-w-[340px] text-[13px] text-graphite">{r.action.text}</span><ExpiryActions r={r} propertyId={propertyId} /></Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
            <Note className="px-6 py-4">Batches come from deliveries: the use-by date recorded on receiving, or the item&rsquo;s shelf life from the delivery day. Stock is used first expiring, first out, so the batches still on the shelf are the ones that expire last. Suggestions follow fixed rules: normal use first, then a transfer to the outlet that uses it most, then a special, then the staff meal. Values at the hotel&rsquo;s valuation method. Simulated data.{data.noBatchItems ? ` ${data.noBatchItems} fresh ${data.noBatchItems === 1 ? "item has" : "items have"} more on the shelf than the recorded batches: check those by hand.` : ""}</Note>
          </Panel>
        </>
      )}
    </div>
  );
}

/** The first thing on the page: what the kitchen should use or remove today, in large type, with words and icons, not colour alone. */
function UseToday({ rows, money, propertyId }: { rows: ExpiryRow[]; money: (n: number) => string; propertyId: string }) {
  const expired = rows.filter((r) => r.daysLeft < 0);
  const soon = rows.filter((r) => r.daysLeft >= 0);
  return (
    <section aria-labelledby="use-today" className="rounded-panel border-2 border-ink bg-paper p-5 shadow-panel sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="use-today" className="text-[22px] font-semibold leading-tight text-ink">Use today</h2>
        <p className="text-sm text-graphite">{rows.length ? `${soon.length} to use by tomorrow${expired.length ? `, ${expired.length} expired` : ""}` : "Nothing urgent"}</p>
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 flex items-center gap-2 text-base text-ink"><CheckCircle2 size={20} className="shrink-0 text-pos" aria-hidden />Nothing needs using up today. Every batch keeps at least two more days.</p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {rows.map((r) => {
            const gone = r.daysLeft < 0;
            const Icon = gone ? AlertTriangle : Clock;
            return (
              <li key={`${r.ingredientId}|${r.batch}|${r.expiry}`} className="flex gap-3 py-3.5 first:pt-0 last:pb-0">
                <Icon size={22} className={cn("mt-0.5 shrink-0", gone ? "text-neg" : "text-warn")} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-lg font-semibold text-ink">{r.name}</span>
                    <span className={cn("text-[15px] font-medium", gone ? "text-neg" : "text-ink")}>{gone ? when(r.daysLeft) : r.daysLeft === 0 ? "Use by today" : "Use by tomorrow"}</span>
                  </p>
                  <p className="mt-0.5 text-[15px] text-graphite">{fmtNum(r.left, r.left % 1 ? 1 : 0)} {r.unit} left, worth {money(r.value)}. Batch <span className="num whitespace-nowrap">{r.batch}</span>.</p>
                  <p className="mt-1 text-[15px] text-ink">{gone ? "Remove it from the shelf and log it as waste, reason Expired." : r.action.text}</p>
                  <ExpiryActions r={r} propertyId={propertyId} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

const DECIDED: Record<string, string> = { special: "Tonight's special", move: "Moved", waste: "Logged as waste" };

/** What to do with a batch at risk, in one tap: tonight's special, a move to another outlet, or waste. Once decided, who
 * decided and what. The chef and the outlet's restaurant manager are told on the bell. */
function ExpiryActions({ r, propertyId }: { r: ExpiryRow; propertyId: string }) {
  const { user } = useView();
  const entries = useSessionEntries();
  const bump = usePlanDrafts((s) => s.bump);
  const [moving, setMoving] = useState(false);
  const [outlet, setOutlet] = useState("");
  const [busy, setBusy] = useState(false);
  const d = r.decision;
  if (d) {
    return <p className="mt-2 text-[13px] text-ink"><Badge tone="pos" className="me-2">{DECIDED[d.kind]}</Badge>{d.kind === "special" ? `${d.qty} ${r.unit} at ${outletById[d.outletId].name}${d.dish ? `, in ${d.dish}` : ""}` : d.kind === "move" ? `${d.qty} ${r.unit} to ${outletById[d.outletId].name}` : `${d.qty} ${r.unit}, reason Expired`}. {personName(d.by)}.</p>;
  }
  const gone = r.daysLeft < 0;
  if (!r.atRisk && !gone) return null;
  const plans = can(user, "prep.plan");
  const wastes = can(user, "stock.logWaste");
  if (!plans && !wastes) return null;
  const decide = async (kind: "special" | "move" | "waste", outletId?: string) => {
    setBusy(true);
    try {
      await api("/api/stock/expiry", { method: "POST", body: { action: "decide", propertyId, kind, ingredientId: r.ingredientId, batch: r.batch, outletId, ...entries } });
      toast.done(kind === "special" ? `${r.name} is tonight's special. The kitchen and the restaurant manager are told.` : kind === "move" ? `${r.name} moved to ${outletById[outletId!].name}. Its manager is told.` : `${r.name} logged as waste, reason Expired.`);
      bump();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save."); }
    finally { setBusy(false); }
  };
  const others = outletsOfProperty(propertyId).filter((o) => o.id !== "lis-terrace");
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2">
      {!gone && plans && <Button size="sm" variant="primary" disabled={busy} onClick={() => void decide("special", "lis-terrace")}>Make it tonight&rsquo;s special</Button>}
      {!gone && plans && (moving ? (
        <>
          <Select label="Move to" hideLabel value={outlet} onChange={(e) => setOutlet(e.target.value)} className="min-w-[180px]"><option value="">Choose an outlet</option>{others.map((o) => <option key={o.id} value={o.id}>{outletById[o.id].name}</option>)}</Select>
          <Button size="sm" disabled={busy || !outlet} onClick={() => void decide("move", outlet)}>Move</Button>
        </>
      ) : <Button size="sm" disabled={busy} onClick={() => setMoving(true)}>Move to another outlet</Button>)}
      {wastes && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void decide("waste", "lis-terrace")}>Log as waste</Button>}
    </div>
  );
}
