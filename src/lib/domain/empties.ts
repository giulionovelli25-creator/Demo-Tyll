// Empty bottle scans: staff scan (or pick) each empty wine or spirit bottle before it goes in the bin.
// Where an outlet scans its empties, Over pouring counts the bottles it scanned instead of the simulated bottles opened.
// An empty bottle is not waste: it says a bottle was used up. Who scanned it is not who poured it.
import { STAFF, outletById, staffById } from "../data/catalog";
import type { Role, User } from "../types";
import { allowedOutlets, can } from "./access";
import { DEMO_TODAY, DEMO_NOW_MIN, addDays, rng } from "../util";
import { rostered } from "./rota";
import { POUR_SKUS, pourSellsAt, shiftOf, type PourEntry, type PourSku, type Shift } from "./pour";

export interface EmptyScan {
  id: string;
  propertyId: string;
  outletId: string;
  /** The bottle: one of the Over pouring labels (POUR_SKUS). */
  skuId: string;
  /** Business date and minute of the business day (after midnight runs past 1440). */
  date: string;
  min: number;
  shift: Shift;
  /** Till login, or the user id for people with no till login. */
  by: string;
  /** The Tyll user who saved it. Absent on the simulated history. */
  byUser?: string;
  role: Role;
  /** Scanned by barcode, or picked from the list when the label would not scan. */
  method: "scan" | "pick";
  /** When it was saved on the server. Absent on the simulated history. */
  at?: string;
  clientKey?: string;
  /** Set when the person who scanned it took it back. It stays on record and no longer counts. */
  withdrawnBy?: string;
  withdrawnAt?: string;
}

/** EAN-13 with its check digit, in the 29 range kept for in-house codes, so a demo code never matches a real product. */
export function bottleEan(n: number): string {
  const base = `29${String(n).padStart(10, "0")}`;
  const check = (10 - (base.split("").reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0) % 10)) % 10;
  return `${base}${check}`;
}

/** The barcode on each bottle. In the demo they are in-house codes; a live hotel would use the producer's barcode. */
export const BOTTLE_BARCODE: Record<string, string> = Object.fromEntries(POUR_SKUS.map((s, i) => [s.id, bottleEan(90_001 + i)]));
export const skuByBarcode = (code: string): PourSku | undefined => POUR_SKUS.find((s) => BOTTLE_BARCODE[s.id] === code.trim());

/** Outlets that pour wine or spirits by the glass, the only places an empty can be logged. */
export const pourOutlets = (outletIds: readonly string[]) => outletIds.filter((o) => pourSellsAt(o, "wine") || pourSellsAt(o, "spirits"));

/** Who may log empties: the permission, and at least one outlet of theirs that pours. */
export const mayLogEmpty = (user: User) => can(user, "stock.logEmpty") && pourOutlets(allowedOutlets(user)).length > 0;

/**
 * The simulated history: Bar Azulejo has scanned every empty since 17 days ago, Mercado since 9 days ago.
 * In-Room Dining and Banquets and Events do not scan, so their bottles stay simulated.
 */
export const SCANNING: { outletId: string; fromDay: number }[] = [
  { outletId: "lis-lobby", fromDay: -17 },
  { outletId: "lis-terrace", fromDay: -9 },
];

/** How full the open bottle of each label was when the outlet started scanning, as a share of a bottle. Simulated. */
const openAtStart = (outletId: string, skuId: string) => rng(`empties|${outletId}|${skuId}`).next();

const ORDER: Record<Shift, number> = { day: 0, evening: 1, late: 2 };
/** When empties go in the bin on each shift: through the shift, after the first rounds. */
const WINDOW: Record<Shift, [number, number]> = { day: [12 * 60, 16 * 60 + 55], evening: [17 * 60 + 10, 21 * 60 + 55], late: [22 * 60 + 10, 25 * 60 + 20] };

/** Who bins the empties: the steward on Mercado's evenings, otherwise the bartender, or whoever runs the bar. */
function binner(outletId: string, date: string, shift: Shift, roll: number): string {
  const steward = STAFF.find((s) => s.outletId === outletId && s.role === "steward");
  if (steward && shift !== "day" && outletById[outletId].code === "MER" && roll < 0.7) return steward.id;
  const on = rostered(outletId, date, shift);
  return on.find((id) => staffById[id]?.role === "bartender") ?? on.find((id) => staffById[id]?.role === "supervisor") ?? on[0] ?? steward?.id ?? `${outletById[outletId].code}-S5`;
}

/**
 * Simulated scans for the outlets in SCANNING, from the same pouring as the simulated bottles: a bottle is scanned empty
 * in the shift its last glass is poured. Each label starts with a part bottle already open.
 */
export function seedEmptyScans(log: readonly PourEntry[]): EmptyScan[] {
  const out: EmptyScan[] = [];
  for (const { outletId, fromDay } of SCANNING) {
    const outlet = outletById[outletId];
    const from = addDays(DEMO_TODAY, fromDay);
    const perDay = new Map<string, number>();
    for (const sku of POUR_SKUS) {
      const entries = log.filter((e) => e.outletId === outletId && e.skuId === sku.id && e.date >= from && e.date <= DEMO_TODAY)
        .sort((a, b) => a.date.localeCompare(b.date) || ORDER[a.shift] - ORDER[b.shift]);
      let poured = openAtStart(outletId, sku.id) * sku.bottleMl;
      for (const e of entries) {
        const before = Math.floor(poured / sku.bottleMl);
        poured += e.ml;
        const n = Math.floor(poured / sku.bottleMl) - before;
        const r = rng(`empties|${outletId}|${sku.id}|${e.date}|${e.shift}`);
        const [start, windowEnd] = WINDOW[e.shift];
        const end = e.date === DEMO_TODAY ? Math.min(windowEnd, DEMO_NOW_MIN - 5) : windowEnd;
        if (end <= start) continue;
        for (let k = 0; k < n; k++) {
          const min = Math.round(start + ((k + 0.3 + r.next() * 0.6) / n) * (end - start));
          const seq = (perDay.get(e.date) ?? 0) + 1;
          perDay.set(e.date, seq);
          out.push({
            id: `ES-${outlet.code}-${e.date.slice(5, 7)}${e.date.slice(8, 10)}-${sku.id}-${seq}`, propertyId: outlet.propertyId, outletId, skuId: sku.id,
            date: e.date, min, shift: e.shift, by: binner(outletId, e.date, e.shift, r.next()), role: "employee", method: r.next() < 0.12 ? "pick" : "scan",
          });
        }
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.min - b.min);
}

const live = (scans: readonly EmptyScan[]) => scans.filter((s) => !s.withdrawnAt);

/**
 * The first day each outlet's bottles come from scans. An outlet counts from the day it started scanning, once that day
 * has closed: an outlet that starts today keeps simulated bottles until tomorrow, so a part day never counts as a whole one.
 */
export function scanningFrom(scans: readonly EmptyScan[], today = DEMO_TODAY): Map<string, string> {
  const first = new Map<string, string>();
  for (const s of live(scans)) if (!first.has(s.outletId) || s.date < first.get(s.outletId)!) first.set(s.outletId, s.date);
  return new Map([...first].filter(([, d]) => d < today));
}

const keyOf = (x: { date: string; outletId: string; shift: Shift; skuId: string }) => `${x.date}|${x.outletId}|${x.shift}|${x.skuId}`;

/**
 * The open bottle of each label, counted to a tenth at close: how much fuller (+) or emptier (−) it is than at the start
 * of the shift, in bottles. Simulated from the same pouring as the rest of Over pouring, from the day the outlet started scanning.
 */
export function openBottleChange(log: readonly PourEntry[], from: ReadonlyMap<string, string>, today = DEMO_TODAY): Map<string, number> {
  const out = new Map<string, number>();
  const runs = new Map<string, PourEntry[]>();
  for (const e of log) {
    const f = from.get(e.outletId);
    if (!f || e.date < f || e.date > today) continue;
    const k = `${e.outletId}|${e.skuId}`;
    const run = runs.get(k);
    if (run) run.push(e);
    else runs.set(k, [e]);
  }
  for (const [k, entries] of runs) {
    const [outletId, skuId] = k.split("|");
    const sku = POUR_SKUS.find((s) => s.id === skuId)!;
    let open = openAtStart(outletId, skuId);
    for (const e of entries.sort((a, b) => a.date.localeCompare(b.date) || ORDER[a.shift] - ORDER[b.shift])) {
      const after = open + e.ml / sku.bottleMl;
      out.set(keyOf(e), (after % 1) - (open % 1));
      open = after;
    }
  }
  return out;
}

/**
 * The pour log with scans applied: on a day an outlet scans, every shift and label at that outlet counts its empties
 * scanned plus the change in its open bottle (no empty is no whole bottle used). A scan in a shift with no glass sold
 * still counts, as a bottle used with nothing billed.
 */
export function withScans(log: readonly PourEntry[], scans: readonly EmptyScan[], today = DEMO_TODAY): PourEntry[] {
  const from = scanningFrom(scans, today);
  const part = openBottleChange(log, from, today);
  const count = new Map<string, number>();
  for (const s of live(scans)) {
    const f = from.get(s.outletId);
    if (f && s.date >= f && s.date <= today) count.set(keyOf(s), (count.get(keyOf(s)) ?? 0) + 1);
  }
  const out = log.map((e) => {
    const f = from.get(e.outletId);
    if (!f || e.date < f) return e;
    const k = keyOf(e);
    const n = count.get(k) ?? 0;
    count.delete(k);
    return { ...e, scanned: n, part: part.get(k) ?? 0 };
  });
  for (const [k, n] of count) {
    const [date, outletId, shift, skuId] = k.split("|");
    out.push({ date, outletId, shift: shift as Shift, skuId, sold: 0, ml: 0, scanned: n, part: 0 });
  }
  return out;
}

/** A scan made now, on the demo's business day and clock. */
export const scanMoment = () => ({ date: DEMO_TODAY, min: DEMO_NOW_MIN, shift: shiftOf(DEMO_NOW_MIN) });
