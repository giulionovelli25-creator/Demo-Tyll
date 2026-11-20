// Twelve weeks of deliveries as goods in saw them: the window each supplier promised, when it actually came and whether
// it was all there. Simulated, deterministic, and placed relative to the business date like every other record, so the
// same story shows every day. The last 30 days are the dataset's own deliveries (same id, value and lines); before that
// the history keeps each supplier's delivery days and usual order value.
//
// Each supplier has one pattern a manager can see on Supplier reliability:
// - Carnes Ribeiro & Filhos (meat): late on the weekday of tomorrow's delivery, about 2 hours, on most weeks. The story.
// - Peixaria Atlântico (fish): late after public holidays, and with large orders.
// - Hortas do Tejo (produce): the early weekday slot (06:30) runs late now and then; the weekend slot is on time.
// - Mercearia Lusa, Douro Cellars, Linho Lisboa: mostly on time.
// - Fonte Clara Bebidas (drinks): almost always on time.
// - Horeca Ibérica (glass and china): new to the hotel, 5 deliveries, so still being learned.
import { INGREDIENTS, supplierById } from "./catalog";
import { getDataset } from "./generate";
import type { DeliveryTiming } from "../domain/late-delivery";
import { holidayBefore, leadBuffer, minOf, stamp } from "../domain/late-delivery";
import { DEMO_TODAY, addDays, rel, rng, round2, weekday } from "../util";

/** How far back the history goes. */
export const HISTORY_DAYS = 84;

interface Profile {
  /** Delivery weekdays, 0 Sunday to 6 Saturday. The dataset's suppliers keep the dataset's days. */
  days: number[];
  /** The promised window for a delivery on this date. */
  window: (date: string) => { from: string; to: string };
  /** Late or not, and by how many minutes, for one delivery. */
  late: (d: { date: string; value: number; usual: number; r: ReturnType<typeof rng> }) => number | null;
  /** First delivery, in days before today. Older days have no delivery. */
  since?: number;
  /** Usual order value when the dataset has none. */
  value?: number;
}

/** Weeks back (1 is a week before tomorrow) on which the meat delivery on tomorrow's weekday was late. 7 of the last 10. */
const MEAT_LATE_WEEKS = new Set([1, 2, 4, 5, 6, 8, 9, 11, 12]);
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

const PROFILES: Record<string, Profile> = {
  meat: {
    days: ALL_DAYS, window: () => ({ from: "07:00", to: "08:00" }),
    late: ({ date, r }) => {
      const story = weekday(date) === weekday(rel(1));
      if (story) {
        const weeksBack = Math.round((Date.parse(rel(1)) - Date.parse(date)) / (7 * 86400000));
        return MEAT_LATE_WEEKS.has(weeksBack) ? r.int(105, 150) : null;
      }
      return r.chance(0.06) ? r.int(20, 40) : null;
    },
  },
  sea: {
    days: ALL_DAYS, window: () => ({ from: "07:30", to: "08:30" }),
    late: ({ date, value, usual, r }) => {
      if (holidayBefore(date)) return r.chance(0.85) ? r.int(75, 120) : null;
      if (usual > 0 && value > usual * 1.3) return r.chance(0.6) ? r.int(45, 90) : null;
      return r.chance(0.06) ? r.int(20, 35) : null;
    },
  },
  produce: {
    days: ALL_DAYS, window: (date) => ([0, 6].includes(weekday(date)) ? { from: "09:00", to: "10:00" } : { from: "06:30", to: "07:30" }),
    late: ({ date, r }) => ([0, 6].includes(weekday(date)) ? (r.chance(0.03) ? r.int(20, 30) : null) : r.chance(0.2) ? r.int(25, 50) : null),
  },
  dry: { days: [1, 4], window: () => ({ from: "09:00", to: "11:00" }), late: ({ r }) => (r.chance(0.07) ? r.int(30, 60) : null) },
  wine: { days: [2, 5], window: () => ({ from: "10:00", to: "12:00" }), late: ({ r }) => (r.chance(0.08) ? r.int(30, 75) : null) },
  bev: { days: [2, 5], window: () => ({ from: "08:00", to: "09:00" }), late: ({ r }) => (r.chance(0.015) ? r.int(20, 25) : null) },
  hk: { days: [2, 5], window: () => ({ from: "09:00", to: "10:00" }), late: ({ r }) => (r.chance(0.1) ? r.int(25, 45) : null), value: 380 },
  ware: { days: [3], window: () => ({ from: "10:00", to: "12:00" }), late: ({ r }) => (r.chance(0.2) ? r.int(30, 60) : null), since: 35, value: 520 },
};

export const TIMED_SUPPLIERS = Object.keys(PROFILES);
/** The promised window for a supplier's delivery on a date. */
export const windowFor = (supplierId: string, date: string) => PROFILES[supplierId]?.window(date) ?? { from: "08:00", to: "10:00" };

const valueOf = (lines: { ordered: number; poPrice: number }[]) => round2(lines.reduce((t, l) => t + l.ordered * l.poPrice, 0));

let cached: { day: string; rows: DeliveryTiming[] } | null = null;

/** Every delivery from 12 weeks ago to today, with its timing, and tomorrow's confirmed ones (not arrived). */
export function deliveryHistory(): DeliveryTiming[] {
  if (cached?.day === DEMO_TODAY) return cached.rows;
  const ds = getDataset();
  const rows: DeliveryTiming[] = [];
  const from = addDays(DEMO_TODAY, -HISTORY_DAYS + 1);
  const dsFrom = ds.deliveries.filter((d) => d.propertyId === "lis").reduce((m, d) => (d.date < m ? d.date : m), DEMO_TODAY);
  for (const [supplierId, p] of Object.entries(PROFILES)) {
    const own = ds.deliveries.filter((d) => d.propertyId === "lis" && d.supplierId === supplierId);
    const values = own.filter((d) => d.status === "delivered").map((d) => valueOf(d.lines));
    const usual = values.length ? values.sort((a, b) => a - b)[Math.floor(values.length / 2)] : p.value ?? 300;
    const items = own.at(-1)?.lines.map((l) => ({ ingredientId: l.ingredientId, qty: l.ordered })) ?? INGREDIENTS.filter((g) => g.supplierId === supplierId).slice(0, 3).map((g) => ({ ingredientId: g.id, qty: g.packSize }));
    for (let date = from; date <= addDays(DEMO_TODAY, 1); date = addDays(date, 1)) {
      if (p.since !== undefined && date < rel(-p.since)) continue;
      const r = rng(`delivery-time|${supplierId}|${date}`);
      // The first draws of a seed follow the seed closely, so a few are skipped before anything rare is decided.
      r.next(); r.next(); r.next();
      // The dataset's deliveries for the last 30 days, and tomorrow's confirmed ones; the history before keeps the days.
      const real = own.find((d) => d.date === date);
      if (date >= dsFrom && own.length) { if (!real) continue; } else if (!p.days.includes(weekday(date))) continue;
      const window = p.window(date);
      const value = real ? valueOf(real.lines) : round2(usual * (r.chance(supplierId === "sea" ? 0.14 : 0.05) ? r.between(1.45, 1.8) : r.between(0.85, 1.15)));
      const future = date > DEMO_TODAY;
      const lateBy = future ? null : p.late({ date, value, usual, r });
      // On time: anywhere from 10 minutes early to the end of the window.
      const arrival = lateBy !== null ? minOf(window.to) + lateBy : minOf(window.from) - 10 + r.int(0, minOf(window.to) - minOf(window.from) + 10);
      rows.push({
        id: real?.id ?? `PO-LIS-${date.slice(5, 7)}${date.slice(8, 10)}-${supplierId.toUpperCase()}`,
        propertyId: "lis", supplierId, date,
        orderedAt: stamp(addDays(date, -1), r.int(11 * 60, 15 * 60 + 30)),
        window, arrivedAt: future ? null : stamp(date, arrival),
        complete: future ? null : real ? real.lines.every((l) => l.delivered >= l.ordered) : r.chance(0.97),
        value, items: real ? real.lines.map((l) => ({ ingredientId: l.ingredientId, qty: l.ordered })) : items, source: "simulated",
      });
    }
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.supplierId.localeCompare(b.supplierId));
  cached = { day: DEMO_TODAY, rows };
  return rows;
}

/** The usual order value of a supplier: the median over its history. */
export function usualValue(supplierId: string): number {
  const v = deliveryHistory().filter((d) => d.supplierId === supplierId && d.arrivedAt).map((d) => d.value).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : 0;
}

/** Whether an order arriving on this date should go a day early, because this supplier is often late then. */
export function leadBufferFor(supplierId: string, date: string): { days: 1; why: string } | null {
  if (!PROFILES[supplierId]) return null;
  return leadBuffer(deliveryHistory(), { supplierId, date, window: windowFor(supplierId, date), value: usualValue(supplierId) }, DEMO_TODAY, supplierById[supplierId]?.name ?? "This supplier");
}
