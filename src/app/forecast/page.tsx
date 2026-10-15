"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { ClipboardList, Inbox, ShoppingCart, Stamp, Truck } from "lucide-react";
import { useLiveGet } from "@/lib/guest-hooks";
import type { PurchaseRequest } from "@/lib/types";
import { Approvals } from "@/components/forecast/approvals";
import { WhatToBuy } from "@/components/forecast/buy";
import { WhatToPrep } from "@/components/forecast/prep";
import { HELP } from "@/components/help";
import { ModuleHub, useSection } from "@/components/module-hub";
import { StockAlert } from "@/components/overview/stock-alert";
import { Crumbs, PageHeader, Tabs } from "@/components/ui";
import { can } from "@/lib/domain/access";
import { useView } from "@/lib/hooks";

type Tab = "buy" | "prep" | "approvals";

const LABEL: Record<Tab, string> = { buy: "Order stock", prep: "What to prep", approvals: "Purchase requests" };

/** Three questions: what do we need to buy, what do we need to prepare, and who needs to approve it. */
export default function ForecastPage() {
  const { user } = useView();
  const tabs = ([
    // What to buy plans for outlets; departments raise their requests from their own screens.
    can(user, "purchase.create") && (user.outletIds === "all" || user.outletIds.length > 0 || can(user, "events.plan")) && "buy",
    (can(user, "prep.plan") || can(user, "prep.complete")) && "prep",
    "approvals",
  ].filter(Boolean) as Tab[]);
  const [tab, setTab] = useSection<Tab>("/forecast", tabs, null);
  const router = useRouter();
  const fromStock = useSearchParams().get("from") === "stock";
  const purchasing = can(user, "purchase.review");
  const home = purchasing ? "Purchasing" : user.role === "chef" ? "Kitchen planning" : "Tyll Forecast";
  const { data } = useLiveGet<{ requests: PurchaseRequest[] }>(purchasing ? "/api/purchasing" : null);
  const count = (f: (r: PurchaseRequest) => boolean) => { const n = (data?.requests ?? []).filter(f).length; return n ? String(n) : undefined; };

  return (
    <div className="space-y-5">
      <PageHeader
        title={tab ? LABEL[tab] : home}
        lead={tab ? undefined : "What do you want to do?"}
        crumbs={tab ? <Crumbs items={fromStock && tab === "buy" ? [{ label: "Tyll Stock", onClick: () => router.push("/stock") }, { label: LABEL[tab] }] : [{ label: home, onClick: () => setTab(null) }, { label: LABEL[tab] }]} /> : undefined}
      />
      {tab === null && <StockAlert where="forecast" />}
      {tab === null && (
        <ModuleHub
          onPick={(v) => (v.startsWith("q:") ? router.push(`/forecast?tab=approvals&queue=${v.slice(2)}`) : setTab(v as Tab))}
          choices={purchasing ? [
            { value: "q:purchasing", title: "Requests to review", detail: "Purchase requests from departments waiting for you.", icon: Inbox, badge: count((r) => r.status === "purchasing"), help: HELP.approvals },
            { value: "q:approved", title: "Purchase orders", detail: "Approved orders and where each one is.", icon: Stamp, badge: count((r) => r.status === "approved" || r.status === "received") },
            { value: "q:delivery", title: "Deliveries", detail: "Orders waiting to be delivered and received.", icon: Truck, badge: count((r) => r.status === "approved") },
          ] : [
            ...(tabs.includes("buy") ? [{ value: "buy", title: "Order stock", detail: "Check what you need and send a request to Purchasing.", icon: ShoppingCart, help: HELP.buy }] : []),
            ...(tabs.includes("prep") ? [{ value: "prep", title: "What to prep", detail: "How many portions the kitchen should prepare.", icon: ClipboardList, help: HELP.prep }] : []),
            { value: "approvals", title: can(user, "purchase.review") || can(user, "purchase.approveFinance") || can(user, "purchase.approveManager") ? "Approvals" : "My requests", detail: can(user, "purchase.approveManager") || can(user, "purchase.approveFinance") ? "Review and approve purchase requests." : "Track requests you sent to Purchasing.", icon: Stamp, help: HELP.approvals },
          ]}
        />
      )}
      {tab !== null && tabs.length > 1 && <Tabs value={tab} onChange={setTab} tabs={tabs.map((t) => ({ value: t, label: LABEL[t] }))} />}
      {tab === "buy" && <WhatToBuy />}
      {tab === "prep" && <WhatToPrep />}
      {tab === "approvals" && <Approvals />}
    </div>
  );
}
