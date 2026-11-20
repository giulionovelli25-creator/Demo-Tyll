// Clock helpers for adapters. Source systems give instants in UTC; Tyll counts minutes from the start of the business date
// in the hotel's own time zone, so 9:42 PM in Lisbon is minute 1302 whatever the season.

const parts = (at: Date, timeZone: string) => {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const get = (t: string) => Number(p.find((x) => x.type === t)!.value);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), min: get("minute"), s: get("second") };
};

/** The zone's offset from UTC at an instant, in minutes (Lisbon: 0 in winter, 60 in summer). */
export function offsetMinutes(at: Date, timeZone: string): number {
  const p = parts(at, timeZone);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/** The UTC instant of a wall clock time: minutes from the start of `date` in the zone (may run past 1440 into the next day). */
export function zonedInstant(date: string, minutes: number, timeZone: string): Date {
  const guess = new Date(Date.parse(`${date}T00:00:00Z`) + minutes * 60000);
  // Two passes settle the offset, also on the night the clocks change.
  let at = new Date(guess.getTime() - offsetMinutes(guess, timeZone) * 60000);
  at = new Date(guess.getTime() - offsetMinutes(at, timeZone) * 60000);
  return at;
}

/** Minutes from the start of `date` in the zone to an instant. Past midnight runs on (1500 is 1:00 AM the next day). */
export function minutesInto(date: string, iso: string, timeZone: string): number {
  return Math.floor(secondsInto(date, iso, timeZone) / 60);
}

/** Seconds from the start of `date` in the zone to an instant. */
export function secondsInto(date: string, iso: string, timeZone: string): number {
  return Math.floor((new Date(iso).getTime() - zonedInstant(date, 0, timeZone).getTime()) / 1000);
}

/** The calendar date of an instant in the zone. */
export function zonedDate(iso: string, timeZone: string): string {
  const p = parts(new Date(iso), timeZone);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

const DAY = 86400000;
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

/**
 * Moves an instant by whole days while keeping its wall clock time in the zone, so a sample recorded at 9:42 PM on a
 * winter evening still reads 9:42 PM when it is replayed on a summer date.
 */
export function moveInstant(iso: string, days: number, timeZone: string): string {
  const date = zonedDate(iso, timeZone);
  const into = new Date(iso).getTime() - zonedInstant(date, 0, timeZone).getTime();
  return new Date(zonedInstant(addDays(date, days), 0, timeZone).getTime() + into).toISOString();
}

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Every date and instant in a recorded response, moved by whole days (wall clock kept). Other values are left alone. */
export function moveDates<T>(value: T, days: number, timeZone: string): T {
  if (days === 0) return value;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return INSTANT.test(v) ? moveInstant(v, days, timeZone) : DAY_ONLY.test(v) ? addDays(v, days) : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}

export { addDays as addDaysIso };
