// The public demo shows a short, believable list of flags. The full set stays in the dataset and in every other mode.
import { HERO_EXCEPTION_ID, ROOM_STORY_EXCEPTION_ID } from "./constants";
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

/**
 * The worked examples, every room charge case in the last 30 days (the room charge check lists each one, so each needs
 * its case), then up to three of the largest other open cases while the hotel stays within twelve open, the twelve
 * most recent other closed cases for each hotel, and a fixed share of the other closed cases of the last 30 days.
 */
export function demoCases(exceptions: readonly Exception[], seed: Record<string, InvestigationState>): Exception[] {
  const keep = new Set<string>();
  const roomFrom = demoRoomCheckFrom();
  const open = exceptions.filter((e) => seed[e.id]?.status !== "closed");
  for (const e of open) if (e.id === HERO_EXCEPTION_ID || e.id === ROOM_STORY_EXCEPTION_ID || e.type === "usage_variance" || isRoom(e)) keep.add(e.id);
  for (const e of exceptions) if (isRoom(e) && e.date >= roomFrom) keep.add(e.id);
  const others = new Map<string, Exception[]>();
  for (const e of open) if (!keep.has(e.id)) others.set(e.propertyId, [...(others.get(e.propertyId) ?? []), e]);
  for (const [propertyId, list] of others) {
    const room = OPEN_MAX_PER_HOTEL - open.filter((e) => e.propertyId === propertyId && keep.has(e.id)).length;
    for (const e of [...list].sort((a, b) => b.exposure - a.exposure).slice(0, Math.max(0, Math.min(OPEN_OTHERS_PER_HOTEL, room)))) keep.add(e.id);
  }
  // Closed room charge cases follow their own rule above, so they do not crowd the other kinds out of the closed list.
  const closed = new Map<string, Exception[]>();
  for (const e of exceptions) if (seed[e.id]?.status === "closed" && !isRoom(e)) closed.set(e.propertyId, [...(closed.get(e.propertyId) ?? []), e]);
  for (const list of closed.values()) for (const e of [...list].sort((a, b) => b.date.localeCompare(a.date)).slice(0, CLOSED_PER_HOTEL)) keep.add(e.id);
  for (const list of closed.values()) for (const e of list) if (e.date >= roomFrom && rng(`demo-case|${e.id}`).chance(CLOSED_SAMPLE)) keep.add(e.id);
  return exceptions.filter((e) => keep.has(e.id));
}
