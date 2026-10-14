"use client";
// Everything a user changes during the demo lives here and is saved in the browser.
// Each action checks the signed-in user's permissions before it changes anything, and writes an audit entry.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ingredientById, itemById, outletById, propertyById, staffById, storeOwner, userById } from "./data/catalog";
import { getDataset } from "./data/dataset";
import { AccessError, assertCan, clampScope, hasWholeProperty, type Permission } from "./domain/access";
import type { ForecastInputs } from "./domain/forecast";
import { countVariance, countVarianceValue } from "./domain/inventory";
import { headlineFor, periodVariance, type Adjustments } from "./domain/variance";
import type { FlowSim } from "./domain/operations";
import type {
  Arrival, AuditEntry, CountRecord, Exception, ReceiptCorrection, RecipeChange, Recount, UsagePeriod, WasteCorrection, DateRange, FlowStatus, InvestigationState, Outcome, PriceChange, Room, Scope, User, WasteLog, WasteReason,
} from "./types";
import { DATA_START, DEMO_NOW_MIN, DEMO_TODAY, addDays, fmtDate, fmtQty, presetRange, type RangePreset } from "./util";

export type Result = { ok: true } | { ok: false; error: string };

export interface PurchaseApproval {
  id: string;
  propertyId: string;
  ingredientId: string;
  qty: number;
  cost: number;
  approvedBy: string;
  at: string;
}

interface Persisted {
  userId: string | null;
  scope: Scope;
  preset: RangePreset;
  custom: DateRange;
  lang: "en" | "ar";
  seq: number;
  investigations: Record<string, InvestigationState>;
  /** Cases opened by hand from a stock count shortfall. */
  stockCases: Exception[];
  /** Stock corrections. Each keeps the original record and says who changed what, and why. */
  recounts: Recount[];
  recipeChanges: RecipeChange[];
  wasteCorrections: WasteCorrection[];
  receiptCorrections: ReceiptCorrection[];
  /** Daily alerts the user has closed. */
  dismissedAlerts: string[];
  wasteLogs: WasteLog[];
  counts: CountRecord[];
  priceOverrides: PriceChange[];
  approvals: PurchaseApproval[];
  forecastInputs: Record<string, ForecastInputs>;
  flowStatus: Record<string, FlowStatus>;
  flowSim: FlowSim;
  roomState: Record<string, Partial<Room>>;
  arrivalState: Record<string, Arrival["status"]>;
  requestsDone: Record<string, boolean>;
  audit: AuditEntry[];
  offline: boolean;
  tourOpen: boolean;
  tourStep: number;
}

interface Actions {
  /** Mirrors the server session. Only the shell calls this, after the server has confirmed who is signed in. */
  signIn(userId: string): void;
  signOut(): void;
  setScope(scope: Partial<Scope>): void;
  setPreset(preset: RangePreset): void;
  setCustom(range: DateRange): Result;
  setLang(lang: "en" | "ar"): void;
  assignInvestigation(id: string, assigneeId: string, deadline: string): Result;
  addNote(id: string, text: string): Result;
  startReview(id: string): Result;
  closeInvestigation(id: string, input: { outcome: Outcome; confirmedLoss: number; recovered: number; note: string; verifiedCause?: string; correctiveAction?: string }): Result;
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
  syncWaste(): void;
  setOffline(offline: boolean): void;
  /** Removes this device's copies of entries now saved on the server. */
  dropUploaded(ids: { waste?: string[]; counts?: string[] }): void;
  /** The expected quantity and how a difference is shared between outlets both come from the server's stock figures. */
  recordCount(input: { propertyId: string; ingredientId: string; counted: number; expected: number; allocation: Record<string, number> }): Result;
  setIngredientPrice(ingredientId: string, cost: number): Result;
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

export type DemoState = Persisted & Actions;

const initial = (): Persisted => ({
  userId: null,
  scope: { propertyId: "all", outletId: "all", dept: "all" },
  preset: "week",
  custom: { from: addDays(DEMO_TODAY, -13), to: DEMO_TODAY },
  lang: "en",
  seq: 0,
  investigations: {},
  stockCases: [],
  recounts: [],
  recipeChanges: [],
  wasteCorrections: [],
  receiptCorrections: [],
  dismissedAlerts: [],
  wasteLogs: [],
  counts: [],
  priceOverrides: [],
  approvals: [],
  forecastInputs: {},
  flowStatus: {},
  flowSim: { kitchenExtra: 0, barExtra: 0 },
  roomState: {},
  arrivalState: {},
  requestsDone: {},
  audit: [],
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

export const useDemo = create<DemoState>()(
  persist(
    (set, get) => {
      const me = (): User | undefined => (get().userId ? userById[get().userId!] : undefined);
      const audit = (action: string, detail: string): AuditEntry => ({ at: new Date().toISOString(), userId: get().userId ?? "unknown", action, detail });
      const log = (action: string, detail: string) => set((s) => ({ audit: [audit(action, detail), ...s.audit].slice(0, 400) }));

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

      const exceptionOf = (id: string) => get().stockCases.find((e) => e.id === id) ?? getDataset().exceptions.find((e) => e.id === id);
      const adjustments = (): Adjustments => {
        const s = get();
        return { recounts: s.recounts, recipes: s.recipeChanges, waste: correctedWaste(s.wasteLogs, s.wasteCorrections) };
      };
      /** For a usage case the amount at stake follows the current figures, so corrections are reflected. */
      const exposureOf = (e: Exception) => (e.period ? Math.max(0, Math.round(periodVariance(e.period, adjustments()).value * 100) / 100) : e.exposure);
      const currentState = (id: string): InvestigationState => get().investigations[id] ?? getDataset().seedInvestigations[id];
      const guardInvestigation = (permission: Permission, id: string, run: (user: User, state: InvestigationState, exposure: number) => Result): Result => {
        const e = exceptionOf(id);
        if (!e) return fail("This investigation no longer exists.");
        return guarded(permission, e.outletId, (user) => {
          if (!e.outletId && !hasWholeProperty(user, e.propertyId)) return fail("This record belongs to the whole property and is outside your access.");
          return run(user, currentState(id), exposureOf(e));
        });
      };
      const saveInvestigation = (id: string, state: InvestigationState) => set((s) => ({ investigations: { ...s.investigations, [id]: state } }));

      return {
        ...initial(),

        signIn(userId) {
          const user = userById[userId];
          if (!user) return;
          set((s) => ({ userId, scope: clampScope(user, s.scope) }));
          log("Signed in", user.name);
        },
        signOut() {
          log("Signed out", me()?.name ?? "");
          set({ userId: null });
        },
        setScope(scope) {
          const user = me();
          if (!user) return;
          set((s) => {
            const next = { ...s.scope, ...scope };
            if (scope.propertyId !== undefined && scope.outletId === undefined) next.outletId = "all";
            return { scope: clampScope(user, next) };
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
        setLang(lang) {
          set({ lang });
        },

        assignInvestigation(id, assigneeId, deadline) {
          return guardInvestigation("investigation.assign", id, (_u, state) => {
            if (state.status === "closed") return fail("Reopen the investigation before assigning it.");
            if (!assigneeId || !(userById[assigneeId] || staffById[assigneeId])) return fail("Choose who is responsible.");
            if (!ISO_DATE.test(deadline)) return fail("Choose a deadline.");
            if (deadline < DEMO_TODAY) return fail("The deadline cannot be in the past.");
            saveInvestigation(id, { ...state, status: state.status === "new" ? "assigned" : state.status, assigneeId, deadline });
            log("Investigation assigned", `${id} to ${assigneeId}, due ${deadline}`);
            return OK;
          });
        },
        addNote(id, text) {
          return guardInvestigation("investigation.note", id, (user, state) => {
            const clean = text.trim();
            if (clean.length < 3) return fail("Write a short note first.");
            if (clean.length > 600) return fail("Keep the note under 600 characters.");
            saveInvestigation(id, { ...state, notes: [...state.notes, { at: DEMO_TODAY, by: user.id, text: clean }] });
            log("Note added", id);
            return OK;
          });
        },
        startReview(id) {
          return guardInvestigation("investigation.note", id, (user, state) => {
            if (state.status === "closed") return fail("This investigation is closed.");
            saveInvestigation(id, { ...state, status: "in_review", assigneeId: state.assigneeId ?? user.id });
            log("Review started", id);
            return OK;
          });
        },
        closeInvestigation(id, input) {
          return guardInvestigation("investigation.close", id, (user, state, exposure) => {
            if (state.status === "closed") return fail("This investigation is already closed.");
            const { outcome, note } = input;
            const confirmedLoss = Math.round(input.confirmedLoss * 100) / 100;
            const recovered = Math.round(input.recovered * 100) / 100;
            if (!Number.isFinite(confirmedLoss) || !Number.isFinite(recovered) || confirmedLoss < 0 || recovered < 0) return fail("Amounts must be zero or more.");
            if (confirmedLoss + recovered > exposure + 0.005) return fail(`Loss and recovery together cannot be more than the ${exposure.toFixed(2)} involved.`);
            if (outcome === "confirmed_loss" && confirmedLoss <= 0) return fail("Enter the amount lost.");
            if (outcome === "recovered" && recovered <= 0) return fail("Enter the amount recovered.");
            if ((outcome === "legitimate" || outcome === "inconclusive") && confirmedLoss + recovered > 0) return fail("This outcome carries no amounts. Choose a loss or a recovery instead.");
            if (note.trim().length < 3) return fail("Add a short note on what you found.");
            const e = exceptionOf(id)!;
            const stockCase = e.type === "usage_variance" || e.type === "stock_shortfall";
            const verifiedCause = input.verifiedCause?.trim() || undefined;
            const correctiveAction = input.correctiveAction?.trim().slice(0, 400) || undefined;
            if (stockCase && outcome !== "inconclusive" && !verifiedCause) return fail("Choose the cause you verified, or record no finding.");
            saveInvestigation(id, {
              ...state, status: "closed", outcome, confirmedLoss, recovered, closedAt: DEMO_TODAY, closedBy: user.id, verifiedCause, correctiveAction,
              assigneeId: state.assigneeId ?? user.id,
              notes: [...state.notes, { at: DEMO_TODAY, by: user.id, text: note.trim() }],
            });
            log("Investigation closed", `${id}: ${outcome}, loss ${confirmedLoss}, recovered ${recovered}`);
            return OK;
          });
        },
        reopenInvestigation(id) {
          return guardInvestigation("investigation.reopen", id, (user, state) => {
            if (state.status !== "closed") return fail("This investigation is already open.");
            saveInvestigation(id, {
              ...state, status: "in_review", outcome: undefined, confirmedLoss: 0, recovered: 0, closedAt: undefined, closedBy: undefined, verifiedCause: undefined, correctiveAction: undefined,
              notes: [...state.notes, { at: DEMO_TODAY, by: user.id, text: "Reopened for another look." }],
            });
            log("Investigation reopened", id);
            return OK;
          });
        },

        openStockCase(countId, outletId) {
          return guarded("investigation.assign", outletId, (user) => {
            const count = [...getDataset().counts, ...get().counts].find((c) => c.id === countId);
            if (!count) return fail("This count no longer exists.");
            const outlet = outletById[outletId];
            if (!outlet || outlet.propertyId !== count.propertyId) return fail("Choose an outlet at this hotel.");
            const owner = storeOwner(count.propertyId, count.ingredientId);
            if (owner && owner !== outletId) return fail(`This item is held in ${outletById[owner].name}'s own store.`);
            const existing = get().stockCases.find((e) => e.countId === countId && e.outletId === outletId);
            if (existing) return { ok: true, id: existing.id };
            const value = -countVarianceValue(count, get().priceOverrides);
            if (value < 0.5) return fail("This count shows no shortfall.");
            const shares = count.allocation ?? {};
            const share = owner || Object.keys(shares).length === 0 ? 1 : (shares[outletId] ?? 0);
            if (share <= 0) return fail(`${outlet.name} did not use this item in the week before the count.`);
            const g = ingredientById[count.ingredientId];
            const exposure = Math.round(value * share * 100) / 100;
            const seq = get().seq + 1;
            const id = `EX-STK-${String(seq).padStart(3, "0")}`;
            const e: Exception = {
              id, type: "stock_shortfall", propertyId: count.propertyId, outletId, date: count.date, min: count.date === DEMO_TODAY ? DEMO_NOW_MIN : 7 * 60,
              countId, ingredientId: count.ingredientId, exposure,
              headline: `${g.name}: ${fmtQty(-countVariance(count) * share, g.unit)} short at the ${fmtDate(count.date)} count`,
            };
            set((s) => ({ seq, stockCases: [...s.stockCases, e], investigations: { ...s.investigations, [id]: { status: "new", notes: [], confirmedLoss: 0, recovered: 0 } } }));
            log("Stock case opened", `${id} by ${user.name}`);
            return { ok: true, id };
          });
        },
        openVarianceCase(period) {
          return guarded("investigation.assign", period.outletId, (user) => {
            const existing = [...get().stockCases, ...getDataset().exceptions].find((e) => e.period?.id === period.id);
            if (existing) return { ok: true, id: existing.id };
            const v = periodVariance(period, adjustments());
            if (v.unexplained <= 0) return fail("Nothing is unexplained in this period.");
            const seq = get().seq + 1;
            const id = `EX-STK-${String(seq).padStart(3, "0")}`;
            const e: Exception = {
              id, type: "usage_variance", propertyId: period.propertyId, outletId: period.outletId, date: period.to.date, min: period.to.min,
              ingredientId: period.ingredientId, exposure: Math.max(0, Math.round(v.value * 100) / 100), headline: headlineFor(period, v), period,
            };
            set((s) => ({ seq, stockCases: [...s.stockCases, e], investigations: { ...s.investigations, [id]: { status: "new", notes: [], confirmedLoss: 0, recovered: 0 } } }));
            log("Stock case opened", `${id} by ${user.name}`);
            return { ok: true, id };
          });
        },
        correctWaste(wasteId, qty, reason) {
          const w = get().wasteLogs.find((x) => x.id === wasteId);
          if (!w) return fail("Only entries made in Tyll can be corrected here.");
          return guarded("stock.logWaste", w.outletId, (user) => {
            if (!Number.isFinite(qty) || qty < 0 || qty > 500) return fail("Enter the correct quantity, or zero to cancel the entry.");
            if (reason.trim().length < 3) return fail("Say why the entry is being corrected.");
            const seq = get().seq + 1;
            set((s) => ({ seq, wasteCorrections: [...s.wasteCorrections, { id: `WC-${seq}`, wasteId, qty, reason: reason.trim(), by: user.id, seq }] }));
            log("Waste entry corrected", `${wasteId}: ${w.qty} to ${qty}. ${reason.trim()}`);
            return OK;
          });
        },
        recordRecount(input) {
          return guarded("stock.count", input.outletId, (user) => {
            if (!ingredientById[input.ingredientId]) return fail("Choose an item.");
            if (!Number.isFinite(input.counted) || input.counted < 0 || input.counted > 1e5) return fail("Enter the quantity you counted.");
            if (input.reason.trim().length < 3) return fail("Say why the item was recounted.");
            const seq = get().seq + 1;
            set((s) => ({ seq, recounts: [...s.recounts, { id: `RC-${seq}`, checkId: input.checkId, counted: input.counted, reason: input.reason.trim(), by: user.id, date: DEMO_TODAY, seq }] }));
            log("Recount recorded", `${input.checkId}: ${ingredientById[input.ingredientId].name} recounted at ${input.counted}. ${input.reason.trim()}`);
            return OK;
          });
        },
        setStandardQty(input) {
          return guarded("stock.editPrices", undefined, (user) => {
            const base = itemById[input.itemId]?.recipe?.find((l) => l.ingredientId === input.ingredientId)?.qty;
            if (base === undefined) return fail("This ingredient is not in that recipe.");
            if (!Number.isFinite(input.qty) || input.qty < base * 0.5 || input.qty > base * 2) return fail("Choose a quantity between half and double the current standard.");
            if (!ISO_DATE.test(input.from) || input.from > DEMO_TODAY) return fail("Choose the date the setting was wrong from.");
            if (input.reason.trim().length < 3) return fail("Say why the standard is changing.");
            const seq = get().seq + 1;
            set((s) => ({ seq, recipeChanges: [...s.recipeChanges, { id: `RQ-${seq}`, itemId: input.itemId, ingredientId: input.ingredientId, qty: input.qty, from: input.from, reason: input.reason.trim(), by: user.id, seq }] }));
            log("Standard quantity changed", `${itemById[input.itemId].name}: ${ingredientById[input.ingredientId].name} ${base} to ${input.qty} from ${input.from}. ${input.reason.trim()}`);
            return OK;
          });
        },
        recordReceipt(input) {
          const d = getDataset().deliveries.find((x) => x.id === input.deliveryId);
          if (!d) return fail("This delivery does not exist.");
          return guarded("stock.count", undefined, (user) => {
            if (user.propertyIds !== "all" && !user.propertyIds.includes(d.propertyId)) return fail("This property is outside your access.");
            const line = d.lines.find((l) => l.ingredientId === input.ingredientId);
            if (!line) return fail("This item is not on the delivery.");
            if (!Number.isFinite(input.received) || input.received < 0 || input.received > line.ordered * 3) return fail("Enter the quantity actually received.");
            if (input.reason.trim().length < 3) return fail("Say how the difference was found.");
            const seq = get().seq + 1;
            set((s) => ({ seq, receiptCorrections: [...s.receiptCorrections, { id: `RR-${seq}`, deliveryId: d.id, ingredientId: input.ingredientId, received: input.received, reason: input.reason.trim(), by: user.id, seq }] }));
            log("Delivery difference recorded", `${d.id}: ${ingredientById[input.ingredientId].name} received ${input.received}, recorded ${line.delivered}. ${input.reason.trim()}`);
            return OK;
          });
        },
        dismissAlert(id) {
          set((s) => ({ dismissedAlerts: [...new Set([...s.dismissedAlerts, id])] }));
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
            log("Waste logged", `${input.ingredientId ?? input.itemId} × ${input.qty} (${input.reason}) at ${outletById[input.outletId].name}${entry.synced ? "" : ", saved offline"}`);
            return OK;
          });
        },
        syncWaste() {
          const pending = get().wasteLogs.filter((w) => !w.synced).length;
          if (pending === 0) return;
          set((s) => ({ wasteLogs: s.wasteLogs.map((w) => ({ ...w, synced: true })) }));
          log("Offline entries synchronised", `${pending} waste entr${pending === 1 ? "y" : "ies"}`);
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
            log("Stock counted", `${ingredientById[input.ingredientId].name} at ${propertyById[input.propertyId].name}: counted ${input.counted}, expected ${record.expected}`);
            return OK;
          });
        },
        setIngredientPrice(ingredientId, cost) {
          return guarded("stock.editPrices", undefined, () => {
            if (!ingredientById[ingredientId]) return fail("Unknown ingredient.");
            if (!Number.isFinite(cost) || cost <= 0) return fail("Enter a price above zero.");
            if (cost > 100000) return fail("That price looks too high. Check the amount.");
            set((s) => ({ priceOverrides: [...s.priceOverrides.filter((p) => p.id !== ingredientId), { id: ingredientId, from: DEMO_TODAY, value: Math.round(cost * 100) / 100 }] }));
            log("Ingredient price changed", `${ingredientById[ingredientId].name} to AED ${cost.toFixed(2)} from ${DEMO_TODAY}`);
            return OK;
          });
        },
        approvePurchases(propertyId, lines) {
          return guarded("forecast.approve", undefined, (user) => {
            if (user.propertyIds !== "all" && !user.propertyIds.includes(propertyId)) return fail("This property is outside your access.");
            const valid = lines.filter((l) => l.qty > 0 && ingredientById[l.ingredientId]);
            if (valid.length === 0) return fail("Nothing to approve.");
            const at = new Date().toISOString();
            set((s) => ({
              approvals: [
                ...s.approvals.filter((a) => !(a.propertyId === propertyId && valid.some((l) => l.ingredientId === a.ingredientId))),
                ...valid.map((l) => ({ id: `AP-${propertyId}-${l.ingredientId}`, propertyId, ingredientId: l.ingredientId, qty: l.qty, cost: l.cost, approvedBy: user.id, at })),
              ],
            }));
            log("Purchase suggestions approved", `${valid.length} line${valid.length === 1 ? "" : "s"} at ${propertyById[propertyId].name}`);
            return OK;
          });
        },
        withdrawApproval(id) {
          return guarded("forecast.approve", undefined, () => {
            set((s) => ({ approvals: s.approvals.filter((a) => a.id !== id) }));
            log("Purchase approval withdrawn", id);
            return OK;
          });
        },
        setForecastInputs(propertyId, inputs) {
          set((s) => ({ forecastInputs: { ...s.forecastInputs, [propertyId]: inputs } }));
        },

        setFlowStatus(orderId, status) {
          const order = getDataset().liveOrders.find((o) => o.id === orderId);
          if (!order) return fail("This order is no longer on the board.");
          return guarded("flow.updateOrder", order.outletId, () => {
            set((s) => ({ flowStatus: { ...s.flowStatus, [orderId]: status } }));
            log("Order status changed", `${orderId} to ${status}`);
            return OK;
          });
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
            log("Room updated", `${room.number}: ${Object.entries(patch).map(([k, v]) => `${k} ${v}`).join(", ")}`);
            return OK;
          });
        },
        setArrivalStatus(arrivalId, status) {
          const arrival = getDataset().arrivals.find((a) => a.id === arrivalId);
          if (!arrival) return fail("Unknown arrival.");
          return guarded("rooms.manage", undefined, (user) => {
            if (!hasWholeProperty(user, arrival.propertyId)) return fail("This property is outside your access.");
            set((s) => ({ arrivalState: { ...s.arrivalState, [arrivalId]: status } }));
            log("Arrival updated", `${arrival.guest}: ${status}`);
            return OK;
          });
        },
        completeRequest(requestId) {
          const request = getDataset().requests.find((r) => r.id === requestId);
          if (!request) return fail("Unknown request.");
          return guarded("rooms.manage", undefined, (user) => {
            if (!hasWholeProperty(user, request.propertyId)) return fail("This property is outside your access.");
            set((s) => ({ requestsDone: { ...s.requestsDone, [requestId]: true } }));
            log("Guest request completed", `Room ${request.room}: ${request.text}`);
            return OK;
          });
        },

        setTour(open, step) {
          set((s) => ({ tourOpen: open, tourStep: step ?? s.tourStep }));
        },
        resetDemo() {
          const userId = get().userId;
          set({ ...initial(), userId });
          const user = me();
          if (user) set((s) => ({ scope: clampScope(user, s.scope) }));
          log("Demo data reset", "All changes made in this browser were cleared");
        },
      };
    },
    {
      name: "tyll-demo-v1",
      version: 1,
      partialize: (s) => {
        const out: Record<string, unknown> = {};
        // Identity is never persisted: it always comes from the server session.
        for (const [k, v] of Object.entries(s)) if (typeof v !== "function" && k !== "userId") out[k] = v;
        return out as unknown as DemoState;
      },
    },
  ),
);

export const currentRange = (s: Pick<Persisted, "preset" | "custom">): DateRange => (s.preset === "custom" ? s.custom : presetRange(s.preset));
