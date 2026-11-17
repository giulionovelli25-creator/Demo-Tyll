"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Counts } from "@/components/stock/counts";
import { Inventory } from "@/components/stock/inventory";
import { Recipes } from "@/components/stock/recipes";
import { StockPage } from "@/components/stock/stock-page";
import { Suppliers } from "@/components/stock/suppliers";
import { WasteLogger } from "@/components/stock/waste-logger";
import { WhereDidItGo } from "@/components/stock/where";
import { useSection } from "@/components/module-hub";
import { PageHeader, Segmented, Tabs } from "@/components/ui";
import { propertyById } from "@/lib/data/catalog";
import { PurchasingTabs } from "@/components/finance/purchasing-tabs";

import { allowedProperties, canOpen } from "@/lib/domain/access";
import { useView } from "@/lib/hooks";

type Tab = "inventory" | "where" | "counts" | "recipes" | "suppliers" | "log";

const QUESTION: Partial<Record<Tab, string>> = { where: "What went missing between counts?", counts: "What did each count find?", suppliers: "Did we get, and pay for, what we ordered?", inventory: "What happened to each item?", recipes: "What does each dish cost to make?" };
const LABEL: Record<Tab, string> = { inventory: "Item history", where: "Counts and missing stock", counts: "Counts and missing stock", recipes: "Recipes and costs", suppliers: "Deliveries and invoices", log: "Log waste or breakage" };

/** Stock is one full page. The older detail screens stay reachable from the links at its foot, and by their old addresses. */
export default function StockRoute() {
  const { user, propertyId } = useView();
  const params = useSearchParams();
  const router = useRouter();
  const employee = user.role === "employee";
  const valid: Tab[] = employee ? ["log", "counts"] : (["inventory", "where", "counts", "recipes", "suppliers"] as Tab[]).filter((t) => t !== "where" || canOpen(user, "investigations"));
  const [tab, setTab] = useSection<Tab>("/stock", valid, employee ? "log" : null);
  const props = allowedProperties(user);
  const [picked, setPicked] = useState(props[0]);
  // Stock is held per hotel. In a group view the user chooses which hotel's store to look at.
  const pid = propertyId ?? picked;
  // Old links to waste now live on their own page.
  const raw = params.get("tab");
  useEffect(() => {
    if (!employee && (raw === "waste" || raw === "log")) router.replace("/waste");
  }, [employee, raw, router]);

  if (tab === null) return <StockPage />;
  const label = LABEL[tab];
  // Header, then the numbers, then the parts of the page: the same order as every other page.
  const countTabs = valid.includes("where") ? <Tabs value={tab} onChange={setTab} tabs={[{ value: "where", label: "Missing stock" }, { value: "counts", label: "Count records" }]} /> : null;
  return (
    <div className="space-y-6">
      <PageHeader
        title={label}
        question={QUESTION[tab]}
        lead={tab === "recipes" ? undefined : "Simulated data."}
      >
        {tab !== "recipes" && (propertyId || props.length === 1 ? null : (
          <Segmented label="Hotel" value={picked} onChange={setPicked} options={props.map((p) => ({ value: p, label: propertyById[p].name }))} />
        ))}
      </PageHeader>
      {employee && <Tabs value={tab} onChange={setTab} tabs={[{ value: "log", label: LABEL.log }, { value: "counts", label: "Stock counts" }]} />}
      {!employee && tab === "counts" && countTabs}
      {tab === "inventory" && <Inventory propertyId={pid} />}
      {tab === "where" && <WhereDidItGo key={pid} propertyId={pid} tabs={countTabs} />}
      {tab === "log" && <WasteLogger key={pid} propertyId={pid} />}
      {tab === "counts" && <Counts propertyId={pid} />}
      {tab === "recipes" && <Recipes />}
      {tab === "suppliers" && <Suppliers propertyId={pid} tabs={employee ? null : <PurchasingTabs here="deliveries" />} />}
    </div>
  );
}

