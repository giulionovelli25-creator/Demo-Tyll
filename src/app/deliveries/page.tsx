"use client";
// Deliveries and invoices: one address for the three way check of every delivery (ordered, delivered, invoiced) and,
// for the roles that review invoices, the invoices themselves. The old addresses (/stock?tab=suppliers and
// /finance?tab=invoices) lead here (lib/redirects.ts).
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Invoices } from "@/components/finance/finance";
import { PurchasingTabs } from "@/components/finance/purchasing-tabs";
import { Suppliers } from "@/components/stock/suppliers";
import { PageHeader, Segmented } from "@/components/ui";
import { propertyById } from "@/lib/data/catalog";
import { allowedProperties, can } from "@/lib/domain/access";
import { useView } from "@/lib/hooks";

export default function DeliveriesPage() {
  const { user, propertyId } = useView();
  const params = useSearchParams();
  const invoices = params.get("tab") === "invoices" && can(user, "finance.review");
  const props = allowedProperties(user);
  const [picked, setPicked] = useState(props[0]);
  const pid = propertyId ?? picked;
  if (invoices) {
    return (
      <div className="space-y-6">
        <PageHeader title="Deliveries and invoices" question="Which supplier invoices need checking before they are paid?" lead="Simulated data." />
        <PurchasingTabs here="invoices" />
        <Invoices />
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <PageHeader title="Deliveries and invoices" question="Did we get, and pay for, what we ordered?" lead="Simulated data.">
        {propertyId || props.length === 1 ? null : <Segmented label="Hotel" value={picked} onChange={setPicked} options={props.map((p) => ({ value: p, label: propertyById[p].name }))} />}
      </PageHeader>
      <Suppliers propertyId={pid} tabs={user.role === "employee" ? null : <PurchasingTabs here="deliveries" />} />
    </div>
  );
}
