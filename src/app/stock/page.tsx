"use client";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Counts } from "@/components/stock/counts";
import { Inventory } from "@/components/stock/inventory";
import { Recipes } from "@/components/stock/recipes";
import { Suppliers } from "@/components/stock/suppliers";
import { WasteAnalytics } from "@/components/stock/waste-analytics";
import { WasteLogger } from "@/components/stock/waste-logger";
import { Badge, PageHeader, Segmented, Tabs } from "@/components/ui";
import { propertyById } from "@/lib/data/catalog";
import { allowedProperties } from "@/lib/domain/access";
import { useView } from "@/lib/hooks";

type Tab = "inventory" | "recipes" | "log" | "counts" | "suppliers" | "waste";

const TABS: { value: Tab; label: string }[] = [
  { value: "inventory", label: "Inventory" },
  { value: "recipes", label: "Recipes and prices" },
  { value: "log", label: "Log waste" },
  { value: "counts", label: "Stock counts" },
  { value: "suppliers", label: "Suppliers" },
  { value: "waste", label: "Waste analytics" },
];

export default function StockPage() {
  const params = useSearchParams();
  const { user, propertyId } = useView();
  const employee = user.role === "employee";
  const tabs = employee ? TABS.filter((t) => t.value === "log" || t.value === "counts") : TABS;
  const requested = params.get("tab") as Tab | null;
  const [tab, setTab] = useState<Tab>(requested && tabs.some((t) => t.value === requested) ? requested : employee ? "log" : "inventory");
  const props = allowedProperties(user);
  const [picked, setPicked] = useState(props[0]);
  // Stock is held per hotel. In a group view the user chooses which hotel's store to look at.
  const pid = propertyId ?? picked;
  const needsProperty = tab !== "recipes" && tab !== "waste";

  return (
    <div className="space-y-5">
      <PageHeader title="Tyll Stock" lead="Everything that leaves the shelf was sold, or has a reason. Recipes say what should have been used. Counts say what is there. The gap is shown in money.">
        {needsProperty && (propertyId || props.length === 1 ? <Badge>{propertyById[pid].name}</Badge> : (
          <Segmented label="Hotel" value={picked} onChange={setPicked} options={props.map((p) => ({ value: p, label: propertyById[p].name }))} />
        ))}
      </PageHeader>
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === "inventory" && <Inventory propertyId={pid} />}
      {tab === "recipes" && <Recipes />}
      {tab === "log" && <WasteLogger key={pid} propertyId={pid} />}
      {tab === "counts" && <Counts propertyId={pid} />}
      {tab === "suppliers" && <Suppliers propertyId={pid} />}
      {tab === "waste" && <WasteAnalytics />}
    </div>
  );
}
