// The variance review before a stock take is approved: for each difference, the likely reason by fixed rules, and
// whether it is large enough to check before approving. A likely reason is something to check, never proof, and never
// about a person.
import type { LocationId } from "../data/locations";

export interface ReasonIn {
  diff: number;
  value: number;
  system: number;
  area: LocationId;
  shelfLifeDays: number;
  /** A goods in difference was recorded for this item in the last days. */
  deliveryShort: boolean;
}

export const LARGE_VALUE = 50;
export const LARGE_SHARE = 0.15;

/** Large: worth checking before approving. €50 or more either way, or 15% of the system figure when it is worth €15. */
export const isLarge = (x: { value: number; diff: number; system: number }) =>
  Math.abs(x.value) >= LARGE_VALUE || (x.system > 0 && Math.abs(x.diff) / x.system >= LARGE_SHARE && Math.abs(x.value) >= 15);

export function likelyReason(x: ReasonIn): string {
  if (Math.abs(x.diff) < 1e-9) return "";
  if (Math.abs(x.value) < 5 || (x.system > 0 && Math.abs(x.diff) / x.system <= 0.02)) return "Within normal counting error.";
  if (x.diff > 0) return "More than the system shows: a delivery not recorded, or stock sent back from an outlet.";
  if (x.deliveryShort) return "A delivery of it came short this week: check that goods in recorded it.";
  if (x.area === "cellar" || x.area === "bar") return "Drinks poured but not billed, or bottles taken to a bar without a transfer. Compare with Over pouring.";
  if (x.shelfLifeDays <= 4) return "Fresh item: waste not logged, or portions above the recipe.";
  return "Used without a record: a transfer, a staff meal or portions above the recipe.";
}
