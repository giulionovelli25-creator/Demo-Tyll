"use client";
import { BadgeCheck, CalendarPlus, CalendarRange, FileSignature, Target, Users } from "lucide-react";
import { MyEvents, PlanEvent } from "@/components/events/events";
import { StaffSupport } from "@/components/events/staff";
import { ConfirmedBusiness, Opportunities, Proposals } from "@/components/sales/sales";
import { ModuleHub, useSection } from "@/components/module-hub";
import { StockAlert } from "@/components/overview/stock-alert";
import { Crumbs, PageHeader, Tabs } from "@/components/ui";
import { can } from "@/lib/domain/access";
import { useView } from "@/lib/hooks";

type Tab = "opportunities" | "proposals" | "confirmed" | "plan" | "events" | "support";
const LABEL: Record<Tab, string> = { opportunities: "Opportunities", proposals: "Proposals", confirmed: "Confirmed business", plan: "Plan an event", events: "My events", support: "Staff support" };

/** Events and the people to run them. Each role sees only the choices it can act on. */
export default function EventsPage() {
  const { user } = useView();
  const selling = can(user, "sales.work") || can(user, "sales.approve");
  const tabs = ([
    selling && "opportunities",
    selling && "proposals",
    can(user, "sales.view") && "confirmed",
    can(user, "events.plan") && "plan",
    (can(user, "events.plan") || user.role === "chef") && "events",
    (can(user, "staff.request") || can(user, "staff.lend")) && "support",
  ].filter(Boolean) as Tab[]);
  const [tab, setTab] = useSection<Tab>("/events", tabs, null);
  return (
    <div className="space-y-5">
      <PageHeader
        title={tab ? LABEL[tab] : "Sales & Events"}
        lead={tab ? undefined : "What do you want to do?"}
        crumbs={tab ? <Crumbs items={[{ label: "Sales & Events", onClick: () => setTab(null) }, { label: LABEL[tab] }]} /> : undefined}
      />
      {tab === null && <StockAlert />}
      {tab === null && (
        <ModuleHub
          onPick={setTab}
          choices={[
            ...(tabs.includes("opportunities") ? [{ value: "opportunities" as Tab, title: "Opportunities", detail: "Potential business and sales enquiries.", icon: Target }] : []),
            ...(tabs.includes("proposals") ? [{ value: "proposals" as Tab, title: "Proposals", detail: "Quotes and offers for customers.", icon: FileSignature }] : []),
            ...(tabs.includes("confirmed") ? [{ value: "confirmed" as Tab, title: "Confirmed business", detail: "Confirmed deals, their events and sales performance.", icon: BadgeCheck }] : []),
            ...(tabs.includes("plan") ? [{ value: "plan" as Tab, title: "Plan an event", detail: "Create an event and work out food, stock and staff.", icon: CalendarPlus }] : []),
            ...(tabs.includes("events") ? [{ value: "events" as Tab, title: "My events", detail: "Open, change and follow up planned events.", icon: CalendarRange }] : []),
            ...(tabs.includes("support") ? [{ value: "support" as Tab, title: "Staff support", detail: "Ask for extra help, or answer other teams' requests.", icon: Users }] : []),
          ]}
        />
      )}
      {tab !== null && tabs.length > 1 && <Tabs value={tab} onChange={setTab} tabs={tabs.map((t) => ({ value: t, label: LABEL[t] }))} />}
      {tab === "opportunities" && <Opportunities />}
      {tab === "proposals" && <Proposals />}
      {tab === "confirmed" && <ConfirmedBusiness />}
      {tab === "plan" && <PlanEvent />}
      {tab === "events" && <MyEvents />}
      {tab === "support" && <StaffSupport />}
    </div>
  );
}
