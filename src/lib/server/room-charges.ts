// Room charge check, server side. Bills charged to a room at an outlet till, and minibar, spa and laundry charges, are set
// against the guest folio in the PMS (simulated). Room numbers and check-out times are guest data, so only roles with
// "roomcharge.view" receive them, and only for the outlets and hotels they hold. Each difference is also a flag, raised by
// the same rule (detectRoomChargeException), so the check and the flags list always agree.
import { ROOM_STORY_CHARGE_ID, ROOM_STORY_EXCEPTION_ID } from "../data/constants";
import { outletById } from "../data/catalog";
import { getDataset } from "../data/generate";
import { allowedOutlets, can, hasWholeProperty } from "../domain/access";
import { classifyRoomCharge, detectRoomChargeException, type RoomChargeStatus } from "../domain/detect";
import { roomChargesByDay, roomChargesBySource, summariseRoomCharges, type RoomCheckSummary, type SourceRow } from "../domain/room-charges";
import { SOURCE_LABEL } from "../labels";
import type { ChargeSource, InvestigationStatus, RoomCharge, User } from "../types";
import { DATA_START, DEMO_TODAY, addDays, eachDay, round2 } from "../util";

type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export interface RoomCheckRow {
  chargeId: string;
  caseId: string;
  status: Exclude<RoomChargeStatus, "matched">;
  propertyId: string;
  outletId?: string;
  /** The outlet, or the hotel service for minibar, spa and laundry. */
  where: string;
  source: ChargeSource;
  date: string;
  min: number;
  room: string;
  folioRoom?: string;
  charged: number;
  atStake: number;
  headline: string;
  comparedWith: string;
  /** The case state as the dataset seeds it. The browser shows its own state when it holds the case. */
  seedStatus: InvestigationStatus;
}

export interface RoomStory {
  caseId: string;
  orderId: string;
  outletId: string;
  date: string;
  room: string;
  folioRoom: string;
  amount: number;
  covers: number;
  /** Minutes from the start of `date`; past 1440 is the next day. */
  signedMin: number;
  postedMin: number;
  checkoutMin: number;
}

export interface RoomCheck {
  ok: true;
  from: string;
  to: string;
  summary: RoomCheckSummary;
  /** The last 30 days, whatever period is chosen, for the trend. */
  days: { date: string; checked: number; mismatched: number; value: number }[];
  bySource: SourceRow[];
  /** Every difference in the period, largest amount first. */
  rows: RoomCheckRow[];
  /** Restaurant and room service charges: already in outlet sales, so never added again. */
  outletSales: number;
  story: RoomStory | null;
}

/** A comma list from the query. Absent means "everything you hold"; present but empty means none. */
const list = (v: string | null | undefined) => (v === null || v === undefined ? null : v.split(",").map((x) => x.trim()).filter(Boolean));

function toRow(c: RoomCharge): RoomCheckRow | null {
  const e = detectRoomChargeException(c);
  if (!e) return null;
  return {
    chargeId: c.id, caseId: e.id, status: classifyRoomCharge(c) as RoomCheckRow["status"], propertyId: c.propertyId, outletId: c.outletId,
    where: c.outletId ? outletById[c.outletId].name : SOURCE_LABEL[c.source], source: c.source, date: c.date, min: c.min, room: c.room, folioRoom: c.folioRoom,
    charged: c.expected, atStake: e.exposure, headline: e.headline, comparedWith: e.comparedWith ?? "",
    seedStatus: getDataset().seedInvestigations[e.id]?.status ?? "new",
  };
}

/**
 * The check for one period. `outlets` and `whole` come from the global outlet selector and are cut back to what the user
 * holds: outlet charges for their outlets, hotel charges (minibar, spa, laundry) only for hotels they hold in full.
 */
export function roomCheckFor(user: User, q: { from?: string | null; to?: string | null; outlets?: string | null; whole?: string | null }): RoomCheck | Fail {
  if (!can(user, "roomcharge.view")) return fail(403, "Your role cannot see room charges.");
  const to = q.to && ISO.test(q.to) ? (q.to > DEMO_TODAY ? DEMO_TODAY : q.to) : DEMO_TODAY;
  const from = q.from && ISO.test(q.from) ? (q.from < DATA_START ? DATA_START : q.from) : addDays(to, -29);
  if (from > to) return fail(400, "The period starts after it ends.");
  const mine = allowedOutlets(user);
  const outlets = new Set((list(q.outlets) ?? mine).filter((id) => mine.includes(id)));
  const whole = new Set((list(q.whole) ?? [...new Set(mine.map((id) => outletById[id].propertyId))]).filter((p) => hasWholeProperty(user, p)));
  const scoped = getDataset().roomCharges.filter((c) => (c.outletId ? outlets.has(c.outletId) : whole.has(c.propertyId)));
  const inPeriod = scoped.filter((c) => c.date >= from && c.date <= to);
  const rows = inPeriod.map(toRow).filter((r): r is RoomCheckRow => !!r).sort((a, b) => b.atStake - a.atStake || b.date.localeCompare(a.date));

  const storyCharge = getDataset().chargesById.get(ROOM_STORY_CHARGE_ID);
  const story: RoomStory | null = storyCharge?.outletId && mine.includes(storyCharge.outletId) && storyCharge.folioRoom && storyCharge.checkoutMin !== undefined
    ? {
        caseId: ROOM_STORY_EXCEPTION_ID, orderId: storyCharge.orderId!, outletId: storyCharge.outletId, date: storyCharge.date, room: storyCharge.room, folioRoom: storyCharge.folioRoom,
        amount: storyCharge.expected, covers: getDataset().ordersById.get(storyCharge.orderId!)?.covers ?? 0, signedMin: storyCharge.min,
        postedMin: storyCharge.postedMin ?? storyCharge.min, checkoutMin: storyCharge.checkoutMin,
      }
    : null;

  return {
    ok: true, from, to,
    summary: summariseRoomCharges(inPeriod),
    days: roomChargesByDay(scoped, eachDay({ from: addDays(DEMO_TODAY, -29), to: DEMO_TODAY })),
    bySource: roomChargesBySource(inPeriod),
    rows,
    outletSales: round2(inPeriod.filter((c) => c.source === "restaurant" || c.source === "room_service").reduce((s, c) => s + c.expected, 0)),
    story,
  };
}
