// Hotel guests against outlet charges, server side (overnight feature 7): are in-house guests' meals being charged? The
// in-house list (rooms, rates) and the breakfast list stay on the server; this sends the totals per morning, per rate and
// per outlet, and the rooms flagged. The flags are the ones the snapshot sends this user (the public demo keeps every open
// one), so the check, the flags page and the Money Back List count the same rooms.
import { BREAKFAST_STORY_EXCEPTION_ID } from "../data/constants";
import { getDataset } from "../data/generate";
import { allowedOutlets, can } from "../domain/access";
import {
  GUEST_RULES, RATE_PLANS, addVisit, emptyBreakfast, guestsOn, hasBreakfast, matchBreakfast, nightOf, outletDays,
  type BreakfastMatch, type BreakfastTotals, type OutletDay,
} from "../domain/guests";
import type { BreakfastEvidence, BreakfastVisit, InvestigationStatus, User } from "../types";
import { DATA_START, DEMO_TODAY, addDays, eachDay } from "../util";
import { snapshotFor } from "./snapshot";

type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });
const list = (v: string | null | undefined) => (v === null || v === undefined ? null : v.split(",").map((x) => x.trim()).filter(Boolean));

export interface GuestCase {
  caseId: string;
  outletId: string;
  date: string;
  min: number;
  room: string;
  rate: string | null;
  included: number;
  notCharged: number;
  headline: string;
  atStake: number;
  seedStatus: InvestigationStatus;
}

export interface BreakfastMorning {
  date: string;
  /** Guests in house the night before. */
  inHouse: number;
  guests: number;
  included: number;
  charged: number;
  paid: number;
  notCharged: number;
}

export interface RateRow {
  code: string;
  name: string;
  breakfast: boolean;
  /** Room nights and guest nights on this rate, the nights before the mornings in the period. */
  rooms: number;
  guests: number;
  /** Guests of these rooms at breakfast, and how many of them were not charged. */
  atBreakfast: number;
  notCharged: number;
}

export interface OutletRow {
  outletId: string;
  /** Sales in the period and the period before (from the first day with sales on record at the earliest), and the guest nights they are set against. */
  sales: number;
  guestNights: number;
  salesBefore: number;
  guestNightsBefore: number;
  toRooms: number;
  /** Days whose sales were well below what the guests in house usually spend there. */
  below: number;
}

export interface GuestsCheck {
  ok: true;
  days: 7 | 30;
  /** Breakfast mornings in the period, to this morning. */
  from: string;
  to: string;
  /** Outlet days in the period, whole days to last night. */
  outletFrom: string;
  outletTo: string;
  /** The first outlet day of the period before: the same length earlier, never before the first day with sales on record. */
  outletBeforeFrom: string;
  /** The breakfast outlet, when it is in view. */
  breakfastOutlet: string | null;
  lastNight: { date: string; rooms: number; guests: number; occupancy: number; withBreakfast: number; guestsWithBreakfast: number };
  total: BreakfastTotals & { value: number };
  /** The same period before. Null when it had rooms flagged whose cases are not in this user's list (the public demo's shorter list). */
  before: BreakfastTotals | null;
  unlisted: { period: number; before: number; trend: number };
  /** The last 30 mornings, whatever the period. */
  trend: BreakfastMorning[];
  rates: RateRow[];
  cases: GuestCase[];
  story: (BreakfastEvidence & { caseId: string; outletId: string; date: string; value: number }) | null;
  outlets: OutletRow[];
  /** Each outlet's last 30 days, for the chart. */
  outletTrend: OutletDay[];
  /** Days in the period to look at, largest gap first. */
  belowDays: OutletDay[];
  rules: typeof GUEST_RULES;
}

export function guestsCheckFor(user: User, q: { days?: string | null; outlets?: string | null }): GuestsCheck | Fail {
  if (!can(user, "guests.view")) return fail(403, "Your role cannot see hotel guests against outlet charges.");
  const days = q.days === "7" ? 7 : 30;
  // Breakfast is checked once it closes, so this morning counts. Outlet sales are whole days, so they end last night.
  const to = DEMO_TODAY;
  const from = addDays(to, -(days - 1)) < DATA_START ? DATA_START : addDays(to, -(days - 1));
  const outletTo = addDays(DEMO_TODAY, -1);
  const outletFrom = addDays(outletTo, -(days - 1));
  const mine = allowedOutlets(user);
  const outlets = (list(q.outlets) ?? mine).filter((id) => mine.includes(id));
  const d = getDataset();
  const breakfastOutlet = outlets.includes(GUEST_RULES.breakfastOutletId) ? GUEST_RULES.breakfastOutletId : null;

  const cases = snapshotFor(user).exceptions.filter((e) => e.type === "breakfast_not_charged" && !!e.outletId && outlets.includes(e.outletId) && !!e.breakfast);
  const listed = new Set(cases.map((e) => e.id));
  const visits = breakfastOutlet ? d.breakfasts.filter((v) => v.outletId === breakfastOutlet) : [];
  const matches = matchBreakfast(visits, d.stays, d.orders);
  const flagged = (v: BreakfastVisit) => (matches.get(v.id)?.notCharged ?? 0) > 0;
  // A room flagged whose case is not in this user's list (the public demo keeps a shorter one) is left out of the check
  // altogether, so every room the check counts as not charged has its case to review, and the totals still add up.
  const inView = visits.filter((v) => !flagged(v) || listed.has(`EX-${v.id}`));
  const left = visits.filter((v) => flagged(v) && !listed.has(`EX-${v.id}`));
  const beforeFrom = addDays(from, -days);
  const trendFrom = addDays(to, -29);
  const unlisted = {
    period: left.filter((v) => v.date >= from && v.date <= to).length,
    before: left.filter((v) => v.date >= beforeFrom && v.date < from).length,
    trend: left.filter((v) => v.date >= trendFrom && v.date <= to).length,
  };
  const sumOf = (vs: BreakfastVisit[]) => vs.reduce((t, v) => addVisit(t, v, matches.get(v.id)), emptyBreakfast());
  const valueOf = new Map(cases.map((e) => [e.id, e.exposure]));
  const period = inView.filter((v) => v.date >= from && v.date <= to);
  const total = { ...sumOf(period), value: period.reduce((s, v) => s + (flagged(v) ? valueOf.get(`EX-${v.id}`) ?? 0 : 0), 0) };
  const before = unlisted.before > 0 || !breakfastOutlet ? null : sumOf(inView.filter((v) => v.date >= beforeFrom && v.date < from));

  const trend: BreakfastMorning[] = eachDay({ from: trendFrom, to }).map((date) => {
    const t = sumOf(inView.filter((v) => v.date === date));
    return { date, inHouse: guestsOn(d.stays, addDays(date, -1)), guests: t.guests, included: t.included, charged: t.charged, paid: t.paid, notCharged: t.notCharged };
  });

  // Rates: the nights before the mornings in the period, and the guests of those rooms at breakfast.
  const nights = eachDay({ from: addDays(from, -1), to: addDays(to, -1) });
  const nightSet = new Set(nights);
  const stays = d.stays.filter((s) => nightSet.has(s.date));
  const atBreakfast = new Map<string, { guests: number; notCharged: number }>();
  for (const v of period) {
    const m: BreakfastMatch | undefined = matches.get(v.id);
    const rate = m?.rate ?? "none";
    const cur = atBreakfast.get(rate) ?? { guests: 0, notCharged: 0 };
    cur.guests += v.guests;
    cur.notCharged += m?.notCharged ?? 0;
    atBreakfast.set(rate, cur);
  }
  const rates: RateRow[] = RATE_PLANS.map((p) => {
    const on = stays.filter((s) => s.rate === p.code);
    return { code: p.code, name: p.name, breakfast: p.breakfast, rooms: on.length, guests: on.reduce((t, s) => t + s.guests, 0), atBreakfast: atBreakfast.get(p.code)?.guests ?? 0, notCharged: atBreakfast.get(p.code)?.notCharged ?? 0 };
  });

  const night = addDays(DEMO_TODAY, -1);
  const lastList = [...nightOf(d.stays, night).values()];
  const property = d.occupancy.find((o) => o.date === night && o.propertyId === "lis");
  const withBreakfast = lastList.filter((s) => hasBreakfast(s.rate));
  const lastNight = {
    date: night, rooms: lastList.length, guests: lastList.reduce((t, s) => t + s.guests, 0), occupancy: property?.occupancy ?? 0,
    withBreakfast: withBreakfast.length, guestsWithBreakfast: withBreakfast.reduce((t, s) => t + s.guests, 0),
  };

  const rowsOut: GuestCase[] = cases
    .filter((e) => e.date >= from && e.date <= to)
    .map((e) => ({
      caseId: e.id, outletId: e.outletId!, date: e.date, min: e.min, room: e.breakfast!.room, rate: e.breakfast!.rate, included: e.breakfast!.included,
      notCharged: e.breakfast!.notCharged, headline: e.headline, atStake: e.exposure, seedStatus: d.seedInvestigations[e.id]?.status ?? "new",
    }))
    .sort((a, b) => b.atStake - a.atStake || b.date.localeCompare(a.date));
  const storyCase = cases.find((e) => e.id === BREAKFAST_STORY_EXCEPTION_ID);
  const story = storyCase?.breakfast ? { ...storyCase.breakfast, caseId: storyCase.id, outletId: storyCase.outletId!, date: storyCase.date, value: storyCase.exposure } : null;

  // Outlet sales against the guests in house.
  const compared = GUEST_RULES.occupancyOutlets.filter((id) => outlets.includes(id));
  const outletTrend = outletDays(d.orders, d.stays, compared, eachDay({ from: addDays(outletTo, -29), to: outletTo }));
  const span = (a: string, b: string) => outletDays(d.orders, d.stays, compared, eachDay({ from: a, to: b }));
  const now = span(outletFrom, outletTo);
  // The period before starts no earlier than the first day with sales on record: the in-house list holds the night before
  // the data starts, which has guests and no bills, and would pull the earlier sales per guest down.
  const wasFrom = addDays(outletFrom, -days) < DATA_START ? DATA_START : addDays(outletFrom, -days);
  const was = span(wasFrom, addDays(outletFrom, -1));
  const outletRows: OutletRow[] = compared.map((outletId) => {
    const a = now.filter((x) => x.outletId === outletId);
    const b = was.filter((x) => x.outletId === outletId);
    const s = (xs: OutletDay[], f: (x: OutletDay) => number) => xs.reduce((t, x) => t + f(x), 0);
    return { outletId, sales: s(a, (x) => x.sales), guestNights: s(a, (x) => x.guests), salesBefore: s(b, (x) => x.sales), guestNightsBefore: s(b, (x) => x.guests), toRooms: s(a, (x) => x.toRooms), below: a.filter((x) => x.below).length };
  });
  const belowDays = now.filter((x) => x.below).sort((a, b) => (b.expected! - b.sales) - (a.expected! - a.sales));

  return { ok: true, days, from, to, outletFrom, outletTo, outletBeforeFrom: wasFrom, breakfastOutlet, lastNight, total, before, unlisted, trend, rates, cases: rowsOut, story, outlets: outletRows, outletTrend, belowDays, rules: GUEST_RULES };
}
