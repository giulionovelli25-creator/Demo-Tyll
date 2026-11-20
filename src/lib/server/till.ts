// Till rule check, server side (overnight feature 5). How the bills of a period were rung and changed at the till: bills
// reopened after payment, cheaper items rung up, open items and prices set by hand, and items rung twice or in unusual
// numbers. The flags it lists are the same flags the snapshot sends (the public demo's shorter list included), so the
// check, the flags page and the Money Back List always count the same cases.
import { TILL_STORY_EXCEPTION_ID, TILL_STORY_ORDER_ID } from "../data/constants";
import { getDataset } from "../data/generate";
import { allowedOutlets, can } from "../domain/access";
import { POLICY, TILL_TYPES, hasOwnDay } from "../domain/detect";
import { lineValue } from "../domain/orders";
import { MIX_LABELS, MIX_OUTLETS, MIX_RULES, mixFlagged, mixValue, mixWeek } from "../domain/till-rules";
import type { ExceptionType, InvestigationStatus, MixEvidence, Order, User } from "../types";
import { DATA_START, DEMO_TODAY, addDays, eachDay, round2 } from "../util";
import { snapshotFor } from "./snapshot";

type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const list = (v: string | null | undefined) => (v === null || v === undefined ? null : v.split(",").map((x) => x.trim()).filter(Boolean));

export interface TillRow {
  caseId: string;
  type: ExceptionType;
  outletId: string;
  date: string;
  min: number;
  orderId?: string;
  headline: string;
  comparedWith: string;
  atStake: number;
  estimate: boolean;
  /** The case state as the dataset seeds it. The browser shows its own state when it holds the case. */
  seedStatus: InvestigationStatus;
}

/** Per rule: what it looked at in the period, and how many of those met the rule. */
export interface TillRuleRow {
  type: ExceptionType;
  /** Bills reopened, lines priced at the till, bills with an item entered twice in seconds or six or more of one, weeks of bottles checked. */
  seen: number;
  flagged: number;
  value: number;
}

export interface TillStory {
  caseId: string;
  orderId: string;
  outletId: string;
  date: string;
  covers: number;
  paid: number;
  after: number;
  payment: Order["payment"];
  paidMin: number;
  reopenMin: number;
  closedMin: number;
  removed: { itemId: string; qty: number; value: number; readyMin?: number }[];
}

export interface TillCheck {
  ok: true;
  from: string;
  to: string;
  bills: number;
  rules: TillRuleRow[];
  /** Every flag in the period, largest first. */
  rows: TillRow[];
  /** The last 30 days, for the trend, whatever period is chosen. */
  days: { date: string; flagged: number; value: number }[];
  /** The latest week of each premium bottle at the bars in view, flagged or not. */
  bottles: (MixEvidence & { outletId: string; flagged: boolean; value: number })[];
  story: TillStory | null;
}

/** A bill with an item entered twice within seconds, or one entry of many: what the duplicate rule looks at. */
function ringSeen(o: Order): boolean {
  const timed = o.lines.filter((l) => l.state === "kept" && l.enteredSec !== undefined);
  const at = (l: (typeof timed)[number]) => l.enteredMin * 60 + l.enteredSec!;
  return timed.some((a, i) => timed.some((b, j) => j > i && a.itemId === b.itemId && Math.abs(at(a) - at(b)) <= POLICY.duplicateSeconds)) || o.lines.some((l) => l.state === "kept" && l.qty >= POLICY.quantityMin);
}

export function tillCheckFor(user: User, q: { from?: string | null; to?: string | null; outlets?: string | null }): TillCheck | Fail {
  if (!can(user, "till.view")) return fail(403, "Your role cannot see the till rule check.");
  const to = q.to && ISO.test(q.to) ? (q.to > DEMO_TODAY ? DEMO_TODAY : q.to) : DEMO_TODAY;
  const asked = q.from && ISO.test(q.from) ? q.from : addDays(to, -29);
  const from = asked < DATA_START ? DATA_START : asked;
  if (from > to) return fail(400, "The period starts after it ends.");
  const mine = allowedOutlets(user);
  const outlets = new Set((list(q.outlets) ?? mine).filter((id) => mine.includes(id)));
  const d = getDataset();
  // The flags this user receives, so every row has its case and the counts match the flags page.
  const cases = snapshotFor(user).exceptions.filter((e) => TILL_TYPES.includes(e.type) && !!e.outletId && outlets.has(e.outletId));
  const inPeriod = cases.filter((e) => e.date >= from && e.date <= to);
  const rows: TillRow[] = inPeriod
    .map((e) => ({
      caseId: e.id, type: e.type, outletId: e.outletId!, date: e.date, min: e.min, orderId: e.orderId, headline: e.headline, comparedWith: e.comparedWith ?? "",
      atStake: e.exposure, estimate: e.basis === "estimate", seedStatus: d.seedInvestigations[e.id]?.status ?? "new",
    }))
    .sort((a, b) => b.atStake - a.atStake || b.date.localeCompare(a.date));

  const bills = d.orders.filter((o) => outlets.has(o.outletId) && o.date >= from && o.date <= to);
  const flaggedOf = (type: ExceptionType) => inPeriod.filter((e) => e.type === type);
  // The weekly bottle check runs on the morning after each week of seven closed days (the latest this morning).
  const runs = Array.from({ length: MIX_RULES.weeks }, (_, k) => addDays(DEMO_TODAY, -7 * k)).filter((x) => x >= from && x <= to).length;
  const bars = MIX_OUTLETS.filter((id) => outlets.has(id)).length;
  const seen: Record<string, number> = {
    bill_reopened: bills.filter((o) => o.reopened).length,
    price_override: bills.reduce((s, o) => s + o.lines.filter((l) => l.till).length, 0),
    duplicate_ring: bills.filter(ringSeen).length,
    // Each run looks at every premium bottle at every bar in view.
    cheaper_item_rung: runs * bars * MIX_LABELS.length,
  };
  const rules: TillRuleRow[] = TILL_TYPES.map((type) => {
    const f = flaggedOf(type);
    return { type, seen: Math.max(seen[type] ?? 0, f.length), flagged: f.length, value: round2(f.reduce((s, e) => s + e.exposure, 0)) };
  });

  const dated = cases.filter(hasOwnDay);
  const days = eachDay({ from: addDays(DEMO_TODAY, -29), to: DEMO_TODAY }).map((date) => {
    const on = dated.filter((e) => e.date === date);
    return { date, flagged: on.length, value: round2(on.reduce((s, e) => s + e.exposure, 0)) };
  });

  const latest = addDays(DEMO_TODAY, -1);
  const bottles = MIX_OUTLETS.filter((id) => outlets.has(id)).flatMap((outletId) =>
    MIX_LABELS.map((l) => {
      const m = mixWeek(d.dayItems, d.bottleIssues, outletId, l.id, latest);
      return { ...m, outletId, flagged: mixFlagged(m), value: mixFlagged(m) ? mixValue(m) : 0 };
    }),
  );

  const o = d.ordersById.get(TILL_STORY_ORDER_ID);
  const storyCase = cases.find((e) => e.id === TILL_STORY_EXCEPTION_ID);
  const story: TillStory | null = o?.reopened && storyCase
    ? {
        caseId: storyCase.id, orderId: o.id, outletId: o.outletId, date: o.date, covers: o.covers, paid: o.reopened.paid, after: round2(o.reopened.paid - storyCase.exposure), payment: o.payment,
        paidMin: o.closeMin, reopenMin: o.reopened.min, closedMin: o.reopened.closedMin,
        removed: o.lines.filter((l) => l.state === "removed_post" && (l.removedMin ?? 0) >= o.reopened!.min).map((l) => ({ itemId: l.itemId, qty: l.qty, value: lineValue(l), readyMin: l.completedMin })),
      }
    : null;

  return { ok: true, from, to, bills: bills.length, rules, rows, days, bottles, story };
}
