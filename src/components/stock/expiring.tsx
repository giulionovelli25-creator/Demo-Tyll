"use client";
// Expiring soon: batches on the shelf that expire in the next days, what they are worth, and what to do about each,
// by fixed rules. Stock is used first expiring, first out, so the batch to use first is marked.
import Link from "next/link";
import { useState } from "react";
import { Badge, EmptyState, Note, Panel, Segmented, Skeleton, SummaryBar, TableWrap, Td, Th, WidgetError, cn, linkButton, rowClass } from "@/components/ui";
import { propertyById } from "@/lib/data/catalog";
import { useExpiring } from "@/lib/procurement-hooks";
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
                        <Td><span className={cn(r.daysLeft < 0 ? "font-medium text-neg" : r.daysLeft <= 1 ? "font-medium text-warn" : "text-ink")}>{when(r.daysLeft)}</span><span className="block text-xs text-steel">{fmtDate(r.expiry, true)}</span></Td>
                        <Td align="right">{fmtNum(r.left, r.left % 1 ? 1 : 0)} {r.unit}</Td>
                        <Td align="right" className="num text-ink">{money(r.value)}</Td>
                        <Td><Badge tone={KIND[r.action.kind].tone}>{KIND[r.action.kind].label}</Badge><span className="mt-1 block max-w-[340px] text-[13px] text-graphite">{r.action.text}</span></Td>
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
