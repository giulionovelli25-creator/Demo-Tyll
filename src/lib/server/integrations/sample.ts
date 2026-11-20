// The Lightspeed and Mews adapters, run on sample responses for the Settings page and for tests.
// The responses (fixtures/) are written to each system's documented format with simulated data for one night at the
// Grand Hotel Lumière. Here they are replayed as last night of the demo's business date. No live call is made and
// nothing read here reaches the demo's figures: the demo keeps running on its simulated adapters.
import { can } from "../../domain/access";
import { classifyRoomCharge, detectRoomChargeException, type RoomChargeStatus } from "../../domain/detect";
import type { User } from "../../types";
import { DEMO_TODAY, rel, round2 } from "../../util";
import irdSales from "./fixtures/lightspeed-sales-daily-in-room-dining.json";
import mercadoSales from "./fixtures/lightspeed-sales-daily-mercado.json";
import mewsItems from "./fixtures/mews-order-items.json";
import mewsReservations from "./fixtures/mews-reservations.json";
import mewsResources from "./fixtures/mews-resources.json";
import meta from "./fixtures/sample-meta.json";
import { LIGHTSPEED_READS, LightspeedKSeriesPos, type LightspeedConfig, type LightspeedDayReport, type LskSalesDaily } from "./lightspeed-k";
import { MEWS_READS, MewsPms, type MewsConfig, type MewsOrderItem, type MewsReservation, type MewsResource } from "./mews";
import { daysBetween, minutesInto, moveDates } from "./time";
import { recording, type SourceRequest, type Transport } from "./transport";

/** The business date the sample responses were written for. */
export const SAMPLE_DATE = meta.businessDate;
export const SAMPLE_TZ = meta.timeZone;

const LOCATION_SALES: Record<number, LskSalesDaily> = {
  [meta.lightspeed["lis-terrace"].businessLocationId]: mercadoSales as LskSalesDaily,
  [meta.lightspeed["lis-ird"].businessLocationId]: irdSales as LskSalesDaily,
};

export class SampleError extends Error {}

/** Answers Lightspeed's sales-daily request from the sample, moved to `date`. Any other day has no sales. */
export function lightspeedSampleTransport(date = SAMPLE_DATE): Transport {
  const shift = daysBetween(SAMPLE_DATE, date);
  return async (req: SourceRequest) => {
    const m = /^\/f\/v2\/business-location\/(\d+)\/sales-daily$/.exec(req.path);
    if (req.system !== "lightspeed" || req.method !== "GET" || !m) throw new SampleError(`No sample for ${req.method} ${req.path}.`);
    const res = LOCATION_SALES[Number(m[1])];
    if (!res) throw new SampleError(`Business location ${m[1]} is not in the sample.`);
    if (req.query?.date !== date) return { sales: [], dataComplete: true };
    return moveDates(res, shift, SAMPLE_TZ);
  };
}

interface Interval { StartUtc: string; EndUtc: string }
const overlaps = (start: string, end: string | null | undefined, i: Interval) => Date.parse(start) < Date.parse(i.EndUtc) && Date.parse(end ?? "9999-12-31T00:00:00Z") > Date.parse(i.StartUtc);
const within = (at: string, i: Interval) => Date.parse(at) >= Date.parse(i.StartUtc) && Date.parse(at) < Date.parse(i.EndUtc);

/** Answers Mews's getAll requests from the sample, moved to `date`, with the documented filters and cursor pagination. */
export function mewsSampleTransport(date = SAMPLE_DATE): Transport {
  const shift = daysBetween(SAMPLE_DATE, date);
  const resources = moveDates((mewsResources as { Resources: MewsResource[] }).Resources, shift, SAMPLE_TZ);
  const reservations = moveDates((mewsReservations as unknown as { Reservations: MewsReservation[] }).Reservations, shift, SAMPLE_TZ);
  const items = moveDates((mewsItems as unknown as { OrderItems: MewsOrderItem[] }).OrderItems, shift, SAMPLE_TZ);
  const page = <T extends { Id: string }>(list: T[], key: string, body: Record<string, unknown>) => {
    const lim = body.Limitation as { Count?: number; Cursor?: string } | undefined;
    if (!lim || typeof lim.Count !== "number" || lim.Count < 1 || lim.Count > 1000) throw new SampleError("Limitation.Count must be 1 to 1000.");
    const from = lim.Cursor ? list.findIndex((x) => x.Id === lim.Cursor) + 1 : 0;
    const slice = list.slice(from, from + lim.Count);
    return { [key]: slice, Cursor: slice.length ? slice[slice.length - 1].Id : null };
  };
  return async (req: SourceRequest) => {
    if (req.system !== "mews" || req.method !== "POST") throw new SampleError(`No sample for ${req.method} ${req.path}.`);
    const body = req.body ?? {};
    if (req.path === "/api/connector/v1/resources/getAll") {
      const extent = body.Extent as { Resources?: boolean; Inactive?: boolean } | undefined;
      if (!extent?.Resources) throw new SampleError("Extent.Resources is required.");
      return page(resources.filter((r) => extent.Inactive || r.IsActive), "Resources", body);
    }
    if (req.path === "/api/connector/v1/reservations/getAll/2023-06-06") {
      const col = body.CollidingUtc as Interval | undefined;
      const states = body.States as string[] | undefined;
      return page(reservations.filter((r) => (!col || overlaps(r.ActualStartUtc ?? r.ScheduledStartUtc, r.ActualEndUtc ?? r.ScheduledEndUtc, col)) && (!states || states.includes(r.State))), "Reservations", body);
    }
    if (req.path === "/api/connector/v1/orderItems/getAll") {
      const services = body.ServiceIds as string[] | undefined;
      const consumed = body.ConsumedUtc as Interval | undefined;
      if (!services && !consumed) throw new SampleError("At least one filter is required.");
      return page(items.filter((i) => (!services || services.includes(i.ServiceId)) && (!consumed || within(i.ConsumedUtc, consumed))), "OrderItems", body);
    }
    throw new SampleError(`No sample for ${req.path}.`);
  };
}

export const SAMPLE_LIGHTSPEED_CONFIG: LightspeedConfig = {
  propertyId: "lis",
  timeZone: SAMPLE_TZ,
  locations: meta.lightspeed,
  items: meta.items,
  staff: meta.staff,
  roomPaymentCodes: meta.roomPaymentCodes,
  cashPaymentCodes: meta.cashPaymentCodes,
};

export function sampleMewsConfig(pos: LightspeedKSeriesPos, pageSize = 100): MewsConfig {
  return {
    propertyId: "lis",
    timeZone: SAMPLE_TZ,
    enterpriseId: meta.enterpriseId,
    posServiceIds: meta.posServiceIds,
    dayStartMin: 4 * 60,
    pageSize,
    today: () => DEMO_TODAY,
    posRoomCharges: (propertyId, date) => pos.roomCharges(propertyId, date),
  };
}

/** Both adapters wired to the sample transports, each request kept. */
export function sampleAdapters(date = SAMPLE_DATE, pageSize = 100) {
  const lsk = recording(lightspeedSampleTransport(date));
  const mews = recording(mewsSampleTransport(date));
  const pos = new LightspeedKSeriesPos(lsk, SAMPLE_LIGHTSPEED_CONFIG);
  const pms = new MewsPms(mews, sampleMewsConfig(pos, pageSize));
  return { pos, pms, requests: { lightspeed: lsk.requests, mews: mews.requests } };
}

export interface SampleCharge {
  id: string;
  outletId: string;
  description: string;
  min: number;
  room: string;
  folioRoom?: string;
  expected: number;
  posted: number[];
  status: RoomChargeStatus;
  headline?: string;
  /** Money to check, as the room charge rule counts it. 0 when posted correctly. */
  atRisk: number;
}

export interface AdapterSampleView {
  businessDate: string;
  liveCalls: 0;
  pos: {
    reads: typeof LIGHTSPEED_READS;
    requests: number;
    outlets: Pick<LightspeedDayReport, "outletId" | "orders" | "lines" | "cancelled" | "refunds" | "sourceNet" | "tyllNet">[];
    bills: number;
    cancelled: number;
    refunds: number;
    removedLines: number;
    discountedBills: number;
    compedLines: number;
    lines: number;
    sourceNet: number;
    tyllNet: number;
    unmappedItems: LightspeedDayReport["unmappedItems"];
    unmappedStaff: string[];
  };
  pms: {
    reads: typeof MEWS_READS;
    requests: number;
    rooms: number;
    inHouse: number;
    guests: number;
    occupancy: number;
    postings: number;
    canceledItems: number;
    unmatched: { amount: number; min: number; note: string }[];
  };
  charges: SampleCharge[];
  summary: { checked: number; matched: number; toCheck: number; atRisk: number };
}

/** Runs both adapters over the sample for one date. Pure apart from the sample transports. */
export async function runSample(date: string, pageSize = 100): Promise<AdapterSampleView> {
  const { pos, pms, requests } = sampleAdapters(date, pageSize);
  const days = await Promise.all(Object.keys(pos.config.locations).map((o) => pos.readDay(o, date)));
  const mewsDay = await pms.readDay("lis", date);
  const [night] = await pms.nights("lis", date, date);
  const charges: SampleCharge[] = mewsDay.charges.map((c) => {
    const status = classifyRoomCharge(c);
    const ex = detectRoomChargeException(c);
    return { id: c.id, outletId: c.outletId!, description: c.description, min: c.min, room: c.room, folioRoom: c.folioRoom, expected: c.expected, posted: c.posted, status, headline: ex?.headline, atRisk: ex?.exposure ?? 0 };
  }).sort((a, b) => b.atRisk - a.atRisk || a.min - b.min);
  const reports = days.map((d) => d.report);
  const sum = (f: (r: LightspeedDayReport) => number) => round2(reports.reduce((s, r) => s + f(r), 0));
  return {
    businessDate: date,
    liveCalls: 0,
    pos: {
      reads: LIGHTSPEED_READS,
      requests: requests.lightspeed.length,
      outlets: reports.map(({ outletId, orders, lines, cancelled, refunds, sourceNet, tyllNet }) => ({ outletId, orders, lines, cancelled, refunds, sourceNet, tyllNet })),
      bills: sum((r) => r.orders),
      cancelled: sum((r) => r.cancelled),
      refunds: sum((r) => r.refunds),
      removedLines: sum((r) => r.removedLines),
      discountedBills: sum((r) => r.discountedBills),
      compedLines: sum((r) => r.compedLines),
      lines: sum((r) => r.lines),
      sourceNet: sum((r) => r.sourceNet),
      tyllNet: sum((r) => r.tyllNet),
      unmappedItems: reports.flatMap((r) => r.unmappedItems),
      unmappedStaff: [...new Set(reports.flatMap((r) => r.unmappedStaff))],
    },
    pms: {
      reads: MEWS_READS,
      requests: requests.mews.length,
      rooms: night.roomCount,
      inHouse: night.rooms,
      guests: night.guests,
      occupancy: night.roomCount ? night.rooms / night.roomCount : 0,
      postings: mewsDay.postings,
      canceledItems: mewsDay.canceledItems,
      unmatched: mewsDay.unmatchedPostings.map((p) => ({ amount: p.gross, min: minutesInto(date, p.consumedUtc, SAMPLE_TZ), note: "Posted to an F&B service with no receipt id, and no bill charged to a room matches it" })),
    },
    charges,
    summary: { checked: charges.length, matched: charges.filter((c) => c.status === "matched").length, toCheck: charges.filter((c) => c.status !== "matched").length, atRisk: round2(charges.reduce((s, c) => s + c.atRisk, 0)) },
  };
}

const cache = new Map<string, Promise<AdapterSampleView>>();

/** The sample replayed as last night, for roles that may see adapter checks. Nothing here changes a figure in the demo. */
export async function adapterSampleFor(user: User): Promise<{ ok: true; sample: AdapterSampleView } | { ok: false; status: number; error: string }> {
  if (!can(user, "adapters.view")) return { ok: false, status: 403, error: "Your role cannot do this." };
  const date = rel(-1);
  if (!cache.has(date)) cache.set(date, runSample(date));
  try {
    return { ok: true, sample: await cache.get(date)! };
  } catch (e) {
    cache.delete(date);
    return { ok: false, status: 500, error: e instanceof Error ? e.message : "The sample could not be read." };
  }
}
