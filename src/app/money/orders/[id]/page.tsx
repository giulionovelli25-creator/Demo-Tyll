"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { OrderTimeline, OrderVersusBill, Tickets, ChargeEvidence } from "@/components/order-evidence";
import { Badge, Button, Crumbs, EmptyState, PageHeader, Panel } from "@/components/ui";
import { outletById, propertyById, staffById } from "@/lib/data/catalog";
import { canSeeOutlet } from "@/lib/domain/access";
import { orderTotals } from "@/lib/domain/orders";
import { useCtx, useInvestigations, useOrder, useUser } from "@/lib/hooks";
import { STATUS_LABEL } from "@/lib/labels";
import { fmtDate, fmtMoney, fmtTime } from "@/lib/util";

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const user = useUser()!;
  const ctx = useCtx();
  const investigations = useInvestigations();
  const { order, status } = useOrder(decodeURIComponent(id));

  if (status === "loading") return <EmptyState title="Loading the order" />;
  if (!order || !canSeeOutlet(user, order.outletId)) {
    return (
      <EmptyState title="This order is not available" action={<Button variant="primary" onClick={() => router.push("/money?tab=orders")}>Open order history</Button>}>
        It does not exist, or it belongs to an outlet outside your access.
      </EmptyState>
    );
  }
  const outlet = outletById[order.outletId];
  const property = propertyById[outlet.propertyId];
  const t = orderTotals(order);
  const cases = investigations.filter((i) => i.orderId === order.id);
  const charge = ctx.data.chargesById.get(`RC-${order.id}`);
  const money = (n: number) => fmtMoney(n, property.currency, { decimals: n % 1 !== 0 });

  return (
    <div className="space-y-5">
      <PageHeader
        crumbs={<Crumbs items={[{ label: "Tyll Money", onClick: () => router.push("/money") }, { label: "Order history", onClick: () => router.push("/money?tab=orders") }, { label: order.id }]} />}
        title={`Order ${order.id}`}
        lead={`${outlet.name}, ${property.name}. ${fmtDate(order.date, true)}, opened ${fmtTime(order.openMin)} on ${order.table.toLowerCase()} under the POS login of ${staffById[order.staffId]?.name ?? order.staffId}.`}
      >
        <Badge>{order.voided ? "Voided" : order.payment === "room" ? `Charged to room ${order.room}` : `Paid by ${order.payment}`}</Badge>
        <Badge>{money(t.net)} billed</Badge>
      </PageHeader>

      {cases.map((c) => (
        <Link key={c.id} href={`/investigations/${c.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-warn/30 bg-warn-soft px-6 py-4 transition-colors duration-300 ease-tyll hover:border-warn/60">
          <span className="min-w-0">
            <span className="block text-[15px] text-ink">{c.headline}</span>
            <span className="text-[13px] text-graphite">Investigation {STATUS_LABEL[c.status].toLowerCase()} · {money(c.exposure)} involved</span>
          </span>
          <span className="flex items-center gap-1 text-sm text-ink">Open the investigation <ArrowRight size={15} /></span>
        </Link>
      ))}

      <Panel title="Original order and final bill"><OrderVersusBill order={order} /></Panel>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Panel title="Complete order history" description="Every step the point of sale recorded."><OrderTimeline order={order} /></Panel>
        <Panel title="Kitchen and bar tickets"><Tickets order={order} /></Panel>
      </div>
      {charge && <Panel title="Posting to the guest bill" description="The outlet's charge compared with what the property management system holds."><ChargeEvidence charge={charge} /></Panel>}
    </div>
  );
}
