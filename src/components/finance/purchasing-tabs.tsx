"use client";
// Deliveries and invoices is one sidebar item with four parts: the three way check of each delivery, then the finance views of the same invoices.
import { PageTabs } from "@/components/ui";
import { can, canOpen } from "@/lib/domain/access";
import { useView } from "@/lib/hooks";

export type PurchasingPart = "deliveries" | "invoices" | "approvals" | "reports";

export function PurchasingTabs({ here }: { here: PurchasingPart }) {
  const { user } = useView();
  // Only what this role may do, in the public demo as well: the role never changes on its own.
  const may = (p: PurchasingPart) => (p === "deliveries" ? canOpen(user, "stock") : can(user, "finance.review"));
  const parts: { id: PurchasingPart; href: string; label: string }[] = [
    { id: "deliveries", href: "/deliveries", label: "Deliveries checked" },
    { id: "invoices", href: "/deliveries?tab=invoices", label: "Invoice approval" },
    // Order approvals and budgets belong to the hotel's accounting system; they stay reachable from the finance page but are not part of this item.
  ];
  const shown = parts.filter((p) => may(p.id));
  if (shown.length < 2) return null;
  return <PageTabs tabs={shown.map((p) => ({ href: p.href, label: p.label, active: p.id === here }))} />;
}
