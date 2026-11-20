"use client";
// Data for the purchasing and stock control screens. Every read carries the plan version, so a change made on one
// screen (an order created, a par level set, a stock take approved) refreshes the others.
import { useCallback, useState } from "react";
import { api } from "./api";
import { usePost, useSessionEntries, useApi } from "./hooks";
import { usePlanDrafts } from "./plan-hooks";
import type { CatalogueView, ParRow, PricePoint, SupplierView } from "./server/procurement";
import type { ExpiryRow } from "./server/expiry";
import type { StockTakeView } from "./server/stocktake";
import type { CashRow } from "./server/cash";
import type { OutboxEmail, PurchasingSettings } from "./types";

export function useProcurement<T>(action: string | null, propertyId: string | null, extra: Record<string, unknown> = {}) {
  const entries = useSessionEntries();
  const version = usePlanDrafts((s) => s.version);
  return usePost<T>("/api/procurement", action && propertyId ? { action, propertyId, version, ...entries, ...extra } : null);
}

export const useToOrder = (pid: string | null) => useProcurement<{ rows: ParRow[]; mayCreate: boolean }>("to_order", pid);
export const usePars = (pid: string | null) => useProcurement<{ rows: ParRow[]; mayEdit: boolean }>("pars", pid);
export const useSuppliers = (pid: string | null) => useProcurement<{ suppliers: SupplierView[]; catalogue: CatalogueView[]; mayEdit: boolean; currency: string }>("suppliers", pid);
export const usePrices = (pid: string | null, ingredientId: string | null) => useProcurement<{ points: PricePoint[]; above: PricePoint[] }>(ingredientId ? "prices" : null, pid, { ingredientId });
export const useOutbox = (pid: string | null) => useProcurement<{ emails: OutboxEmail[] }>("outbox", pid);
export interface SettingsOut {
  settings: PurchasingSettings; valuationLabel: string; currency: string; mayChange: boolean; maySending: boolean; autoSend: boolean;
  vat: { scheme: string; label: string; rates: { area: string; rate: number }[] };
  limits: { accountingAbove: number; fnbAbove: number; fnbLabel: string; managerAbove: number; managerLabel: string };
  statuses: { id: string; label: string }[];
}
export const usePurchasingSettings = (pid: string | null) => useProcurement<SettingsOut>("settings", pid);

export function useExpiring(pid: string | null, days = 3) {
  const entries = useSessionEntries();
  const version = usePlanDrafts((s) => s.version);
  return usePost<{ rows: ExpiryRow[]; totals: { batches: number; atRisk: number; value: number; atRiskValue: number; expired: number }; days: number; currency: string; noBatchItems: number }>("/api/stock/expiry", pid ? { propertyId: pid, days, version, ...entries } : null);
}

export function useStockTakes(pid: string | null) {
  const version = usePlanDrafts((s) => s.version);
  return useApi<{ takes: StockTakeView[]; mayDecide: boolean; mayCount: boolean }>(pid ? `/api/stock/takes?propertyId=${pid}&v=${version}` : null);
}
export function useStockTake(id: string | null) {
  const version = usePlanDrafts((s) => s.version);
  const res = useApi<{ take: StockTakeView; mayDecide: boolean }>(id ? `/api/stock/takes?id=${encodeURIComponent(id)}&v=${version}` : null);
  // Keep the last stock take on screen while a count saves and it reloads, so the list never blanks out mid-count.
  const [last, setLast] = useState(res.data);
  if (res.data && res.data !== last) setLast(res.data);
  return { data: res.data ?? (last?.take.id === id ? last : undefined), error: res.error };
}
export interface MonthEndOut {
  month: string; currency: string;
  takes: { id: string; date: string; location: string; kind: string; counted: number; net: number; missing: number; surplus: number; systemValue: number; countedValue: number; approvedBy?: string }[];
  groups: { group: string; net: number; missing: number; surplus: number; items: number }[];
  totals: { net: number; missing: number; surplus: number; countedValue: number };
}
export function useMonthEnd(pid: string | null, month: string) {
  const version = usePlanDrafts((s) => s.version);
  return useApi<MonthEndOut>(pid ? `/api/stock/takes?propertyId=${pid}&month=${month}&v=${version}` : null);
}

export function useCash(pid: string | null) {
  const version = usePlanDrafts((s) => s.version);
  return useApi<{ rows: CashRow[]; totals: { shifts: number; flagged: number; short: number; over: number; cash: number }; currency: string; days: number; mayRecord: boolean; outlets: { id: string; name: string }[] }>(pid ? `/api/money/cash?propertyId=${pid}&v=${version}` : null);
}

/** Sends a change and refreshes every purchasing and stock screen. Returns the reply, or throws with the server's message. */
export function useProcAction() {
  const bump = usePlanDrafts((s) => s.bump);
  return useCallback(async <T,>(url: string, body: Record<string, unknown>): Promise<T> => {
    const r = await api<T>(url, { method: "POST", body });
    bump();
    return r;
  }, [bump]);
}
