// Outlet stock periods for the outlets a user may see. Each period holds only its own outlet's sales.
import { getOutletStock } from "../data/generate";
import { latestPeriods } from "../data/outlet-stock";
import { allowedOutlets } from "../domain/access";
import type { UsagePeriod, User } from "../types";

/** The latest period for each item counted at the user's outlets in a hotel. */
export function periodsFor(user: User, propertyId: string): UsagePeriod[] {
  const mine = new Set(allowedOutlets(user));
  return latestPeriods(getOutletStock().periods).filter((p) => p.propertyId === propertyId && mine.has(p.outletId));
}

/** One period by id, or null when it does not exist or belongs to another outlet. */
export function periodFor(user: User, id: string): UsagePeriod | null {
  const p = getOutletStock().periods.find((x) => x.id === id);
  return p && allowedOutlets(user).includes(p.outletId) ? p : null;
}
