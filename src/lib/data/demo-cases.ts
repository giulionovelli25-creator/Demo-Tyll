// The public demo shows a short, believable list of flags. The full set stays in the dataset and in every other mode.
import { BREAKFAST_STORY_EXCEPTION_ID, COVERS_EXAMPLE_EXCEPTION_ID, COVERS_STORY_EXCEPTION_ID, HERO_EXCEPTION_ID, MIX_STORY_EXCEPTION_ID, ROOM_STORY_EXCEPTION_ID, TILL_STORY_EXCEPTION_ID } from "./constants";
import { TILL_TYPES } from "../domain/detect";
import type { Exception, InvestigationState } from "../types";
import { DEMO_TODAY, addDays, rng } from "../util";

const OPEN_OTHERS_PER_HOTEL = 3;
const OPEN_MAX_PER_HOTEL = 12;
const CLOSED_PER_HOTEL = 12;
/**
 * Besides the twelve newest, this share of the other closed cases of the last 30 days is kept, drawn by case id so a case
 * stays in or out as the days move. The 30 day views then keep the same mix of kinds as the full data, without the
 * Overview's money lost growing past the story's figure (about EUR 10,000).
 */
const CLOSED_SAMPLE = 0.1;

/**
 * The first day of the room charge check in the public demo: the last 30 days, the longest period the check offers (a
 * custom range cannot start earlier). Every room charge case from this day on is kept, open or closed, so each difference
 * the check counts has its case, and the check and the flags add up to the same figures.
 */
export const demoRoomCheckFrom = () => addDays(DEMO_TODAY, -29);

const isRoom = (e: Exception) => e.type.startsWith("room_charge");
/** Bought against used: one flag per item with a large gap, a few a day. The check lists each one, so each keeps its case. */
const isBought = (e: Exception) => e.type === "bought_not_used";
/** Till rules: the till rule check shows each rule's history, so its closed cases of the last 30 days are kept, as room charges are. */
const isTill = (e: Exception) => TILL_TYPES.includes(e.type);
/**
 * A seated table with no bill: every open one and the checked example are kept; other closed ones are not, so the
 * Overview's money lost stays near the story's figure. The covers check leaves out a table whose case is not in the list.
 */
const isSeated = (e: Exception) => e.type === "seated_no_bill";
/**
 * A breakfast not charged: every open one (this morning's worked example) is kept; closed ones follow the rule for other
 * closed cases. Hotel guests against outlet charges leaves out a room whose case is not in the list.
 */
const isBreakfast = (e: Exception) => e.type === "breakfast_not_charged";

/** The worked examples: the Coke, the dinner on the wrong room, the bill reopened after payment, the reserve red and the table with no bill. */
const STORIES = new Set([HERO_EXCEPTION_ID, ROOM_STORY_EXCEPTION_ID, TILL_STORY_EXCEPTION_ID, MIX_STORY_EXCEPTION_ID, COVERS_STORY_EXCEPTION_ID, BREAKFAST_STORY_EXCEPTION_ID]);

/**
 * The worked examples (STORIES), open usage above sales (today's, those linked to a kept bill, then the largest within twelve open), every room charge case in the last 30 days (the room charge check lists each one, so each needs
 * its case), every bought against used flag (the same reason), the closed till rule cases of the last 30 days (the till rule
 * check lists them, with the two checked examples), every open seated table with no bill and the checked one, every open breakfast not charged, then up to three of the largest other open cases while the hotel stays within twelve open, the twelve
 * most recent other closed cases for each hotel, and a fixed share of the other closed cases of the last 30 days.
 */
export function demoCases(exceptions: readonly Exception[], seed: Record<string, InvestigationState>): Exception[] {
  const keep = new Set<string>();
  const roomFrom = demoRoomCheckFrom();
  const open = exceptions.filter((e) => seed[e.id]?.status !== "closed");
  for (const e of open) if (STORIES.has(e.id) || isRoom(e) || isSeated(e) || isBreakfast(e)) keep.add(e.id);
  for (const e of exceptions) if ((isRoom(e) && e.date >= roomFrom) || isBought(e) || e.id === COVERS_EXAMPLE_EXCEPTION_ID) keep.add(e.id);
  for (const e of exceptions) if (isTill(e) && e.date >= roomFrom && seed[e.id]?.status === "closed") keep.add(e.id);
  // Usage above sales: every open one from today's counts, and any whose stock period holds a removal from a bill kept
  // here (the case page links the two), then the older ones, largest first, while the hotel stays within twelve open.
  const variances = open.filter((e) => e.type === "usage_variance");
  const linked = (e: Exception) => !!e.period?.removals.some((r) => keep.has(`EX-${r.orderId}`));
  for (const e of variances) if (e.date === DEMO_TODAY || linked(e)) keep.add(e.id);
  for (const e of [...variances].sort((a, b) => b.exposure - a.exposure)) {
    if (keep.has(e.id)) continue;
    if (open.filter((x) => x.propertyId === e.propertyId && keep.has(x.id)).length < OPEN_MAX_PER_HOTEL) keep.add(e.id);
  }
  const others = new Map<string, Exception[]>();
  for (const e of open) if (!keep.has(e.id)) others.set(e.propertyId, [...(others.get(e.propertyId) ?? []), e]);
  for (const [propertyId, list] of others) {
    const room = OPEN_MAX_PER_HOTEL - open.filter((e) => e.propertyId === propertyId && keep.has(e.id)).length;
    for (const e of [...list].sort((a, b) => b.exposure - a.exposure).slice(0, Math.max(0, Math.min(OPEN_OTHERS_PER_HOTEL, room)))) keep.add(e.id);
  }
  // Closed room charge cases follow their own rule above, so they do not crowd the other kinds out of the closed list.
  const closed = new Map<string, Exception[]>();
  for (const e of exceptions) if (seed[e.id]?.status === "closed" && !isRoom(e) && !isBought(e) && !isTill(e) && !isSeated(e)) closed.set(e.propertyId, [...(closed.get(e.propertyId) ?? []), e]);
  for (const list of closed.values()) for (const e of [...list].sort((a, b) => b.date.localeCompare(a.date)).slice(0, CLOSED_PER_HOTEL)) keep.add(e.id);
  for (const list of closed.values()) for (const e of list) if (e.date >= roomFrom && rng(`demo-case|${e.id}`).chance(CLOSED_SAMPLE)) keep.add(e.id);
  return exceptions.filter((e) => keep.has(e.id));
}
