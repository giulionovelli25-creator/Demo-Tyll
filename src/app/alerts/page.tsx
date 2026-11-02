"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { AlertRow } from "@/components/alerts/alert-row";
import { EmptyState, PageHeader, Segmented, Skeleton, Stat, Tabs, WidgetError, cn } from "@/components/ui";
import { useAlertFeed, type AlertKind, type AlertState } from "@/lib/alert-feed";
import { useView } from "@/lib/hooks";
import { sum } from "@/lib/util";

type Filter = "all" | "stock" | "money" | "waste";
const FILTERS: { value: Filter; label: string }[] = [{ value: "all", label: "All" }, { value: "stock", label: "Stock" }, { value: "money", label: "Money" }, { value: "waste", label: "Waste" }];
const inFilter = (k: AlertKind, f: Filter) => f === "all" || (f === "stock" ? k === "stock" || k === "supplier" : f === "money" ? k === "money" || k === "margin" || k === "pour" : k === "waste");

/** Every flag across stock, money and waste, sorted by money at risk. */
export default function AlertsPage() {
  const params = useSearchParams();
  const router = useRouter();
  const { user, money } = useView();
  const feed = useAlertFeed();
  const raw = params.get("kind");
  const filter: Filter = raw === "stock" || raw === "money" || raw === "waste" ? raw : "all";
  const rawView = params.get("view");
  const view: AlertState = rawView === "snoozed" || rawView === "resolved" ? rawView : "open";
  const go = (next: { kind?: Filter; view?: AlertState }) => {
    const k = next.kind ?? filter;
    const v = next.view ?? view;
    const q = new URLSearchParams();
    if (k !== "all") q.set("kind", k);
    if (v !== "open") q.set("view", v);
    router.replace(q.size ? `/alerts?${q}` : "/alerts");
  };
  const list = useMemo(() => (view === "open" ? feed.open : view === "snoozed" ? feed.snoozed : feed.resolved).filter((a) => inFilter(a.kind, filter)), [feed, view, filter]);
  const atRisk = sum(feed.open.filter((a) => inFilter(a.kind, filter)), (a) => a.amount ?? 0);
  const red = feed.open.filter((a) => a.rag === "red" && inFilter(a.kind, filter)).length;
  const amber = feed.open.filter((a) => a.rag === "amber" && inFilter(a.kind, filter)).length;

  return (
    <div className="space-y-4">
      <PageHeader title="All alerts" question="Everything that needs a decision, in one list" lead="Stock, money and waste together, with the largest amount of money first." />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="col-span-2 rounded-panel border border-line bg-paper p-4 shadow-panel lg:col-span-1"><Stat label="Money involved, open alerts" value={<span className="text-money">{money(atRisk)}</span>} sub="At risk or to spend" /></div>
        <div className="rounded-panel border border-line bg-paper p-4 shadow-panel"><Stat label="Act today" value={red} tone={red ? "neg" : "pos"} sub="Red" /></div>
        <div className="rounded-panel border border-line bg-paper p-4 shadow-panel"><Stat label="This week" value={amber} tone={amber ? "warn" : "pos"} sub="Amber" /></div>
        <div className="hidden rounded-panel border border-line bg-paper p-4 shadow-panel lg:block"><Stat label="Snoozed or resolved" value={feed.snoozed.length + feed.resolved.length} sub="By you, in this browser" /></div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs value={view} onChange={(v) => go({ view: v })} tabs={[{ value: "open", label: "Open", count: feed.open.length }, { value: "snoozed", label: "Snoozed", count: feed.snoozed.length }, { value: "resolved", label: "Resolved", count: feed.resolved.length }]} />
        <Segmented size="sm" label="Show alerts about" value={filter} onChange={(v) => go({ kind: v })} options={FILTERS} />
      </div>
      {feed.error && <WidgetError>Stock alerts could not load. Money and waste alerts below are still current.</WidgetError>}
      {list.length === 0 ? (
        feed.loading && view === "open" ? <div className="space-y-2"><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div> : (
          <EmptyState title={view === "open" ? "Nothing needs you here" : view === "snoozed" ? "Nothing is snoozed" : "Nothing resolved yet"}>
            {view === "open" ? "When something needs a decision, it appears here with the money involved." : "Alerts you set aside show up here, and you can bring them back at any time."}
          </EmptyState>
        )
      ) : (
        <ul className={cn("overflow-hidden rounded-panel border border-line bg-paper shadow-panel")}>
          {list.map((a) => <AlertRow key={a.id} alert={a} money={(n) => money(n)} userId={user.id} state={view} />)}
        </ul>
      )}
    </div>
  );
}
