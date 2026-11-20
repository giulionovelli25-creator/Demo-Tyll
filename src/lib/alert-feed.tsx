"use client";
// What the whole shell needs to agree on: the month plan, Pour Control, and one list of everything that needs a decision.
// Each alert says what happened, why it matters in money, and the one next step. Resolve and snooze are saved per person
// on the demo server (the `alert.state` change in lib/domain/records.ts), with the role, and a snooze lasts until the next
// business day; a money case is only ever closed on its own page, with an outcome recorded.
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Rag } from "@/components/ui";
import { MENU_ITEMS, ingredientById, outletById, propertyById, supplierById } from "./data/catalog";
import { orderStage } from "./domain/order-stage";
import { allowedProperties, can, canOpen } from "./domain/access";
import { buildIssues, type Issue } from "./domain/issues";
import { alertStateOf, type AlertStateName } from "./domain/records";
import { useApi, useCtx, useInvestigations, usePatterns, useView } from "./hooks";
import { useMonthPlan, useRequests } from "./plan-hooks";
import { useExpiring } from "./procurement-hooks";
import type { PourOut } from "./server/pour";
import { useEmptiesVersion } from "./empties-version";
import type { MonthPlanOut } from "./server/purchasing";
import { useDemo } from "./store";
import { DEMO_TODAY, addDays, fmtDate, fmtTime, fxRate } from "./util";
import { minOf } from "./domain/late-delivery";

export type AlertKind = "stock" | "money" | "pour" | "waste" | "margin" | "supplier" | "delivery" | "expiry";
export type AlertState = AlertStateName;

export interface FeedAlert {
  id: string;
  kind: AlertKind;
  rag: Rag;
  what: string;
  why: string;
  where: string;
  outletId?: string;
  /** Money involved, in the selection's currency. */
  amount: number | null;
  /** What that money is: at risk, to order, not billed. An order is not a loss. */
  amountWord: string;
  next: { label: string; href: string };
  /** A second way to act, such as ordering from a backup supplier. */
  also?: { label: string; href: string };
  /** A money case closes on its own page, so its outcome is recorded. A delivery at risk is handled on Predictions. */
  caseHref?: string;
  /** Handled for the whole team (a delivery at risk someone acted on): resolved for everyone, whoever opens Alerts. */
  teamResolved?: boolean;
}

/** Before feature 8 resolve and snooze were kept in this browser under this key. They are dropped, not uploaded: they
 * carried no person, role or time. */
const OLD_KEY = "tyll-alerts-v1";
if (typeof window !== "undefined") {
  try { window.localStorage.removeItem(OLD_KEY); } catch { /* private window */ }
}

interface Feed {
  alerts: FeedAlert[];
  open: FeedAlert[];
  snoozed: FeedAlert[];
  resolved: FeedAlert[];
  loading: boolean;
  error?: string;
  /** Read from here by Overview, Stock and Money, so they always agree. */
  plan?: MonthPlanOut;
  pour?: PourOut;
  /** The hotel the plan and Pour Control are for. */
  propertyId: string | null;
}

const Ctx = createContext<Feed>({ alerts: [], open: [], snoozed: [], resolved: [], loading: false, propertyId: null });
export const useAlertFeed = () => useContext(Ctx);

const RAG_OF: Record<Issue["priority"], Rag> = { high: "red", medium: "amber", low: "green" };

export function AlertFeedProvider({ children }: { children: ReactNode }) {
  const { user, sel, money, propertyId } = useView();
  const ctx = useCtx();
  const investigations = useInvestigations();
  const patterns = usePatterns();
  // The server sends each person only their own resolve and snooze.
  const memory = useDemo((s) => s.alertStates);
  const pid = propertyId ?? allowedProperties(user)[0] ?? null;
  const planned = useMonthPlan(canOpen(user, "stock") && user.role !== "employee" ? pid : null);
  const plan = planned.data?.plan;
  const outlets = useMemo(() => sel.outletIds.filter((o) => outletById[o].propertyId === pid).join(","), [sel.outletIds, pid]);
  // A new empty bottle scan changes Over pouring, so the figures are fetched again after one.
  const emptiesVersion = useEmptiesVersion((s) => s.v);
  const pourRes = useApi<{ pour: PourOut }>(canOpen(user, "money") && pid ? `/api/pour?propertyId=${pid}&outlets=${outlets}${emptiesVersion ? `&v=${emptiesVersion}` : ""}` : null);
  const pour = pourRes.data?.pour;
  const orders = useRequests().data?.requests;
  // Batches that normal use will not finish before they expire, in the next three days.
  const seesBatches = can(user, "stock.count") || can(user, "stock.review") || can(user, "purchase.create");
  const expiring = useExpiring(canOpen(user, "stock") && seesBatches && user.role !== "employee" ? pid : null, 3).data;

  const value = useMemo<Feed>(() => {
    const out: FeedAlert[] = [];
    const issues = canOpen(user, "alerts") ? buildIssues(ctx, sel, investigations, patterns, { includeStock: canOpen(user, "stock") }) : [];
    const suppliers: Issue[] = [];
    for (const i of issues) {
      const m = i.impact === null ? null : money(i.impact);
      const rag = RAG_OF[i.priority];
      if (i.kind === "investigation") out.push({ id: i.id, kind: "money", rag, what: i.title, why: i.estimateFrom === "bottles" ? `About ${m} at risk, an estimate from bottles issued against what was billed.` : i.estimateFrom === "spend" ? `About ${m} at risk, an estimate at the outlet's spend per guest.` : i.estimate ? `About ${m} at risk, an estimate until a count confirms it.` : `${m} at risk until someone checks it.`, where: i.location, outletId: i.outletId, amount: i.impact, amountWord: i.estimate ? "at risk, an estimate" : "at risk", next: { label: "Review case", href: i.href }, caseHref: i.href });
      else if (i.kind === "waste") out.push({ id: i.id, kind: "waste", rag, what: i.title.replace("Food waste up", "Food waste is up"), why: `${m} more waste than the period before.`, where: i.location, outletId: i.outletId, amount: i.impact, amountWord: "more waste", next: { label: "See waste", href: i.href } });
      else if (i.kind === "supplier") suppliers.push(i);
      else if (canOpen(user, "overview")) out.push({ id: i.id, kind: "margin", rag, what: i.title.replace(" pts", " points"), why: `About ${m} less profit in this period.`, where: i.location, amount: i.impact, amountWord: "less profit", next: { label: "See dish", href: i.href } });
    }
    if (suppliers.length) {
      const over = suppliers.reduce((n, i) => n + (i.impact ?? 0), 0);
      out.push({
        id: "supplier-invoices", kind: "supplier", rag: suppliers.some((i) => i.priority === "high") ? "red" : suppliers.some((i) => i.priority === "medium") ? "amber" : "green",
        what: `Check ${suppliers.length} supplier ${suppliers.length === 1 ? "invoice" : "invoices"} against what was delivered`, why: `${money(over)} more on the ${suppliers.length === 1 ? "invoice" : "invoices"} than was delivered or agreed.`,
        where: suppliers[0].location, amount: over, amountWord: "over invoiced", next: { label: "Check deliveries", href: suppliers[0].href },
      });
    }
    if (plan) {
      const rate = fxRate(propertyById[plan.propertyId].currency, sel.currency);
      const where = propertyById[plan.propertyId].name;
      // The Stock page lists each item. Ordering them is one job, so it is one alert.
      const critical = plan.items.filter((l) => l.health === "critical" && l.nextQty > 0 && l.orderBy).sort((a, b) => (a.daysUntilOut ?? 99) - (b.daysUntilOut ?? 99));
      if (critical.length) {
        const cost = critical.reduce((n, l) => n + l.nextCost, 0) * rate;
        const first = critical[0];
        out.push({
          id: "stock-critical", kind: "stock", rag: "red", what: `Order ${critical.length} critical ${critical.length === 1 ? "item" : "items"} today`,
          why: `${ingredientById[first.ingredientId].name} runs out first${first.runOutDate ? `, ${fmtDate(first.runOutDate, true)}` : ""}. An order placed later arrives too late.`,
          where, amount: cost, amountWord: "to order", next: { label: "See what to order", href: "/forecast" },
        });
      }
      const low = plan.items.filter((l) => l.health === "low" && l.nextQty > 0 && l.orderBy);
      if (low.length) {
        out.push({
          id: "stock-low", kind: "stock", rag: "amber", what: `Order ${low.length} low ${low.length === 1 ? "item" : "items"} soon`,
          why: `${ingredientById[low[0].ingredientId].name} and others need an order in the next few days.`,
          where, amount: low.reduce((n, l) => n + l.nextCost, 0) * rate, amountWord: "to order", next: { label: "See what to order", href: "/forecast" },
        });
      }
    }
    if (pour) {
      const rate = fxRate(propertyById[pour.propertyId].currency, sel.currency);
      // The two largest wine patterns, so the list stays readable. The rest are on Over pouring.
      for (const f of pour.wine.flags.slice(0, 2)) {
        out.push({ id: f.id, kind: "pour", rag: "amber", what: `Check pouring at ${outletById[f.outletId].name}, ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][f.weekday]} ${f.shift} shift`, why: f.text, where: outletById[f.outletId].name, outletId: f.outletId, amount: f.figures.gapValue * rate, amountWord: "not billed", next: { label: "See over pouring", href: "/drinks" } });
      }
    }
    // A delivery likely to be late that would leave a service short (lib/server/late-delivery.ts). A prediction, labelled so.
    for (const r of plan?.risk?.rows ?? []) {
      if (r.status !== "alert" && r.status !== "handled") continue;
      const i = r.items.find((x) => x.shortfall);
      if (!i?.shortfall) continue;
      const rate = fxRate(propertyById[plan!.propertyId].currency, sel.currency);
      const href = `/forecast?risk=${encodeURIComponent(r.key)}`;
      const when = r.date === DEMO_TODAY ? "today" : r.date === addDays(DEMO_TODAY, 1) ? "tomorrow" : fmtDate(r.date, true);
      out.push({
        id: `risk-${r.key}`, kind: "delivery", rag: r.severity === "red" ? "red" : "amber",
        // What hurts first, then why: a chef reads the item and the service before the supplier.
        what: `${i.name} short before ${i.shortfall.service} ${when}: ${r.supplier} likely late`,
        why: `${r.supplier} delivery ${when} ${fmtTime(minOf(r.window.from))}. ${r.prediction.sentence} A prediction from the supplier's record.`,
        where: i.outletIds.map((o) => outletById[o]?.name).join(", ") || propertyById[plan!.propertyId].name, outletId: i.outletIds[0], amount: r.valueAtRisk * rate, amountWord: "sales at risk, an estimate",
        next: { label: r.backup ? "Order from backup supplier" : "See the delivery", href },
        also: { label: "Call supplier", href },
        caseHref: href, teamResolved: r.status === "handled",
      });
    }
    // A delivery that has not arrived puts tonight's menu at risk, so it goes first.
    for (const r of (orders ?? []).filter((x) => orderStage(x) === "late" && (!pid || x.propertyId === pid))) {
      const supplierId = r.lines[0]?.supplierId ?? "";
      const ids = new Set(r.lines.map((l) => l.ingredientId));
      const dishes = MENU_ITEMS.filter((m) => (m.recipe ?? []).some((x) => ids.has(x.ingredientId)) && r.outletIds.some((o) => outletById[o]?.menu.some((e) => e.itemId === m.id)));
      const word: Record<string, string> = { sea: "Fresh fish", meat: "Meat", produce: "Fresh produce", dry: "Dairy and dry goods", wine: "Wine and spirits", bev: "Drinks" };
      out.push({
        id: `late-${r.id}`, kind: "delivery", rag: "red",
        what: `${word[supplierId] ?? "A"} delivery due ${r.expectedAt?.slice(11, 16)} has not arrived`,
        why: `${dishes.length} menu ${dishes.length === 1 ? "item" : "items"} at risk tonight: ${dishes.map((d) => d.name).join(", ")}. ${supplierById[supplierId]?.name ?? "The supplier"}, order ${r.poNumber ?? r.id}.`,
        where: r.outletIds.map((o) => outletById[o]?.name).join(", "), outletId: r.outletIds[0], amount: null, amountWord: "",
        next: { label: "Call supplier", href: `/forecast?tab=approvals&request=${r.id}` },
        also: { label: "Order from backup supplier", href: `/forecast?tab=buy&focus=${r.lines[0]?.ingredientId ?? ""}` },
      });
    }
    if (expiring && (expiring.totals.atRisk > 0 || expiring.totals.expired > 0)) {
      const risky = expiring.rows.filter((r) => r.atRisk || r.daysLeft < 0);
      const soonest = risky[0];
      const gone = risky.filter((r) => r.daysLeft < 0).length;
      out.push({
        id: `expiry-${risky.map((r) => r.batch).join(",")}`, kind: "expiry", rag: gone ? "red" : "amber",
        what: gone ? `${gone} expired ${gone === 1 ? "batch is" : "batches are"} still on the shelf` : `${risky.length} ${risky.length === 1 ? "batch expires" : "batches expire"} in the next 3 days`,
        why: `${soonest.name}, batch ${soonest.batch}, ${soonest.daysLeft < 0 ? "has expired" : soonest.daysLeft === 0 ? "expires today" : `expires in ${soonest.daysLeft} ${soonest.daysLeft === 1 ? "day" : "days"}`}. ${soonest.action.text}`,
        where: pid ? propertyById[pid].name : "", amount: risky.reduce((t, r) => t + r.value, 0) * (pid ? fxRate(propertyById[pid].currency, sel.currency) : 1), amountWord: "at risk", next: { label: "See expiring soon", href: "/stock?tab=expiry" },
      });
    }
    // Most urgent first, then the most money inside each level.
    const RANK = { red: 0, amber: 1, green: 2 } as const;
    out.sort((a, b) => RANK[a.rag as keyof typeof RANK] - RANK[b.rag as keyof typeof RANK] || Number(b.kind === "delivery") - Number(a.kind === "delivery") || (b.amount ?? -1) - (a.amount ?? -1));
    const state = (a: FeedAlert): AlertState => (a.teamResolved ? "resolved" : alertStateOf(memory[a.id], DEMO_TODAY));
    return {
      alerts: out, open: out.filter((a) => state(a) === "open"), snoozed: out.filter((a) => state(a) === "snoozed"), resolved: out.filter((a) => state(a) === "resolved"),
      loading: planned.loading, error: planned.error, plan, pour, propertyId: pid,
    };
  }, [ctx, sel, investigations, patterns, plan, pour, orders, expiring, pid, user, money, memory, planned.loading, planned.error]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
