// The public demo shows a short, believable list of flags. The full set stays in the dataset and in every other mode.
import { HERO_EXCEPTION_ID } from "./constants";
import type { Exception, InvestigationState } from "../types";

const OPEN_OTHERS_PER_HOTEL = 3;
const CLOSED_PER_HOTEL = 12;

/** The worked examples, the three largest other open cases, and the most recent closed cases for each hotel. */
export function demoCases(exceptions: readonly Exception[], seed: Record<string, InvestigationState>): Exception[] {
  const keep = new Set<string>();
  const open = exceptions.filter((e) => seed[e.id]?.status !== "closed");
  for (const e of open) if (e.id === HERO_EXCEPTION_ID || e.type === "usage_variance") keep.add(e.id);
  const others = new Map<string, Exception[]>();
  for (const e of open) if (!keep.has(e.id)) others.set(e.propertyId, [...(others.get(e.propertyId) ?? []), e]);
  for (const list of others.values()) for (const e of [...list].sort((a, b) => b.exposure - a.exposure).slice(0, OPEN_OTHERS_PER_HOTEL)) keep.add(e.id);
  const closed = new Map<string, Exception[]>();
  for (const e of exceptions) if (seed[e.id]?.status === "closed") closed.set(e.propertyId, [...(closed.get(e.propertyId) ?? []), e]);
  for (const list of closed.values()) for (const e of [...list].sort((a, b) => b.date.localeCompare(a.date)).slice(0, CLOSED_PER_HOTEL)) keep.add(e.id);
  return exceptions.filter((e) => keep.has(e.id));
}
