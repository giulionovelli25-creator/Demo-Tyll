// Automatic ordering: each morning the prediction's items due today become orders, one per supplier.
// Fixed, stated rules decide whether an order goes straight to the supplier or waits for approval. Never AI.
import type { MonthPlanOut, PlanItem } from "../server/purchasing";
import { DEMO_TODAY, addDays, eachDay, fmtNum, fmtQty } from "../util";

export interface AutoSettings {
  on: boolean;
  /** Local time of the morning run, HH:MM. */
  time: string;
  /** An order at or under this value, with nothing to review, goes to the supplier without waiting for approval. */
  sendUnder: number;
  /** Items that are never ordered automatically, such as premium items bought by hand. */
  never: string[];
  changedBy: string;
  changedAt: string;
}

export interface AutoRun {
  propertyId: string;
  date: string;
  time: string;
  /** Orders created by this run, one per supplier. */
  requestIds: string[];
  /** Items due today that were left for a person to order, and why. */
  skipped: { ingredientId: string; reason: string }[];
  /** The rules as they stood when the run happened. */
  sendUnder: number;
}

export interface AutoShape {
  settings: Record<string, AutoSettings>;
  runs: AutoRun[];
}

export const RUN_TIMES = ["05:00", "06:00", "07:00"] as const;
export const SEND_LIMITS = [500, 1000, 1500, 2500, 5000] as const;

export const defaultAuto = (): AutoShape => ({
  settings: { lis: { on: true, time: "06:00", sendUnder: 1500, never: ["lobster", "wagyu"], changedBy: "u-fnb", changedAt: `${addDays(DEMO_TODAY, -14)}T10:00` } },
  runs: [],
});

const daysLeft = (plan: MonthPlanOut) => Math.max(1, eachDay({ from: addDays(DEMO_TODAY, 1), to: plan.period.to }).length);

/** Why a recommendation needs a manager's eye. A rule, said in words, never a black box. */
export function reviewReason(r: PlanItem, qty: number, plan: MonthPlanOut): string | null {
  const perDay = r.predicted / daysLeft(plan);
  if (r.lastFourWeeks > 0 && qty > r.lastFourWeeks * 1.5) return `more than 1.5 times the last 4 weeks of use (${fmtQty(r.lastFourWeeks, r.unit)})`;
  if (r.shelfLifeDays <= 3 && perDay > 0 && qty / perDay > r.shelfLifeDays + 0.5) return `keeps ${r.shelfLifeDays} days, and this covers ${fmtNum(qty / perDay, 0)}`;
  if (plan.inputs.confidence === "low") return "the forecast confidence is low this month";
  return null;
}
