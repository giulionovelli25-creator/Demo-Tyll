"use client";
import Link from "next/link";
import { Approvals } from "@/components/forecast/approvals";
import { WhatToBuy } from "@/components/forecast/buy";
import { WhatToPrep } from "@/components/forecast/prep";
import { useSection } from "@/components/module-hub";
import { Outlook } from "@/components/prediction/outlook";
import { AutoOrdering } from "@/components/prediction/auto-order";
import { ParLevels, ToOrder } from "@/components/purchasing/to-order";
import { SupplierDirectory } from "@/components/purchasing/supplier-directory";
import { Predictions } from "@/components/prediction/predictions";
import { PageHeader, PageTabs, SummaryBar, Tabs, linkButton } from "@/components/ui";
import type { ReactNode } from "react";
import { useAlertFeed } from "@/lib/alert-feed";
import { DEMO_TODAY, fmtDate } from "@/lib/util";
import { propertyById } from "@/lib/data/catalog";
import { allowedProperties, can, canOpen } from "@/lib/domain/access";
import { useLiveGet } from "@/lib/guest-hooks";
import { useView } from "@/lib/hooks";
import type { PurchaseRequest } from "@/lib/types";
import { fmtMoney, sum } from "@/lib/util";
import { orderStage } from "@/lib/domain/order-stage";

type Tab = "approvals" | "buy" | "prep" | "outlook" | "auto" | "toorder" | "pars" | "suppliers" | "catalogue";

const LABEL: Record<Tab, string> = { approvals: "Orders", buy: "Order by hand", prep: "Plan the prep", outlook: "Next 7 days", auto: "Automatic ordering", toorder: "To order", pars: "Par levels", suppliers: "Suppliers", catalogue: "Catalogue and prices" };
const WAITING: PurchaseRequest["status"][] = ["purchasing", "accounting", "manager"];

/** Predictions come first. Orders is a page of its own, with its own filters. */
export default function ForecastPage() {
  const { user } = useView();
  const hasOutlets = user.outletIds === "all" || user.outletIds.length > 0;
  // The month plan is held with stock, so a role without stock starts on its orders.
  const predicts = canOpen(user, "stock") && user.role !== "employee";
  const tabs = ([
    "approvals",
    can(user, "purchase.create") && (hasOutlets || can(user, "events.plan")) && "buy",
    (can(user, "prep.plan") || can(user, "prep.complete")) && "prep",
    hasOutlets && "outlook",
    can(user, "purchase.create") && "auto",
    can(user, "purchase.create") && "toorder",
    can(user, "purchase.create") && "pars",
    can(user, "purchase.create") && "suppliers",
    can(user, "purchase.create") && "catalogue",
  ].filter(Boolean) as Tab[]);
  const [tab, setTab] = useSection<Tab>("/forecast", tabs, predicts ? null : "approvals");
  // Predictions, Plan the prep and Next 7 days are one item: what is coming and what to buy for it.
  const planTabs = (here: Tab | null) => {
    const parts = [{ id: null, href: "/forecast", label: "What to order" }, ...(tabs.includes("prep") ? [{ id: "prep", href: "/forecast?tab=prep", label: LABEL.prep }] : []), ...(tabs.includes("outlook") ? [{ id: "outlook", href: "/forecast?tab=outlook", label: LABEL.outlook }] : [])];
    return parts.length > 1 && predicts ? <PageTabs tabs={parts.map((p) => ({ href: p.href, label: p.label, active: p.id === here }))} /> : null;
  };
  if (tab === null) return <Predictions tabs={planTabs(null)} />;
  if (tab === "auto") return <AutoOrdering />;
  // To order and Par levels are one item; Suppliers and the catalogue another.
  const sub = (a: Tab, b: Tab) => <PageTabs tabs={[{ href: `/forecast?tab=${a}`, label: LABEL[a], active: tab === a }, { href: `/forecast?tab=${b}`, label: LABEL[b], active: tab === b }]} />;
  if (tab === "toorder") return <ToOrder tabs={sub("toorder", "pars")} />;
  if (tab === "pars") return <ParLevels tabs={sub("toorder", "pars")} />;
  if (tab === "suppliers" || tab === "catalogue") return <SupplierDirectory view={tab} tabs={sub("suppliers", "catalogue")} />;
  return <Orders tab={tab} tabs={tabs} setTab={setTab} predicts={predicts} planTabs={planTabs(tab)} />;
}

function Orders({ tab, tabs, setTab, predicts, planTabs }: { tab: Tab; tabs: Tab[]; setTab: (t: Tab | null) => void; predicts: boolean; planTabs: ReactNode }) {
  const planning = tab === "prep" || tab === "outlook";
  const orderTabs = tabs.filter((t) => t === "approvals" || t === "buy");
  const { user } = useView();
  const { data } = useLiveGet<{ requests: PurchaseRequest[] }>("/api/purchasing");
  const requests = data?.requests ?? [];
  const value = (rs: PurchaseRequest[]) => sum(rs, (r) => sum(r.lines, (l) => l.qty * l.unitPrice));
  const drafts = requests.filter((r) => r.status === "draft");
  const waiting = requests.filter((r) => WAITING.includes(r.status));
  const onTheWay = requests.filter((r) => r.status === "approved");
  const late = onTheWay.filter((r) => orderStage(r) === "late");
  const currency = allowedProperties(user)[0] ? propertyById[allowedProperties(user)[0]].currency : "EUR";
  const money = (n: number) => fmtMoney(n, currency);
  const { plan } = useAlertFeed();
  const nextOrder = plan?.items.filter((i) => i.orderQty > 0 && i.orderBy).map((i) => i.orderBy!).sort()[0];
  const dueNext = plan?.items.filter((i) => i.orderQty > 0 && i.orderBy === nextOrder).length ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={LABEL[tab]}
        question={tab === "approvals" ? "What is on order, and what still needs a decision?" : undefined}
        lead={tab === "approvals" ? (data ? `${waiting.length} waiting for approval, ${onTheWay.length} on the way${late.length ? ` (${late.length} late)` : ""}, ${drafts.length} ${drafts.length === 1 ? "draft" : "drafts"}.` : "Loading orders.") : undefined}
      >
        {!planning && predicts && can(user, "purchase.create") && <Link href="/forecast" className={linkButton("primary")}>Build order</Link>}
      </PageHeader>
      {tab === "approvals" && (
        <SummaryBar
          items={[
            { label: "Your drafts", value: drafts.length, compare: { text: drafts.length ? `${money(value(drafts))} not sent yet` : "Nothing started", good: null }, href: "/forecast?tab=approvals&queue=drafts" },
            { label: "Waiting for approval", value: waiting.length, tone: waiting.length ? "warn" : undefined, compare: { text: waiting.length ? `${money(value(waiting))} to approve` : "Nothing waiting", good: null }, href: "/forecast?tab=approvals&queue=purchasing" },
            { label: "Awaiting delivery", value: onTheWay.length, compare: { text: onTheWay.length ? `${money(value(onTheWay))} on the way` : "Nothing on the way", good: null }, href: "/forecast?tab=approvals&queue=delivery" },
            { label: "Next order", value: nextOrder ? (nextOrder === DEMO_TODAY ? "Today" : fmtDate(nextOrder, true)) : "None due", tone: nextOrder === DEMO_TODAY ? "warn" : undefined, compare: { text: nextOrder ? `${dueNext} ${dueNext === 1 ? "item" : "items"} to order by then` : "Stock covers the month", good: null }, href: "/forecast" },
          ]}
        />
      )}
      {planning ? planTabs : orderTabs.length > 1 && <Tabs value={tab} onChange={setTab} tabs={orderTabs.map((t) => ({ value: t, label: LABEL[t] }))} />}
      {tab === "approvals" && <Approvals />}
      {tab === "buy" && <WhatToBuy />}
      {tab === "prep" && <WhatToPrep />}
      {tab === "outlook" && <Outlook />}
    </div>
  );
}
