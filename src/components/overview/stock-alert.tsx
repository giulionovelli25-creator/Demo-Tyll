"use client";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui";
import { outletById } from "@/lib/data/catalog";
import { can } from "@/lib/domain/access";
import { exceptionInSel } from "@/lib/domain/metrics";
import { plainName } from "@/lib/domain/variance";
import { useInvestigations, useView } from "@/lib/hooks";
import { useDemo } from "@/lib/store";

/** One short notice for the most important open stock case, until the user opens it or closes the notice. */
export function StockAlert() {
  const router = useRouter();
  const { user, sel } = useView();
  const cases = useInvestigations();
  const dismissed = useDemo((s) => s.dismissedAlerts);
  const dismiss = useDemo((s) => s.dismissAlert);
  if (!can(user, "investigation.assign")) return null;
  // New cases first, since assigned ones already have someone on them, then the largest amount.
  const top = cases
    .filter((c) => c.type === "usage_variance" && c.status !== "closed" && c.exposure > 0 && exceptionInSel(c, sel) && !dismissed.includes(c.id))
    .sort((a, b) => Number(b.status === "new") - Number(a.status === "new") || b.exposure - a.exposure)[0];
  if (!top || !top.ingredientId || !top.outletId) return null;
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-2xl border border-warn/25 bg-warn-soft px-5 py-4">
      <div className="min-w-[220px] flex-1">
        <p className="text-sm font-medium text-ink">Tyll needs your attention</p>
        <p className="mt-0.5 text-sm text-graphite">Unexplained {plainName(top.ingredientId)} usage detected at {outletById[top.outletId].name}.</p>
      </div>
      <Button variant="primary" size="sm" onClick={() => { dismiss(top.id); router.push(`/investigations/${top.id}`); }}>Investigate</Button>
      <button type="button" aria-label="Close this notice" onClick={() => dismiss(top.id)} className="rounded-full p-1.5 text-steel hover:bg-paper hover:text-ink"><X size={16} /></button>
    </div>
  );
}
