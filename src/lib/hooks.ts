"use client";
import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { STAFF, USERS, outletById, staffById, userById } from "./data/catalog";
import { getDataset, rememberOrders } from "./data/dataset";
import { allowedOutlets, allowedProperties, clampScope, hasWholeProperty, scopeCurrency, scopeOutlets } from "./domain/access";
import { detectPatterns } from "./domain/detect";
import type { StockInputs } from "./domain/inventory";
import { exceptionInSel, listInvestigations, type Ctx, type Sel } from "./domain/metrics";
import { currentRange, useDemo } from "./store";
import type { ForecastInputs } from "./domain/forecast";
import type { ForecastOut, StockRowOut } from "./server/stock";
import type { Currency, Investigation, Order, User } from "./types";
import { DEMO_TODAY, fmtMoney } from "./util";

export function useUser(): User | null {
  const userId = useDemo((s) => s.userId);
  return userId ? (userById[userId] ?? null) : null;
}

/** The dataset merged with everything changed in this session. */
export function useCtx(): Ctx {
  const wasteLogs = useDemo((s) => s.wasteLogs);
  const counts = useDemo((s) => s.counts);
  const overrides = useDemo((s) => s.priceOverrides);
  const investigations = useDemo((s) => s.investigations);
  const stockCases = useDemo((s) => s.stockCases);
  return useMemo(() => {
    const base = getDataset();
    // Stock cases opened in this session join the flagged transactions everywhere cases are listed.
    const data = stockCases.length ? { ...base, exceptions: [...base.exceptions, ...stockCases] } : base;
    return { data, waste: [...data.wasteLogs, ...wasteLogs], counts: [...data.counts, ...counts], overrides, investigations };
  }, [wasteLogs, counts, overrides, investigations, stockCases]);
}

export function useStockInputs(): StockInputs {
  const ctx = useCtx();
  return useMemo(
    () => ({ dayItems: ctx.data.dayItems, counts: ctx.counts, deliveries: ctx.data.deliveries, transfers: ctx.data.transfers, waste: ctx.waste }),
    [ctx],
  );
}

export interface View {
  user: User;
  sel: Sel;
  currency: Currency;
  money: (n: number, opts?: { compact?: boolean; decimals?: boolean }) => string;
  /** Property in view, when the scope resolves to exactly one. */
  propertyId: string | null;
}

/** The current selection: what the signed-in user asked for, clamped to what they may see. */
export function useView(): View {
  const user = useUser()!;
  const rawScope = useDemo((s) => s.scope);
  const preset = useDemo((s) => s.preset);
  const custom = useDemo((s) => s.custom);
  return useMemo(() => {
    const scope = clampScope(user, rawScope);
    const outletIds = scopeOutlets(user, scope);
    const currency = scopeCurrency(user, scope);
    const props = [...new Set(outletIds.map((id) => outletById[id].propertyId))];
    const wholeProperties = scope.outletId === "all" ? props.filter((p) => hasWholeProperty(user, p)) : [];
    return {
      user,
      currency,
      propertyId: props.length === 1 ? props[0] : null,
      sel: { outletIds, wholeProperties, dept: scope.dept, range: currentRange({ preset, custom }), currency },
      money: (n, opts) => fmtMoney(n, currency, opts),
    };
  }, [user, rawScope, preset, custom]);
}

/** Every investigation the signed-in user is allowed to see, across all dates. */
export function useInvestigations(): Investigation[] {
  const ctx = useCtx();
  const user = useUser()!;
  return useMemo(() => {
    const access = { outletIds: allowedOutlets(user), wholeProperties: allowedProperties(user).filter((p) => hasWholeProperty(user, p)) };
    return listInvestigations(ctx).filter((e) => exceptionInSel(e, access));
  }, [ctx, user]);
}

export function usePatterns() {
  return useMemo(() => detectPatterns(getDataset().exceptions, DEMO_TODAY), []);
}

export const personName = (id?: string) => (id ? (userById[id]?.name ?? staffById[id]?.name ?? id) : "Unassigned");

/** People an investigation can be given to: the outlet's own supervisors and managers, then the demo accounts with access. */
export function assignablePeople(outletId: string | undefined, propertyId: string): { id: string; label: string }[] {
  const staff = STAFF.filter((s) => s.outletId === outletId && (s.role === "manager" || s.role === "supervisor")).map((s) => ({ id: s.id, label: `${s.name}, ${s.role}` }));
  const users = USERS.filter((u) => u.role !== "employee" && allowedProperties(u).includes(propertyId) && (!outletId || allowedOutlets(u).includes(outletId)) && !staff.some((s) => s.id === u.staffId)).map((u) => ({ id: u.id, label: `${u.name}, ${u.title.split(",")[0]}` }));
  return [...staff, ...users];
}

/** Reads a protected API endpoint. Returns undefined while loading and null if the request failed. */
export function useApi<T>(url: string | null): { data: T | undefined | null; error?: string } {
  const [state, setState] = useState<{ url: string; data: T | null; error?: string } | null>(null);
  useEffect(() => {
    if (!url) return;
    let live = true;
    api<T>(url)
      .then((data) => live && setState({ url, data }))
      .catch((e: unknown) => live && setState({ url, data: null, error: e instanceof Error ? e.message : "Could not load." }));
    return () => {
      live = false;
    };
  }, [url]);
  if (!url) return { data: null };
  return state && state.url === url ? { data: state.data, error: state.error } : { data: undefined };
}

/** One order, fetched from the server the first time it is needed. */
export function useOrder(id: string | undefined): { order: Order | undefined; status: "loading" | "ready" | "missing" } {
  const cached = id ? getDataset().ordersById.get(id) : undefined;
  const { data } = useApi<{ order: Order }>(id && !cached ? `/api/orders/${encodeURIComponent(id)}` : null);
  if (!id) return { order: undefined, status: "missing" };
  if (cached) return { order: cached, status: "ready" };
  if (data === undefined) return { order: undefined, status: "loading" };
  if (!data) return { order: undefined, status: "missing" };
  rememberOrders([data.order]);
  return { order: data.order, status: "ready" };
}

/** Posts to a protected endpoint whenever the body changes. Keeps the last answer on screen while a new one loads. */
function usePost<T>(url: string, body: unknown | null, delayMs = 0): { data: T | undefined; loading: boolean; error?: string } {
  const key = body === null ? null : JSON.stringify(body);
  const [state, setState] = useState<{ key: string; data?: T; error?: string } | null>(null);
  useEffect(() => {
    if (key === null) return;
    let live = true;
    const t = setTimeout(() => {
      api<T>(url, { method: "POST", body: JSON.parse(key) })
        .then((data) => live && setState({ key, data }))
        .catch((e: unknown) => live && setState((s) => ({ key, data: s?.data, error: e instanceof Error ? e.message : "Could not load." })));
    }, delayMs);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [url, key, delayMs]);
  return { data: state?.data, loading: key !== null && state?.key !== key, error: state?.key === key ? state.error : undefined };
}

/** This session's own entries, sent along so the server's figures include them. */
function useSessionEntries() {
  const waste = useDemo((s) => s.wasteLogs);
  const counts = useDemo((s) => s.counts);
  const overrides = useDemo((s) => s.priceOverrides);
  return useMemo(() => ({ waste: waste.filter((w) => w.synced), counts, overrides }), [waste, counts, overrides]);
}

/** Stock worked out on the server from every outlet's use of the shared store. */
export function useServerStock(propertyId: string | null) {
  const entries = useSessionEntries();
  return usePost<{ rows: StockRowOut[] }>("/api/stock", propertyId ? { propertyId, ...entries } : null);
}

/** Forecast and purchase suggestions worked out on the server. Slider changes are sent after a short pause. */
export function useServerForecast(propertyId: string | null, inputs?: ForecastInputs) {
  const entries = useSessionEntries();
  return usePost<ForecastOut>("/api/forecast", propertyId ? { propertyId, inputs, ...entries } : null, inputs ? 250 : 0);
}
