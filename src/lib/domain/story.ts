// The demo's story over time: the hotel started using Tyll about eight weeks ago, and avoidable losses
// (waste, breakage, over pouring) have come down since. Simulated, like the rest of the demo data.
import { diffDays, rel } from "../util";

/** Tyll went live this many days before the business date. */
export const TYLL_LIVE_DAYS = 56;

/**
 * How much higher avoidable losses ran on a date than they do now: 1 means today's level.
 * Losses fall steadily from go-live and settle about 12 days ago.
 */
export function lossLevel(date: string): number {
  const daysBack = diffDays(rel(-12), date);
  return 1 + 1.1 * Math.min(1, Math.max(0, daysBack / 45));
}
