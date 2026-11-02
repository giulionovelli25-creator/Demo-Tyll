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
import { Badge, Crumbs, PageHeader, Segmented, Tabs } from "@/components/ui";
import { ingredientById, propertyById } from "@/lib/data/catalog";
import { allowedProperties, canOpen } from "@/lib/domain/access";
import { useView } from "@/lib/hooks";

type Tab = "inventory" | "where" | "counts" | "recipes" | "suppliers" | "log";

const LABEL: Record<Tab, string> = { inventory: "Item history", where: "Where missing stock went", counts: "Count records", recipes: "Recipes and costs", suppliers: "Suppliers", log: "Log waste or breakage" };

/** A period id carries its item: UP-<outlet code>-<ingredient>-<date>-<time>. */
const crumbFor = (periodId: string) => {
  const g = ingredientById[periodId.split("-")[2] ?? ""];
  return g ? g.name : "Item";
};

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
  const inDetail = tab === "where" && params.get("period");
  // Old links to waste now live on their own page.
  const raw = params.get("tab");
  useEffect(() => {
    if (!employee && (raw === "waste" || raw === "log")) router.replace("/waste");
  }, [employee, raw, router]);

  if (tab === null) return <StockPage />;
  const label = LABEL[tab];
  return (
    <div className="space-y-6">
      <PageHeader
        title={label}
        crumbs={!employee ? <Crumbs items={[{ label: "Stock", onClick: () => setTab(null) }, { label, onClick: inDetail ? () => setTab("where") : undefined }, ...(inDetail ? [{ label: crumbFor(params.get("period")!) }] : [])]} /> : undefined}
      >
        {tab !== "recipes" && (propertyId || props.length === 1 ? <Badge>{propertyById[pid].name}</Badge> : (
          <Segmented label="Hotel" value={picked} onChange={setPicked} options={props.map((p) => ({ value: p, label: propertyById[p].name }))} />
        ))}
      </PageHeader>
      {employee && <Tabs value={tab} onChange={setTab} tabs={[{ value: "log", label: LABEL.log }, { value: "counts", label: "Stock counts" }]} />}
      {tab === "inventory" && <Inventory propertyId={pid} />}
      {tab === "where" && <WhereDidItGo key={pid} propertyId={pid} />}
      {tab === "log" && <WasteLogger key={pid} propertyId={pid} />}
      {tab === "counts" && <Counts propertyId={pid} />}
      {tab === "recipes" && <Recipes />}
      {tab === "suppliers" && <Suppliers propertyId={pid} />}
    </div>
  );
}
