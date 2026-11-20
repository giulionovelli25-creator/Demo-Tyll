// Decisions and corrections people make in Tyll: investigation steps, stock cases opened by hand, recounts, standard
// quantities, delivery differences, ingredient prices, purchase approvals, order status and closed notices.
// One set of rules for both sides: the browser runs them for an instant answer, the demo server runs them again with
// the person's own session and keeps the result. Every change carries the person and the role that made it.
import { ingredientById, itemById, outletById, propertyById, staffById, storeOwner, userById } from "../data/catalog";
import { AccessError, assertCan, hasWholeProperty, type Permission } from "./access";
import { chargedToGuest } from "./detect";
import type { ForecastInputs } from "./forecast";
import { countVariance, countVarianceValue } from "./inventory";
import { headlineFor, periodVariance, type Adjustments } from "./variance";
import type {
  AuditEntry, CountRecord, Delivery, Exception, FlowStatus, InvestigationState, Outcome, PriceChange, ReceiptCorrection, RecipeChange, Recount, Role, UsagePeriod, User, WasteLog,
} from "../types";
import { addDays, fmtDate, fmtQty } from "../util";

export interface PurchaseApproval {
  id: string;
  propertyId: string;
  ingredientId: string;
  qty: number;
  cost: number;
  approvedBy: string;
  role?: Role;
  at: string;
}

/** An ingredient price change as it was made. The current price per ingredient is in `priceOverrides`. */
export interface PriceLogEntry {
  id: string;
  ingredientId: string;
  value: number;
  from: string;
  by: string;
  role: Role;
  at: string;
}

/** What one person may hold of the saved records. The server keeps the full set; each person receives their view. */
export interface Records {
  /** Numbers the records made here (stock cases, recounts, standards, receipts). */
  recordSeq: number;
  investigations: Record<string, InvestigationState>;
  /** Cases opened by hand from a count shortfall or an outlet stock period. */
  stockCases: Exception[];
  recounts: Recount[];
  recipeChanges: RecipeChange[];
  receiptCorrections: ReceiptCorrection[];
  priceOverrides: PriceChange[];
  priceLog: PriceLogEntry[];
  approvals: PurchaseApproval[];
  forecastInputs: Record<string, ForecastInputs>;
  flowStatus: Record<string, FlowStatus>;
  /** Notices this person closed. Kept per person, so another role on the same browser still sees them. */
  dismissedAlerts: string[];
  audit: AuditEntry[];
}

export const RECORD_KEYS = ["recordSeq", "investigations", "stockCases", "recounts", "recipeChanges", "receiptCorrections", "priceOverrides", "priceLog", "approvals", "forecastInputs", "flowStatus", "dismissedAlerts", "audit"] as const satisfies readonly (keyof Records)[];

export const emptyRecords = (): Records => ({
  recordSeq: 0, investigations: {}, stockCases: [], recounts: [], recipeChanges: [], receiptCorrections: [], priceOverrides: [], priceLog: [], approvals: [], forecastInputs: {}, flowStatus: {}, dismissedAlerts: [], audit: [],
});

export interface CloseInput { outcome: Outcome; confirmedLoss: number; recovered: number; note: string; verifiedCause?: string; correctiveAction?: string }

export type RecordOp =
  | { kind: "investigation.assign"; id: string; assigneeId: string; deadline: string }
  | { kind: "investigation.note"; id: string; text: string }
  | { kind: "investigation.review"; id: string }
  | { kind: "investigation.close"; id: string; input: CloseInput }
  | { kind: "investigation.reopen"; id: string }
  | { kind: "case.fromCount"; countId: string; outletId: string }
  | { kind: "case.fromPeriod"; period: UsagePeriod }
  | { kind: "stock.recount"; checkId: string; outletId: string; ingredientId: string; counted: number; reason: string }
  | { kind: "recipe.standard"; itemId: string; ingredientId: string; qty: number; from: string; reason: string }
  | { kind: "delivery.receipt"; deliveryId: string; ingredientId: string; received: number; reason: string }
  | { kind: "price.set"; ingredientId: string; cost: number }
  | { kind: "purchase.approve"; propertyId: string; lines: { ingredientId: string; qty: number; cost: number }[] }
  | { kind: "purchase.withdraw"; id: string }
  | { kind: "forecast.inputs"; propertyId: string; inputs: ForecastInputs }
  | { kind: "flow.status"; orderId: string; status: FlowStatus }
  | { kind: "alert.dismiss"; id: string };

export const OP_KINDS: RecordOp["kind"][] = [
  "investigation.assign", "investigation.note", "investigation.review", "investigation.close", "investigation.reopen", "case.fromCount", "case.fromPeriod",
  "stock.recount", "recipe.standard", "delivery.receipt", "price.set", "purchase.approve", "purchase.withdraw", "forecast.inputs", "flow.status", "alert.dismiss",
];

/** What the rules need to know about the world, supplied by the browser or the server from their own data. */
export interface RecordEnv {
  user: User | undefined;
  today: string;
  nowMin: number;
  /** A real timestamp for the record. */
  now: string;
  /** Flags in the person's own data (stock cases are looked up in the records). */
  exception(id: string): Exception | undefined;
  /** A flag the data already holds for an outlet stock period. */
  exceptionForPeriod(periodId: string): Exception | undefined;
  seedState(id: string): InvestigationState | undefined;
  count(id: string): CountRecord | undefined;
  /** The stock period as the server holds it, or null when the person may not see it. The browser passes it through. */
  period(p: UsagePeriod): UsagePeriod | null;
  delivery(id: string): Delivery | undefined;
  liveOrderOutlet(id: string): string | undefined;
  /** Late waste entries and corrections that change what a stock period explains. */
  waste(): WasteLog[];
  /** The first date a custom range may start on, for late entries and standards. */
  dataStart: string;
}

export type OpResult = { ok: true; rec: Records; id?: string } | { ok: false; error: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const fail = (error: string): OpResult => ({ ok: false, error });
const STOCK_TYPES = new Set(["usage_variance", "stock_shortfall"]);
/** How a closed case reads in the trail of saved changes. */
export const OUTCOME_WORDS: Record<Outcome, string> = { legitimate: "legitimate correction", confirmed_loss: "confirmed loss", recovered: "revenue recovered", inconclusive: "no finding" };
const euros = (n: number) => `€${n.toLocaleString("en-GB", { maximumFractionDigits: 2 })}`;
/** One line for a closed case: the outcome, then the money, if any. */
export const closedDetail = (id: string, outcome: Outcome, loss: number, recovered: number) =>
  `${id}: ${OUTCOME_WORDS[outcome]}${recovered > 0 ? `, ${euros(recovered)}` : loss > 0 ? `, ${euros(loss)}` : ""}`;
const nameOf = (id: string) => userById[id]?.name ?? staffById[id]?.name ?? id;

/** Applies one change to the records, or explains why it cannot be made. Pure: the input is never changed. */
export function applyRecordOp(prev: Records, op: RecordOp, env: RecordEnv): OpResult {
  const user = env.user;
  const rec: Records = { ...prev };
  const audit = (action: string, detail: string, ref?: string) => {
    rec.audit = [{ at: env.now, userId: user!.id, role: user!.role, action, detail, ref }, ...rec.audit].slice(0, 400);
  };
  const guarded = (permission: Permission, outletId: string | undefined, run: (u: User) => OpResult): OpResult => {
    try {
      assertCan(user, permission, outletId);
      return run(user!);
    } catch (e) {
      if (e instanceof AccessError) return fail(e.message);
      throw e;
    }
  };
  const exceptionOf = (id: string) => rec.stockCases.find((e) => e.id === id) ?? env.exception(id);
  const adjustments = (): Adjustments => ({ recounts: rec.recounts, recipes: rec.recipeChanges, waste: env.waste() });
  const exposureOf = (e: Exception) => (e.period ? Math.max(0, Math.round(periodVariance(e.period, adjustments()).value * 100) / 100) : e.exposure);
  const stateOf = (id: string): InvestigationState | undefined => rec.investigations[id] ?? env.seedState(id);
  const save = (id: string, state: InvestigationState, u: User) => {
    rec.investigations = { ...rec.investigations, [id]: { ...state, updatedBy: u.id, updatedRole: u.role, updatedAt: env.now } };
  };
  const onCase = (permission: Permission, id: string, run: (u: User, state: InvestigationState, exposure: number, e: Exception) => OpResult): OpResult => {
    const e = exceptionOf(id);
    const state = e && stateOf(id);
    if (!e || !state) return fail("This investigation no longer exists.");
    return guarded(permission, e.outletId, (u) => {
      if (!e.outletId && !hasWholeProperty(u, e.propertyId)) return fail("This record belongs to the whole property and is outside your access.");
      return run(u, state, exposureOf(e), e);
    });
  };
  const nextSeq = () => (rec.recordSeq = prev.recordSeq + 1);

  switch (op.kind) {
    case "investigation.assign":
      return onCase("investigation.assign", op.id, (u, state) => {
        if (state.status === "closed") return fail("Reopen the investigation before assigning it.");
        if (!op.assigneeId || !(userById[op.assigneeId] || staffById[op.assigneeId])) return fail("Choose who is responsible.");
        if (!ISO_DATE.test(op.deadline)) return fail("Choose a deadline.");
        if (op.deadline < env.today) return fail("The deadline cannot be in the past.");
        save(op.id, { ...state, status: state.status === "new" ? "assigned" : state.status, assigneeId: op.assigneeId, deadline: op.deadline }, u);
        audit("Investigation assigned", `${op.id} to ${nameOf(op.assigneeId)}, due ${fmtDate(op.deadline)}`, op.id);
        return { ok: true, rec };
      });
    case "investigation.note":
      return onCase("investigation.note", op.id, (u, state) => {
        const clean = String(op.text ?? "").trim();
        if (clean.length < 3) return fail("Write a short note first.");
        if (clean.length > 600) return fail("Keep the note under 600 characters.");
        save(op.id, { ...state, notes: [...state.notes, { at: env.today, by: u.id, text: clean }] }, u);
        audit("Note added", `${op.id}: ${clean.length > 120 ? `${clean.slice(0, 117)}...` : clean}`, op.id);
        return { ok: true, rec };
      });
    case "investigation.review":
      return onCase("investigation.note", op.id, (u, state) => {
        if (state.status === "closed") return fail("This investigation is closed.");
        save(op.id, { ...state, status: "in_review", assigneeId: state.assigneeId ?? u.id }, u);
        audit("Review started", op.id, op.id);
        return { ok: true, rec };
      });
    case "investigation.close":
      return onCase("investigation.close", op.id, (u, state, exposure, e) => {
        if (state.status === "closed") return fail("This investigation is already closed.");
        const input = op.input ?? ({} as CloseInput);
        const outcome = input.outcome;
        const note = String(input.note ?? "");
        if (!["legitimate", "confirmed_loss", "recovered", "inconclusive"].includes(outcome)) return fail("Choose an outcome.");
        const confirmedLoss = Math.round(Number(input.confirmedLoss) * 100) / 100;
        const recovered = Math.round(Number(input.recovered) * 100) / 100;
        if (!Number.isFinite(confirmedLoss) || !Number.isFinite(recovered) || confirmedLoss < 0 || recovered < 0) return fail("Amounts must be zero or more.");
        if (confirmedLoss + recovered > exposure + 0.005) return fail(`Loss and recovery together cannot be more than the ${exposure.toFixed(2)} involved.`);
        if (outcome === "confirmed_loss" && confirmedLoss <= 0) return fail("Enter the amount lost.");
        if (outcome === "recovered" && recovered <= 0) return fail("Enter the amount recovered.");
        if ((outcome === "legitimate" || outcome === "inconclusive") && confirmedLoss + recovered > 0) return fail("This outcome carries no amounts. Choose a loss or a recovery instead.");
        if (chargedToGuest(e) && (outcome === "confirmed_loss" || outcome === "recovered")) return fail("The value was charged to the guest. Refund the guest if needed and close as a legitimate correction.");
        if (note.trim().length < 3) return fail("Add a short note on what you found.");
        const verifiedCause = typeof input.verifiedCause === "string" ? input.verifiedCause.trim().slice(0, 200) || undefined : undefined;
        const correctiveAction = typeof input.correctiveAction === "string" ? input.correctiveAction.trim().slice(0, 400) || undefined : undefined;
        if (STOCK_TYPES.has(e.type) && outcome !== "inconclusive" && !verifiedCause) return fail("Choose the cause you verified, or record no finding.");
        save(op.id, {
          ...state, status: "closed", outcome, confirmedLoss, recovered, closedAt: env.today, closedBy: u.id, verifiedCause, correctiveAction,
          assigneeId: state.assigneeId ?? u.id,
          notes: [...state.notes, { at: env.today, by: u.id, text: note.trim().slice(0, 600) }],
        }, u);
        audit("Investigation closed", closedDetail(op.id, outcome, confirmedLoss, recovered), op.id);
        return { ok: true, rec };
      });
    case "investigation.reopen":
      return onCase("investigation.reopen", op.id, (u, state) => {
        if (state.status !== "closed") return fail("This investigation is already open.");
        save(op.id, {
          ...state, status: "in_review", outcome: undefined, confirmedLoss: 0, recovered: 0, closedAt: undefined, closedBy: undefined, verifiedCause: undefined, correctiveAction: undefined,
          notes: [...state.notes, { at: env.today, by: u.id, text: "Reopened for another look." }],
        }, u);
        audit("Investigation reopened", op.id, op.id);
        return { ok: true, rec };
      });

    case "case.fromCount":
      return guarded("investigation.assign", op.outletId, (u) => {
        const count = env.count(op.countId);
        if (!count) return fail("This count no longer exists.");
        const outlet = outletById[op.outletId];
        if (!outlet || outlet.propertyId !== count.propertyId) return fail("Choose an outlet at this hotel.");
        const owner = storeOwner(count.propertyId, count.ingredientId);
        if (owner && owner !== op.outletId) return fail(`This item is held in ${outletById[owner].name}'s own store.`);
        const existing = rec.stockCases.find((e) => e.countId === op.countId && e.outletId === op.outletId);
        if (existing) return { ok: true, rec: prev, id: existing.id };
        const value = -countVarianceValue(count, rec.priceOverrides);
        if (value < 0.5) return fail("This count shows no shortfall.");
        const shares = count.allocation ?? {};
        const share = owner || Object.keys(shares).length === 0 ? 1 : (shares[op.outletId] ?? 0);
        if (share <= 0) return fail(`${outlet.name} did not use this item in the week before the count.`);
        const g = ingredientById[count.ingredientId];
        const exposure = Math.round(value * share * 100) / 100;
        const id = `EX-STK-${String(nextSeq()).padStart(3, "0")}`;
        const e: Exception = {
          id, type: "stock_shortfall", propertyId: count.propertyId, outletId: op.outletId, date: count.date, min: count.date === env.today ? env.nowMin : 7 * 60,
          countId: op.countId, ingredientId: count.ingredientId, exposure,
          headline: `${g.name}: ${fmtQty(-countVariance(count) * share, g.unit)} short at the ${fmtDate(count.date)} count`,
        };
        rec.stockCases = [...rec.stockCases, e];
        rec.investigations = { ...rec.investigations, [id]: { status: "new", notes: [], confirmedLoss: 0, recovered: 0, updatedBy: u.id, updatedRole: u.role, updatedAt: env.now } };
        audit("Stock case opened", `${id} by ${u.name}`, id);
        return { ok: true, rec, id };
      });
    case "case.fromPeriod": {
      const period = op.period && typeof op.period === "object" ? env.period(op.period) : null;
      if (!period) return fail("This stock period is not available.");
      return guarded("investigation.assign", period.outletId, (u) => {
        const existing = rec.stockCases.find((e) => e.period?.id === period.id) ?? env.exceptionForPeriod(period.id);
        if (existing) return { ok: true, rec: prev, id: existing.id };
        const v = periodVariance(period, adjustments());
        if (v.unexplained <= 0) return fail("Nothing is unexplained in this period.");
        const id = `EX-STK-${String(nextSeq()).padStart(3, "0")}`;
        const e: Exception = {
          id, type: "usage_variance", propertyId: period.propertyId, outletId: period.outletId, date: period.to.date, min: period.to.min,
          ingredientId: period.ingredientId, exposure: Math.max(0, Math.round(v.value * 100) / 100), headline: headlineFor(period, v), period,
        };
        rec.stockCases = [...rec.stockCases, e];
        rec.investigations = { ...rec.investigations, [id]: { status: "new", notes: [], confirmedLoss: 0, recovered: 0, updatedBy: u.id, updatedRole: u.role, updatedAt: env.now } };
        audit("Stock case opened", `${id} by ${u.name}`, id);
        return { ok: true, rec, id };
      });
    }

    case "stock.recount":
      return guarded("stock.count", op.outletId, (u) => {
        if (!ingredientById[op.ingredientId]) return fail("Choose an item.");
        const counted = Number(op.counted);
        const reason = String(op.reason ?? "").trim().slice(0, 300);
        if (!Number.isFinite(counted) || counted < 0 || counted > 1e5) return fail("Enter the quantity you counted.");
        if (reason.length < 3) return fail("Say why the item was recounted.");
        const seq = nextSeq();
        rec.recounts = [...rec.recounts, { id: `RC-${seq}`, checkId: String(op.checkId), outletId: op.outletId, counted, reason, by: u.id, role: u.role, at: env.now, date: env.today, seq }];
        audit("Recount recorded", `${op.checkId}: ${ingredientById[op.ingredientId].name} recounted at ${counted}. ${reason}`);
        return { ok: true, rec };
      });
    case "recipe.standard":
      return guarded("stock.editPrices", undefined, (u) => {
        const base = itemById[op.itemId]?.recipe?.find((l) => l.ingredientId === op.ingredientId)?.qty;
        if (base === undefined) return fail("This ingredient is not in that recipe.");
        const qty = Number(op.qty);
        const reason = String(op.reason ?? "").trim().slice(0, 300);
        if (!Number.isFinite(qty) || qty < base * 0.5 || qty > base * 2) return fail("Choose a quantity between half and double the current standard.");
        if (!ISO_DATE.test(op.from) || op.from > env.today) return fail("Choose the date the setting was wrong from.");
        if (reason.length < 3) return fail("Say why the standard is changing.");
        const seq = nextSeq();
        rec.recipeChanges = [...rec.recipeChanges, { id: `RQ-${seq}`, itemId: op.itemId, ingredientId: op.ingredientId, qty, from: op.from, reason, by: u.id, role: u.role, at: env.now, seq }];
        audit("Standard quantity changed", `${itemById[op.itemId].name}: ${ingredientById[op.ingredientId].name} ${base} to ${qty} from ${op.from}. ${reason}`);
        return { ok: true, rec };
      });
    case "delivery.receipt": {
      const d = env.delivery(op.deliveryId);
      if (!d) return fail("This delivery does not exist.");
      return guarded("stock.count", undefined, (u) => {
        if (u.propertyIds !== "all" && !u.propertyIds.includes(d.propertyId)) return fail("This property is outside your access.");
        const line = d.lines.find((l) => l.ingredientId === op.ingredientId);
        if (!line) return fail("This item is not on the delivery.");
        const received = Number(op.received);
        const reason = String(op.reason ?? "").trim().slice(0, 300);
        if (!Number.isFinite(received) || received < 0 || received > line.ordered * 3) return fail("Enter the quantity actually received.");
        if (reason.length < 3) return fail("Say how the difference was found.");
        const seq = nextSeq();
        rec.receiptCorrections = [...rec.receiptCorrections, { id: `RR-${seq}`, deliveryId: d.id, propertyId: d.propertyId, ingredientId: op.ingredientId, received, reason, by: u.id, role: u.role, at: env.now, seq }];
        audit("Delivery difference recorded", `${d.id}: ${ingredientById[op.ingredientId].name} received ${received}, recorded ${line.delivered}. ${reason}`);
        return { ok: true, rec };
      });
    }
    case "price.set":
      return guarded("stock.editPrices", undefined, (u) => {
        if (!ingredientById[op.ingredientId]) return fail("Unknown ingredient.");
        const cost = Number(op.cost);
        if (!Number.isFinite(cost) || cost <= 0) return fail("Enter a price above zero.");
        if (cost > 100000) return fail("That price looks too high. Check the amount.");
        const value = Math.round(cost * 100) / 100;
        rec.priceOverrides = [...rec.priceOverrides.filter((p) => p.id !== op.ingredientId), { id: op.ingredientId, from: env.today, value }];
        rec.priceLog = [{ id: `PC-${rec.priceLog.length + 1}`, ingredientId: op.ingredientId, value, from: env.today, by: u.id, role: u.role, at: env.now }, ...rec.priceLog].slice(0, 200);
        audit("Ingredient price changed", `${ingredientById[op.ingredientId].name} to €${value.toFixed(2)} from ${fmtDate(env.today)}`);
        return { ok: true, rec };
      });
    case "purchase.approve":
      return guarded("forecast.approve", undefined, (u) => {
        if (!propertyById[op.propertyId] || (u.propertyIds !== "all" && !u.propertyIds.includes(op.propertyId))) return fail("This property is outside your access.");
        const valid = (Array.isArray(op.lines) ? op.lines : []).filter((l) => Number(l.qty) > 0 && Number.isFinite(Number(l.cost)) && ingredientById[l.ingredientId]);
        if (valid.length === 0) return fail("Nothing to approve.");
        rec.approvals = [
          ...rec.approvals.filter((a) => !(a.propertyId === op.propertyId && valid.some((l) => l.ingredientId === a.ingredientId))),
          ...valid.map((l) => ({ id: `AP-${op.propertyId}-${l.ingredientId}`, propertyId: op.propertyId, ingredientId: l.ingredientId, qty: Number(l.qty), cost: Number(l.cost), approvedBy: u.id, role: u.role, at: env.now })),
        ];
        audit("Purchase suggestions approved", `${valid.length} line${valid.length === 1 ? "" : "s"} at ${propertyById[op.propertyId].name}`);
        return { ok: true, rec };
      });
    case "purchase.withdraw":
      return guarded("forecast.approve", undefined, (u) => {
        const a = rec.approvals.find((x) => x.id === op.id);
        if (!a) return fail("This approval no longer exists.");
        if (u.propertyIds !== "all" && !u.propertyIds.includes(a.propertyId)) return fail("This property is outside your access.");
        rec.approvals = rec.approvals.filter((x) => x.id !== op.id);
        audit("Purchase approval withdrawn", op.id);
        return { ok: true, rec };
      });
    case "forecast.inputs":
      return guarded("forecast.approve", undefined, (u) => {
        if (!propertyById[op.propertyId] || (u.propertyIds !== "all" && !u.propertyIds.includes(op.propertyId))) return fail("This property is outside your access.");
        if (!op.inputs || typeof op.inputs !== "object") return fail("Nothing to save.");
        rec.forecastInputs = { ...rec.forecastInputs, [op.propertyId]: op.inputs };
        audit("Forecast settings changed", propertyById[op.propertyId].name);
        return { ok: true, rec };
      });
    case "flow.status": {
      const outletId = env.liveOrderOutlet(op.orderId);
      if (!outletId) return fail("This order is no longer on the board.");
      if (!["new", "sent", "preparing", "ready", "served", "cancelled"].includes(op.status)) return fail("Choose a status.");
      return guarded("flow.updateOrder", outletId, () => {
        rec.flowStatus = { ...rec.flowStatus, [op.orderId]: op.status };
        audit("Order status changed", `${op.orderId} to ${op.status}`);
        return { ok: true, rec };
      });
    }
    case "alert.dismiss": {
      if (!user) return fail("Sign in to continue.");
      const id = String(op.id ?? "").slice(0, 120);
      if (!id) return fail("Nothing to close.");
      if (prev.dismissedAlerts.includes(id)) return { ok: true, rec: prev };
      rec.dismissedAlerts = [...prev.dismissedAlerts, id].slice(-300);
      return { ok: true, rec };
    }
    default:
      return fail("Unknown change.");
  }
}

/** Late entries can go back up to seven days. */
export const lateEntryFloor = (today: string) => addDays(today, -7);
