"use client";
// What a user changes during the demo. Decisions and corrections (investigations, stock cases, recounts, standards,
// delivery differences, prices, approvals, order status, closed notices, resolve and snooze on Alerts) are saved on the
// demo server: each action runs
// the shared rules in lib/domain/records.ts for an instant answer, then the change is sent to /api/records, where the
// server runs the same rules with the person's own session and keeps it with the person and the role
// (lib/records-sync.ts). Only this device's queue of unsent entries and view settings stay in the browser. The trail of
// saved changes (`audit`) is written only by those rules and by the server, so every line in it carries the role.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ingredientById, userById } from "./data/catalog";
import { getDataset } from "./data/dataset";
import { AccessError, assertCan, clampScope, hasWholeProperty, type Permission } from "./domain/access";
import type { ForecastInputs } from "./domain/forecast";
import { RECORD_KEYS, applyRecordOp, emptyRecords, type AlertStateName, type CloseInput, type RecordEnv, type RecordOp, type Records } from "./domain/records";
import type { FlowSim } from "./domain/operations";
import type {
  Arrival, CountRecord, UsagePeriod, WasteCorrection, DateRange, FlowStatus, Room, Scope, User, WasteLog, WasteReason,
} from "./types";
import { DATA_START, DEMO_NOW_MIN, DEMO_TODAY, addDays, presetRange, type RangePreset } from "./util";

export type Result = { ok: true } | { ok: false; error: string };

export type { PurchaseApproval } from "./domain/records";

/** A change made on this device that the server has not confirmed yet. */
export interface PendingOp { key: string; userId: string; op: RecordOp }

interface Persisted {
  userId: string | null;
  scope: Scope;
  /** Whose selection `scope` is, and each person's last selection, so one account never inherits another's. */
  scopeOwner: string | null;
  scopes: Record<string, Scope>;
  preset: RangePreset;
  custom: DateRange;
  seq: number;
  /** Waste, corrections and counts made on this device, waiting to be uploaded (offline entries wait here). */
  wasteCorrections: WasteCorrection[];
  wasteLogs: WasteLog[];
  counts: CountRecord[];
  /** Changes to the saved records not yet confirmed by the server, oldest first. */
  pendingOps: PendingOp[];
  flowSim: FlowSim;
  roomState: Record<string, Partial<Room>>;
  arrivalState: Record<string, Arrival["status"]>;
  requestsDone: Record<string, boolean>;
  offline: boolean;
  tourOpen: boolean;
  tourStep: number;
}

/** Saved records, as the server last sent them for this person, with this device's unconfirmed changes on top. */
type RecordState = Records;

interface Actions {
  /** Mirrors the server session. Only the shell calls this, after the server has confirmed who is signed in. */
  signIn(userId: string): void;
  signOut(): void;
  setScope(scope: Partial<Scope>): void;
  setPreset(preset: RangePreset): void;
  setCustom(range: DateRange): Result;
  assignInvestigation(id: string, assigneeId: string, deadline: string): Result;
  addNote(id: string, text: string): Result;
  startReview(id: string): Result;
  closeInvestigation(id: string, input: CloseInput): Result;
  reopenInvestigation(id: string): Result;
  /** Opens an investigation into a count shortfall, charged to one outlet. Returns the existing case if one is already open. */
  openStockCase(countId: string, outletId: string): Result & { id?: string };
  /** Opens a case for an outlet stock period that did not open one by itself. Returns the existing case if there is one. */
  openVarianceCase(period: UsagePeriod): Result & { id?: string };
  /** A late entry names the period it belongs to and the day it happened. */
  logWaste(input: { outletId: string; ingredientId?: string; itemId?: string; qty: number; reason: WasteReason; date?: string; periodId?: string }): Result;
  correctWaste(wasteId: string, qty: number, reason: string): Result;
  recordRecount(input: { checkId: string; outletId: string; ingredientId: string; counted: number; reason: string }): Result;
  setStandardQty(input: { itemId: string; ingredientId: string; qty: number; from: string; reason: string }): Result;
  recordReceipt(input: { deliveryId: string; ingredientId: string; received: number; reason: string }): Result;
  dismissAlert(id: string): void;
  /** Resolve, snooze or reopen an alert for the person signed in. `label` is the alert as they read it. */
  setAlertState(id: string, state: AlertStateName, label?: string): Result;
  syncWaste(): void;
  setOffline(offline: boolean): void;
  /** Removes this device's copies of entries now saved on the server. */
  dropUploaded(ids: { waste?: string[]; counts?: string[] }): void;
  /** The expected quantity and how a difference is shared between outlets both come from the server's stock figures. */
  recordCount(input: { propertyId: string; ingredientId: string; counted: number; expected: number; allocation: Record<string, number> }): Result;
  setIngredientPrice(ingredientId: string, cost: number): Result;
  overrideIngredientPrice(ingredientId: string, cost: number, reason: string): Result;
  clearIngredientPrice(ingredientId: string): Result;
  approvePurchases(propertyId: string, lines: { ingredientId: string; qty: number; cost: number }[]): Result;
  withdrawApproval(id: string): Result;
  setForecastInputs(propertyId: string, inputs: ForecastInputs): void;
  setFlowStatus(orderId: string, status: FlowStatus): Result;
  setFlowSim(sim: Partial<FlowSim>): void;
  updateRoom(roomId: string, patch: Partial<Room>): Result;
  setArrivalStatus(arrivalId: string, status: Arrival["status"]): Result;
  completeRequest(requestId: string): Result;
  setTour(open: boolean, step?: number): void;
  resetDemo(): void;
}

interface SyncActions {
  /** Takes the server's records for this person, drops a confirmed change, and puts the unconfirmed ones back on top. */
  receiveRecords(records: Records, confirmed?: string): void;
  /** Forgets a change the server refused. */
  dropPending(key: string): void;
}

export type DemoState = Persisted & RecordState & Actions & SyncActions;

const initial = (): Persisted & RecordState => ({
  ...emptyRecords(),
  pendingOps: [],
  userId: null,
  scope: { propertyId: "all", outletId: "all", dept: "all" },
  scopeOwner: null,
  scopes: {},
  preset: "week",
  custom: { from: addDays(DEMO_TODAY, -13), to: DEMO_TODAY },
  seq: 0,
  wasteCorrections: [],
  wasteLogs: [],
  counts: [],
  flowSim: { kitchenExtra: 0, barExtra: 0 },
  roomState: {},
  arrivalState: {},
  requestsDone: {},
  offline: false,
  tourOpen: false,
  tourStep: 0,
});

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const fail = (error: string): Result => ({ ok: false, error });

/** Waste entries with their latest correction applied. Cancelled entries drop out; the originals stay in the store. */
export function correctedWaste(logs: readonly WasteLog[], corrections: readonly WasteCorrection[]): WasteLog[] {
  if (corrections.length === 0) return [...logs];
  return logs.flatMap((w) => {
    const c = corrections.filter((x) => x.wasteId === w.id).sort((a, b) => b.seq - a.seq)[0];
    if (!c) return [w];
    return c.qty > 0 ? [{ ...w, qty: c.qty }] : [];
  });
}
const OK: Result = { ok: true };

/** What the browser keeps between visits: view settings and this device's unsent entries, never the saved records. */
export const storagePolicy = {
  partialize(s: object): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    // Identity is never persisted: it always comes from the server session. Saved records come from the server
    // too, for the person signed in, so nothing one role saw stays in the browser for the next.
    const server = new Set<string>(RECORD_KEYS);
    for (const [k, v] of Object.entries(s)) if (typeof v !== "function" && k !== "userId" && !server.has(k)) out[k] = v;
    return out;
  },
  // Version 1 kept decisions and prices in the browser. They are dropped: the server is now the record.
  migrate(persisted: unknown): Record<string, unknown> {
    const out = { ...(persisted as Record<string, unknown>) };
    for (const k of [...RECORD_KEYS, "approvals", "forecastInputs"]) delete out[k];
    return out;
  },
};

export const useDemo = create<DemoState>()(
  persist(
    (set, get) => {
      const me = (): User | undefined => (get().userId ? userById[get().userId!] : undefined);

      /** Runs a guarded change. Permission failures come back as a message instead of an exception. */
      const guarded = (permission: Permission, outletId: string | undefined, run: (user: User) => Result): Result => {
        try {
          const user = me();
          assertCan(user, permission, outletId);
          return run(user);
        } catch (e) {
          if (e instanceof AccessError) return fail(e.message);
          throw e;
        }
      };

      /** The rules' view of the world from this browser's copy of the data. The server checks again with its own. */
      const env = (): RecordEnv => {
        const s = get();
        const d = getDataset();
        return {
          user: me(), today: DEMO_TODAY, nowMin: DEMO_NOW_MIN, now: new Date().toISOString(), dataStart: DATA_START,
          exception: (id) => d.exceptions.find((e) => e.id === id),
          exceptionForPeriod: (pid) => d.exceptions.find((e) => e.period?.id === pid),
          seedState: (id) => d.seedInvestigations[id],
          count: (id) => [...d.counts, ...s.counts].find((c) => c.id === id),
          period: (p) => p,
          // The browser holds no stock periods: the screen's own count is passed through, and the server checks it.
          countCheck: (_id, c) => (c.outletId && c.ingredientId ? { outletId: c.outletId, ingredientId: c.ingredientId } : null),
          delivery: (id) => d.deliveries.find((x) => x.id === id),
          liveOrderOutlet: (id) => d.liveOrders.find((o) => o.id === id)?.outletId,
          waste: () => correctedWaste(s.wasteLogs, s.wasteCorrections),
        };
      };
      const records = (s: DemoState): Records => Object.fromEntries(RECORD_KEYS.map((k) => [k, s[k]])) as unknown as Records;
      let opCount = 0;
      /** Applies a change here at once and queues it for the server, which keeps it with the person and role. */
      const run = (op: RecordOp): Result & { id?: string } => {
        const before = records(get());
        const r = applyRecordOp(before, op, env());
        if (!r.ok) return fail(r.error);
        if (r.rec === before) return r.id ? { ok: true, id: r.id } : OK;
        const userId = get().userId!;
        const key = `${Date.now().toString(36)}-${(opCount++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        set((s) => ({ ...r.rec, pendingOps: [...s.pendingOps, { key, userId, op }] }));
        return r.id ? { ok: true, id: r.id } : OK;
      };

      return {
        ...initial(),

        signIn(userId) {
          const user = userById[userId];
          if (!user) return;
          set((s) => {
            if (s.scopeOwner === userId) return { userId, scope: clampScope(user, s.scope) };
            // A different person: keep the previous person's selection for them, and start from this person's own.
            const scopes = s.scopeOwner ? { ...s.scopes, [s.scopeOwner]: s.scope } : s.scopes;
            // When the public demo changes role, stay on the hotel that was in view, so every page shows the same figures.
            const fresh: Scope = { propertyId: s.scopeOwner ? s.scope.propertyId : "all", outletId: "all", dept: "all" };
            return { userId, scopeOwner: userId, scopes, scope: clampScope(user, scopes[userId] ?? fresh) };
          });
        },
        signOut() {
          set({ userId: null });
        },
        setScope(scope) {
          const user = me();
          if (!user) return;
          set((s) => {
            const next = { ...s.scope, ...scope };
            if (scope.propertyId !== undefined && scope.outletId === undefined) next.outletId = "all";
            const scoped = clampScope(user, next);
            return { scope: scoped, scopeOwner: user.id, scopes: { ...s.scopes, [user.id]: scoped } };
          });
        },
        setPreset(preset) {
          set({ preset });
        },
        setCustom(range) {
          if (!ISO_DATE.test(range.from) || !ISO_DATE.test(range.to)) return fail("Enter both dates.");
          if (range.from > range.to) return fail("The start date is after the end date.");
          if (range.from < addDays(DATA_START, 31)) return fail(`Choose a start date on or after ${addDays(DATA_START, 31)}, so the previous period can be compared.`);
          if (range.to > DEMO_TODAY) return fail("The end date cannot be in the future.");
          set({ custom: range, preset: "custom" });
          return OK;
        },

        assignInvestigation(id, assigneeId, deadline) {
          return run({ kind: "investigation.assign", id, assigneeId, deadline });
        },
        addNote(id, text) {
          return run({ kind: "investigation.note", id, text });
        },
        startReview(id) {
          return run({ kind: "investigation.review", id });
        },
        closeInvestigation(id, input) {
          return run({ kind: "investigation.close", id, input });
        },
        reopenInvestigation(id) {
          return run({ kind: "investigation.reopen", id });
        },
        openStockCase(countId, outletId) {
          return run({ kind: "case.fromCount", countId, outletId });
        },
        openVarianceCase(period) {
          return run({ kind: "case.fromPeriod", period });
        },
        correctWaste(wasteId, qty, reason) {
          const w = get().wasteLogs.find((x) => x.id === wasteId);
          if (!w) return fail("Only entries made in Tyll can be corrected here.");
          return guarded("stock.logWaste", w.outletId, (user) => {
            if (!Number.isFinite(qty) || qty < 0 || qty > 500) return fail("Enter the correct quantity, or zero to cancel the entry.");
            if (reason.trim().length < 3) return fail("Say why the entry is being corrected.");
            const seq = get().seq + 1;
            set((s) => ({ seq, wasteCorrections: [...s.wasteCorrections, { id: `WC-${seq}`, wasteId, qty, reason: reason.trim(), by: user.id, seq }] }));
            return OK;
          });
        },
        recordRecount(input) {
          return run({ kind: "stock.recount", ...input });
        },
        setStandardQty(input) {
          return run({ kind: "recipe.standard", ...input });
        },
        recordReceipt(input) {
          return run({ kind: "delivery.receipt", ...input });
        },
        dismissAlert(id) {
          if (get().userId) run({ kind: "alert.dismiss", id });
        },
        setAlertState(id, state, label) {
          if (!get().userId) return fail("Sign in to continue.");
          return run({ kind: "alert.state", id, state, label });
        },
        logWaste(input) {
          return guarded("stock.logWaste", input.outletId, (user) => {
            if (!input.ingredientId && !input.itemId) return fail("Choose an item.");
            const date = input.date ?? DEMO_TODAY;
            if (!ISO_DATE.test(date) || date > DEMO_TODAY || date < addDays(DEMO_TODAY, -7)) return fail("Late entries can go back up to seven days.");
            if (!Number.isFinite(input.qty) || input.qty <= 0) return fail("Enter a quantity above zero.");
            if (input.qty > 500) return fail("That quantity looks too large. Check the amount.");
            const seq = get().seq + 1;
            const entry: WasteLog = {
              id: `W-USER-${seq}`, outletId: input.outletId, date, periodId: input.periodId, ingredientId: input.ingredientId, itemId: input.itemId,
              qty: input.qty, reason: input.reason, by: user.staffId ?? user.id, synced: !get().offline, seq,
            };
            set((s) => ({ seq, wasteLogs: [...s.wasteLogs, entry] }));
            return OK;
          });
        },
        syncWaste() {
          if (!get().wasteLogs.some((w) => !w.synced)) return;
          set((s) => ({ wasteLogs: s.wasteLogs.map((w) => ({ ...w, synced: true })) }));
        },
        setOffline(offline) {
          set({ offline });
          if (!offline) get().syncWaste();
        },
        dropUploaded({ waste = [], counts = [] }) {
          const w = new Set(waste), c = new Set(counts);
          set((s) => ({ wasteLogs: s.wasteLogs.filter((x) => !w.has(x.id)), wasteCorrections: s.wasteCorrections.filter((x) => !w.has(x.wasteId)), counts: s.counts.filter((x) => !c.has(x.id)) }));
        },
        recordCount(input) {
          return guarded("stock.count", undefined, (user) => {
            // Staff counts wait for a manager's review, so they are submitted from Tyll Staff.
            if (user.role === "employee" || user.role === "storekeeper") return fail("Submit counts from Tyll Staff, so a manager can review them.");
            if (!user.propertyIds.includes(input.propertyId) && user.propertyIds !== "all") return fail("This property is outside your access.");
            if (!ingredientById[input.ingredientId]) return fail("Choose an item to count.");
            if (!Number.isFinite(input.counted) || input.counted < 0) return fail("Enter the quantity you counted.");
            if (!Number.isFinite(input.expected)) return fail("Stock figures are not loaded yet.");
            const s = get();
            const seq = s.seq + 1;
            const record: CountRecord = {
              id: `C-USER-${seq}`, propertyId: input.propertyId, ingredientId: input.ingredientId, date: DEMO_TODAY, kind: "spot",
              expected: Math.round(input.expected * 100) / 100, counted: input.counted, by: user.staffId ?? user.id, seq,
              allocation: ingredientById[input.ingredientId].dept === "glassware" ? {} : input.allocation,
            };
            set((st) => ({ seq, counts: [...st.counts, record] }));
            return OK;
          });
        },
        setIngredientPrice(ingredientId, cost) {
          return run({ kind: "price.set", ingredientId, cost });
        },
        overrideIngredientPrice(ingredientId, cost, reason) {
          return run({ kind: "price.override", ingredientId, cost, reason });
        },
        clearIngredientPrice(ingredientId) {
          return run({ kind: "price.clear", ingredientId });
        },
        approvePurchases(propertyId, lines) {
          return run({ kind: "purchase.approve", propertyId, lines });
        },
        withdrawApproval(id) {
          return run({ kind: "purchase.withdraw", id });
        },
        setForecastInputs(propertyId, inputs) {
          if (get().userId) run({ kind: "forecast.inputs", propertyId, inputs });
        },
        setFlowStatus(orderId, status) {
          return run({ kind: "flow.status", orderId, status });
        },
        setFlowSim(sim) {
          set((s) => ({ flowSim: { ...s.flowSim, ...sim } }));
        },

        updateRoom(roomId, patch) {
          const room = getDataset().rooms.find((r) => r.id === roomId);
          if (!room) return fail("Unknown room.");
          return guarded("rooms.manage", undefined, (user) => {
            if (!hasWholeProperty(user, room.propertyId)) return fail("This property is outside your access.");
            set((s) => ({ roomState: { ...s.roomState, [roomId]: { ...s.roomState[roomId], ...patch } } }));
            return OK;
          });
        },
        setArrivalStatus(arrivalId, status) {
          const arrival = getDataset().arrivals.find((a) => a.id === arrivalId);
          if (!arrival) return fail("Unknown arrival.");
          return guarded("rooms.manage", undefined, (user) => {
            if (!hasWholeProperty(user, arrival.propertyId)) return fail("This property is outside your access.");
            set((s) => ({ arrivalState: { ...s.arrivalState, [arrivalId]: status } }));
            return OK;
          });
        },
        completeRequest(requestId) {
          const request = getDataset().requests.find((r) => r.id === requestId);
          if (!request) return fail("Unknown request.");
          return guarded("rooms.manage", undefined, (user) => {
            if (!hasWholeProperty(user, request.propertyId)) return fail("This property is outside your access.");
            set((s) => ({ requestsDone: { ...s.requestsDone, [requestId]: true } }));
            return OK;
          });
        },

        setTour(open, step) {
          set((s) => ({ tourOpen: open, tourStep: step ?? s.tourStep }));
        },
        receiveRecords(incoming, confirmed) {
          set((s) => {
            const pending = s.pendingOps.filter((p) => p.key !== confirmed);
            // This person's unconfirmed changes go back on top of the server's records; another person's never do.
            let rec = { ...emptyRecords(), ...incoming };
            for (const p of pending) {
              if (p.userId !== s.userId) continue;
              const r = applyRecordOp(rec, p.op, env());
              if (r.ok) rec = r.rec;
            }
            return { ...rec, pendingOps: pending };
          });
        },
        dropPending(key) {
          set((s) => ({ pendingOps: s.pendingOps.filter((p) => p.key !== key) }));
        },
        resetDemo() {
          const userId = get().userId;
          set({ ...initial(), userId });
          const user = me();
          if (user) set((s) => ({ scope: clampScope(user, s.scope) }));
        },
      };
    },
    {
      name: "tyll-demo-v1",
      version: 2,
      partialize: (s) => storagePolicy.partialize(s) as unknown as DemoState,
      migrate: (persisted) => storagePolicy.migrate(persisted) as unknown as DemoState,
    },
  ),
);

export const currentRange = (s: Pick<Persisted, "preset" | "custom">): DateRange => (s.preset === "custom" ? s.custom : presetRange(s.preset));
