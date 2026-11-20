// The room charge check: every bill charged to a room, and every minibar, spa and laundry charge, set against the guest
// folio in the PMS. Pure functions over RoomCharge records, so the screen, the flags and the tests count the same way.
// A difference is a prompt to check the folio, never a finding about the person who rang the bill.
import type { ChargeSource, RoomCharge } from "../types";
import { round2 } from "../util";
import { classifyRoomCharge, detectRoomChargeException, type RoomChargeStatus } from "./detect";

/** In the order a manager reads them: posted correctly first, then the differences. */
export const ROOM_STATUSES: RoomChargeStatus[] = ["matched", "missing", "wrong_amount", "duplicate", "wrong_room", "after_checkout"];

export const ROOM_STATUS_LABEL: Record<RoomChargeStatus, string> = {
  matched: "Posted correctly",
  missing: "Missing from the guest bill",
  wrong_amount: "Different amount",
  duplicate: "Posted twice",
  wrong_room: "Posted to the wrong room",
  after_checkout: "Posted after check-out",
};

/** The money a difference puts at stake: the same figure as the flag it raises, so the check and the flags agree. */
export const roomChargeAtStake = (c: RoomCharge) => detectRoomChargeException(c)?.exposure ?? 0;

export interface RoomCheckSummary {
  checked: number;
  matched: number;
  mismatched: number;
  /** What the outlets and housekeeping charged to rooms. */
  charged: number;
  /** What reached guest folios, whatever room it landed on. */
  posted: number;
  /** Money at stake on the differences. */
  atStake: number;
  byStatus: { status: RoomChargeStatus; n: number; value: number }[];
}

export function summariseRoomCharges(charges: readonly RoomCharge[]): RoomCheckSummary {
  const by = new Map<RoomChargeStatus, { n: number; value: number }>(ROOM_STATUSES.map((s) => [s, { n: 0, value: 0 }]));
  let charged = 0, posted = 0;
  for (const c of charges) {
    const status = classifyRoomCharge(c);
    const row = by.get(status)!;
    row.n += 1;
    row.value += status === "matched" ? c.expected : roomChargeAtStake(c);
    charged += c.expected;
    posted += c.posted.reduce((s, x) => s + x, 0);
  }
  const byStatus = ROOM_STATUSES.map((status) => ({ status, n: by.get(status)!.n, value: round2(by.get(status)!.value) }));
  const mismatchedRows = byStatus.filter((s) => s.status !== "matched");
  return {
    checked: charges.length,
    matched: by.get("matched")!.n,
    mismatched: mismatchedRows.reduce((s, x) => s + x.n, 0),
    charged: round2(charged),
    posted: round2(posted),
    atStake: round2(mismatchedRows.reduce((s, x) => s + x.value, 0)),
    byStatus,
  };
}

/** Charges checked and differences found on each day, for the 30 day chart. Days with no charges show zero. */
export function roomChargesByDay(charges: readonly RoomCharge[], days: readonly string[]) {
  const out = new Map(days.map((date) => [date, { date, checked: 0, mismatched: 0, value: 0 }]));
  for (const c of charges) {
    const d = out.get(c.date);
    if (!d) continue;
    d.checked += 1;
    if (classifyRoomCharge(c) !== "matched") {
      d.mismatched += 1;
      d.value = round2(d.value + roomChargeAtStake(c));
    }
  }
  return [...out.values()];
}

export interface SourceRow {
  source: ChargeSource;
  n: number;
  charged: number;
  posted: number;
  counts: Record<RoomChargeStatus, number>;
}

/** The same check split by where the charge came from: outlet tills, room service, minibar, spa, laundry. */
export function roomChargesBySource(charges: readonly RoomCharge[]): SourceRow[] {
  const out = new Map<ChargeSource, SourceRow>();
  for (const c of charges) {
    const row = out.get(c.source) ?? { source: c.source, n: 0, charged: 0, posted: 0, counts: Object.fromEntries(ROOM_STATUSES.map((s) => [s, 0])) as Record<RoomChargeStatus, number> };
    row.n += 1;
    row.charged = round2(row.charged + c.expected);
    row.posted = round2(row.posted + c.posted.reduce((s, x) => s + x, 0));
    row.counts[classifyRoomCharge(c)] += 1;
    out.set(c.source, row);
  }
  return [...out.values()].sort((a, b) => b.charged - a.charged);
}
