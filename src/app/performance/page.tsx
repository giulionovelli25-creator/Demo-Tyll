"use client";
import { ManagerOverview } from "@/components/overview/manager";
import { OwnerOverview } from "@/components/overview/owner";
import { useView } from "@/lib/hooks";

/** The full picture behind Home. Owners and directors see the group view; an outlet manager sees what to do today. */
export default function PerformancePage() {
  const { user, sel } = useView();
  return user.role === "restaurant_manager" && sel.outletIds.length === 1 ? <ManagerOverview /> : <OwnerOverview />;
}
