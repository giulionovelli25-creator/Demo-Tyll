// Late delivery prediction: which supplier deliveries are likely to arrive late, from each supplier's own record, and
// whether that lateness would hurt a service. Plain counting, weighted towards recent deliveries. Never AI.
// One module for the server, the screens and the tests. Every time is the hotel's local time ("YYYY-MM-DDTHH:MM").
import { addDays, diffDays, weekday } from "../util";

// ---- The rules, in one place --------------------------------------------------------------------------------------

export const LATE_RULES = {
  /** A delivery is late when it arrives more than this many minutes after the end of the promised window. */
  graceMin: 15,
  /** Below this many deliveries a supplier is still being learned: no prediction. */
  learningBelow: 8,
  /** Recent deliveries count more: a delivery this many days old counts half. */
  halfLifeDays: 42,
  /** At or above this chance a delivery is "likely late". */
  likely: 0.5,
  /** At or above this chance a delivery "may be late". */
  maybe: 0.3,
  /** A pattern needs at least this many deliveries before it is used. */
  minPattern: 4,
  /** An order this much above the supplier's usual value counts as large. */
  largeOrder: 1.3,
  /** Days after a public holiday that count as "after a holiday". */
  afterHolidayDays: 2,
} as const;

export type ServiceId = "breakfast" | "lunch" | "dinner";
/** Each service, and when its prep starts: the time the kitchen needs the stock in hand. */
export const SERVICES: { id: ServiceId; label: string; start: number; end: number; prep: number }[] = [
  { id: "breakfast", label: "breakfast", start: 7 * 60, end: 10 * 60 + 30, prep: 6 * 60 },
  { id: "lunch", label: "lunch", start: 12 * 60, end: 15 * 60, prep: 9 * 60 + 30 },
  { id: "dinner", label: "dinner", start: 19 * 60, end: 23 * 60, prep: 16 * 60 + 30 },
];
/** The service an order opened at this minute of the day belongs to. */
export const serviceAt = (min: number): ServiceId => (min < 11 * 60 ? "breakfast" : min < 17 * 60 ? "lunch" : "dinner");

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

// ---- Dates and times ----------------------------------------------------------------------------------------------

export const hm = (min: number) => `${String(Math.floor((((min % 1440) + 1440) % 1440) / 60)).padStart(2, "0")}:${String((((min % 1440) + 1440) % 1440) % 60).padStart(2, "0")}`;
export const minOf = (time: string) => { const [h, m] = time.split(":").map(Number); return h * 60 + m; };
/** A local date and minutes from midnight, as one local stamp. Minutes past midnight roll into the next day. */
export const stamp = (date: string, min: number) => `${addDays(date, Math.floor(min / 1440))}T${hm(min)}`;
/** Minutes from the start of `date` to a local stamp, so 01:00 the next day is 1500. */
export const minutesFrom = (date: string, at: string) => diffDays(at.slice(0, 10), date) * 1440 + minOf(at.slice(11, 16));

/** The hotel's date and time for an instant, in its own time zone: never the viewer's or the server's. */
export function localNow(timeZone: string, at: Date): { date: string; min: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, min: Number(parts.hour) * 60 + Number(parts.minute) };
}

/** Easter Sunday (Gregorian), for the holidays that move with it. */
function easter(year: number): string {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
const FIXED = ["01-01", "04-25", "05-01", "06-10", "06-13", "08-15", "10-05", "11-01", "12-01", "12-08", "12-25"];
/** Public holidays in Lisbon: the national ones and Saint Anthony (13 June). */
export function holidaysIn(year: number): string[] {
  const e = easter(year);
  return [...FIXED.map((d) => `${year}-${d}`), addDays(e, -2), e, addDays(e, 60)].sort();
}
export const isHoliday = (date: string) => holidaysIn(Number(date.slice(0, 4))).includes(date);
/** The holiday this date follows within LATE_RULES.afterHolidayDays, or null. A holiday itself is not "after" one. */
export function holidayBefore(date: string): string | null {
  if (isHoliday(date)) return null;
  for (let n = 1; n <= LATE_RULES.afterHolidayDays; n++) if (isHoliday(addDays(date, -n))) return addDays(date, -n);
  return null;
}

// ---- Deliveries ---------------------------------------------------------------------------------------------------

/** One delivery as goods in saw it: what was promised, when it came, and whether it was all there. */
export interface DeliveryTiming {
  id: string;
  propertyId: string;
  supplierId: string;
  /** The delivery date. */
  date: string;
  /** When the order went to the supplier, local. */
  orderedAt: string;
  /** The promised window, local HH:MM on the delivery date. */
  window: { from: string; to: string };
  /** When it arrived, local. Null while it has not. */
  arrivedAt: string | null;
  /** Every line arrived in full. Null while it has not arrived. */
  complete: boolean | null;
  /** Order value before VAT, for "large order". */
  value: number;
  items: { ingredientId: string; qty: number }[];
  /** Simulated history, or recorded at goods in by a person. */
  source: "simulated" | "recorded";
  recordedBy?: string;
}

/** Minutes after the end of the promised window. Negative when early. */
export const minutesLate = (d: Pick<DeliveryTiming, "date" | "window" | "arrivedAt">): number | null => (d.arrivedAt ? minutesFrom(d.date, d.arrivedAt) - minOf(d.window.to) : null);
export const isLate = (d: Pick<DeliveryTiming, "date" | "window" | "arrivedAt">) => (minutesLate(d) ?? -1) > LATE_RULES.graceMin;

const weightOf = (date: string, today: string) => 0.5 ** (Math.max(0, diffDays(today, date)) / LATE_RULES.halfLifeDays);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };

export type Confidence = "learning" | "low" | "medium" | "high";
export const confidenceOf = (n: number): Confidence => (n < LATE_RULES.learningBelow ? "learning" : n < 20 ? "low" : n < 40 ? "medium" : "high");
export const CONFIDENCE_WORD: Record<Confidence, string> = { learning: "Learning this supplier", low: "Low confidence", medium: "Medium confidence", high: "High confidence" };

/** "2 hours", "1 hour 30 minutes", "40 minutes". */
export function delayText(min: number): string {
  const m = Math.max(0, Math.round(min / 5) * 5);
  const h = Math.floor(m / 60), r = m % 60;
  if (!h) return `${r} minutes`;
  if (!r) return `${h} ${h === 1 ? "hour" : "hours"}`;
  return `${h} ${h === 1 ? "hour" : "hours"} ${r} minutes`;
}

export type Driver = "weekday" | "holiday" | "size" | "slot" | "overall";

/** What the record says about one coming delivery. */
export interface Prediction {
  supplierId: string;
  /** Deliveries in the record (arrived ones only). */
  n: number;
  confidence: Confidence;
  /** Chance it arrives late, 0 to 1. Null while learning. */
  chance: number | null;
  /** Likely minutes late when it is late. */
  delayMin: number;
  /** "likely": at or above LATE_RULES.likely; "maybe": at or above maybe; "on_time" below; "learning" below 8 deliveries. */
  verdict: "likely" | "maybe" | "on_time" | "learning";
  driver: Driver;
  /** The deliveries the sentence counts: the last ten of the pattern. */
  shown: { late: number; of: number };
  /** One sentence a chef understands: "Late on 7 of the last 10 Saturdays, 2 hours on average." */
  sentence: string;
  /** When it is likely to arrive, local. The end of the window when it is not likely to be late. */
  likelyArrival: string;
}

export interface Coming {
  supplierId: string;
  date: string;
  window: { from: string; to: string };
  value: number;
}

interface Subset { driver: Driver; rows: DeliveryTiming[]; label: (late: number, of: number) => string }

function subsetsFor(history: DeliveryTiming[], c: Coming): Subset[] {
  const out: Subset[] = [];
  const wd = weekday(c.date);
  out.push({ driver: "weekday", rows: history.filter((d) => weekday(d.date) === wd), label: (l, n) => `Late on ${l} of the last ${n} ${WEEKDAYS[wd]}s` });
  if (holidayBefore(c.date)) out.push({ driver: "holiday", rows: history.filter((d) => holidayBefore(d.date)), label: (l, n) => `Late on ${l} of the last ${n} deliveries after a public holiday` });
  const usual = median(history.map((d) => d.value));
  if (usual > 0 && c.value > usual * LATE_RULES.largeOrder) out.push({ driver: "size", rows: history.filter((d) => d.value > usual * LATE_RULES.largeOrder), label: (l, n) => `Late on ${l} of the last ${n} large orders` });
  if (new Set(history.map((d) => d.window.from)).size > 1) out.push({ driver: "slot", rows: history.filter((d) => d.window.from === c.window.from), label: (l, n) => `Late on ${l} of the last ${n} deliveries in the ${c.window.from} slot` });
  return out;
}

/** The weighted share of late deliveries, pulled towards the supplier's own rate when the pattern is small. */
function rateOf(rows: DeliveryTiming[], today: string, prior: number, pull = 2): number {
  let w = 0, late = 0;
  for (const d of rows) { const x = weightOf(d.date, today); w += x; if (isLate(d)) late += x; }
  return (late + prior * pull) / (w + pull);
}
function delayOf(rows: DeliveryTiming[], today: string): number {
  let w = 0, sum = 0;
  for (const d of rows) if (isLate(d)) { const x = weightOf(d.date, today); w += x; sum += x * (minutesLate(d) ?? 0); }
  return w ? sum / w : 0;
}
/** The last ten (or fewer) of a pattern, newest first: what the sentence counts. */
function lastTen(rows: DeliveryTiming[]) {
  const ten = [...rows].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
  return { late: ten.filter(isLate).length, of: ten.length, rows: ten };
}

/**
 * The prediction for one coming delivery from the supplier's record of arrived deliveries before `today`.
 * Each pattern that applies (same weekday, after a public holiday, a large order, the same time slot) is compared with
 * the supplier's usual rate, and the one that differs most explains it. Under 8 deliveries: learning, no prediction.
 */
export function predict(record: readonly DeliveryTiming[], c: Coming, today: string): Prediction {
  const history = record.filter((d) => d.supplierId === c.supplierId && d.arrivedAt && d.date < today);
  const n = history.length;
  const confidence = confidenceOf(n);
  const end = minOf(c.window.to);
  if (confidence === "learning") {
    return { supplierId: c.supplierId, n, confidence, chance: null, delayMin: 0, verdict: "learning", driver: "overall", shown: { late: 0, of: n }, sentence: `Learning this supplier: ${n} ${n === 1 ? "delivery" : "deliveries"} so far, ${LATE_RULES.learningBelow} are needed for a prediction.`, likelyArrival: stamp(c.date, end) };
  }
  // The usual rate counts every delivery with no pull of its own.
  const base = rateOf(history, today, 0, 0);
  let best: { s: Subset; rate: number } | null = null;
  for (const s of subsetsFor(history, c)) {
    if (s.rows.length < LATE_RULES.minPattern) continue;
    const rate = rateOf(s.rows, today, base);
    if (!best || Math.abs(rate - base) > Math.abs(best.rate - base)) best = { s, rate };
  }
  // A pattern explains the prediction only when it moves the chance by at least 15 points.
  const use = best && Math.abs(best.rate - base) >= 0.15 ? best : null;
  const rows = use ? use.s.rows : history;
  const chance = use ? use.rate : base;
  const delayMin = delayOf(rows, today) || delayOf(history, today);
  const ten = lastTen(rows);
  const tenDelay = delayOf(ten.rows, today) || delayMin;
  const verdict = chance >= LATE_RULES.likely ? "likely" : chance >= LATE_RULES.maybe ? "maybe" : "on_time";
  const sentence = use
    ? `${use.s.label(ten.late, ten.of)}${ten.late ? `, ${delayText(tenDelay)} on average` : ""}.`
    : ten.late === 0 ? `On time on all of the last ${ten.of} deliveries.` : verdict === "on_time" ? `On time on ${ten.of - ten.late} of the last ${ten.of} deliveries.` : `Late on ${ten.late} of the last ${ten.of} deliveries, ${delayText(tenDelay)} on average.`;
  // A small pattern lowers the confidence one step.
  const conf: Confidence = use && use.s.rows.length < 6 && confidence !== "low" ? (confidence === "high" ? "medium" : "low") : confidence;
  return {
    supplierId: c.supplierId, n, confidence: conf, chance, delayMin, verdict, driver: use?.s.driver ?? "overall", shown: { late: ten.late, of: ten.of }, sentence,
    likelyArrival: stamp(c.date, end + (verdict === "likely" ? Math.round(delayMin / 5) * 5 : 0)),
  };
}

// ---- Does it hurt a service? --------------------------------------------------------------------------------------

/** How much of an item each service on the delivery day is expected to use, in the item's unit. */
export type ServiceUse = Record<ServiceId, number>;

export interface Shortfall {
  service: ServiceId;
  /** Stock left when the service needs it, and what it needs. */
  have: number;
  need: number;
  short: number;
  /** Local time the service needs the item by: when its prep starts. */
  neededBy: string;
}

/**
 * The first service on the delivery day that would be short, if the delivery came at `arrivalMin` minutes after the
 * day's midnight. A service whose prep starts after the delivery has arrived is covered by it.
 */
export function firstShort(date: string, stockAtStart: number, use: ServiceUse, arrivalMin: number): Shortfall | null {
  let have = stockAtStart;
  for (const s of SERVICES) {
    const neededBy = s.prep;
    if (neededBy >= arrivalMin) return null;
    const need = use[s.id];
    if (need > 1e-9 && have < need - 1e-9) return { service: s.id, have: Math.max(0, have), need, short: need - Math.max(0, have), neededBy: stamp(date, neededBy) };
    have -= need;
  }
  return null;
}

/**
 * Whether lateness hurts: the item is short for a service when the delivery comes at its likely time, and would not
 * be if it came on time. A shortage there would be anyway is a stock problem, not a delivery one, and is left to Stock.
 */
export function lateShortfall(date: string, stockAtStart: number, use: ServiceUse, window: { to: string }, likelyArrival: string): Shortfall | null {
  const late = firstShort(date, stockAtStart, use, minutesFrom(date, likelyArrival));
  if (!late) return null;
  const onTime = firstShort(date, stockAtStart, use, minOf(window.to));
  if (onTime && SERVICES.findIndex((s) => s.id === onTime.service) <= SERVICES.findIndex((s) => s.id === late.service)) return null;
  return late;
}

/** Red when a quarter or more of a lunch or dinner is short; amber otherwise. */
export const severityOf = (s: Shortfall): "red" | "amber" => (s.service !== "breakfast" && s.short >= s.need * 0.25 ? "red" : "amber");

// ---- When people are told -----------------------------------------------------------------------------------------

export type WarnPhase = "evening" | "morning" | null;
/**
 * The evening before (from 18:00), and again on the day from 05:00 until the first affected service's prep starts.
 * Outside those times nobody is woken up; the alert still shows in Tyll.
 */
export function warnPhase(now: { date: string; min: number }, deliveryDate: string, neededBy: string): WarnPhase {
  if (now.date === addDays(deliveryDate, -1) && now.min >= 18 * 60) return "evening";
  if (now.date === deliveryDate && now.min >= 5 * 60 && now.min < minutesFrom(deliveryDate, neededBy)) return "morning";
  return null;
}

// ---- Reliability, per supplier ------------------------------------------------------------------------------------

export interface Reliability {
  supplierId: string;
  n: number;
  confidence: Confidence;
  onTime: number;
  late: number;
  incomplete: number;
  /** Share on time, 0 to 1. Null with no deliveries. */
  onTimeRate: number | null;
  /** Average minutes late, over the late ones. */
  avgDelay: number;
  /** Per weekday, Sunday first: deliveries and late ones. */
  byWeekday: { n: number; late: number }[];
  /** On time share per week, oldest first. */
  weekly: { from: string; n: number; rate: number | null }[];
  /** What makes it late, in one sentence, or null when nothing stands out. */
  pattern: string | null;
}

/** On time, delay and patterns for one supplier over the last `weeks` weeks to yesterday. */
export function reliabilityOf(record: readonly DeliveryTiming[], supplierId: string, today: string, weeks: number): Reliability {
  const from = addDays(today, -weeks * 7);
  const rows = record.filter((d) => d.supplierId === supplierId && d.arrivedAt && d.date < today && d.date >= from);
  const late = rows.filter(isLate);
  const byWeekday = WEEKDAYS.map((_, i) => { const r = rows.filter((d) => weekday(d.date) === i); return { n: r.length, late: r.filter(isLate).length }; });
  const weekly = Array.from({ length: weeks }, (_, i) => {
    const a = addDays(from, i * 7), b = addDays(a, 7);
    const r = rows.filter((d) => d.date >= a && d.date < b);
    return { from: a, n: r.length, rate: r.length ? r.filter((d) => !isLate(d)).length / r.length : null };
  });
  // The strongest pattern: a weekday, after holidays, large orders or a slot, against the supplier's own rate.
  let pattern: string | null = null;
  if (rows.length >= LATE_RULES.learningBelow) {
    const base = late.length / rows.length;
    const usual = median(rows.map((d) => d.value));
    const groups: { rows: DeliveryTiming[]; label: (l: number, n: number) => string }[] = [
      ...WEEKDAYS.map((w, i) => ({ rows: rows.filter((d) => weekday(d.date) === i), label: (l: number, n: number) => `Late on ${l} of the last ${n} ${w}s` })),
      { rows: rows.filter((d) => holidayBefore(d.date)), label: (l, n) => `Late on ${l} of the last ${n} deliveries after a public holiday` },
      { rows: rows.filter((d) => usual > 0 && d.value > usual * LATE_RULES.largeOrder), label: (l, n) => `Late on ${l} of the last ${n} large orders` },
      ...[...new Set(rows.map((d) => d.window.from))].map((slot) => ({ rows: rows.filter((d) => d.window.from === slot), label: (l: number, n: number) => `Late on ${l} of the last ${n} deliveries in the ${slot} slot` })),
    ];
    let best: { g: (typeof groups)[number]; lift: number } | null = null;
    for (const g of groups) {
      if (g.rows.length < LATE_RULES.minPattern || g.rows.length === rows.length) continue;
      const lift = g.rows.filter(isLate).length / g.rows.length - base;
      if (lift >= 0.25 && (!best || lift > best.lift)) best = { g, lift };
    }
    if (best) {
      const ten = lastTen(best.g.rows);
      pattern = `${best.g.label(ten.late, ten.of)}${ten.late ? `, ${delayText(delayOf(ten.rows, today))} on average` : ""}.`;
    }
  }
  return {
    supplierId, n: rows.length, confidence: confidenceOf(record.filter((d) => d.supplierId === supplierId && d.arrivedAt && d.date < today).length),
    onTime: rows.length - late.length, late: late.length, incomplete: rows.filter((d) => d.complete === false).length,
    onTimeRate: rows.length ? (rows.length - late.length) / rows.length : null,
    avgDelay: late.length ? late.reduce((t, d) => t + (minutesLate(d) ?? 0), 0) / late.length : 0,
    byWeekday, weekly, pattern,
  };
}

/** Whether a supplier's record says to order a day early for a delivery on this date: likely late, by an hour or more. */
export function leadBuffer(record: readonly DeliveryTiming[], c: Coming, today: string, supplierName: string): { days: 1; why: string } | null {
  const p = predict(record, c, today);
  if (p.verdict !== "likely" || p.delayMin < 60) return null;
  const when = p.driver === "weekday" ? `on ${WEEKDAYS[weekday(c.date)]}s` : p.driver === "holiday" ? "after public holidays" : p.driver === "size" ? "with large orders" : p.driver === "slot" ? `in the ${c.window.from} slot` : "";
  return { days: 1, why: `Ordered a day early: ${supplierName} is often late${when ? ` ${when}` : ""}.` };
}
