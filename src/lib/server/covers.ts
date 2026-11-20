// Booked against billed covers, server side (overnight feature 6): did every seated table get a bill? The reservation
// book stays on the server (guest bookings, rooms); this sends the totals per outlet, service and day, and the flags.
// The flags are the ones the snapshot sends this user (the public demo's shorter list keeps every one of these), so the
// check, the flags page and the Money Back List count the same tables.
import { COVERS_STORY_EXCEPTION_ID } from "../data/constants";
import { outletById } from "../data/catalog";
import { getDataset } from "../data/generate";
import { allowedOutlets, can } from "../domain/access";
import { COVER_RULES, addBooking, emptyTotals, matchBookings, type BookingMatch, type CoverTotals } from "../domain/covers";
import type { Booking, BookingEvidence, InvestigationStatus, Service, User } from "../types";
import { DATA_START, DEMO_TODAY, addDays, eachDay } from "../util";
import { snapshotFor } from "./snapshot";

type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });
const list = (v: string | null | undefined) => (v === null || v === undefined ? null : v.split(",").map((x) => x.trim()).filter(Boolean));

/** Booked, billed and the gap for one outlet and service in the period. */
export interface CoverRow extends CoverTotals {
  outletId: string;
  service: Service;
  /** Estimated value of the tables with no bill. */
  value: number;
}

export interface CoverCase {
  caseId: string;
  outletId: string;
  date: string;
  min: number;
  service: Service;
  table: string;
  party: number;
  headline: string;
  comparedWith: string;
  atStake: number;
  seedStatus: InvestigationStatus;
}

export interface CoverDay {
  date: string;
  booked: number;
  billed: number;
  /** Guests at tables with no bill, all services and each one. */
  noBill: number;
  lunch: { booked: number; billed: number; gap: number; noBill: number; leftEarly: number };
  dinner: { booked: number; billed: number; gap: number; noBill: number; leftEarly: number };
}

export interface CoversCheck {
  ok: true;
  days: 7 | 30;
  from: string;
  to: string;
  /** Outlets in view that take table bookings, and those that do not. */
  bookable: string[];
  walkIn: string[];
  rows: CoverRow[];
  total: CoverTotals & { value: number };
  /** The same period before, for the comparison. */
  before: CoverTotals;
  /** The last 30 closed days, whatever the period, for the trend and the per service chart. */
  trend: CoverDay[];
  /** Every seated table with no bill in the period, largest first. */
  cases: CoverCase[];
  story: (BookingEvidence & { caseId: string; outletId: string; date: string; value: number }) | null;
  rules: typeof COVER_RULES;
}

const slice = () => ({ booked: 0, billed: 0, gap: 0, noBill: 0, leftEarly: 0 });

export function coversCheckFor(user: User, q: { days?: string | null; outlets?: string | null }): CoversCheck | Fail {
  if (!can(user, "covers.view")) return fail(403, "Your role cannot see booked against billed covers.");
  const days = q.days === "7" ? 7 : 30;
  // Closed services only: the check runs once a service has closed, so the period ends last night.
  const to = addDays(DEMO_TODAY, -1);
  const from = addDays(to, -(days - 1)) < DATA_START ? DATA_START : addDays(to, -(days - 1));
  const mine = allowedOutlets(user);
  const outlets = (list(q.outlets) ?? mine).filter((id) => mine.includes(id));
  const bookable = outlets.filter((id) => outletById[id].reservable);
  const walkIn = outlets.filter((id) => !outletById[id].reservable);
  const d = getDataset();
  const cases = snapshotFor(user).exceptions.filter((e) => e.type === "seated_no_bill" && !!e.outletId && bookable.includes(e.outletId) && !!e.booking);
  const listed = new Set(cases.map((e) => e.id));
  const all = d.bookings.filter((b) => bookable.includes(b.outletId));
  const matches = matchBookings(all, d.orders.filter((o) => bookable.includes(o.outletId)));
  // A table with no bill whose case is not in this user's list (the public demo keeps a shorter one) is left out of the
  // check altogether, so every table the check counts as having no bill has its case to review, and the totals still add up.
  const inView = all.filter((b) => matches.get(b.id)?.kind !== "no_bill" || listed.has(`EX-${b.id}`));
  const sumOf = (bs: Booking[]) => bs.reduce((t, b) => addBooking(t, b, matches.get(b.id)), emptyTotals());

  const valueOf = new Map(cases.map((e) => [e.id, e.exposure]));
  const period = inView.filter((b) => b.date >= from && b.date <= to);
  const rows: CoverRow[] = bookable.flatMap((outletId) =>
    (["lunch", "dinner"] as Service[]).map((service) => {
      const bs = period.filter((b) => b.outletId === outletId && b.service === service);
      const value = bs.filter((b) => matches.get(b.id)?.kind === "no_bill").reduce((s, b) => s + (valueOf.get(`EX-${b.id}`) ?? 0), 0);
      return { outletId, service, ...sumOf(bs), value };
    }),
  );
  const total = { ...sumOf(period), value: rows.reduce((s, r) => s + r.value, 0) };
  const before = sumOf(inView.filter((b) => b.date >= addDays(from, -days) && b.date < from));

  const trend: CoverDay[] = eachDay({ from: addDays(to, -29), to }).map((date) => {
    const day: CoverDay = { date, booked: 0, billed: 0, noBill: 0, lunch: slice(), dinner: slice() };
    for (const b of inView) {
      if (b.date !== date || (b.service !== "lunch" && b.service !== "dinner")) continue;
      const m: BookingMatch | undefined = matches.get(b.id);
      const t = addBooking(emptyTotals(), b, m);
      const s = day[b.service];
      s.booked += t.booked; s.billed += t.billed; s.gap += t.gap; s.noBill += t.noBill; s.leftEarly += t.leftEarly;
      day.booked += t.booked; day.billed += t.billed; day.noBill += t.noBill;
    }
    return day;
  });

  const rowsOut: CoverCase[] = cases
    .filter((e) => e.date >= from && e.date <= to)
    .map((e) => ({
      caseId: e.id, outletId: e.outletId!, date: e.date, min: e.min, service: e.booking!.service, table: e.booking!.table, party: e.booking!.party,
      headline: e.headline, comparedWith: e.comparedWith ?? "", atStake: e.exposure, seedStatus: d.seedInvestigations[e.id]?.status ?? "new",
    }))
    .sort((a, b) => b.atStake - a.atStake || b.date.localeCompare(a.date));

  const storyCase = cases.find((e) => e.id === COVERS_STORY_EXCEPTION_ID);
  const story = storyCase?.booking ? { ...storyCase.booking, caseId: storyCase.id, outletId: storyCase.outletId!, date: storyCase.date, value: storyCase.exposure } : null;

  return { ok: true, days, from, to, bookable, walkIn, rows, total, before, trend, cases: rowsOut, story, rules: COVER_RULES };
}
