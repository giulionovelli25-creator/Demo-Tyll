import type { Currency, DateRange } from "./types";

// ---- Demo clock -------------------------------------------------------------
// The demo runs on a fixed business date so every figure is reproducible.
export const DEMO_TODAY = "2026-10-13";
export const DEMO_NOW_MIN = 20 * 60 + 55;
export const DATA_START = "2026-08-15";

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
  let a = hashString(seed) || 1;
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

export type RangePreset = "today" | "week" | "month" | "custom";

export function presetRange(preset: Exclude<RangePreset, "custom">): DateRange {
  if (preset === "today") return { from: DEMO_TODAY, to: DEMO_TODAY };
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
  return range.from === range.to ? fmtDate(range.from, true) : `${fmtDate(range.from)} – ${fmtDate(range.to)}`;
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
  // Qatar's weekend is Friday–Saturday; the UAE moved to Saturday–Sunday in 2022.
  return city === "Doha" ? wd === 5 || wd === 6 : wd === 6 || wd === 0;
};

// ---- Money ------------------------------------------------------------------
// Both currencies are pegged to the US dollar (AED 3.6725, QAR 3.64).
const USD_PER: Record<Currency, number> = { AED: 1 / 3.6725, QAR: 1 / 3.64 };
export const fxRate = (from: Currency, to: Currency) => (from === to ? 1 : USD_PER[from] / USD_PER[to]);

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function fmtMoney(n: number, currency: Currency, opts: { compact?: boolean; decimals?: boolean } = {}): string {
  const abs = Math.abs(n);
  let body: string;
  if (opts.compact && abs >= 1_000_000) body = `${(abs / 1_000_000).toFixed(2)}M`;
  else if (opts.compact && abs >= 10_000) body = `${(abs / 1000).toFixed(1)}k`;
  else
    body = abs.toLocaleString("en-US", {
      minimumFractionDigits: opts.decimals ? 2 : 0,
      maximumFractionDigits: opts.decimals ? 2 : 0,
    });
  return `${n < 0 ? "−" : ""}${currency} ${body}`;
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
  return `${fmtNum(qty, 1)} ${unit}`;
}

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
