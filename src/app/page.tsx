"use client";
import { ManagerOverview } from "@/components/overview/manager";
import { OwnerOverview } from "@/components/overview/owner";
import { useView } from "@/lib/hooks";

/** Owners and directors see the big picture. An outlet manager sees what to do today. */
export default function OverviewPage() {
  const { user, sel } = useView();
  return user.role === "restaurant_manager" && sel.outletIds.length === 1 ? <ManagerOverview /> : <OwnerOverview />;
}
