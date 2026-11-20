"use client";
// Order now, from Stock levels, Alerts and the Overview: a critical or low item at the suggested quantity, from its usual
// supplier, sent to purchasing for approval. The person sees what will happen before anything is saved.
import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Drawer, Note, StatusPill, cn, toast } from "@/components/ui";
import { ingredientById, propertyById } from "@/lib/data/catalog";
import { can } from "@/lib/domain/access";
import { api } from "@/lib/api";
import { useSessionEntries, useView } from "@/lib/hooks";
import { usePlanDrafts } from "@/lib/plan-hooks";
import type { OrderNowOut, PlanItem } from "@/lib/server/purchasing";
import type { PurchaseRequest } from "@/lib/types";
import { fmtMoney, fmtQty } from "@/lib/util";

type Item = Pick<PlanItem, "ingredientId" | "health" | "nextQty" | "unit">;
type Preview = Omit<OrderNowOut, "request">;
type RowState = { step: "idle" } | { step: "loading" } | { step: "confirm"; p: Preview } | { step: "sending"; p: Preview } | { step: "done"; p: Preview; request: PurchaseRequest } | { step: "error"; error: string };

/** Items that can be ordered now: critical or low, with a quantity to order. */
export const orderable = (items: Item[]) => items.filter((i) => i.health !== "fine" && i.nextQty > 0);

/** Critical or low, but already covered by an open order: says so, and links to Orders. */
export function OnOrder({ item }: { item: Item & { incoming: number } }) {
  if (item.health === "fine" || item.nextQty > 0 || item.incoming <= 0) return null;
  return <Link href="/forecast?tab=approvals&queue=all" prefetch={false} className="shrink-0 whitespace-nowrap text-xs font-medium text-accent-ink underline-offset-4 hover:underline">On order</Link>;
}

/** The "Order now" button. One item opens straight on its confirmation; several open as a list, most urgent first. */
export function OrderNowButton({ items, propertyId, label = "Order now", size = "sm", variant = "secondary", className }: { items: Item[]; propertyId: string; label?: string; size?: "sm" | "md"; variant?: "primary" | "secondary"; className?: string }) {
  const { user } = useView();
  const [open, setOpen] = useState(false);
  // The list is kept as it was when the drawer opened: an ordered item leaves the plan's list, but stays here with its link.
  const [frozen, setFrozen] = useState<Item[]>([]);
  const current = orderable(items).sort((a, b) => Number(b.health === "critical") - Number(a.health === "critical"));
  const list = open ? frozen : current;
  if (!can(user, "purchase.create") || (!open && current.length === 0)) return null;
  return (
    <>
      {current.length > 0 && <Button size={size} variant={variant} className={className} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setFrozen(current); setOpen(true); }}>{label}</Button>}
      {open && createPortal(<Drawer open={open} onClose={() => setOpen(false)} title="Order now" description={list.length === 1 ? `${ingredientById[list[0].ingredientId].name}, from its usual supplier, at the suggested quantity.` : `${list.length} items, each from its usual supplier, at the suggested quantity. Each goes to purchasing for approval.`}>
        <ul className="space-y-3">
          {list.map((i) => <OrderNowRow key={i.ingredientId} item={i} propertyId={propertyId} auto={list.length === 1} onOpen={() => setOpen(false)} />)}
        </ul>
        <Note className="mt-4">Tyll suggests the quantity from the predicted use, what is in stock and what is already on order. No AI chooses a quantity. Nothing reaches a supplier before the order is approved, and in this demo nothing is sent to a real supplier.</Note>
      </Drawer>, document.body)}
    </>
  );
}

function OrderNowRow({ item, propertyId, auto, onOpen }: { item: Item; propertyId: string; auto: boolean; onOpen: () => void }) {
  const entries = useSessionEntries();
  const bump = usePlanDrafts((s) => s.bump);
  const [s, setS] = useState<RowState>(auto ? { step: "loading" } : { step: "idle" });
  const g = ingredientById[item.ingredientId];
  const money = (n: number) => fmtMoney(n, propertyById[propertyId].currency);
  const preview = () => { setS({ step: "loading" }); void load(); };
  const load = async () => {
    try {
      const p = await api<Preview>("/api/plan/month", { method: "POST", body: { action: "order-now-preview", propertyId, ingredientId: item.ingredientId, ...entries } });
      setS({ step: "confirm", p });
    } catch (e) { setS({ step: "error", error: e instanceof Error ? e.message : "Could not prepare the order." }); }
  };
  const send = async (p: Preview) => {
    setS({ step: "sending", p });
    try {
      const out = await api<OrderNowOut>("/api/plan/month", { method: "POST", body: { action: "order-now", propertyId, ingredientId: item.ingredientId, ...entries } });
      setS({ step: "done", p, request: out.request! });
      toast.done(`Sent for approval: ${fmtQty(p.qty, p.unit)} ${g.name} from ${p.supplierName}.`);
      bump();
    } catch (e) { setS({ step: "error", error: e instanceof Error ? e.message : "Could not order." }); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (auto) void load(); }, []);
  return (
    <li className="rounded-[var(--radius-control)] border border-line p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-medium text-ink">{g.name}</p>
          <p className="mt-0.5 text-sm text-graphite">{s.step === "confirm" || s.step === "sending" || s.step === "done" ? `${fmtQty(s.p.qty, s.p.unit)} from ${s.p.supplierName}, ${money(s.p.value)} before VAT` : `Suggested: ${fmtQty(item.nextQty, item.unit)}`}</p>
        </div>
        <StatusPill rag={item.health === "critical" ? "red" : "amber"}>{item.health === "critical" ? "Critical" : "Low"}</StatusPill>
      </div>
      {s.step === "idle" && <Button size="sm" variant="primary" className="mt-3" onClick={preview}>Order now</Button>}
      {s.step === "loading" && <p className="mt-3 text-sm text-steel">Preparing the order.</p>}
      {(s.step === "confirm" || s.step === "sending") && (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-graphite">{s.p.draft ? `Joins your open draft for ${s.p.supplierName}, which has ${s.p.draft.otherItems} other ${s.p.draft.otherItems === 1 ? "item" : "items"}. The whole order then goes to purchasing for approval.` : `A new order to ${s.p.supplierName}. It goes to purchasing for approval, and is sent to the supplier once it is approved.`}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary" disabled={s.step === "sending"} onClick={() => send(s.p)}>{s.step === "sending" ? "Sending for approval" : "Send for approval"}</Button>
            <Button size="sm" variant="ghost" disabled={s.step === "sending"} onClick={() => setS({ step: "idle" })}>Cancel</Button>
          </div>
        </div>
      )}
      {s.step === "done" && (
        <p className="mt-3 text-sm text-pos">
          Sent for approval as {s.request.id}. <Link href={`/forecast?tab=approvals&request=${s.request.id}`} prefetch={false} onClick={onOpen} className={cn("font-medium text-accent-ink underline underline-offset-4")}>Open the order</Link>
        </p>
      )}
      {s.step === "error" && <p className="mt-3 text-sm text-neg" role="alert">{s.error}</p>}
    </li>
  );
}
