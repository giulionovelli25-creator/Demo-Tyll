"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Approvals } from "@/components/forecast/approvals";
import { WhatToBuy } from "@/components/forecast/buy";
import { WhatToPrep } from "@/components/forecast/prep";
import { useSection } from "@/components/module-hub";
import { Outlook } from "@/components/prediction/outlook";
import { Crumbs, KeyNumber, KeyNumbers, PageHeader, Tabs, linkButton } from "@/components/ui";
import { propertyById } from "@/lib/data/catalog";
import { allowedProperties, can } from "@/lib/domain/access";
import { useLiveGet } from "@/lib/guest-hooks";
import { useView } from "@/lib/hooks";
import type { PurchaseRequest } from "@/lib/types";
import { fmtMoney, sum } from "@/lib/util";

type Tab = "approvals" | "buy" | "prep" | "outlook";

const LABEL: Record<Tab, string> = { approvals: "Orders", buy: "Order by hand", prep: "Plan the prep", outlook: "Tomorrow and next 7 days" };
const WAITING: PurchaseRequest["status"][] = ["purchasing", "accounting", "manager"];

/** Orders: what is on order, and what still needs a decision. The order recommendation itself lives on Stock. */
export default function ForecastPage() {
  const { user } = useView();
  const hasOutlets = user.outletIds === "all" || user.outletIds.length > 0;
  const tabs = ([
    "approvals",
    can(user, "purchase.create") && (hasOutlets || can(user, "events.plan")) && "buy",
    (can(user, "prep.plan") || can(user, "prep.complete")) && "prep",
    hasOutlets && "outlook",
  ].filter(Boolean) as Tab[]);
  const [tab, setTab] = useSection<Tab>("/forecast", tabs, "approvals");
  const router = useRouter();
  const fromStock = useSearchParams().get("from") === "stock";
  const { data } = useLiveGet<{ requests: PurchaseRequest[] }>("/api/purchasing");
  const requests = data?.requests ?? [];
  const value = (rs: PurchaseRequest[]) => sum(rs, (r) => sum(r.lines, (l) => l.qty * l.unitPrice));
  const drafts = requests.filter((r) => r.status === "draft" && r.createdBy === user.id);
  const waiting = requests.filter((r) => WAITING.includes(r.status));
  const onTheWay = requests.filter((r) => r.status === "approved");
  const currency = allowedProperties(user)[0] ? propertyById[allowedProperties(user)[0]].currency : "AED";
  const money = (n: number) => fmtMoney(n, currency);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Orders"
        question="What is on order, and what still needs a decision?"
        lead={data ? `${waiting.length} waiting for approval, ${onTheWay.length} on the way, ${drafts.length} ${drafts.length === 1 ? "draft" : "drafts"} of yours.` : "Loading orders."}
        crumbs={fromStock && tab === "buy" ? <Crumbs items={[{ label: "Stock", onClick: () => router.push("/stock") }, { label: LABEL.buy }]} /> : undefined}
      >
        {can(user, "purchase.create") && <Link href="/stock#order" className={linkButton("primary")}>Build order from Stock</Link>}
      </PageHeader>
      <KeyNumbers>
        <KeyNumber label="Your drafts" value={drafts.length} note={drafts.length ? money(value(drafts)) : "Nothing started"} />
        <KeyNumber label="Waiting for approval" value={waiting.length} tone={waiting.length ? "warn" : undefined} note={waiting.length ? money(value(waiting)) : "Nothing waiting"} />
        <KeyNumber label="On the way" value={onTheWay.length} note={onTheWay.length ? money(value(onTheWay)) : "No open orders"} />
        <KeyNumber label="All orders" value={requests.length} note="That you can see" />
      </KeyNumbers>
      {tab !== null && tabs.length > 1 && <Tabs value={tab} onChange={setTab} tabs={tabs.map((t) => ({ value: t, label: LABEL[t] }))} />}
      {tab === "approvals" && <Approvals />}
      {tab === "buy" && <WhatToBuy />}
      {tab === "prep" && <WhatToPrep />}
      {tab === "outlook" && <Outlook />}
    </div>
  );
}
