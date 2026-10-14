"use client";
import { Badge, cn } from "@/components/ui";
import { itemById, outletById, propertyById, staffById } from "@/lib/data/catalog";
import { lineValue, orderTimeline, orderTotals } from "@/lib/domain/orders";
import type { Order, RoomCharge } from "@/lib/types";
import { fmtMoney, fmtTime } from "@/lib/util";

const useMoney = (order: Order) => {
  const currency = propertyById[outletById[order.outletId].propertyId].currency;
  return (n: number) => fmtMoney(n, currency, { decimals: n % 1 !== 0 });
};

/** Original order and final bill, side by side. */
export function OrderVersusBill({ order }: { order: Order }) {
  const money = useMoney(order);
  const t = orderTotals(order);
  const billed = order.voided ? [] : order.lines.filter((l) => l.state === "kept" || l.state === "comped");
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-2xl border border-line p-4">
        <p className="text-[13px] text-steel">Original order</p>
        <ul className="mt-2 divide-y divide-hair text-sm">
          {order.lines.map((l, i) => {
            const gone = order.voided || l.state === "removed_pre" || l.state === "removed_post";
            return (
              <li key={i} className="flex items-baseline justify-between gap-3 py-2">
                <span className={cn(gone && "text-steel")}>
                  {l.qty} × {itemById[l.itemId].name}
                  {l.state === "removed_post" && !order.voided && <Badge tone="warn" className="ml-2 !py-0">removed after dispatch</Badge>}
                  {l.state === "removed_pre" && <Badge className="ml-2 !py-0">removed before dispatch</Badge>}
                  {l.state === "comped" && <Badge className="ml-2 !py-0">complimentary</Badge>}
                </span>
                <span className="num">{money(lineValue(l))}</span>
              </li>
            );
          })}
        </ul>
        <p className="num mt-2 flex justify-between border-t border-line pt-2 text-sm"><span className="text-steel">Value as ordered</span>{money(t.original)}</p>
      </div>
      <div className="rounded-2xl border border-line p-4">
        <p className="text-[13px] text-steel">Final bill</p>
        {billed.length === 0 ? (
          <p className="mt-2 py-2 text-sm text-graphite">No bill was produced. The order was voided.</p>
        ) : (
          <ul className="mt-2 divide-y divide-hair text-sm">
            {billed.map((l, i) => (
              <li key={i} className="flex items-baseline justify-between gap-3 py-2">
                <span>{l.qty} × {itemById[l.itemId].name}</span>
                <span className="num">{l.state === "comped" ? money(0) : money(lineValue(l))}</span>
              </li>
            ))}
            {t.discounts > 0 && <li className="flex justify-between py-2"><span>Discount, {order.discountPct}%</span><span className="num">{money(-t.discounts)}</span></li>}
            {t.refunds > 0 && <li className="flex justify-between py-2"><span>Refund after payment</span><span className="num">{money(-t.refunds)}</span></li>}
          </ul>
        )}
        <p className="num mt-2 flex justify-between border-t border-line pt-2 text-sm"><span className="text-steel">{order.voided ? "Charged" : order.payment === "room" ? `Charged to room ${order.room}` : `Paid by ${order.payment}`}</span>{money(t.net)}</p>
        {t.original - t.net > 0.005 && <p className="num mt-1 flex justify-between text-sm text-warn"><span>Difference from the original order</span>{money(t.original - t.net)}</p>}
      </div>
    </div>
  );
}

/** Every recorded step of the order, in time order. Flagged steps are marked. */
export function OrderTimeline({ order }: { order: Order }) {
  const events = orderTimeline(order);
  return (
    <ol className="relative ml-2 border-l border-line">
      {events.map((e, i) => (
        <li key={i} className="relative pb-4 pl-6 last:pb-0">
          <span className={cn("absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-paper", e.flagged ? "bg-warn" : e.kind === "paid" ? "bg-pos" : "bg-fog")} aria-hidden />
          <p className="flex flex-wrap items-baseline gap-x-3 text-sm">
            <span className="num w-[70px] shrink-0 text-steel">{fmtTime(e.min)}</span>
            <span className={cn("text-ink", e.flagged && "font-medium")}>{e.title}</span>
            {e.flagged && <Badge tone="warn" className="!py-0">flagged</Badge>}
          </p>
          {e.detail && <p className="ml-[82px] text-xs text-steel">{e.detail}</p>}
        </li>
      ))}
    </ol>
  );
}

/** The preparation tickets sent to the kitchen and bar. */
export function Tickets({ order }: { order: Order }) {
  const stations = (["kitchen", "bar"] as const).filter((s) => order.lines.some((l) => l.sentMin !== undefined && itemById[l.itemId].station === s));
  if (stations.length === 0) return <p className="text-sm text-steel">Nothing on this order was sent for preparation.</p>;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {stations.map((s) => {
        const lines = order.lines.filter((l) => l.sentMin !== undefined && itemById[l.itemId].station === s);
        return (
          <div key={s} className="rounded-2xl border border-dashed border-fog bg-cloud p-4 font-mono text-[12.5px] leading-relaxed text-graphite">
            <p className="flex justify-between text-ink"><span>{s === "kitchen" ? "KITCHEN TICKET" : "BAR TICKET"}</span><span>{order.id}</span></p>
            <p>{order.table} · {staffById[order.staffId]?.name ?? order.staffId}</p>
            <p className="my-2 border-t border-dashed border-fog" />
            {lines.map((l, i) => (
              <p key={i} className="flex justify-between gap-3">
                <span>{l.qty} × {itemById[l.itemId].name}</span>
                <span>{fmtTime(l.sentMin!)}</span>
              </p>
            ))}
            <p className="my-2 border-t border-dashed border-fog" />
            {lines.map((l, i) => (
              <p key={i} className="text-steel">
                {itemById[l.itemId].name}: {l.completedMin !== undefined ? `marked ready ${fmtTime(l.completedMin)}` : s === "bar" ? "no completion record (bar has no display)" : "no completion record"}
              </p>
            ))}
          </div>
        );
      })}
    </div>
  );
}

export function ChargeEvidence({ charge }: { charge: RoomCharge }) {
  const currency = propertyById[charge.propertyId].currency;
  const money = (n: number) => fmtMoney(n, currency, { decimals: n % 1 !== 0 });
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-2xl border border-line p-4">
        <p className="text-[13px] text-steel">Recorded at the source</p>
        <p className="mt-2 text-sm text-ink">{charge.description}</p>
        <p className="text-xs text-steel">Room {charge.room} · {fmtTime(charge.min)}</p>
        <p className="num mt-3 flex justify-between border-t border-line pt-2 text-sm"><span className="text-steel">Should be on the guest bill</span>{money(charge.expected)}</p>
      </div>
      <div className="rounded-2xl border border-line p-4">
        <p className="text-[13px] text-steel">Guest bill in the PMS</p>
        {charge.posted.length === 0 ? (
          <p className="mt-2 py-2 text-sm text-warn">No matching line found.</p>
        ) : (
          <ul className="mt-2 divide-y divide-hair text-sm">
            {charge.posted.map((p, i) => <li key={i} className="flex justify-between py-2"><span>Posting {i + 1}</span><span className="num">{money(p)}</span></li>)}
          </ul>
        )}
        <p className="num mt-2 flex justify-between border-t border-line pt-2 text-sm"><span className="text-steel">Total posted</span>{money(charge.posted.reduce((s, x) => s + x, 0))}</p>
      </div>
    </div>
  );
}
