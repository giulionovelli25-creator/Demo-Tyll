"use client";
// Automatic ordering: what Tyll ordered this morning from the prediction, and the rules that decide what is sent
// straight to a supplier and what waits for approval. Fixed rules, never AI. Simulated: nothing reaches a supplier.
import Link from "next/link";
import { useState } from "react";
import { X } from "lucide-react";
import { Badge, Button, Drawer, EmptyState, Note, PageHeader, Panel, Segmented, Skeleton, SummaryBar, WidgetError, cn, textLink, toast } from "@/components/ui";
import { api } from "@/lib/api";
import { useAlertFeed } from "@/lib/alert-feed";
import { INGREDIENTS, ingredientById, propertyById } from "@/lib/data/catalog";
import { supplierName } from "@/lib/data/purchasing-rules";
import { RUN_TIMES, SEND_LIMITS, type AutoSettings } from "@/lib/domain/auto-order";
import { orderStage } from "@/lib/domain/order-stage";
import { personName } from "@/lib/hooks";
import { useAutoOrder, usePlanDrafts } from "@/lib/plan-hooks";
import type { PurchaseRequest } from "@/lib/types";
import { DEMO_TODAY, addDays, fmtDate, fmtMoney, fmtQty, sum } from "@/lib/util";

const total = (r: PurchaseRequest) => sum(r.lines, (l) => l.qty * l.unitPrice);
const supplierOf = (r: PurchaseRequest) => supplierName(r.lines[0]?.supplierId ?? "");
const when = (iso: string) => (iso === DEMO_TODAY ? "today" : iso === addDays(DEMO_TODAY, 1) ? "tomorrow" : fmtDate(iso, true));

function Rule({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-t border-hair py-3 first:border-t-0 sm:grid-cols-[220px_1fr] sm:gap-4">
      <dt className="text-[13px] text-steel">{label}</dt>
      <dd className="text-sm text-ink">{children}</dd>
    </div>
  );
}

function OrderRow({ r, money }: { r: PurchaseRequest; money: (n: number) => string }) {
  const sent = r.auto?.decision === "sent";
  const stage = orderStage(r);
  return (
    <li className="border-t border-hair px-5 py-4 sm:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-[15px] font-medium text-ink">{supplierOf(r)}</span>
        <span className="num text-[15px] font-medium text-ink">{money(total(r))}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        {sent
          ? <Badge tone="pos">{stage === "delivered" || stage === "short" ? "Delivered" : `Sent, arrives ${r.expectedAt ? when(r.expectedAt.slice(0, 10)) : "soon"}`}</Badge>
          : r.status === "approved" ? <Badge tone="pos">Approved and sent</Badge>
          : r.status === "rejected" ? <Badge tone="neg">Rejected</Badge>
          : <Badge tone="warn">Waiting for approval</Badge>}
        <span className="text-xs text-steel">{r.lines.length} {r.lines.length === 1 ? "item" : "items"}</span>
      </div>
      <p className="mt-2 text-[13px] text-graphite">{r.lines.map((l) => `${ingredientById[l.ingredientId].name} ${fmtQty(l.qty, ingredientById[l.ingredientId].unit)}`).join(", ")}.</p>
      <p className="mt-1 text-xs text-steel">{sent ? "Sent without waiting: " : "Waits because: "}{r.auto?.why}</p>
      <Link href={`/forecast?tab=approvals&request=${r.id}`} prefetch={false} className={cn(textLink, "mt-2")}>Open {r.id}</Link>
    </li>
  );
}

function RulesDrawer({ open, onClose, settings, propertyId }: { open: boolean; onClose: () => void; settings: AutoSettings; propertyId: string }) {
  const [draft, setDraft] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState("");
  const bump = usePlanDrafts((s) => s.bump);
  const money = (n: number) => fmtMoney(n, propertyById[propertyId].currency);
  const save = async () => {
    setBusy(true);
    try {
      await api("/api/auto-order", { method: "POST", body: { action: "settings", propertyId, on: draft.on, time: draft.time, sendUnder: draft.sendUnder, never: draft.never } });
      toast.done(draft.on ? "Rules saved. They apply from the next run." : "Automatic ordering is off. Nothing will be ordered automatically.");
      bump();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The rules could not be saved. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const choices = INGREDIENTS.filter((g) => g.dept !== "glassware" && !draft.never.includes(g.id)).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <Drawer open={open} onClose={onClose} title="Change the rules" description="Changes apply from the next morning's run. Orders already placed stay as they are.">
      <div className="space-y-6">
        <div>
          <p className="mb-2 text-[13px] font-medium text-ink">Automatic ordering</p>
          <Segmented label="Automatic ordering" value={draft.on ? "on" : "off"} onChange={(v) => setDraft({ ...draft, on: v === "on" })} options={[{ value: "on", label: "On" }, { value: "off", label: "Off" }]} />
        </div>
        <div>
          <p className="mb-2 text-[13px] font-medium text-ink">Runs every morning at</p>
          <Segmented label="Run time" value={draft.time} onChange={(v) => setDraft({ ...draft, time: v })} options={RUN_TIMES.map((t) => ({ value: t, label: t }))} />
        </div>
        <div>
          <p className="mb-2 text-[13px] font-medium text-ink">Send to the supplier without approval up to</p>
          <Segmented label="Limit" value={String(draft.sendUnder)} onChange={(v) => setDraft({ ...draft, sendUnder: Number(v) })} options={SEND_LIMITS.map((n) => ({ value: String(n), label: money(n) }))} />
          <p className="mt-2 text-xs text-steel">Per order. Anything above, or with an item that needs a manager&rsquo;s review, goes to purchasing as usual.</p>
        </div>
        <div>
          <p className="mb-2 text-[13px] font-medium text-ink">Never order automatically</p>
          {draft.never.length === 0 ? <p className="text-sm text-steel">Every item can be ordered automatically.</p> : (
            <ul className="flex flex-wrap gap-2">
              {draft.never.map((g) => (
                <li key={g}><button type="button" onClick={() => setDraft({ ...draft, never: draft.never.filter((x) => x !== g) })} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line px-3 text-[13px] text-ink hover:bg-cloud" aria-label={`Remove ${ingredientById[g].name}`}>{ingredientById[g].name}<X size={13} aria-hidden /></button></li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex gap-2">
            <label className="sr-only" htmlFor="auto-never">Add an item</label>
            <select id="auto-never" value={adding} onChange={(e) => setAdding(e.target.value)} className="h-10 min-w-0 flex-1 rounded-full border border-line bg-paper px-3 text-sm text-ink">
              <option value="">Add an item to order by hand</option>
              {choices.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <Button disabled={!adding} onClick={() => { setDraft({ ...draft, never: [...draft.never, adding] }); setAdding(""); }}>Add</Button>
          </div>
        </div>
        <Button variant="primary" className="w-full" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save the rules"}</Button>
        <Note>Only the F&amp;B director, purchasing and the general manager can change these rules. Each change is saved with who made it.</Note>
      </div>
    </Drawer>
  );
}

export function AutoOrdering() {
  const { propertyId } = useAlertFeed();
  const { data, error } = useAutoOrder(propertyId);
  const [editing, setEditing] = useState(false);
  const auto = data?.auto;
  const money = (n: number) => fmtMoney(n, propertyById[propertyId ?? "lis"].currency);
  const orders = auto?.orders ?? [];
  const sent = orders.filter((r) => r.auto?.decision === "sent");
  const held = orders.filter((r) => r.auto?.decision === "held");
  const s = auto?.settings;
  const run = auto?.run;

  return (
    <div className="space-y-6">
      <PageHeader title="Automatic ordering" question="What did Tyll order for me this morning?" lead={`Every morning${s ? ` at ${s.time}` : ""} Tyll orders what the prediction says must be ordered today or tomorrow, one order per supplier. Small orders go straight to the supplier; the rest wait for approval. Simulated data: nothing is sent to a supplier.`}>
        {s && <Badge tone={s.on ? "pos" : "neutral"}>{s.on ? "On" : "Off"}</Badge>}
      </PageHeader>
      {error ? <WidgetError>Automatic ordering could not load.</WidgetError> : !auto || !s ? (
        <div className="space-y-4" aria-busy><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div>
      ) : (
        <>
          <SummaryBar
            items={[
              { label: "Ordered this morning", value: money(sum(orders, total)), tone: "money", compare: { text: run ? `${orders.length} ${orders.length === 1 ? "order" : "orders"} at ${run.time}` : s.on ? "Not run yet" : "Automatic ordering is off", good: null }, onClick: () => document.getElementById("auto-orders")?.scrollIntoView({ block: "start", behavior: "smooth" }) },
              { label: "Sent to suppliers", value: sent.length, tone: sent.length ? "pos" : undefined, compare: { text: sent.length ? `${money(sum(sent, total))}, no one had to approve` : "None sent without approval", good: sent.length ? true : null }, onClick: () => document.getElementById("auto-orders")?.scrollIntoView({ block: "start", behavior: "smooth" }) },
              { label: "Waiting for approval", value: held.length, tone: held.length ? "warn" : undefined, compare: { text: held.length ? `${money(sum(held, total))} with purchasing` : "Nothing waiting", good: null }, href: held.length === 1 ? `/forecast?tab=approvals&request=${held[0].id}` : "/forecast?tab=approvals&queue=purchasing" },
              { label: "Next run", value: s.on ? `${when(auto.next.date) === "tomorrow" ? "Tomorrow" : fmtDate(auto.next.date, true)}, ${s.time}` : "Off", compare: { text: s.on ? (auto.next.items ? `${auto.next.items} ${auto.next.items === 1 ? "item" : "items"} due, about ${money(auto.next.value)}` : "Nothing due yet on today's prediction") : "Turn it on to order each morning", good: null } },
            ]}
            action={auto.mayChange ? <Button variant="primary" onClick={() => setEditing(true)}>Change the rules</Button> : undefined}
          />

          <section id="auto-orders" className="scroll-mt-24">
            <Panel title={run ? `This morning's orders, ${fmtDate(run.date)} at ${run.time}` : "This morning's orders"} description={run ? "One order per supplier, at the quantities on Predictions." : undefined} flush>
              {!s.on && !run ? (
                <div className="p-6"><EmptyState title="Automatic ordering is off" action={auto.mayChange ? <Button onClick={() => setEditing(true)}>Turn it on</Button> : undefined}>Orders are built by hand on Predictions until it is turned on.</EmptyState></div>
              ) : orders.length === 0 ? (
                <div className="p-6"><EmptyState title="Nothing had to be ordered today">Stock and deliveries already on the way cover what the prediction needs. The next run checks again.</EmptyState></div>
              ) : (
                <ul>{orders.map((r) => <OrderRow key={r.id} r={r} money={money} />)}</ul>
              )}
              {run && run.skipped.length > 0 && (
                <p className="border-t border-hair px-5 py-3 text-[13px] text-graphite sm:px-6"><span className="font-medium text-ink">Left for you to order by hand: </span>{run.skipped.map((x) => ingredientById[x.ingredientId].name).join(", ")}. They are on the list of items never ordered automatically.</p>
              )}
            </Panel>
          </section>

          <Panel title="The rules" description={`Set by ${personName(s.changedBy)}. The same rules every morning, written out so anyone can check them.`}>
            <dl>
              <Rule label="When">Every morning at {s.time}, after last night&rsquo;s sales, today&rsquo;s bookings and events are in.</Rule>
              <Rule label="What is ordered">Items whose order date on Predictions is today or tomorrow, at the quantity Predictions shows, from the usual supplier. One order per supplier.</Rule>
              <Rule label="Sent without approval">Orders of {money(s.sendUnder)} or less where no item needs a manager&rsquo;s review.</Rule>
              <Rule label="Waits for approval">Orders over {money(s.sendUnder)}, or with an item that is more than 1.5 times its last 4 weeks of use, a fresh item that covers more days than it keeps, or a month with low forecast confidence. These go to purchasing like any other order.</Rule>
              <Rule label="Never ordered automatically">{s.never.length ? s.never.map((g) => ingredientById[g].name).join(", ") : "None"}</Rule>
              <Rule label="Who is told">Purchasing, for each order that waits. The storekeeper, for each delivery on its way.</Rule>
            </dl>
          </Panel>
          {s && propertyId && <RulesDrawer key={`${editing}`} open={editing} onClose={() => setEditing(false)} settings={s} propertyId={propertyId} />}
        </>
      )}
    </div>
  );
}
