// The public demo shows a short, believable list of flags. The full set stays in the dataset and in every other mode.
import { HERO_EXCEPTION_ID, ROOM_STORY_EXCEPTION_ID } from "./constants";
import type { Exception, InvestigationState } from "../types";

const OPEN_OTHERS_PER_HOTEL = 3;
const OPEN_MAX_PER_HOTEL = 12;
const CLOSED_PER_HOTEL = 12;

/**
 * The worked examples, every open room charge difference (the room charge check lists each one, so each needs its case),
 * then up to three of the largest other open cases while the hotel stays within twelve open, and the most recent closed
 * cases for each hotel.
 */
export function demoCases(exceptions: readonly Exception[], seed: Record<string, InvestigationState>): Exception[] {
  const keep = new Set<string>();
  const open = exceptions.filter((e) => seed[e.id]?.status !== "closed");
  for (const e of open) if (e.id === HERO_EXCEPTION_ID || e.id === ROOM_STORY_EXCEPTION_ID || e.type === "usage_variance" || e.type.startsWith("room_charge")) keep.add(e.id);
  const others = new Map<string, Exception[]>();
  for (const e of open) if (!keep.has(e.id)) others.set(e.propertyId, [...(others.get(e.propertyId) ?? []), e]);
  for (const [propertyId, list] of others) {
    const room = OPEN_MAX_PER_HOTEL - open.filter((e) => e.propertyId === propertyId && keep.has(e.id)).length;
    for (const e of [...list].sort((a, b) => b.exposure - a.exposure).slice(0, Math.max(0, Math.min(OPEN_OTHERS_PER_HOTEL, room)))) keep.add(e.id);
  }
  const closed = new Map<string, Exception[]>();
  for (const e of exceptions) if (seed[e.id]?.status === "closed") closed.set(e.propertyId, [...(closed.get(e.propertyId) ?? []), e]);
  for (const list of closed.values()) for (const e of [...list].sort((a, b) => b.date.localeCompare(a.date)).slice(0, CLOSED_PER_HOTEL)) keep.add(e.id);
  return exceptions.filter((e) => keep.has(e.id));
}
