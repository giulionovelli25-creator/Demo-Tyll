import type { Currency, DateRange } from "./types";

// ---- Demo clock -------------------------------------------------------------
// The demo's business date is today in Lisbon, so it never looks out of date. Every simulated record is placed
// relative to it, and random draws are seeded by "days before today" (see rng), so the same story shows every day.
// TYLL_DEMO_DATE pins the date for tests and screenshots.
/** The demo hotel's time zone. Each property carries its own (Property.timeZone); the demo has one hotel, in Lisbon. */
export const DEMO_TIME_ZONE = "Europe/Lisbon";
/** The calendar day at a place, as YYYY-MM-DD: the hotel's day, not the viewer's or the server's. */
export function dayIn(timeZone: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}
/** Hours and minutes at a place, as HH:MM. */
export function timeIn(timeZone: string, at: Date = new Date()): string {
  return at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone });
}
/** The cookie that hands the server's business date to the browser, so both always show the same day. */
export const DAY_COOKIE = "tyll_day";
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The business date, from one source per process. A pinned date (tests, screenshots) wins. In the browser it is the
 * server's day, from DAY_COOKIE, so labels worked out on screen agree with figures worked out on the server, also
 * after midnight. On the server it is the hotel's day when the process started, shared by every module.
 */
export function resolveBusinessDay(o: { pinned?: string; cookie?: string; shared: { day?: string }; now: Date }): string {
  if (o.pinned && ISO_DAY.test(o.pinned)) return o.pinned;
  const fromServer = o.cookie ? new RegExp(`(?:^|; )${DAY_COOKIE}=(\\d{4}-\\d{2}-\\d{2})`).exec(o.cookie)?.[1] : undefined;
  if (fromServer) return fromServer;
  return (o.shared.day ??= dayIn(DEMO_TIME_ZONE, o.now));
}
export const DEMO_TODAY = resolveBusinessDay({
  pinned: typeof process !== "undefined" ? process.env?.TYLL_DEMO_DATE || process.env?.NEXT_PUBLIC_TYLL_DEMO_DATE : undefined,
  cookie: typeof document !== "undefined" ? document.cookie : undefined,
  shared: ((globalThis as { __tyllClock?: { day?: string } }).__tyllClock ??= {}),
  now: new Date(),
});
export const DEMO_NOW_MIN = 20 * 60 + 55;
const shift = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
/** A date relative to the business date: rel(-1) is yesterday. */
export const rel = (days: number) => shift(DEMO_TODAY, days);
export const DATA_START = rel(-59);
/** The first day of the business date's month. */
export const MONTH_START = `${DEMO_TODAY.slice(0, 8)}01`;
const offsetOf = (iso: string) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${DEMO_TODAY}T00:00:00Z`)) / 86400000);

// ---- Deterministic random numbers --------------------------------------------
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function rng(seed: string) {
  // Dates in a seed count as days before today, so a record keeps its draw as the business date moves.
  let a = hashString(seed.replace(/\d{4}-\d{2}-\d{2}/g, (d) => `d${offsetOf(d)}`)) || 1;
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    between: (lo: number, hi: number) => lo + (hi - lo) * next(),
    int: (lo: number, hi: number) => Math.floor(lo + (hi - lo + 1) * next()),
    chance: (p: number) => next() < p,
    pick: <T,>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)],
    weighted: <T,>(arr: readonly T[], weight: (t: T) => number): T => {
      const total = arr.reduce((s, x) => s + weight(x), 0);
      let r = next() * total;
      for (const x of arr) {
        r -= weight(x);
        if (r <= 0) return x;
      }
      return arr[arr.length - 1];
    },
  };
}

// ---- Dates ------------------------------------------------------------------
const DAY_MS = 86400000;
export const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
export const toIso = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => toIso(new Date(toDate(iso).getTime() + n * DAY_MS));
export const diffDays = (a: string, b: string) => Math.round((toDate(a).getTime() - toDate(b).getTime()) / DAY_MS);
export const weekday = (iso: string) => toDate(iso).getUTCDay();

export function eachDay(range: DateRange): string[] {
  const out: string[] = [];
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function previousRange(range: DateRange): DateRange {
  const len = diffDays(range.to, range.from) + 1;
  return { from: addDays(range.from, -len), to: addDays(range.to, -len) };
}

export type RangePreset = "today" | "yesterday" | "week" | "month" | "custom";

export function presetRange(preset: Exclude<RangePreset, "custom">): DateRange {
  if (preset === "today") return { from: DEMO_TODAY, to: DEMO_TODAY };
  if (preset === "yesterday") return { from: addDays(DEMO_TODAY, -1), to: addDays(DEMO_TODAY, -1) };
  if (preset === "week") return { from: addDays(DEMO_TODAY, -6), to: DEMO_TODAY };
  return { from: addDays(DEMO_TODAY, -29), to: DEMO_TODAY };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function fmtDate(iso: string, withDay = false): string {
  const d = toDate(iso);
  const base = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return withDay ? `${DAYS[d.getUTCDay()]} ${base}` : base;
}

export function fmtRange(range: DateRange): string {
  return range.from === range.to ? fmtDate(range.from, true) : `${fmtDate(range.from)} to ${fmtDate(range.to)}`;
}

export function fmtTime(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  const suffix = h >= 12 ? "PM" : "AM";
  return `${h % 12 === 0 ? 12 : h % 12}:${mm} ${suffix}`;
}

export const isWeekend = (iso: string, city: string) => {
  const wd = weekday(iso);
  void city;
  return wd === 6 || wd === 0;
};

// ---- Money ------------------------------------------------------------------
// Each hotel reports in its own currency: EUR, AED or SAR. Amounts in different currencies are never added together,
// so fxRate only ever converts a currency to itself.
export const fxRate = (from: Currency, to: Currency) => (from === to ? 1 : 1);
const SIGN: Record<Currency, string> = { EUR: "€", AED: "AED\u00a0", SAR: "SAR\u00a0" };

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function fmtMoney(n: number, currency: Currency, opts: { compact?: boolean; decimals?: boolean } = {}): string {
  // One format everywhere: whole euros in full, such as €12,400. "compact" is kept for callers but no longer shortens,
  // so a screen never mixes €12.4k with €12,400. Chart axes use fmtShort, which has no currency sign.
  void opts.compact;
  const abs = Math.abs(n);
  const body = abs.toLocaleString("en-US", {
      minimumFractionDigits: opts.decimals ? 2 : 0,
      maximumFractionDigits: opts.decimals ? 2 : 0,
    });
  return `${n < 0 ? "−" : ""}${SIGN[currency] ?? currency}${body}`;
}

/** Short axis label without a currency code, such as 150k or 1.2M. */
export const fmtShort = (n: number) => (Math.abs(n) >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : Math.abs(n) >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)));

export const fmtNum = (n: number, digits = 0) =>
  n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const fmtPct = (ratio: number, digits = 1) => `${(ratio * 100).toFixed(digits)}%`;

export const pctChange = (now: number, before: number): number | null =>
  before === 0 ? null : (now - before) / Math.abs(before);

export function fmtQty(qty: number, unit: string): string {
  if (unit === "each") return fmtNum(qty, qty % 1 === 0 || Math.abs(qty) >= 10 ? 0 : 1);
  if (qty !== 0 && Math.abs(qty) < 1) return `${fmtNum(qty * 1000)} ${unit === "kg" ? "g" : "ml"}`;
  return `${fmtNum(qty, 1)} ${unitLabel(unit)}`;
}

/** Units as people write them: a capital L for litres, so it never reads as a 1. */
export const unitLabel = (unit: string) => (unit === "l" ? "L" : unit);

export const sum = <T,>(arr: readonly T[], f: (t: T) => number) => arr.reduce((s, x) => s + f(x), 0);

export function groupBy<T>(arr: readonly T[], key: (t: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const x of arr) (out[key(x)] ??= []).push(x);
  return out;
}

export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v);
    // Neutralise spreadsheet formula injection as well as quoting.
    const safe = /^[=+\-@]/.test(s) && typeof v === "string" ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const blob = new Blob([rows.map((r) => r.map(esc).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
