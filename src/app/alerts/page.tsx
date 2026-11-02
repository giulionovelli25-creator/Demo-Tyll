"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { AlertRow } from "@/components/alerts/alert-row";
import { Section } from "@/components/disclosure";
import { EmptyState, PageHeader, Segmented, Skeleton, SummaryBar, Tabs, WidgetError, linkButton } from "@/components/ui";
import { useAlertFeed, type AlertKind, type AlertState } from "@/lib/alert-feed";
import { topAlerts } from "@/lib/domain/top-alerts";
import { useView } from "@/lib/hooks";
import { sum } from "@/lib/util";

type Filter = "all" | "stock" | "money" | "waste";
const FIRST = 3;
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

  const first = useMemo(() => topAlerts(feed.open, FIRST), [feed.open]);
  const totalRed = feed.open.filter((a) => a.rag === "red").length;
  const totalAmber = feed.open.filter((a) => a.rag === "amber").length;

  return (
    <div className="space-y-4">
      <PageHeader title="Alerts" question="What needs a decision?" lead="Stock, money and waste together. Simulated data." />
      <SummaryBar
        items={[
          { label: "Act today", value: totalRed, tone: totalRed ? "neg" : "pos" },
          { label: "This week", value: totalAmber, tone: totalAmber ? "warn" : "pos" },
          { label: "Money in these alerts", value: money(sum(feed.open.filter((a) => a.amountWord !== "to order"), (a) => a.amount ?? 0), { compact: true }), tone: "money" },
        ]}
        action={first[0] ? <Link href={first[0].next.href} className={linkButton("primary")}>Open the first alert</Link> : undefined}
      />
      {feed.error && <WidgetError>Stock alerts could not load. Money and waste alerts below are still current.</WidgetError>}
      {first.length === 0 ? (
        feed.loading ? <div className="space-y-2"><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div> : <EmptyState title="Nothing needs you here">When something needs a decision, it appears here with the money involved.</EmptyState>
      ) : (
        <ul className="overflow-hidden rounded-panel border border-line bg-paper shadow-panel">
          {first.map((a) => <AlertRow key={a.id} compact alert={a} money={(n) => money(n)} />)}
        </ul>
      )}
      <Section id="alerts.all" forceOpen={raw !== null || rawView !== null} title={`Show all ${feed.open.length} alerts`} summary={`${feed.snoozed.length} snoozed, ${feed.resolved.length} resolved. Largest amount of money first.`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Tabs value={view} onChange={(v) => go({ view: v })} tabs={[{ value: "open", label: "Open", count: feed.open.length }, { value: "snoozed", label: "Snoozed", count: feed.snoozed.length }, { value: "resolved", label: "Resolved", count: feed.resolved.length }]} />
          <Segmented size="sm" label="Show alerts about" value={filter} onChange={(v) => go({ kind: v })} options={FILTERS} />
        </div>
        <p className="text-[13px] text-steel">{red} act today, {amber} this week, {money(atRisk)} involved, including orders to place.</p>
        {list.length === 0 ? (
          <EmptyState title={view === "open" ? "Nothing needs you here" : view === "snoozed" ? "Nothing is snoozed" : "Nothing resolved yet"}>
            {view === "open" ? "Try another filter." : "Alerts you set aside show up here, and you can bring them back at any time."}
          </EmptyState>
        ) : (
          <ul className="overflow-hidden rounded-panel border border-line bg-paper">
            {list.map((a) => <AlertRow key={a.id} alert={a} money={(n) => money(n)} userId={user.id} state={view} />)}
          </ul>
        )}
      </Section>
    </div>
  );
}
