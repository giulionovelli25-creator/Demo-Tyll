// Bought against used, per item, worked out on the server: supplier deliveries from the dataset and deliveries received
// in Tyll, against the recipes of what the till sold, the waste logged anywhere in the hotel and recorded transfers.
// The flags it raises join the flags system through the snapshot, and the checks managers record are kept in the store.
import { ingredientById, propertyById } from "../data/catalog";
import { getDataset } from "../data/generate";
import { can, hasWholeProperty, roleCan } from "../domain/access";
import { BOUGHT_USED_RULES, boughtAgainstUsed, boughtUsedExceptions, boughtUsedFlagId, boughtUsedPeriod, summarise, type BoughtUsedRow, type BoughtUsedSummary } from "../domain/bought-used";
import { stockPosition } from "../domain/inventory";
import { ingredientCostAt } from "../domain/pricing";
import type { BoughtUsedCheck, BoughtUsedCount, BoughtUsedOutcome, CountRecord, Exception, InvestigationState, User } from "../types";
import { DEMO_TODAY, eachDay, round2 } from "../util";
import { audit } from "./auth";
import { loadStore, mutateStore, nextNumber, receivedDeliveries, type Shape } from "./purchasing-store";
import { sharedCounts, sharedWaste } from "./stock-log";

/** What a manager found, in the words shown on screen. The first two settle the gap; the last leaves the flag open. */
export const OUTCOME_LABEL: Record<BoughtUsedOutcome, string> = {
  on_shelf: "Counted: the stock is on the shelf",
  no_recipe: "Used for something with no recipe in the till",
  not_found: "Not found: needs a closer look",
};
const OUTCOMES = Object.keys(OUTCOME_LABEL) as BoughtUsedOutcome[];

/** "Counted" records a count, so only people who count stock may choose it. The other two are open to everyone here. */
const mayChoose = (user: User, outcome: BoughtUsedOutcome) => outcome !== "on_shelf" || can(user, "stock.count");

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

/**
 * What the hotel's own count records say about each item: the latest count and the Stock levels estimate today (that
 * count plus everything recorded since). Shown beside a gap, so the obvious question is answered where it is asked.
 */
export function countsNow(propertyId: string, s: Shape = loadStore()): Map<string, BoughtUsedCount> {
  const d = getDataset();
  const counts = [...d.counts, ...sharedCounts(s)];
  const latest = new Map<string, CountRecord>();
  for (const c of counts) {
    if (c.propertyId !== propertyId) continue;
    const cur = latest.get(c.ingredientId);
    if (!cur || c.date > cur.date || (c.date === cur.date && c.seq > cur.seq)) latest.set(c.ingredientId, c);
  }
  const position = stockPosition(propertyId, {
    dayItems: d.dayItems, counts, deliveries: [...d.deliveries, ...receivedDeliveries(propertyId)], transfers: d.transfers,
    waste: [...d.wasteLogs, ...sharedWaste(s)], recipes: [],
  });
  const out = new Map<string, BoughtUsedCount>();
  for (const p of position) {
    const c = latest.get(p.ingredientId);
    if (c) out.set(p.ingredientId, { date: c.date, counted: c.counted, expected: c.expected, onHand: Math.max(0, round2(p.estimated)) });
  }
  return out;
}

/** The latest check recorded for each item at a hotel. */
function latestChecks(propertyId: string, s: Shape): Map<string, BoughtUsedCheck> {
  const out = new Map<string, BoughtUsedCheck>();
  for (const c of s.boughtUsedChecks ?? []) if (c.propertyId === propertyId) out.set(c.ingredientId, c);
  return out;
}

/** Outcomes that settle a gap. "Not found" is looked at, not settled. */
export const settles = (c: Pick<BoughtUsedCheck, "outcome"> | null | undefined) => !!c && c.outcome !== "not_found";

/**
 * Does a check close the flag? Only an answer that settles the gap, made or confirmed by someone who may close flags.
 * Purchasing may record what it found, but the flag about its own ordering stays open until a manager confirms it.
 */
export const closesFlag = (c: BoughtUsedCheck | null | undefined): boolean =>
  !!c && settles(c) && (roleCan(c.role, "investigation.close") || (!!c.confirmedRole && roleCan(c.confirmedRole, "investigation.close")));

/** A check that settles the gap, recorded by someone who may not close flags, not yet confirmed by a manager. */
export const awaitsManager = (c: BoughtUsedCheck | null | undefined): boolean => settles(c) && !closesFlag(c);

/**
 * Does an earlier check still answer today's gap? Only while the gap has grown by no more than one delivery since: more
 * than that is new stock nobody has looked at, so the flag starts again and the check is shown as history.
 */
export const checkHolds = (c: BoughtUsedCheck, r: Pick<BoughtUsedRow, "gap" | "lastDelivery">) => r.gap <= c.gap + r.lastDelivery + 1e-9;

/**
 * The state a flag starts from: a check that settles the gap, by someone who may close flags, closes it. A settling
 * check from someone who may not waits in review for a manager; "not found" keeps it in review.
 */
export function stateFromCheck(c: BoughtUsedCheck | undefined): InvestigationState {
  if (!c) return { status: "new", notes: [], confirmedLoss: 0, recovered: 0 };
  const notes = [{ at: c.date, by: c.by, text: c.note ? `${OUTCOME_LABEL[c.outcome]}. ${c.note}` : `${OUTCOME_LABEL[c.outcome]}.` }];
  if (c.outcome === "not_found") return { status: "in_review", assigneeId: c.by, notes, confirmedLoss: 0, recovered: 0 };
  if (!closesFlag(c)) return { status: "in_review", notes: [...notes, { at: c.date, by: c.by, text: "Waiting for a manager to confirm it on Bought against used before the flag closes." }], confirmedLoss: 0, recovered: 0 };
  const closer = c.confirmedBy ?? c.by;
  if (c.confirmedBy) notes.push({ at: c.date, by: c.confirmedBy, text: "Confirmed and closed." });
  return { status: "closed", outcome: "legitimate", closedAt: c.date, closedBy: closer, assigneeId: closer, verifiedCause: OUTCOME_LABEL[c.outcome], notes, confirmedLoss: 0, recovered: 0 };
}

/** The flags today's check raises for these hotels, with their starting state. */
export function boughtUsedCases(propertyIds: readonly string[], s: Shape = loadStore()): { exceptions: Exception[]; seed: Record<string, InvestigationState> } {
  const exceptions: Exception[] = [];
  const seed: Record<string, InvestigationState> = {};
  for (const pid of propertyIds) {
    const checks = latestChecks(pid, s);
    const counts = countsNow(pid, s);
    for (const e of boughtUsedExceptions(checkRows(pid, s))) {
      e.boughtUsed = { ...e.boughtUsed!, lastCount: counts.get(e.ingredientId!) ?? null };
      exceptions.push(e);
      const c = checks.get(e.ingredientId!);
      seed[e.id] = stateFromCheck(c && checkHolds(c, e.boughtUsed!) ? c : undefined);
    }
  }
  return { exceptions, seed };
}

export interface BoughtUsedRowOut extends Omit<BoughtUsedRow, "byDay"> {
  /** The flag raised for this item today, when the gap is large enough. */
  flagId: string | null;
  /** The check that answers today's gap. */
  check: BoughtUsedCheck | null;
  /** A check made when the gap was smaller by more than a delivery: history, no longer an answer. */
  earlierCheck: BoughtUsedCheck | null;
  /** Where the check leaves the flag: closed, waiting for a manager to confirm, not found, or nothing yet. */
  checkState: "closed" | "awaiting" | "not_found" | null;
  /** The item's latest count and the Stock levels estimate today. */
  lastCount: BoughtUsedCount | null;
}

export interface BoughtUsedView {
  propertyId: string;
  from: string;
  to: string;
  rules: typeof BOUGHT_USED_RULES;
  rows: BoughtUsedRowOut[];
  summary: BoughtUsedSummary & { checkedFlagged: number };
  /**
   * The flagged items' gap building up over the period, in money, with the largest item on its own. Each item's latest
   * delivery is left out, as it may still be on the shelf, so the line ends on the flags' total.
   */
  trend: { date: string; value: number; top: number }[];
  topId: string | null;
  /** The answers this user may record. */
  outcomes: { value: BoughtUsedOutcome; label: string }[];
  /** Every answer's words, to show a check someone else recorded. */
  labels: Record<BoughtUsedOutcome, string>;
  /** Whether this user's settling check closes the flag, and whether they may confirm someone else's. */
  mayClose: boolean;
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
  const counts = countsNow(propertyId, s);
  const { from, to } = boughtUsedPeriod();
  const flagged = rows.filter((r) => r.flagged);
  const top = flagged[0] ?? null;
  // Running total of bought less used for the flagged items, valued at the price paid, one point a day. The latest
  // delivery is the allowance for stock still on the shelf, so it is left out and the line ends where the flags do.
  let run = 0, runTop = 0;
  const trend = eachDay({ from, to }).map((date) => {
    for (const r of flagged) {
      const v = ((r.byDay[date] ?? 0) - (date === r.lastDeliveryDate ? r.lastDelivery : 0)) * r.unitCost;
      run += v;
      if (r === top) runTop += v;
    }
    return { date, value: round2(run), top: round2(runTop) };
  });
  const out: BoughtUsedRowOut[] = rows.map((full) => {
    const r: Omit<BoughtUsedRow, "byDay"> & { byDay?: unknown } = { ...full };
    delete r.byDay;
    const c = checks.get(r.ingredientId);
    const holds = !!c && checkHolds(c, r);
    const check = holds ? c! : null;
    return {
      ...r,
      flagId: r.flagged ? boughtUsedFlagId(propertyId, r.ingredientId, to) : null,
      check,
      earlierCheck: c && !holds ? c : null,
      checkState: !check ? null : closesFlag(check) ? "closed" : awaitsManager(check) ? "awaiting" : "not_found",
      lastCount: counts.get(r.ingredientId) ?? null,
    };
  });
  return {
    ok: true, propertyId, from, to, rules: BOUGHT_USED_RULES, rows: out,
    // Checked means the flag is closed by the check: settled, by or confirmed by a manager. "Not found" and a check
    // waiting for a manager are not checked yet.
    summary: { ...summarise(rows), checkedFlagged: out.filter((r) => r.flagged && r.checkState === "closed").length },
    trend, topId: top?.ingredientId ?? null,
    outcomes: OUTCOMES.filter((o) => mayChoose(user, o)).map((value) => ({ value, label: OUTCOME_LABEL[value] })), labels: OUTCOME_LABEL,
    mayClose: can(user, "investigation.close"),
  };
}

/** Marks an item's gap as checked, replacing any earlier check of it. Shared with everyone who sees the hotel. */
export function markChecked(user: User, body: Record<string, unknown>): Result<{ check: BoughtUsedCheck }> {
  const { propertyId, ingredientId, outcome } = body;
  if (!can(user, "stock.boughtUsed")) return { ok: false, status: 403, error: "Your role cannot do this." };
  if (!mayUse(user, propertyId)) return { ok: false, status: 403, error: "This check covers the whole hotel. Your access does not." };
  if (typeof ingredientId !== "string" || !ingredientById[ingredientId]) return { ok: false, status: 400, error: "Choose an item." };
  if (!OUTCOMES.includes(outcome as BoughtUsedOutcome)) return { ok: false, status: 400, error: "Choose what you found." };
  if (!mayChoose(user, outcome as BoughtUsedOutcome)) return { ok: false, status: 403, error: "Only someone who counts stock can record a count." };
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 300) : "";
  const row = checkRows(propertyId).find((r) => r.ingredientId === ingredientId);
  if (!row || row.gap <= 0) return { ok: false, status: 400, error: "This item has no gap to check." };
  const check = mutateStore((s) => {
    const c: BoughtUsedCheck = {
      id: `BUC-${propertyId.toUpperCase()}-${nextNumber(s, `bu-${propertyId}`)}`, propertyId, ingredientId, date: DEMO_TODAY,
      outcome: outcome as BoughtUsedOutcome, ...(note ? { note } : {}), by: user.id, role: user.role, at: new Date().toISOString(),
      gap: round2(row.gap), gapValue: row.excessValue,
    };
    s.boughtUsedChecks = [...(s.boughtUsedChecks ?? []).filter((x) => !(x.propertyId === propertyId && x.ingredientId === ingredientId)), c];
    return c;
  });
  audit(user.id, "Bought against used checked", `${propertyId} ${ingredientId}: ${outcome}`, "");
  return { ok: true, check };
}

/**
 * A manager who may close flags confirms a check that someone who may not (purchasing) recorded, which closes the flag.
 * Nobody confirms their own check.
 */
export function confirmCheck(user: User, body: Record<string, unknown>): Result<{ check: BoughtUsedCheck }> {
  const { id } = body;
  if (!can(user, "stock.boughtUsed") || !can(user, "investigation.close")) return { ok: false, status: 403, error: "Only a manager who may close flags can confirm a check." };
  const found = (loadStore().boughtUsedChecks ?? []).find((c) => c.id === id);
  if (!found) return { ok: false, status: 404, error: "This check was not found." };
  if (!mayUse(user, found.propertyId)) return { ok: false, status: 403, error: "This check covers the whole hotel. Your access does not." };
  if (!awaitsManager(found)) return { ok: false, status: 400, error: "This check does not wait for a manager." };
  if (found.by === user.id) return { ok: false, status: 403, error: "A check is confirmed by someone other than the person who made it." };
  const check = mutateStore((s) => {
    const c: BoughtUsedCheck = { ...found, confirmedBy: user.id, confirmedRole: user.role, confirmedAt: new Date().toISOString() };
    s.boughtUsedChecks = (s.boughtUsedChecks ?? []).map((x) => (x.id === found.id ? c : x));
    return c;
  });
  audit(user.id, "Bought against used check confirmed", `${found.propertyId} ${found.ingredientId}: ${found.outcome}, checked by ${found.by}`, "");
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

