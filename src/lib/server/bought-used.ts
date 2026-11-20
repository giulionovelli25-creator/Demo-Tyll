// Bought against used, per item, worked out on the server: supplier deliveries from the dataset and deliveries received
// in Tyll, against the recipes of what the till sold, the waste logged anywhere in the hotel and recorded transfers.
// The flags it raises join the flags system through the snapshot, and the checks managers record are kept in the store.
import { ingredientById, propertyById } from "../data/catalog";
import { getDataset } from "../data/generate";
import { can, hasWholeProperty } from "../domain/access";
import { BOUGHT_USED_RULES, boughtAgainstUsed, boughtUsedExceptions, boughtUsedFlagId, boughtUsedPeriod, summarise, type BoughtUsedRow, type BoughtUsedSummary } from "../domain/bought-used";
import { ingredientCostAt } from "../domain/pricing";
import type { BoughtUsedCheck, BoughtUsedOutcome, Exception, InvestigationState, User } from "../types";
import { DEMO_TODAY, eachDay, round2 } from "../util";
import { audit } from "./auth";
import { loadStore, mutateStore, nextNumber, receivedDeliveries, type Shape } from "./purchasing-store";
import { sharedWaste } from "./stock-log";

/** What a manager found, in the words shown on screen. The first two settle the gap; the last leaves the flag open. */
export const OUTCOME_LABEL: Record<BoughtUsedOutcome, string> = {
  on_shelf: "Counted: the stock is on the shelf",
  no_recipe: "Used for something with no recipe in the till",
  not_found: "Not found: needs a closer look",
};
const OUTCOMES = Object.keys(OUTCOME_LABEL) as BoughtUsedOutcome[];

/** The check for one hotel on the current business day, from every record the server holds. */
export function checkRows(propertyId: string, s: Shape = loadStore()): BoughtUsedRow[] {
  const d = getDataset();
  const { from, to } = boughtUsedPeriod();
  const factor = propertyById[propertyId].costFactor;
  return boughtAgainstUsed({
    propertyId, from, to,
    deliveries: [...d.deliveries, ...receivedDeliveries(propertyId)],
    dayItems: d.dayItems,
    waste: [...d.wasteLogs, ...sharedWaste(s).map((w) => ({ ...w, synced: true }))],
    transfers: d.transfers,
    standardCost: (id) => ingredientCostAt(id, to) * factor,
  });
}

/** The latest check recorded for each item at a hotel. */
function latestChecks(propertyId: string, s: Shape): Map<string, BoughtUsedCheck> {
  const out = new Map<string, BoughtUsedCheck>();
  for (const c of s.boughtUsedChecks ?? []) if (c.propertyId === propertyId) out.set(c.ingredientId, c);
  return out;
}

/** The state a flag starts from: a check that settles the gap closes it, "not found" keeps it in review. */
export function stateFromCheck(c: BoughtUsedCheck | undefined): InvestigationState {
  if (!c) return { status: "new", notes: [], confirmedLoss: 0, recovered: 0 };
  const notes = [{ at: c.date, by: c.by, text: c.note ? `${OUTCOME_LABEL[c.outcome]}. ${c.note}` : `${OUTCOME_LABEL[c.outcome]}.` }];
  if (c.outcome === "not_found") return { status: "in_review", assigneeId: c.by, notes, confirmedLoss: 0, recovered: 0 };
  return { status: "closed", outcome: "legitimate", closedAt: c.date, closedBy: c.by, assigneeId: c.by, verifiedCause: OUTCOME_LABEL[c.outcome], notes, confirmedLoss: 0, recovered: 0 };
}

/** The flags today's check raises for these hotels, with their starting state. */
export function boughtUsedCases(propertyIds: readonly string[], s: Shape = loadStore()): { exceptions: Exception[]; seed: Record<string, InvestigationState> } {
  const exceptions: Exception[] = [];
  const seed: Record<string, InvestigationState> = {};
  for (const pid of propertyIds) {
    const checks = latestChecks(pid, s);
    for (const e of boughtUsedExceptions(checkRows(pid, s))) {
      exceptions.push(e);
      seed[e.id] = stateFromCheck(checks.get(e.ingredientId!));
    }
  }
  return { exceptions, seed };
}

export interface BoughtUsedRowOut extends Omit<BoughtUsedRow, "byDay"> {
  /** The flag raised for this item today, when the gap is large enough. */
  flagId: string | null;
  check: BoughtUsedCheck | null;
}

export interface BoughtUsedView {
  propertyId: string;
  from: string;
  to: string;
  rules: typeof BOUGHT_USED_RULES;
  rows: BoughtUsedRowOut[];
  summary: BoughtUsedSummary & { checkedFlagged: number };
  /** The flagged items' gap building up over the period, in money, with the largest item on its own. */
  trend: { date: string; value: number; top: number }[];
  topId: string | null;
  outcomes: { value: BoughtUsedOutcome; label: string }[];
}

type Result<T> = ({ ok: true } & T) | { ok: false; status: number; error: string };

const mayUse = (user: User, propertyId: unknown): propertyId is string =>
  typeof propertyId === "string" && !!propertyById[propertyId] && can(user, "stock.boughtUsed") && hasWholeProperty(user, propertyId);

export function boughtUsedFor(user: User, propertyId: unknown): Result<BoughtUsedView> {
  if (!can(user, "stock.boughtUsed")) return { ok: false, status: 403, error: "Your role cannot see this check." };
  if (!mayUse(user, propertyId)) return { ok: false, status: 403, error: "This check covers the whole hotel. Your access does not." };
  const s = loadStore();
  const rows = checkRows(propertyId, s);
  const checks = latestChecks(propertyId, s);
  const { from, to } = boughtUsedPeriod();
  const flagged = rows.filter((r) => r.flagged);
  const top = flagged[0] ?? null;
  // Running total of bought less used for the flagged items, valued at the price paid, one point a day.
  let run = 0, runTop = 0;
  const trend = eachDay({ from, to }).map((date) => {
    for (const r of flagged) {
      const v = (r.byDay[date] ?? 0) * r.unitCost;
      run += v;
      if (r === top) runTop += v;
    }
    return { date, value: round2(run), top: round2(runTop) };
  });
  const out: BoughtUsedRowOut[] = rows.map((full) => {
    const r: Omit<BoughtUsedRow, "byDay"> & { byDay?: unknown } = { ...full };
    delete r.byDay;
    return {
    ...r,
    flagId: r.flagged ? boughtUsedFlagId(propertyId, r.ingredientId, to) : null,
    check: checks.get(r.ingredientId) ?? null,
    };
  });
  return {
    ok: true, propertyId, from, to, rules: BOUGHT_USED_RULES, rows: out,
    summary: { ...summarise(rows), checkedFlagged: out.filter((r) => r.flagged && r.check).length },
    trend, topId: top?.ingredientId ?? null,
    outcomes: OUTCOMES.map((value) => ({ value, label: OUTCOME_LABEL[value] })),
  };
}

/** Marks an item's gap as checked, replacing any earlier check of it. Shared with everyone who sees the hotel. */
export function markChecked(user: User, body: Record<string, unknown>): Result<{ check: BoughtUsedCheck }> {
  const { propertyId, ingredientId, outcome } = body;
  if (!can(user, "stock.boughtUsed")) return { ok: false, status: 403, error: "Your role cannot do this." };
  if (!mayUse(user, propertyId)) return { ok: false, status: 403, error: "This check covers the whole hotel. Your access does not." };
  if (typeof ingredientId !== "string" || !ingredientById[ingredientId]) return { ok: false, status: 400, error: "Choose an item." };
  if (!OUTCOMES.includes(outcome as BoughtUsedOutcome)) return { ok: false, status: 400, error: "Choose what you found." };
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 300) : "";
  const row = checkRows(propertyId).find((r) => r.ingredientId === ingredientId);
  if (!row || row.gap <= 0) return { ok: false, status: 400, error: "This item has no gap to check." };
  const check = mutateStore((s) => {
    const c: BoughtUsedCheck = {
      id: `BUC-${propertyId.toUpperCase()}-${nextNumber(s, `bu-${propertyId}`)}`, propertyId, ingredientId, date: DEMO_TODAY,
      outcome: outcome as BoughtUsedOutcome, ...(note ? { note } : {}), by: user.id, role: user.role, at: new Date().toISOString(),
      gap: round2(row.gap), gapValue: row.gapValue,
    };
    s.boughtUsedChecks = [...(s.boughtUsedChecks ?? []).filter((x) => !(x.propertyId === propertyId && x.ingredientId === ingredientId)), c];
    return c;
  });
  audit(user.id, "Bought against used checked", `${propertyId} ${ingredientId}: ${outcome}`, "");
  return { ok: true, check };
}

/** Takes a check back, so the item shows as not yet checked. */
export function clearCheck(user: User, body: Record<string, unknown>): Result<{ id: string }> {
  const { id } = body;
  if (!can(user, "stock.boughtUsed")) return { ok: false, status: 403, error: "Your role cannot do this." };
  const found = (loadStore().boughtUsedChecks ?? []).find((c) => c.id === id);
  if (!found) return { ok: false, status: 404, error: "This check was not found." };
  if (!mayUse(user, found.propertyId)) return { ok: false, status: 403, error: "This check covers the whole hotel. Your access does not." };
  mutateStore((s) => { s.boughtUsedChecks = (s.boughtUsedChecks ?? []).filter((c) => c.id !== id); });
  audit(user.id, "Bought against used check taken back", `${found.propertyId} ${found.ingredientId}`, "");
  return { ok: true, id: found.id };
}

