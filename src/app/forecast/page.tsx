"use client";
import { ClipboardList, ShoppingCart, Stamp } from "lucide-react";
import { Approvals } from "@/components/forecast/approvals";
import { WhatToBuy } from "@/components/forecast/buy";
import { WhatToPrep } from "@/components/forecast/prep";
import { ModuleHub, useSection } from "@/components/module-hub";
import { StockAlert } from "@/components/overview/stock-alert";
import { Crumbs, PageHeader, Tabs } from "@/components/ui";
import { can } from "@/lib/domain/access";
import { useView } from "@/lib/hooks";

type Tab = "buy" | "prep" | "approvals";

const LABEL: Record<Tab, string> = { buy: "What to buy", prep: "What to prep", approvals: "Approvals" };

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

  return (
    <div className="space-y-5">
      <PageHeader
        title={tab ? LABEL[tab] : "Tyll Forecast"}
        lead={tab ? undefined : "What do you want to do?"}
        crumbs={tab ? <Crumbs items={[{ label: "Tyll Forecast", onClick: () => setTab(null) }, { label: LABEL[tab] }]} /> : undefined}
      />
      {tab === null && <StockAlert />}
      {tab === null && (
        <ModuleHub
          onPick={setTab}
          choices={[
            ...(tabs.includes("buy") ? [{ value: "buy" as Tab, title: "What to buy", detail: "Work out ingredient needs and create a purchase request.", icon: ShoppingCart }] : []),
            ...(tabs.includes("prep") ? [{ value: "prep" as Tab, title: "What to prep", detail: "How many portions the kitchen should prepare.", icon: ClipboardList }] : []),
            { value: "approvals" as Tab, title: "Approvals", detail: "Review and approve purchase requests.", icon: Stamp },
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
