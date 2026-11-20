// Mews Connector API. Built from the public documentation at docs.mews.com/connector-api: Get all resources,
// Get all reservations (ver 2023-06-06) and Get all order items, with cursor pagination.
// Tested on sample responses only. Not yet connected to a live account: see transport.ts.
import type { PmsAdapter } from "../../adapters";
import { POLICY } from "../../domain/detect";
import type { OccupancyDay, RoomCharge } from "../../types";
import { round2 } from "../../util";
import type { PosRoomCharge } from "./lightspeed-k";
import { addDaysIso, minutesInto, zonedInstant } from "./time";
import type { Transport } from "./transport";

// ---- The documented objects, as far as Tyll reads them ----

export interface MewsAmount {
  Currency: string;
  NetValue?: number;
  GrossValue: number;
}

export interface MewsResource {
  Id: string;
  IsActive: boolean;
  ParentResourceId?: string | null;
  Name: string;
  State?: string;
  Data?: { Discriminator: "Space" | "Object" | "Person"; Value?: unknown };
}

export type MewsReservationState = "Inquired" | "Confirmed" | "Started" | "Processed" | "Canceled" | "Optional" | "Requested";

export interface MewsReservation {
  Id: string;
  AccountId: string;
  Number?: string;
  State: MewsReservationState;
  RateId?: string;
  AssignedResourceId?: string | null;
  ScheduledStartUtc: string;
  ActualStartUtc?: string | null;
  ScheduledEndUtc: string;
  ActualEndUtc?: string | null;
  PersonCounts?: { AgeCategoryId: string; Count: number }[];
}

export interface MewsOrderItem {
  Id: string;
  AccountId?: string | null;
  ServiceId: string;
  ServiceOrderId: string;
  BillId?: string | null;
  ExternalIdentifier?: string | null;
  BillingName?: string | null;
  Notes?: string | null;
  UnitCount: number;
  Amount: MewsAmount;
  CreatedUtc: string;
  ConsumedUtc: string;
  CanceledUtc?: string | null;
  ClosedUtc?: string | null;
  AccountingState: "Open" | "Closed" | "Inactive" | "Canceled";
  Type: string;
  Data?: { Discriminator: string; Rebate?: { RebatedItemId: string } | null } | null;
}

export interface MewsConfig {
  propertyId: string;
  timeZone: string;
  enterpriseId: string;
  /** The Mews services the POS posts restaurant and room service bills to. */
  posServiceIds: string[];
  /** Business day start, minutes after midnight: a 1:30 AM bar bill belongs to the evening before. */
  dayStartMin: number;
  /** Items per page, 1 to 1000 (Limitation.Count). */
  pageSize: number;
  /** The business date, so nights after it count as booked, not occupied. */
  today: () => string;
  /** Bills charged to a room at the till, from the POS adapter, to match postings against. */
  posRoomCharges: (propertyId: string, businessDate: string) => Promise<PosRoomCharge[]>;
}

/** What the adapter reads, for the Settings page. */
export const MEWS_READS = [
  { method: "POST", path: "/api/connector/v1/resources/getAll", gives: "Rooms and their numbers" },
  { method: "POST", path: "/api/connector/v1/reservations/getAll/2023-06-06", gives: "Who is in which room, check-in and check-out times, guests per room" },
  { method: "POST", path: "/api/connector/v1/orderItems/getAll", gives: "Restaurant and room service bills posted to guest accounts" },
];

/** A posting on a guest account: one Mews service order, possibly several items and rebates. */
export interface MewsPosting {
  serviceOrderId: string;
  ref?: string;
  accountId?: string;
  gross: number;
  createdUtc: string;
  consumedUtc: string;
}

export interface MewsDayReport {
  businessDate: string;
  postings: number;
  /** Postings to F&B services that matched no bill charged to a room at the till. Shown, never a flag on their own. */
  unmatchedPostings: MewsPosting[];
  /** Canceled items left out of the comparison. */
  canceledItems: number;
  charges: RoomCharge[];
}

export interface MewsNight {
  date: string;
  rooms: number;
  roomCount: number;
  guests: number;
  forecast: boolean;
}

const interval = (start: Date, end: Date) => ({ StartUtc: start.toISOString(), EndUtc: end.toISOString() });

export class MewsPms implements PmsAdapter {
  constructor(private readonly transport: Transport, readonly config: MewsConfig) {}

  private async all<T>(path: string, listKey: string, filters: Record<string, unknown>): Promise<T[]> {
    const out: T[] = [];
    let cursor: string | null | undefined;
    for (let page = 0; page < 200; page++) {
      const body = { Client: "Tyll 1.0", EnterpriseIds: [this.config.enterpriseId], ...filters, Limitation: { Count: this.config.pageSize, ...(cursor ? { Cursor: cursor } : {}) } };
      const res = (await this.transport({ system: "mews", method: "POST", path, body })) as Record<string, unknown>;
      const list = res?.[listKey];
      if (!Array.isArray(list)) throw new Error(`Mews answered ${path} without ${listKey}.`);
      out.push(...(list as T[]));
      cursor = res.Cursor as string | null | undefined;
      // Documented end of data: no cursor, or fewer items than asked for.
      if (!cursor || list.length < this.config.pageSize) return out;
    }
    throw new Error(`Mews kept paging on ${path}.`);
  }

  /** Active rooms: space resources that are not a bed inside another room. */
  async rooms(): Promise<MewsResource[]> {
    const list = await this.all<MewsResource>("/api/connector/v1/resources/getAll", "Resources", { Extent: { Resources: true, Inactive: false } });
    return list.filter((r) => r.IsActive && !r.ParentResourceId && (r.Data?.Discriminator ?? "Space") === "Space");
  }

  /** Stays that overlap the interval, in the states that mean a guest is or was in the room. */
  async stays(start: Date, end: Date): Promise<MewsReservation[]> {
    return this.all<MewsReservation>("/api/connector/v1/reservations/getAll/2023-06-06", "Reservations", {
      CollidingUtc: interval(start, end),
      States: ["Confirmed", "Started", "Processed"],
    });
  }

  async items(businessDate: string): Promise<MewsOrderItem[]> {
    const tz = this.config.timeZone;
    return this.all<MewsOrderItem>("/api/connector/v1/orderItems/getAll", "OrderItems", {
      ServiceIds: this.config.posServiceIds,
      ConsumedUtc: interval(zonedInstant(businessDate, this.config.dayStartMin, tz), zonedInstant(businessDate, 1440 + this.config.dayStartMin, tz)),
    });
  }

  /** Guest bill postings for one business date, matched to the bills the till charged to a room. */
  async readDay(propertyId: string, businessDate: string): Promise<MewsDayReport> {
    const tz = this.config.timeZone;
    const empty: MewsDayReport = { businessDate, postings: 0, unmatchedPostings: [], canceledItems: 0, charges: [] };
    if (propertyId !== this.config.propertyId) return empty;
    const [rooms, stays, items, bills] = await Promise.all([
      this.rooms(),
      this.stays(zonedInstant(businessDate, 0, tz), zonedInstant(businessDate, 2 * 1440, tz)),
      this.items(businessDate),
      this.config.posRoomCharges(propertyId, businessDate),
    ]);
    const roomName = new Map(rooms.map((r) => [r.Id, r.Name]));
    const at = (iso: string) => minutesInto(businessDate, iso, tz);
    const begins = (s: MewsReservation) => s.ActualStartUtc ?? s.ScheduledStartUtc;
    const ends = (s: MewsReservation) => s.ActualEndUtc ?? s.ScheduledEndUtc;
    const inStay = (s: MewsReservation, iso: string) => Date.parse(begins(s)) <= Date.parse(iso) && Date.parse(iso) < Date.parse(ends(s));

    // One posting per service order: the items of one bill, less any rebate on them. Canceled items are left out.
    const live = items.filter((i) => i.AccountingState !== "Canceled" && !i.CanceledUtc && this.config.posServiceIds.includes(i.ServiceId));
    const canceledItems = items.length - live.length;
    const byOrder = new Map<string, MewsPosting>();
    for (const i of live) {
      const p = byOrder.get(i.ServiceOrderId) ?? { serviceOrderId: i.ServiceOrderId, accountId: i.AccountId ?? undefined, gross: 0, createdUtc: i.CreatedUtc, consumedUtc: i.ConsumedUtc };
      p.gross = round2(p.gross + i.Amount.GrossValue);
      if (!p.ref && i.ExternalIdentifier) p.ref = i.ExternalIdentifier;
      if (Date.parse(i.CreatedUtc) < Date.parse(p.createdUtc)) p.createdUtc = i.CreatedUtc;
      byOrder.set(i.ServiceOrderId, p);
    }
    const postings = [...byOrder.values()].filter((p) => Math.abs(p.gross) > 0.004);
    const used = new Set<string>();

    const charges: RoomCharge[] = [];
    for (const b of [...bills].sort((x, y) => x.min - y.min)) {
      const closedUtc = zonedInstant(businessDate, b.min, tz).toISOString();
      // The till's receipt id on the posting first; without one, the same amount within an hour of the bill closing.
      let mine = postings.filter((p) => p.ref === b.ref && !used.has(p.serviceOrderId));
      if (!mine.length) {
        const near = postings
          .filter((p) => !p.ref && !used.has(p.serviceOrderId) && Math.abs(p.gross - b.amount) <= POLICY.roomChargeTolerance && Math.abs(at(p.consumedUtc) - b.min) <= 60)
          .sort((x, y) => Math.abs(at(x.consumedUtc) - b.min) - Math.abs(at(y.consumedUtc) - b.min));
        mine = near.slice(0, 1);
      }
      mine.forEach((p) => used.add(p.serviceOrderId));
      const guest = stays.find((s) => s.AssignedResourceId && roomName.get(s.AssignedResourceId) === b.room && inStay(s, closedUtc));
      const charge: RoomCharge = {
        id: `MEWS-${b.orderId}`,
        propertyId,
        outletId: b.outletId,
        date: businessDate,
        min: b.min,
        room: b.room,
        source: b.roomService ? "room_service" : "restaurant",
        description: `${b.roomService ? "Room service" : "Restaurant"} bill ${b.ref}, ${b.table}`,
        orderId: b.orderId,
        expected: b.amount,
        posted: mine.map((p) => p.gross),
      };
      if (mine.length) {
        charge.postedMin = Math.min(...mine.map((p) => at(p.createdUtc)));
        // The room whose guest account holds the posting: the stay of that account at the time of the bill.
        const holder = stays.find((s) => s.AccountId === mine[0].accountId && inStay(s, closedUtc)) ?? stays.find((s) => s.AccountId === mine[0].accountId);
        const folioRoom = holder?.AssignedResourceId ? roomName.get(holder.AssignedResourceId) : undefined;
        if (folioRoom && folioRoom !== b.room) charge.folioRoom = folioRoom;
      }
      if (guest?.State === "Processed" && guest.ActualEndUtc) charge.checkoutMin = at(guest.ActualEndUtc);
      charges.push(charge);
    }
    return { businessDate, postings: postings.length, unmatchedPostings: postings.filter((p) => !used.has(p.serviceOrderId)), canceledItems, charges };
  }

  async fetchRoomCharges(propertyId: string, businessDate: string): Promise<RoomCharge[]> {
    return (await this.readDay(propertyId, businessDate)).charges;
  }

  /** Rooms with a guest each night, guests (all age categories) and the property's active rooms. */
  async nights(propertyId: string, from: string, to: string): Promise<MewsNight[]> {
    if (propertyId !== this.config.propertyId) return [];
    const tz = this.config.timeZone;
    const [rooms, stays] = await Promise.all([this.rooms(), this.stays(zonedInstant(from, 0, tz), zonedInstant(addDaysIso(to, 1), 12 * 60, tz))]);
    const roomIds = new Set(rooms.map((r) => r.Id));
    const out: MewsNight[] = [];
    for (let d = from; d <= to; d = addDaysIso(d, 1)) {
      // A room counts for the night when a stay spans 11:59 PM of that date.
      const night = zonedInstant(d, 1439, tz).getTime();
      const here = stays.filter((s) => s.AssignedResourceId && roomIds.has(s.AssignedResourceId) && Date.parse(s.ActualStartUtc ?? s.ScheduledStartUtc) <= night && night < Date.parse(s.ActualEndUtc ?? s.ScheduledEndUtc));
      const occupied = new Set(here.map((s) => s.AssignedResourceId!));
      out.push({
        date: d,
        rooms: occupied.size,
        roomCount: rooms.length,
        guests: here.reduce((s, r) => s + (r.PersonCounts ?? []).reduce((a, p) => a + p.Count, 0), 0),
        forecast: d > this.config.today(),
      });
    }
    return out;
  }

  async fetchOccupancy(propertyId: string, from: string, to: string): Promise<OccupancyDay[]> {
    return (await this.nights(propertyId, from, to)).map((n) => ({ propertyId, date: n.date, occupancy: n.roomCount ? n.rooms / n.roomCount : 0, forecast: n.forecast }));
  }
}
