"use client";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui";
import { outletById } from "@/lib/data/catalog";
import { can, canOpen } from "@/lib/domain/access";
import { exceptionInSel } from "@/lib/domain/metrics";
import { plainName } from "@/lib/domain/variance";
import { useInvestigations, useView } from "@/lib/hooks";
import { usePlanAlerts } from "@/lib/plan-hooks";
import { useDemo } from "@/lib/store";

interface Notice {
  id: string;
  text: string;
  href: string;
  action: string;
}

/**
 * One short notice at a time: the most important thing for this user, until they open it or close it.
 * Closed notices stay closed in this browser, so the same one does not keep coming back.
 */
export function StockAlert() {
  const router = useRouter();
  const { user, sel } = useView();
  const cases = useInvestigations();
  const dismissed = useDemo((s) => s.dismissedAlerts);
  const dismiss = useDemo((s) => s.dismissAlert);
  const { data } = usePlanAlerts(canOpen(user, "forecast"));

  const notices: Notice[] = [];
  // Approvals waiting for this person come first: someone else is waiting on them.
  const plan = data?.alerts ?? [];
  notices.push(...plan.filter((a) => /^(acc|buy|mgr|budget)-/.test(a.id)));
  if (can(user, "investigation.assign")) {
    // New stock cases before assigned ones, then the largest amount.
    const top = cases
      .filter((c) => c.type === "usage_variance" && c.status !== "closed" && c.exposure > 0 && exceptionInSel(c, sel))
      .sort((a, b) => Number(b.status === "new") - Number(a.status === "new") || b.exposure - a.exposure)
      .find((c) => !dismissed.includes(c.id));
    if (top?.ingredientId && top.outletId) notices.push({ id: top.id, text: `Unexplained ${plainName(top.ingredientId)} usage detected at ${outletById[top.outletId].name}.`, href: `/investigations/${top.id}`, action: "Investigate" });
  }
  notices.push(...plan.filter((a) => !/^(acc|buy|mgr|budget)-/.test(a.id)));
  const top = notices.find((n) => !dismissed.includes(n.id));
  if (!top) return null;
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-2xl border border-warn/25 bg-warn-soft px-5 py-4">
      <div className="min-w-[220px] flex-1">
        <p className="text-sm font-medium text-ink">Tyll needs your attention</p>
        <p className="mt-0.5 text-sm text-graphite">{top.text}</p>
      </div>
      <Button variant="primary" size="sm" onClick={() => { dismiss(top.id); router.push(top.href); }}>{top.action}</Button>
      <button type="button" aria-label="Close this notice" onClick={() => dismiss(top.id)} className="rounded-full p-1.5 text-steel hover:bg-paper hover:text-ink"><X size={16} /></button>
    </div>
  );
}
