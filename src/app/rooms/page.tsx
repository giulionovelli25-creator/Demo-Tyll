"use client";
import { BedDouble, ConciergeBell, Gauge, Luggage, MessageSquareText, Sparkles, UtensilsCrossed } from "lucide-react";
import type { ReactNode } from "react";
import { BellLuggage } from "@/components/guest/bell";
import { HousekeepingBoard, RoomReadiness } from "@/components/guest/rooms";
import { GuestConnect, GuestRequests, ServicePerformance, SuppliesPanel, TableRequests } from "@/components/guest/service";
import { HELP } from "@/components/help";
import { ModuleHub, useSection } from "@/components/module-hub";
import { StockAlert } from "@/components/overview/stock-alert";
import { Crumbs, PageHeader, Tabs } from "@/components/ui";
import { useView } from "@/lib/hooks";
import { roomsTabs, type RoomsTab as Tab } from "@/components/guest/tabs";

const LABEL: Record<Tab, string> = {
  readiness: "Room readiness", housekeeping: "Housekeeping", requests: "Guest requests", connect: "Guest Connect", tables: "Table requests", bell: "Bell & luggage", service: "Service performance",
};

const DETAIL: Record<Tab, { detail: string; icon: typeof BedDouble }> = {
  readiness: { detail: "Which arriving guests' rooms are ready, late or need attention.", icon: BedDouble },
  housekeeping: { detail: "Assign rooms, follow progress and inspect.", icon: Sparkles },
  requests: { detail: "Create and follow guest requests such as taxis and assistance.", icon: MessageSquareText },
  connect: { detail: "Find a restaurant, lounge, spa or activity in the hotel and ask for a table or slot.", icon: ConciergeBell },
  tables: { detail: "Requests from the front desk and concierge for your outlet.", icon: UtensilsCrossed },
  bell: { detail: "Request luggage help and follow it to the room.", icon: Luggage },
  service: { detail: "Rooms ready on time, requests within target, response times.", icon: Gauge },
};

const ROOM_HELP: Record<Tab, string> = { readiness: HELP.readiness, housekeeping: HELP.housekeeping, requests: "Guest requests such as taxis or help in the room. A request shows as confirmed only when the outside confirmation is recorded.", connect: HELP.guestConnect, tables: HELP.tables, bell: HELP.bell, service: HELP.service };

const SECTIONS: Partial<Record<Tab, () => ReactNode>> = {
  readiness: () => <RoomReadiness />,
  housekeeping: () => <div className="space-y-5"><HousekeepingBoard /><SuppliesPanel /></div>,
  requests: () => <GuestRequests />,
  connect: () => <GuestConnect />,
  tables: () => <TableRequests />,
  service: () => <ServicePerformance />,
  bell: () => <BellLuggage />,
};

export default function RoomsPage() {
  const { user } = useView();
  const tabs = roomsTabs(user);
  const [tab, setTab] = useSection<Tab>("/rooms", tabs, tabs.length === 1 ? tabs[0] : null);
  return (
    <div className="space-y-5">
      <PageHeader
        title={tab ? LABEL[tab] : "Rooms & Guests"}
        lead={tab ? undefined : "What do you want to do?"}
        crumbs={tab && tabs.length > 1 ? <Crumbs items={[{ label: "Rooms & Guests", onClick: () => setTab(null) }, { label: LABEL[tab] }]} /> : undefined}
      />
      {tab === null && <StockAlert />}
      {tab === null && <ModuleHub onPick={setTab} choices={tabs.map((t) => ({ value: t, title: LABEL[t], ...DETAIL[t], help: ROOM_HELP[t] }))} />}
      {tab !== null && tabs.length > 1 && <Tabs value={tab} onChange={setTab} tabs={tabs.map((t) => ({ value: t, label: LABEL[t] }))} />}
      {tab && SECTIONS[tab]?.()}
    </div>
  );
}
