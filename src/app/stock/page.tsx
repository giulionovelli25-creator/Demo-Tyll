"use client";
import { Boxes, ClipboardCheck, PackageX, ScrollText, Trash2, TrendingDown } from "lucide-react";
import { useState } from "react";
import { Counts } from "@/components/stock/counts";
import { Inventory } from "@/components/stock/inventory";
import { Recipes } from "@/components/stock/recipes";
import { Suppliers } from "@/components/stock/suppliers";
import { WasteAnalytics } from "@/components/stock/waste-analytics";
import { WasteLogger } from "@/components/stock/waste-logger";
import { ModuleHub, useSection } from "@/components/module-hub";
import { Badge, Crumbs, PageHeader, Segmented, Tabs } from "@/components/ui";
import { propertyById } from "@/lib/data/catalog";
import { allowedProperties } from "@/lib/domain/access";
import { useView } from "@/lib/hooks";

type Tab = "inventory" | "recipes" | "log" | "counts" | "suppliers" | "waste";

const TABS: { value: Tab; label: string }[] = [
  { value: "inventory", label: "Inventory" },
  { value: "recipes", label: "Recipes and prices" },
  { value: "log", label: "Log waste or breakage" },
  { value: "counts", label: "Stock counts" },
  { value: "suppliers", label: "Suppliers" },
  { value: "waste", label: "Waste and breakage" },
];

export default function StockPage() {
  const { user, propertyId } = useView();
  const employee = user.role === "employee";
  const tabs = employee ? TABS.filter((t) => t.value === "log" || t.value === "counts") : TABS;
  // Managers start from a short list of choices. A link that names a section goes straight to it.
  const [tab, setTab] = useSection<Tab>("/stock", tabs.map((t) => t.value), employee ? "log" : null);
  const props = allowedProperties(user);
  const [picked, setPicked] = useState(props[0]);
  // Stock is held per hotel. In a group view the user chooses which hotel's store to look at.
  const pid = propertyId ?? picked;
  const needsProperty = tab !== "recipes" && tab !== "waste";

  return (
    <div className="space-y-5">
      <PageHeader
        title={tab ? TABS.find((t) => t.value === tab)!.label : "Tyll Stock"}
        lead={tab ? undefined : "What do you want to do?"}
        crumbs={tab && !employee ? <Crumbs items={[{ label: "Tyll Stock", onClick: () => setTab(null) }, { label: TABS.find((t) => t.value === tab)!.label }]} /> : undefined}
      >
        {tab && needsProperty && (propertyId || props.length === 1 ? <Badge>{propertyById[pid].name}</Badge> : (
          <Segmented label="Hotel" value={picked} onChange={setPicked} options={props.map((p) => ({ value: p, label: propertyById[p].name }))} />
        ))}
      </PageHeader>
      {tab === null && (
        <ModuleHub
          onPick={setTab}
          choices={[
            { value: "inventory", title: "Inventory", detail: "What is on the shelf now, and what is running low.", icon: Boxes },
            { value: "waste", title: "Waste and breakage", detail: "What was thrown away or broken, and what it cost.", icon: TrendingDown },
            { value: "log", title: "Log waste or breakage", detail: "Record an item in three taps.", icon: Trash2 },
            { value: "counts", title: "Stock counts", detail: "Count items and see what is missing.", icon: ClipboardCheck },
            { value: "recipes", title: "Recipes and prices", detail: "Ingredient costs and the margin of each dish.", icon: ScrollText },
            { value: "suppliers", title: "Suppliers", detail: "Orders, deliveries and invoice differences.", icon: PackageX },
          ]}
        />
      )}
      {tab !== null && <Tabs value={tab} onChange={setTab} tabs={tabs} />}
      {tab === "inventory" && <Inventory propertyId={pid} />}
      {tab === "recipes" && <Recipes />}
      {tab === "log" && <WasteLogger key={pid} propertyId={pid} />}
      {tab === "counts" && <Counts propertyId={pid} />}
      {tab === "suppliers" && <Suppliers propertyId={pid} />}
      {tab === "waste" && <WasteAnalytics />}
    </div>
  );
}
