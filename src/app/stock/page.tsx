"use client";
import { useSearchParams } from "next/navigation";
import { Boxes, ClipboardCheck, PackageX, ScrollText, SearchCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import { Counts } from "@/components/stock/counts";
import { Inventory } from "@/components/stock/inventory";
import { Recipes } from "@/components/stock/recipes";
import { Suppliers } from "@/components/stock/suppliers";
import { WasteAnalytics } from "@/components/stock/waste-analytics";
import { WasteLogger } from "@/components/stock/waste-logger";
import { WhereDidItGo } from "@/components/stock/where";
import { HELP } from "@/components/help";
import { ModuleHub, useSection } from "@/components/module-hub";
import { Badge, Crumbs, PageHeader, Segmented, Tabs } from "@/components/ui";
import { ingredientById, propertyById } from "@/lib/data/catalog";
import { allowedProperties, canOpen } from "@/lib/domain/access";
import { useView } from "@/lib/hooks";

// "log" and "waste" are the two halves of Waste and breakage: recording an item, and reviewing what was recorded.
type Tab = "inventory" | "where" | "waste" | "log" | "counts" | "recipes" | "suppliers";

const TABS: { value: Tab; label: string }[] = [
  { value: "inventory", label: "Check inventory" },
  { value: "where", label: "Where did it go?" },
  { value: "waste", label: "Waste and breakage" },
  { value: "counts", label: "Stock counts" },
  { value: "recipes", label: "Recipes and costs" },
  { value: "suppliers", label: "Suppliers" },
];

/** A period id carries its item: UP-<outlet code>-<ingredient>-<date>-<time>. */
const crumbFor = (periodId: string) => {
  const g = ingredientById[periodId.split("-")[2] ?? ""];
  return g ? g.name : "Item";
};

export default function StockPage() {
  const { user, propertyId } = useView();
  const params = useSearchParams();
  const employee = user.role === "employee";
  const tabs: { value: Tab; label: string }[] = employee
    ? [{ value: "log", label: "Log waste or breakage" }, { value: "counts", label: "Stock counts" }]
    : TABS.filter((t) => t.value !== "where" || canOpen(user, "investigations"));
  const valid: Tab[] = employee ? ["log", "counts"] : [...tabs.map((t) => t.value), "log"];
  // Managers start from a short list of choices. A link that names a section goes straight to it.
  const [tab, setTab] = useSection<Tab>("/stock", valid, employee ? "log" : null);
  const props = allowedProperties(user);
  const [picked, setPicked] = useState(props[0]);
  // Stock is held per hotel. In a group view the user chooses which hotel's store to look at.
  const pid = propertyId ?? picked;
  const needsProperty = tab !== "recipes" && tab !== "waste";
  const shown: Tab | null = !employee && tab === "log" ? "waste" : tab;
  const label = tabs.find((t) => t.value === shown)?.label ?? "Tyll Stock";
  const inDetail = tab === "where" && params.get("period");

  return (
    <div className="space-y-5">
      <PageHeader
        title={tab ? label : "Tyll Stock"}
        lead={tab ? undefined : "What do you want to do?"}
        crumbs={tab && !employee ? <Crumbs items={[{ label: "Tyll Stock", onClick: () => setTab(null) }, { label, onClick: inDetail ? () => setTab("where") : undefined }, ...(inDetail ? [{ label: crumbFor(params.get("period")!) }] : [])]} /> : undefined}
      >
        {tab && needsProperty && (propertyId || props.length === 1 ? <Badge>{propertyById[pid].name}</Badge> : (
          <Segmented label="Hotel" value={picked} onChange={setPicked} options={props.map((p) => ({ value: p, label: propertyById[p].name }))} />
        ))}
      </PageHeader>
      {tab === null && (
        <ModuleHub
          onPick={setTab}
          choices={[
            { value: "inventory", title: "Check inventory", detail: "Stock levels, and what is running low.", icon: Boxes },
            ...(canOpen(user, "investigations") ? [{ value: "where" as const, title: "Where did it go?", detail: "Missing stock and use that sales do not explain.", icon: SearchCheck, help: HELP.where }] : []),
            { value: "waste", title: "Waste and breakage", detail: "Record and review waste, breakage and spoilage.", icon: Trash2, help: HELP.waste },
            { value: "counts", title: "Stock counts", detail: "Enter what is actually on the shelf.", icon: ClipboardCheck, help: HELP.counts },
            { value: "recipes", title: "Recipes and costs", detail: "Ingredient use and the margin of each dish.", icon: ScrollText },
            { value: "suppliers", title: "Suppliers", detail: "Deliveries, and quantities that did not match.", icon: PackageX },
          ]}
        />
      )}
      {tab !== null && <Tabs value={shown!} onChange={setTab} tabs={tabs} />}
      {tab === "inventory" && <Inventory propertyId={pid} />}
      {tab === "where" && <WhereDidItGo key={pid} propertyId={pid} />}
      {(tab === "waste" || tab === "log") && !employee && (
        <Segmented label="Waste and breakage" value={tab} onChange={setTab} options={[{ value: "log" as Tab, label: "Log an item" }, { value: "waste" as Tab, label: "Review what was logged" }]} />
      )}
      {tab === "log" && <WasteLogger key={pid} propertyId={pid} />}
      {tab === "waste" && <WasteAnalytics />}
      {tab === "counts" && <Counts propertyId={pid} />}
      {tab === "recipes" && <Recipes />}
      {tab === "suppliers" && <Suppliers propertyId={pid} />}
    </div>
  );
}
