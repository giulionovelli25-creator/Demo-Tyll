"use client";
// What the whole shell needs to agree on: the month plan, Pour Control, and one list of everything that needs a decision.
// Each alert says what happened, why it matters in money, and the one next step. Resolve and snooze are remembered per
// person in this browser; a money case is only ever closed on its own page, with an outcome recorded.
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Rag } from "@/components/ui";
import { ingredientById, outletById, propertyById } from "./data/catalog";
import { allowedProperties, canOpen } from "./domain/access";
import { buildIssues, type Issue } from "./domain/issues";
import { useApi, useCtx, useInvestigations, usePatterns, useView } from "./hooks";
import { useMonthPlan } from "./plan-hooks";
import type { PourOut } from "./server/pour";
import type { MonthPlanOut } from "./server/purchasing";
import { fmtDate, fxRate } from "./util";

export type AlertKind = "stock" | "money" | "pour" | "waste" | "margin" | "supplier";
export type AlertState = "open" | "snoozed" | "resolved";

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
  /** A money case closes on its own page, so its outcome is recorded. */
  caseHref?: string;
}

interface Remembered {
  byUser: Record<string, Record<string, Exclude<AlertState, "open">>>;
  set(userId: string, alertId: string, state: AlertState): void;
}

export const useAlertMemory = create<Remembered>()(
  persist(
    (set) => ({
      byUser: {},
      set: (userId, alertId, state) =>
        set((s) => {
          const mine = { ...s.byUser[userId] };
          if (state === "open") delete mine[alertId];
          else mine[alertId] = state;
          return { byUser: { ...s.byUser, [userId]: mine } };
        }),
    }),
    { name: "tyll-alerts-v1" },
  ),
);

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
  const memory = useAlertMemory((s) => s.byUser[user.id]);
  const pid = propertyId ?? allowedProperties(user)[0] ?? null;
  const planned = useMonthPlan(canOpen(user, "stock") && user.role !== "employee" ? pid : null);
  const plan = planned.data?.plan;
  const outlets = useMemo(() => sel.outletIds.filter((o) => outletById[o].propertyId === pid).join(","), [sel.outletIds, pid]);
  const pourRes = useApi<{ pour: PourOut }>(canOpen(user, "money") && pid ? `/api/pour?propertyId=${pid}&outlets=${outlets}` : null);
  const pour = pourRes.data?.pour;

  const value = useMemo<Feed>(() => {
    const out: FeedAlert[] = [];
    const issues = canOpen(user, "alerts") ? buildIssues(ctx, sel, investigations, patterns, { includeStock: canOpen(user, "stock") }) : [];
    const suppliers: Issue[] = [];
    for (const i of issues) {
      const m = i.impact === null ? null : money(i.impact);
      const rag = RAG_OF[i.priority];
      if (i.kind === "investigation") out.push({ id: i.id, kind: "money", rag, what: i.title, why: `${m} at risk until someone checks it.`, where: i.location, outletId: i.outletId, amount: i.impact, amountWord: "at risk", next: { label: "Review case", href: i.href }, caseHref: i.href });
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
      // The two largest wine patterns, so the list stays readable. The rest are on Pour Control.
      for (const f of pour.wine.flags.slice(0, 2)) {
        out.push({ id: f.id, kind: "pour", rag: "amber", what: `Check pouring at ${outletById[f.outletId].name}`, why: f.text, where: outletById[f.outletId].name, outletId: f.outletId, amount: f.figures.gapValue * rate, amountWord: "not billed", next: { label: "See Pour Control", href: "/money?tab=pour" } });
      }
    }
    out.sort((a, b) => (b.amount ?? -1) - (a.amount ?? -1));
    const state = (a: FeedAlert): AlertState => memory?.[a.id] ?? "open";
    return {
      alerts: out, open: out.filter((a) => state(a) === "open"), snoozed: out.filter((a) => state(a) === "snoozed"), resolved: out.filter((a) => state(a) === "resolved"),
      loading: planned.loading, error: planned.error, plan, pour, propertyId: pid,
    };
  }, [ctx, sel, investigations, patterns, plan, pour, pid, user, money, memory, planned.loading, planned.error]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
