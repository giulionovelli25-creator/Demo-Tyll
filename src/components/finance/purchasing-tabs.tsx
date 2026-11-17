"use client";
// Deliveries and invoices is one sidebar item with four parts: the three way check of each delivery, then the finance views of the same invoices.
import { PageTabs } from "@/components/ui";
import { can, canOpen } from "@/lib/domain/access";
import { useSession } from "@/lib/api";
import { useView } from "@/lib/hooks";

export type PurchasingPart = "deliveries" | "invoices" | "approvals" | "reports";

export function PurchasingTabs({ here }: { here: PurchasingPart }) {
  const { user } = useView();
  const publicDemo = useSession((s) => !!s.demoRoles);
  // In the public demo a part opens as a role that can use it; otherwise only what this role may do.
  const may = (p: PurchasingPart) => publicDemo || (p === "deliveries" ? canOpen(user, "stock") : can(user, "finance.review"));
  const parts: { id: PurchasingPart; href: string; label: string }[] = [
    { id: "deliveries", href: "/stock?tab=suppliers", label: "Deliveries checked" },
    { id: "invoices", href: "/finance?tab=invoices", label: "Invoice approval" },
    // Order approvals and budgets belong to the hotel's accounting system; they stay reachable from the finance page but are not part of this item.
  ];
  const shown = parts.filter((p) => may(p.id));
  if (shown.length < 2) return null;
  return <PageTabs tabs={shown.map((p) => ({ href: p.href, label: p.label, active: p.id === here }))} />;
}
