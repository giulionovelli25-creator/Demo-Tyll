// Booked covers against billed covers (overnight feature 6): did every seated table get a bill? Each booking the host
// marked seated in the reservation book is matched with the bills at that table. Pure functions over recorded facts, so
// the check, the flags and the tests read one rule. A table with no bill is a prompt to check, never proof of anything.
import { outletById, propertyById } from "../data/catalog";
import type { Booking, BookingEvidence, Exception, NearbyBill, Order, Service } from "../types";
import { addDays, fmtMoney, fmtTime } from "../util";
import { orderTotals } from "./orders";

export const SERVICES: Service[] = ["breakfast", "lunch", "dinner"];
export const SERVICE_LABEL: Record<Service, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };
/** The meal a time belongs to: breakfast before 11 AM, lunch before 5 PM, dinner after. */
export const serviceOf = (min: number): Service => (min < 11 * 60 ? "breakfast" : min < 17 * 60 ? "lunch" : "dinner");

/** The rule, agreed with the hotel. Minutes unless said otherwise. */
export const COVER_RULES = {
  /** A bill opened up to this long before the host marked the table seated still belongs to the booking. */
  beforeSeat: 15,
  /** With no finish time recorded, a bill is looked for until this long after seating. */
  noFinish: 180,
  /** A party that left within this long of being seated, with no bill, left before ordering. Not flagged. */
  leftEarly: 20,
  /** Seated somewhere else: a bill for the same party (give or take one guest) opened elsewhere within this long. */
  moved: 20,
  /** Joined another booking: seated at the same table within this long of it, on a bill with room for both parties. */
  joined: 15,
  /** Guests a party may grow or shrink by and still be the same party. */
  partySlack: 1,
  /** Days of bills behind the spend per guest a table is valued at. */
  spendDays: 28,
} as const;

/** What became of one booking. Only `no_bill` is flagged. */
export type BookingMatch =
  | { kind: "billed"; orderId: string; billCovers: number }
  | { kind: "moved"; orderId: string; billCovers: number; table: string }
  | { kind: "joined"; orderId: string; withBookingId: string }
  | { kind: "left_early"; minutes: number }
  | { kind: "no_bill" }
  | { kind: "no_show" }
  | { kind: "cancelled" };

/** The end of the window a booking's bill is looked for in. */
const windowEnd = (b: Booking) => b.leftMin ?? b.seatedMin! + COVER_RULES.noFinish;
const key = (outletId: string, date: string) => `${outletId}|${date}`;

/**
 * Matches every booking with a bill, in a fixed order: the bill at its table (the one opened nearest the seating time),
 * then a party that joined another booking at the same table, then a party that left before ordering, then a bill for the
 * same party at another table. Whatever is left is a seated table with no bill. Each bill serves one booking, except
 * where two bookings joined on one bill. Voided bills count as a bill: the void rule looks at those.
 */
export function matchBookings(bookings: readonly Booking[], bills: readonly Order[]): Map<string, BookingMatch> {
  const out = new Map<string, BookingMatch>();
  const billsAt = new Map<string, Order[]>();
  for (const o of bills) billsAt.set(key(o.outletId, o.date), [...(billsAt.get(key(o.outletId, o.date)) ?? []), o]);
  const groups = new Map<string, Booking[]>();
  for (const b of bookings) {
    if (b.status !== "seated" || b.seatedMin === undefined) {
      out.set(b.id, { kind: b.status === "cancelled" ? "cancelled" : "no_show" });
      continue;
    }
    groups.set(key(b.outletId, b.date), [...(groups.get(key(b.outletId, b.date)) ?? []), b]);
  }
  for (const [k, list] of groups) {
    const day = billsAt.get(k) ?? [];
    const taken = new Set<string>();
    const seated = [...list].sort((a, b) => a.seatedMin! - b.seatedMin! || a.id.localeCompare(b.id));
    const nearest = (b: Booking, candidates: Order[]) => [...candidates].sort((x, y) => Math.abs(x.openMin - b.seatedMin!) - Math.abs(y.openMin - b.seatedMin!) || x.id.localeCompare(y.id))[0];
    // 1. The bill at the table. Every pairing in the window is ranked by how close the bill opened to the seating, closest
    // first, so a bill goes to the party that sat down just before it, not to whichever booking came first that day.
    const pairs: { b: Booking; o: Order; gap: number }[] = [];
    for (const b of seated) {
      for (const o of day) if (o.table === b.table && o.openMin >= b.seatedMin! - COVER_RULES.beforeSeat && o.openMin <= windowEnd(b)) pairs.push({ b, o, gap: Math.abs(o.openMin - b.seatedMin!) });
    }
    pairs.sort((x, y) => x.gap - y.gap || x.b.id.localeCompare(y.b.id) || x.o.id.localeCompare(y.o.id));
    for (const { b, o } of pairs) {
      if (out.has(b.id) || taken.has(o.id)) continue;
      taken.add(o.id);
      out.set(b.id, { kind: "billed", orderId: o.id, billCovers: o.covers });
    }
    // 2. Joined another booking at the same table, on a bill with room for both parties.
    for (const b of seated) {
      if (out.has(b.id)) continue;
      for (const a of seated) {
        const m = out.get(a.id);
        if (a === b || m?.kind !== "billed" || a.table !== b.table || Math.abs(a.seatedMin! - b.seatedMin!) > COVER_RULES.joined) continue;
        if (m.billCovers < a.party + b.party - COVER_RULES.partySlack) continue;
        out.set(b.id, { kind: "joined", orderId: m.orderId, withBookingId: a.id });
        break;
      }
    }
    // 3. Left before ordering: the host marked the table finished within minutes, so no bill elsewhere is theirs.
    for (const b of seated) {
      if (out.has(b.id) || b.leftMin === undefined) continue;
      const minutes = b.leftMin - b.seatedMin!;
      if (minutes < COVER_RULES.leftEarly) out.set(b.id, { kind: "left_early", minutes });
    }
    // 4. Seated somewhere else: a bill for the same party, opened near the seating time, that no booking has.
    for (const b of seated) {
      if (out.has(b.id)) continue;
      const o = nearest(b, day.filter((x) => !taken.has(x.id) && x.openMin >= b.seatedMin! - COVER_RULES.beforeSeat && x.openMin <= b.seatedMin! + COVER_RULES.moved && Math.abs(x.covers - b.party) <= COVER_RULES.partySlack));
      if (!o) continue;
      taken.add(o.id);
      out.set(b.id, { kind: "moved", orderId: o.id, billCovers: o.covers, table: o.table });
    }
    // 5. What is left is a seated table with no bill.
    for (const b of seated) if (!out.has(b.id)) out.set(b.id, { kind: "no_bill" });
  }
  return out;
}

/** Guests on the bills matched to a booking count as billed: at its table, at another table, or on the bill it joined. */
export const isBilled = (m: BookingMatch | undefined) => m?.kind === "billed" || m?.kind === "moved" || m?.kind === "joined";

/** Booked, billed and the gap for a set of bookings. Booked = billed + left before ordering + no bill, always. */
export interface CoverTotals {
  /** Seated bookings (tables) and their guests. */
  tables: number;
  booked: number;
  billed: number;
  /** Booked minus billed: guests who left before ordering plus guests at tables with no bill. */
  gap: number;
  leftEarly: number;
  leftEarlyTables: number;
  noBill: number;
  noBillTables: number;
  /** Not counted as booked: they never sat down. */
  noShows: number;
  noShowGuests: number;
  cancelled: number;
  /** Matched elsewhere, not flagged. */
  moved: number;
  joined: number;
  /** Guests on the bills matched to bookings, as rung at the till, and how many bills counted a different party. */
  billCovers: number;
  sizeChanged: number;
}

export const emptyTotals = (): CoverTotals => ({ tables: 0, booked: 0, billed: 0, gap: 0, leftEarly: 0, leftEarlyTables: 0, noBill: 0, noBillTables: 0, noShows: 0, noShowGuests: 0, cancelled: 0, moved: 0, joined: 0, billCovers: 0, sizeChanged: 0 });

export function addBooking(t: CoverTotals, b: Booking, m: BookingMatch | undefined): CoverTotals {
  if (!m || m.kind === "cancelled") { t.cancelled += 1; return t; }
  if (m.kind === "no_show") { t.noShows += 1; t.noShowGuests += b.party; return t; }
  t.tables += 1;
  t.booked += b.party;
  if (isBilled(m)) t.billed += b.party;
  if (m.kind === "billed" || m.kind === "moved") {
    t.billCovers += m.billCovers;
    if (m.billCovers !== b.party) t.sizeChanged += 1;
  }
  if (m.kind === "moved") t.moved += 1;
  if (m.kind === "joined") t.joined += 1;
  if (m.kind === "left_early") { t.leftEarly += b.party; t.leftEarlyTables += 1; }
  if (m.kind === "no_bill") { t.noBill += b.party; t.noBillTables += 1; }
  t.gap = t.booked - t.billed;
  return t;
}

export const totalsOf = (bookings: readonly Booking[], matches: Map<string, BookingMatch>) => bookings.reduce((t, b) => addBooking(t, b, matches.get(b.id)), emptyTotals());

/**
 * The outlet's average spend per guest at a service, over the `spendDays` closed days before `date`: net sales over the
 * guests on those bills. Voided bills are left out. What a table with no bill is valued at, an estimate.
 */
export function spendPerGuest(bills: readonly Order[], outletId: string, service: Service, date: string): number {
  const from = addDays(date, -COVER_RULES.spendDays);
  let net = 0, guests = 0;
  for (const o of bills) {
    if (o.outletId !== outletId || o.voided || o.date < from || o.date >= date || serviceOf(o.openMin) !== service) continue;
    net += orderTotals(o).net;
    guests += o.covers;
  }
  return guests > 0 ? Math.round((net / guests) * 100) / 100 : 0;
}

const bill = (o: Order, owner?: string): NearbyBill => ({ orderId: o.id, table: o.table, openMin: o.openMin, closeMin: o.closeMin, covers: o.covers, ...(owner ? { matchedTo: owner } : {}) });
const guests = (n: number) => `${n} ${n === 1 ? "guest" : "guests"}`;
/** "3 to 5 guests": the party sizes the seated elsewhere rule would have accepted. */
export const partyRange = (party: number) => {
  const lo = Math.max(1, party - COVER_RULES.partySlack);
  const hi = party + COVER_RULES.partySlack;
  return `${lo} to ${hi} guests`;
};
/** A bill's party size is within the slack of the booking's party: the seated elsewhere rule would accept it. */
export const sameParty = (covers: number, party: number) => Math.abs(covers - party) <= COVER_RULES.partySlack;

/** Party sizes in words: "2 guests", "1 to 3 guests" for a run, "1, 2 or 6 guests" otherwise. */
export function sizeWords(sizes: readonly number[]): string {
  const s = [...new Set(sizes)].sort((x, y) => x - y);
  if (s.length === 0) return "";
  if (s.length === 1) return guests(s[0]);
  if (s.length > 2 && s[s.length - 1] - s[0] === s.length - 1) return `${s[0]} to ${s[s.length - 1]} guests`;
  return `${s.slice(0, -1).join(", ")} or ${s[s.length - 1]} guests`;
}

/**
 * What the bills opened elsewhere near the seating say, in one or two sentences. A bill for the same party that another
 * booking already has is named as such, so the case never says no such bill exists when one does.
 */
export function nearbyFact(b: Pick<BookingEvidence, "nearby" | "party">, where?: string): string {
  const at = where ? ` at ${where}` : "";
  const n = b.nearby.length;
  if (n === 0) return `No bill was opened elsewhere${at} within ${COVER_RULES.moved} minutes of seating.`;
  const opened = `${n} ${n === 1 ? "bill was" : "bills were"} opened elsewhere${at} within ${COVER_RULES.moved} minutes of seating`;
  const taken = b.nearby.filter((o) => o.matchedTo && sameParty(o.covers, b.party));
  if (taken.length === 0) return `${opened}, for ${sizeWords(b.nearby.map((o) => o.covers))}: none for ${partyRange(b.party)}.`;
  const lead = n === taken.length ? (n === 1 ? "It was" : "All of them were") : `${taken.length} of them, for ${sizeWords(taken.map((o) => o.covers))}, ${taken.length === 1 ? "was" : "were"}`;
  return `${opened}. ${lead} already matched to another booking: no unmatched bill for ${partyRange(b.party)}.`;
}

export const seatedHeadline = (b: Pick<Booking, "party" | "table">) => `Booking for ${b.party} seated at ${b.table}, no bill found`;

/** The booking each bill was matched to: at its table or as a party seated elsewhere (a joined party shares its host's bill). */
export function billOwners(matches: ReadonlyMap<string, BookingMatch>): Map<string, string> {
  const owner = new Map<string, string>();
  for (const [bookingId, m] of matches) if ((m.kind === "billed" || m.kind === "moved") && !owner.has(m.orderId)) owner.set(m.orderId, bookingId);
  return owner;
}

/**
 * The evidence for one seated booking with no bill: the window searched, the table's other bills and the bills nearby,
 * each with the booking it was already matched to, if any.
 */
export function bookingEvidence(b: Booking, bills: readonly Order[], spend: number, owners: ReadonlyMap<string, string> = new Map()): BookingEvidence {
  const day = bills.filter((o) => o.outletId === b.outletId && o.date === b.date);
  const from = b.seatedMin! - COVER_RULES.beforeSeat;
  const to = windowEnd(b);
  const one = (o: Order) => bill(o, owners.get(o.id));
  return {
    bookingId: b.id, service: b.service, table: b.table, party: b.party, bookedFor: b.bookedFor, seatedMin: b.seatedMin!, leftMin: b.leftMin, via: b.via, room: b.room, from, to,
    atTable: day.filter((o) => o.table === b.table).sort((x, y) => x.openMin - y.openMin).map(one),
    nearby: day.filter((o) => o.table !== b.table && o.openMin >= from && o.openMin <= b.seatedMin! + COVER_RULES.moved).sort((x, y) => x.openMin - y.openMin).map(one),
    spendPerGuest: spend,
  };
}

/** One flag per seated booking with no bill, valued at the party times the outlet's spend per guest at that service. */
export function seatedNoBillException(b: Booking, ev: BookingEvidence): Exception {
  const outlet = outletById[b.outletId];
  const currency = propertyById[outlet.propertyId].currency;
  const money = (n: number) => fmtMoney(n, currency);
  const value = Math.round(b.party * ev.spendPerGuest);
  const finished = b.leftMin === undefined ? "no finish time was recorded" : `the table was marked finished at ${fmtTime(b.leftMin)}`;
  return {
    id: `EX-${b.id}`, type: "seated_no_bill", propertyId: outlet.propertyId, outletId: b.outletId, date: b.date, min: b.seatedMin!,
    exposure: value, basis: "estimate", booking: ev,
    headline: seatedHeadline(b),
    comparedWith: `Compared with the reservation book: a booking for ${b.party} was seated at ${b.table} at ${fmtTime(b.seatedMin!)} and ${finished}. The till has no bill at ${b.table} opened between ${fmtTime(ev.from)} and ${fmtTime(ev.to)}, and no bill for ${partyRange(b.party)}, not already matched to another booking, opened elsewhere at ${outlet.name} within ${COVER_RULES.moved} minutes of seating. Valued at the ${SERVICE_LABEL[b.service].toLowerCase()} spend per guest at ${outlet.name}, ${money(ev.spendPerGuest)}, an estimate.`,
  };
}

/** Every seated booking with no bill on a closed day, as a flag. */
export function detectSeatedNoBill(bookings: readonly Booking[], bills: readonly Order[], matches = matchBookings(bookings, bills)): Exception[] {
  const spend = new Map<string, number>();
  const owners = billOwners(matches);
  const out: Exception[] = [];
  for (const b of bookings) {
    if (matches.get(b.id)?.kind !== "no_bill") continue;
    const k = `${b.outletId}|${b.service}|${b.date}`;
    if (!spend.has(k)) spend.set(k, spendPerGuest(bills, b.outletId, b.service, b.date));
    out.push(seatedNoBillException(b, bookingEvidence(b, bills, spend.get(k)!, owners)));
  }
  return out;
}

/** "1 h 52 min" */
export const fmtStay = (minutes: number) => (minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`);
export const VIA_LABEL: Record<Booking["via"], string> = { phone: "by phone", online: "online", concierge: "through the concierge" };
export { guests as guestWords, bill as nearbyBill };
