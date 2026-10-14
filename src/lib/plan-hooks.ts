"use client";
// Forecast, purchasing and prep: server data, and each user's unfinished work kept in this browser so going back loses nothing.
import { useCallback, useEffect, useState } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { api } from "./api";
import type { Assumptions, Meal, PeriodKind } from "./domain/planning";
import { usePost, useSessionEntries } from "./hooks";
import type { BuyPlanOut, PlanAlert, PrepOut } from "./server/purchasing";
import type { PrepPlan, PurchaseRequest } from "./types";

export interface PlanScope {
  propertyId: string;
  outletIds: string[];
  period: PeriodKind;
  from?: string;
  to?: string;
}

export interface BuyDraft extends PlanScope {
  step: 1 | 2 | 3;
  assumptions: Partial<Assumptions>;
  /** Quantities and suppliers the user changed, by ingredient. */
  picks: Record<string, { selected: boolean; qty?: number; supplierId?: string }>;
  prepPlanId?: string;
  comment: string;
}

export interface PrepDraft {
  outletId: string;
  period: PeriodKind;
  meal: Meal;
  step: 1 | 2 | 3;
  assumptions: Partial<Assumptions>;
  portions: Record<string, number>;
}

interface Drafts {
  buy: Record<string, BuyDraft>;
  prep: Record<string, PrepDraft>;
  /** Bumped after every change on the server, so lists reload. */
  version: number;
  setBuy(userId: string, d: BuyDraft | null): void;
  setPrep(userId: string, d: PrepDraft | null): void;
  bump(): void;
}

export const usePlanDrafts = create<Drafts>()(
  persist(
    (set) => ({
      buy: {},
      prep: {},
      version: 0,
      setBuy: (u, d) => set((s) => { const buy = { ...s.buy }; if (d) buy[u] = d; else delete buy[u]; return { buy }; }),
      setPrep: (u, d) => set((s) => { const prep = { ...s.prep }; if (d) prep[u] = d; else delete prep[u]; return { prep }; }),
      bump: () => set((s) => ({ version: s.version + 1 })),
    }),
    { name: "tyll-plan-drafts", partialize: (s) => ({ buy: s.buy, prep: s.prep }) as unknown as Drafts },
  ),
);

export function useBuyPlan(draft: BuyDraft | null) {
  const entries = useSessionEntries();
  const body = draft && draft.step >= 2 ? { propertyId: draft.propertyId, outletIds: draft.outletIds, period: draft.period, from: draft.from, to: draft.to, assumptions: draft.assumptions, prepPlanId: draft.prepPlanId, ...entries } : null;
  return usePost<{ plan: BuyPlanOut }>("/api/plan/buy", body, 250);
}

export function usePrepSuggest(draft: PrepDraft | null) {
  const entries = useSessionEntries();
  const version = usePlanDrafts((s) => s.version);
  const body = draft && draft.step >= 2 ? { action: "suggest", outletId: draft.outletId, period: draft.period, meal: draft.meal, assumptions: draft.assumptions, version, ...entries } : null;
  return usePost<{ prep: PrepOut; assignees: { id: string; name: string }[] }>("/api/plan/prep", body, 250);
}

export function usePlanAlerts(enabled = true) {
  const entries = useSessionEntries();
  const version = usePlanDrafts((s) => s.version);
  return usePost<{ alerts: PlanAlert[] }>("/api/plan/alerts", enabled ? { ...entries, version } : null);
}

/** A GET that reloads whenever something changes on the server. */
function useLive<T>(url: string | null) {
  const version = usePlanDrafts((s) => s.version);
  const [state, setState] = useState<{ key: string; data?: T; error?: string } | null>(null);
  const key = url ? `${url}#${version}` : null;
  useEffect(() => {
    if (!url || !key) return;
    let live = true;
    api<T>(url).then((data) => live && setState({ key, data })).catch((e: unknown) => live && setState({ key, error: e instanceof Error ? e.message : "Could not load." }));
    return () => { live = false; };
  }, [url, key]);
  return { data: state?.data, error: state?.error, loading: !!key && state?.key !== key };
}

export const useRequests = () => useLive<{ requests: PurchaseRequest[] }>("/api/purchasing");
export const useRequest = (id: string | null) => useLive<RequestDetail>(id ? `/api/purchasing/${encodeURIComponent(id)}` : null);
export const usePrepPlans = () => useLive<{ plans: PrepPlan[]; assignees: Record<string, { id: string; name: string }[]> }>("/api/plan/prep");

export interface RequestDetail {
  request: PurchaseRequest;
  total: number;
  steps: ("purchasing" | "accounting" | "manager")[];
  policy: { accountingAbove: number; managerAbove: number; managerLabel: string };
  budget: { month: string; budget: number; spentBefore: number; committed: number; available: number };
  quotes: Record<string, { supplierId: string; name: string; unitPrice: number; leadDays: number; usual: boolean }[]>;
}

/** Sends a change to the server and reloads every list that depends on it. */
export function useMutate() {
  const bump = usePlanDrafts((s) => s.bump);
  return useCallback(async <T,>(url: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> => {
    try {
      const data = await api<T>(url, { method: "POST", body });
      bump();
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Something went wrong." };
    }
  }, [bump]);
}
