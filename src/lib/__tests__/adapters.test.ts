// Feature 9: the Lightspeed Restaurant K Series and Mews adapters, tested on sample responses only.
import { describe, expect, it } from "vitest";
import { DATA_SOURCES } from "../adapters";
import { USERS } from "../data/catalog";
import { can, canOpenPath } from "../domain/access";
import { classifyRoomCharge, detectOrderException } from "../domain/detect";
import { orderTotals } from "../domain/orders";
import { LightspeedKSeriesPos, mapSalesDay, salesDailyRequest, type LskSalesDaily } from "../server/integrations/lightspeed-k";
import { MewsPms, type MewsReservation, type MewsResource } from "../server/integrations/mews";
import { SAMPLE_DATE, SAMPLE_LIGHTSPEED_CONFIG, adapterSampleFor, lightspeedSampleTransport, mewsSampleTransport, runSample, sampleAdapters, sampleMewsConfig } from "../server/integrations/sample";
import { minutesInto, moveDates, moveInstant, zonedInstant } from "../server/integrations/time";
import { CREDENTIAL_FIELDS, NotConnectedError, notConnected, recording, type SourceRequest, type Transport } from "../server/integrations/transport";
import mercado from "../server/integrations/fixtures/lightspeed-sales-daily-mercado.json";
import mewsReservations from "../server/integrations/fixtures/mews-reservations.json";
import mewsResources from "../server/integrations/fixtures/mews-resources.json";
import type { RoomCharge } from "../types";
import { DEMO_TODAY } from "../util";

const MER = "lis-terrace";
const IRD = "lis-ird";
const user = (id: string) => USERS.find((u) => u.id === id)!;
const hasCredential = (r: SourceRequest) => CREDENTIAL_FIELDS.some((f) => JSON.stringify(r).includes(`"${f}"`) || (r.query && f in r.query));

describe("clock helpers", () => {
  it("counts minutes in the hotel's zone in winter and summer", () => {
    expect(minutesInto("2026-11-18", "2026-11-18T21:41:40Z", "Europe/Lisbon")).toBe(21 * 60 + 41);
    expect(minutesInto("2026-07-15", "2026-07-15T20:41:00Z", "Europe/Lisbon")).toBe(21 * 60 + 41);
    expect(minutesInto("2026-11-18", "2026-11-19T01:30:00Z", "Europe/Lisbon")).toBe(1440 + 90);
    expect(zonedInstant("2026-07-15", 0, "Europe/Lisbon").toISOString()).toBe("2026-07-14T23:00:00.000Z");
  });

  it("moves a sample by whole days and keeps the wall clock time", () => {
    expect(moveInstant("2026-11-18T21:41:40.000Z", -126, "Europe/Lisbon")).toBe("2026-07-15T20:41:40.000Z");
    const moved = moveDates({ a: "2026-11-18", b: ["2026-11-18T07:12:12Z"], c: "Table 7", d: 3 }, 1, "Europe/Lisbon");
    expect(moved).toEqual({ a: "2026-11-19", b: ["2026-11-19T07:12:12.000Z"], c: "Table 7", d: 3 });
  });
});

describe("Lightspeed Restaurant K Series adapter", () => {
  const readMercado = () => new LightspeedKSeriesPos(lightspeedSampleTransport(), SAMPLE_LIGHTSPEED_CONFIG).readDay(MER, SAMPLE_DATE);

  it("asks for one business day exactly as documented, with no credentials", async () => {
    const t = recording(lightspeedSampleTransport());
    await new LightspeedKSeriesPos(t, SAMPLE_LIGHTSPEED_CONFIG).fetchOrders(MER, SAMPLE_DATE);
    expect(t.requests).toEqual([salesDailyRequest(45454565682201, SAMPLE_DATE)]);
    expect(t.requests[0]).toMatchObject({ method: "GET", path: "/f/v2/business-location/45454565682201/sales-daily", query: { date: SAMPLE_DATE, include: "payments,staff,table" } });
    expect(t.requests.some(hasCredential)).toBe(false);
  });

  it("maps every sale to a bill, with the refund kept on the bill it refunds", async () => {
    const { orders, report } = await readMercado();
    expect(report.sales).toBe(8);
    expect(orders).toHaveLength(7);
    expect(report.cancelled).toBe(1);
    expect(report.refunds).toBe(1);
    const lunch = orders.find((o) => o.id === "MER-A70412.27")!;
    expect(lunch.refund).toEqual({ amount: 6.5, min: 14 * 60 + 40, reason: "Beer was flat" });
    expect(lunch.covers).toBe(4);
    expect(lunch.staffId).toBe("MER-S2");
    expect(lunch.table).toBe("Table 3");
  });

  it("totals agree with Lightspeed to the cent, net of tax", async () => {
    for (const outlet of [MER, IRD]) {
      const { orders, report } = await new LightspeedKSeriesPos(lightspeedSampleTransport(), SAMPLE_LIGHTSPEED_CONFIG).readDay(outlet, SAMPLE_DATE);
      expect(report.tyllNet).toBe(report.sourceNet);
      const net = Math.round(orders.filter((o) => !o.voided).reduce((s, o) => s + orderTotals(o).net, 0) * 100) / 100;
      expect(net).toBe(report.sourceNet);
    }
  });

  it("reads menu prices back net of tax", async () => {
    const { orders } = await readMercado();
    const first = orders.find((o) => o.id === "MER-A70412.18")!;
    // In the order the till rang them, to the second.
    expect(first.lines.map((l) => [l.itemId, l.qty, l.unitPrice])).toEqual([["still", 1, 4.5], ["caesar", 1, 16], ["salmon", 1, 29], ["cappuccino", 2, 4.5]]);
    expect(first.lines.map((l) => [l.enteredMin, l.enteredSec])).toEqual([[764, 1], [764, 47], [764, 54], [801, 8]]);
    expect(first.discountPct).toBe(0);
    expect(first.payment).toBe("card");
  });

  it("turns a negative quantity into an item taken off after it was rung", async () => {
    const lunch = (await readMercado()).orders.find((o) => o.id === "MER-A70412.27")!;
    const burgers = lunch.lines.filter((l) => l.itemId === "burger");
    expect(burgers.map((l) => [l.state, l.qty])).toEqual([["kept", 1], ["removed_post", 1]]);
    expect(burgers[1]).toMatchObject({ reason: "Kitchen error", removedBy: "MER-S7", removedMin: 13 * 60 + 31 });
    expect(orderTotals(lunch).removedPost).toBe(22);
  });

  it("keeps a bill discount and a complimentary dessert apart", async () => {
    const { orders } = await readMercado();
    const loyalty = orders.find((o) => o.id === "MER-A70412.55")!;
    expect(loyalty.discountPct).toBeCloseTo(10, 1);
    expect(loyalty.discountReason).toBe("Loyalty 10%");
    expect(loyalty.lines.every((l) => l.state === "kept")).toBe(true);
    const birthday = orders.find((o) => o.id === "MER-A70412.58")!;
    const fondant = birthday.lines.find((l) => l.itemId === "fondant")!;
    expect(fondant).toMatchObject({ state: "comped", unitPrice: 11, reason: "Birthday dessert" });
    expect(birthday.discountPct).toBe(0);
    expect(birthday.payment).toBe("cash");
    expect(orderTotals(birthday).comps).toBe(11);
  });

  it("marks a cancelled sale as voided and leaves it out of the totals", async () => {
    const { orders, report } = await readMercado();
    const gone = orders.find((o) => o.id === "MER-A70412.61")!;
    expect(gone.voided).toEqual({ min: 21 * 60 + 20, reason: "Guests left before the drinks came" });
    expect(report.roomCharges.some((c) => c.orderId === gone.id)).toBe(false);
  });

  it("reads room charges with the room the bill was signed to and the amount with tax", async () => {
    const { report } = await readMercado();
    expect(report.roomCharges.map((c) => [c.ref, c.room, c.amount])).toEqual([["R70412.52", "1312", 115.93], ["R70412.55", "1219", 141.55]]);
    expect(report.roomCharges[0]).toMatchObject({ table: "Table 7", covers: 2, min: 21 * 60 + 41, roomService: false });
  });

  it("keeps an item it cannot match on the bill and reports it", async () => {
    const { orders, report } = await readMercado();
    expect(report.unmappedItems).toEqual([{ sku: "9001", name: "Corkage", lines: 1 }]);
    expect(orders.find((o) => o.id === "MER-A70412.66")!.lines.some((l) => l.itemId === "lsk:9001")).toBe(true);
    expect(report.unmappedStaff).toEqual([]);
  });

  it("keeps the wall clock times when the sample is replayed on a summer date", async () => {
    const { orders } = await new LightspeedKSeriesPos(lightspeedSampleTransport("2026-07-15"), SAMPLE_LIGHTSPEED_CONFIG).readDay(MER, "2026-07-15");
    expect(orders.find((o) => o.id === "MER-A70412.52")!.closeMin).toBe(21 * 60 + 41);
    expect(orders.every((o) => o.date === "2026-07-15")).toBe(true);
  });

  it("returns nothing for a day with no sales, and refuses an outlet with no business location", async () => {
    const pos = new LightspeedKSeriesPos(lightspeedSampleTransport(), SAMPLE_LIGHTSPEED_CONFIG);
    expect(await pos.fetchOrders(MER, "2026-11-17")).toEqual([]);
    await expect(pos.fetchOrders("lis-lobby", SAMPLE_DATE)).rejects.toThrow(/No Lightspeed business location/);
  });

  it("makes no call without a live account", async () => {
    const pos = new LightspeedKSeriesPos(notConnected, SAMPLE_LIGHTSPEED_CONFIG);
    await expect(pos.fetchOrders(MER, SAMPLE_DATE)).rejects.toBeInstanceOf(NotConnectedError);
  });

  it("a refund of a bill from another day is counted apart, not put on any bill", () => {
    const res = mercado as LskSalesDaily;
    const refundOnly = { ...res, sales: res.sales.filter((s) => s.type === "REFUND") };
    const { orders, report } = mapSalesDay(SAMPLE_LIGHTSPEED_CONFIG, MER, SAMPLE_DATE, refundOnly);
    expect(orders).toEqual([]);
    expect(report.refundsOtherDay).toBe(6.5);
    expect(report.sourceNet).toBe(0);
    expect(report.tyllNet).toBe(0);
  });

  // Real menus have round prices with tax: still water at €5.00 with 23% VAT is 4.065041 net. Rounding must never read as a discount.
  const waterSale = (fiscId: string, qty: number, discount = 0): LskSalesDaily["sales"][number] => {
    const gross = 5 * qty - discount;
    return {
      accountFiscId: fiscId, receiptId: `R${fiscId}`, type: "SALE", ownerId: 14671, nbCovers: qty, tableName: "Table 2",
      timeOfOpening: `${SAMPLE_DATE}T12:00:00Z`, timeClosed: `${SAMPLE_DATE}T12:30:00Z`,
      salesLines: [{
        id: `L${fiscId}`, sku: "2007", name: "Still water", quantity: qty.toFixed(3), taxRatePercentage: "23.00", timeOfSale: `${SAMPLE_DATE}T12:05:00Z`,
        totalNetAmountWithTax: gross.toFixed(2), totalNetAmountWithoutTax: (gross / 1.23).toFixed(6), totalDiscountAmount: discount.toFixed(2),
        ...(discount ? { discountName: "Staff meal 10%" } : {}),
      }],
      payments: [{ code: "CARD", netAmountWithTax: gross.toFixed(2) }],
    };
  };

  it("never turns the rounding of a tax inclusive price into a discount", () => {
    const res: LskSalesDaily = { sales: [waterSale("W1", 1), waterSale("W3", 3), waterSale("W7", 7)] };
    const { orders, report } = mapSalesDay(SAMPLE_LIGHTSPEED_CONFIG, MER, SAMPLE_DATE, res);
    expect(orders.map((o) => o.discountPct)).toEqual([0, 0, 0]);
    expect(report.discountedBills).toBe(0);
    expect(report.tyllNet).toBe(report.sourceNet);
    // Each bill to the cent, as both systems total a bill: 4.07 + 12.20 + 28.46.
    expect(report.tyllNet).toBe(44.73);
    for (const o of orders) expect(detectOrderException(o)).toBeNull();
  });

  it("reads a real discount from the discount amounts, to two decimals", async () => {
    const { orders, report } = mapSalesDay(SAMPLE_LIGHTSPEED_CONFIG, MER, SAMPLE_DATE, { sales: [waterSale("D3", 3, 1.5)] });
    expect(orders[0].discountPct).toBe(10);
    expect(orders[0].discountReason).toBe("Staff meal 10%");
    expect(report.tyllNet).toBe(report.sourceNet);
    const loyalty = (await readMercado()).orders.find((o) => o.id === "MER-A70412.55")!;
    expect(loyalty.discountPct).toBe(Math.round(loyalty.discountPct * 100) / 100);
    expect(loyalty.discountPct).toBe(10);
  });

  it("does not count a missing approval against staff: the sales export has no approval field", async () => {
    const { orders } = await readMercado();
    expect(orders.every((o) => o.approvalsNotInSource === true)).toBe(true);
    // The loyalty discount has a reason and no approval in the export: the discount rule waits for a sandbox account.
    const loyalty = orders.find((o) => o.id === "MER-A70412.55")!;
    expect(detectOrderException(loyalty)).toBeNull();
    // The same bill from a source that records approvals is still checked by the discount rule.
    expect(detectOrderException({ ...loyalty, approvalsNotInSource: undefined })?.type).toBe("unusual_discount");
    // The burger taken off for "Kitchen error" is not flagged for want of an approval Lightspeed does not export.
    const lunch = orders.find((o) => o.id === "MER-A70412.27")!;
    expect(["removed_after_dispatch", "prepared_not_charged", "bill_mismatch"]).not.toContain(detectOrderException(lunch)?.type);
  });

  it("counts a bill paid to a room with no room number, instead of dropping it", () => {
    const res = structuredClone(mercado) as LskSalesDaily;
    const sale = res.sales.find((x) => x.accountFiscId === "A70412.52")!;
    sale.payments = sale.payments!.map((p) => (p.code === "IKPMS" ? { ...p, externalReference: " " } : p));
    const { orders, report } = mapSalesDay(SAMPLE_LIGHTSPEED_CONFIG, MER, SAMPLE_DATE, res);
    expect(orders.find((o) => o.id === "MER-A70412.52")!.payment).toBe("room");
    expect(report.roomCharges.map((c) => c.ref)).toEqual(["R70412.55"]);
    expect(report.roomChargesWithoutRoom).toBe(1);
  });

  it("counts the lines on the bills, and refund lines apart", async () => {
    const { orders, report } = await readMercado();
    expect(report.lines).toBe(orders.reduce((n, o) => n + o.lines.length, 0));
    expect(report.refundLines).toBe(1);
  });
});

describe("Mews adapter", () => {
  const build = (transport: Transport, pageSize = 100) => {
    const pos = new LightspeedKSeriesPos(lightspeedSampleTransport(), SAMPLE_LIGHTSPEED_CONFIG);
    return new MewsPms(transport, sampleMewsConfig(pos, pageSize));
  };

  it("asks for each list as documented, page by page, with no credentials", async () => {
    const t = recording(mewsSampleTransport());
    await build(t, 100).readDay("lis", SAMPLE_DATE);
    const paths = new Set(t.requests.map((r) => r.path));
    expect([...paths].sort()).toEqual(["/api/connector/v1/orderItems/getAll", "/api/connector/v1/reservations/getAll/2023-06-06", "/api/connector/v1/resources/getAll"]);
    expect(t.requests.every((r) => r.method === "POST" && (r.body!.Limitation as { Count: number }).Count === 100)).toBe(true);
    expect(t.requests.filter((r) => r.path.includes("resources")).length).toBe(3);
    expect(t.requests.some(hasCredential)).toBe(false);
    const items = t.requests.find((r) => r.path.includes("orderItems"))!.body!;
    expect(items.ConsumedUtc).toEqual({ StartUtc: `${SAMPLE_DATE}T04:00:00.000Z`, EndUtc: "2026-11-19T04:00:00.000Z" });
    // Each next page starts from the cursor the last page gave.
    const pages = t.requests.filter((r) => r.path.includes("resources"));
    expect((pages[0].body!.Limitation as { Cursor?: string }).Cursor).toBeUndefined();
    expect((pages[1].body!.Limitation as { Cursor?: string }).Cursor).toBeTruthy();
  });

  it("gives the same answer whatever the page size", async () => {
    const small = await build(mewsSampleTransport(), 7).readDay("lis", SAMPLE_DATE);
    const large = await build(mewsSampleTransport(), 1000).readDay("lis", SAMPLE_DATE);
    expect(small).toEqual(large);
  });

  it("counts rooms with a guest each night, leaving out meeting rooms and stays that ended that morning", async () => {
    const pms = build(mewsSampleTransport());
    const [night] = await pms.nights("lis", SAMPLE_DATE, SAMPLE_DATE);
    expect(night).toMatchObject({ rooms: 203, roomCount: 250, guests: 324 });
    expect(night.guests).toBeGreaterThanOrEqual(304);
    expect(night.guests).toBeLessThanOrEqual(366);
    const [occ] = await pms.fetchOccupancy("lis", SAMPLE_DATE, SAMPLE_DATE);
    expect(occ).toMatchObject({ propertyId: "lis", date: SAMPLE_DATE, forecast: SAMPLE_DATE > DEMO_TODAY });
    expect(occ.occupancy).toBeCloseTo(0.812, 3);
    expect(await pms.fetchOccupancy("other", SAMPLE_DATE, SAMPLE_DATE)).toEqual([]);
  });

  it("leaves a no-show out of a night already past, and keeps a confirmed arrival for a night still to come", async () => {
    // A stay still Confirmed for a free room: the guest never checked in.
    const taken = new Set((mewsReservations as unknown as { Reservations: MewsReservation[] }).Reservations.map((r) => r.AssignedResourceId));
    const free = (mewsResources as unknown as { Resources: MewsResource[] }).Resources.find((r) => r.IsActive && !r.ParentResourceId && r.Data?.Discriminator === "Space" && !taken.has(r.Id) && /^\d+$/.test(r.Name))!;
    const sample = (mewsReservations as unknown as { Reservations: MewsReservation[] }).Reservations.find((r) => r.State === "Started")!;
    const noShow: MewsReservation = {
      ...sample, Id: "no-show", Number: "99999", State: "Confirmed", AssignedResourceId: free.Id, ActualStartUtc: null, ActualEndUtc: null,
      ScheduledStartUtc: `${SAMPLE_DATE}T15:00:00Z`, ScheduledEndUtc: "2026-11-20T11:00:00Z", PersonCounts: [{ AgeCategoryId: "adult", Count: 2 }],
    };
    const base = mewsSampleTransport();
    const t: Transport = async (req) => {
      const res = (await base(req)) as { Reservations?: MewsReservation[] };
      const first = !(req.body?.Limitation as { Cursor?: string } | undefined)?.Cursor;
      if (res.Reservations && first) res.Reservations = [...res.Reservations, noShow];
      return res;
    };
    const pos = new LightspeedKSeriesPos(lightspeedSampleTransport(), SAMPLE_LIGHTSPEED_CONFIG);
    const [past] = await new MewsPms(t, { ...sampleMewsConfig(pos, 1000), today: () => "2026-11-20" }).nights("lis", SAMPLE_DATE, SAMPLE_DATE);
    expect(past).toMatchObject({ rooms: 203, guests: 324, forecast: false });
    const [ahead] = await new MewsPms(t, { ...sampleMewsConfig(pos, 1000), today: () => "2026-11-10" }).nights("lis", SAMPLE_DATE, SAMPLE_DATE);
    expect(ahead).toMatchObject({ rooms: 204, guests: 326, forecast: true });
  });

  it("matches each bill charged to a room with its posting on the guest bill", async () => {
    const day = await build(mewsSampleTransport()).readDay("lis", SAMPLE_DATE);
    const by = new Map(day.charges.map((c) => [c.room, c]));
    expect(day.charges).toHaveLength(6);
    expect(classifyRoomCharge(by.get("1312")!)).toBe("wrong_room");
    expect(by.get("1312")!.folioRoom).toBe("1321");
    expect(classifyRoomCharge(by.get("1512")!)).toBe("missing");
    expect(by.get("1512")!.posted).toEqual([]);
    expect(classifyRoomCharge(by.get("1104")!)).toBe("duplicate");
    expect(by.get("1104")!.posted).toEqual([31.11, 31.11]);
    expect(by.get("1104")!.source).toBe("room_service");
  });

  it("does not flag a discounted bill, a posting canceled and posted again, or a posting made before check-out", async () => {
    const day = await build(mewsSampleTransport()).readDay("lis", SAMPLE_DATE);
    const by = new Map(day.charges.map((c) => [c.room, c]));
    expect(classifyRoomCharge(by.get("1219")!)).toBe("matched");
    expect(by.get("1219")!.posted).toEqual([by.get("1219")!.expected]);
    expect(classifyRoomCharge(by.get("1622")!)).toBe("matched");
    expect(by.get("1622")!.posted).toHaveLength(1);
    expect(day.canceledItems).toBe(1);
    const late = by.get("1415")!;
    expect(classifyRoomCharge(late)).toBe("matched");
    expect(late.checkoutMin).toBe(1440 + 10 * 60 + 40);
    expect(late.postedMin!).toBeLessThan(late.checkoutMin!);
  });

  it("shows a posting with no bill behind it, without flagging it", async () => {
    const day = await build(mewsSampleTransport()).readDay("lis", SAMPLE_DATE);
    expect(day.unmatchedPostings.map((p) => p.gross)).toEqual([14.5]);
    expect(day.charges.some((c) => c.posted.includes(14.5))).toBe(false);
  });

  it("flags a posting that reached the guest bill after check-out", async () => {
    // The same sample, with room 1415's supper posted the morning after, once the guest had left.
    const base = mewsSampleTransport();
    const late: Transport = async (req) => {
      const res = (await base(req)) as { OrderItems?: { ExternalIdentifier?: string; CreatedUtc: string }[] };
      if (res.OrderItems) res.OrderItems = res.OrderItems.map((i) => (i.ExternalIdentifier === "R70415.40" ? { ...i, CreatedUtc: "2026-11-19T11:20:00Z" } : i));
      return res;
    };
    const c = (await build(late).readDay("lis", SAMPLE_DATE)).charges.find((x) => x.room === "1415")!;
    expect(classifyRoomCharge(c)).toBe("after_checkout");
  });

  it("matches on amount and time when the posting carries no receipt id, and not on a different amount", async () => {
    const strip = (gross?: number): Transport => async (req) => {
      const res = (await mewsSampleTransport()(req)) as { OrderItems?: { ExternalIdentifier?: string | null; Amount: { GrossValue: number } }[] };
      if (res.OrderItems) res.OrderItems = res.OrderItems.map((i) => (i.ExternalIdentifier === "R70412.55" ? { ...i, ExternalIdentifier: null, Amount: { ...i.Amount, GrossValue: gross ?? i.Amount.GrossValue } } : i));
      return res;
    };
    const same = (await build(strip()).readDay("lis", SAMPLE_DATE)).charges.find((c) => c.room === "1219")!;
    expect(classifyRoomCharge(same)).toBe("matched");
    const other = (await build(strip(99)).readDay("lis", SAMPLE_DATE)).charges.find((c) => c.room === "1219")!;
    expect(classifyRoomCharge(other)).toBe("missing");
  });

  it("makes no call without a live account", async () => {
    await expect(build(notConnected).fetchRoomCharges("lis", SAMPLE_DATE)).rejects.toBeInstanceOf(NotConnectedError);
  });
});

describe("the sample on the Settings page", () => {
  it("adds up: the money to check is the sum of the charges, and each charge is counted once", async () => {
    const s = await runSample(SAMPLE_DATE);
    expect(s.liveCalls).toBe(0);
    expect(s.summary).toEqual({ checked: 6, matched: 3, toCheck: 3, atRisk: Math.round((115.93 + 96.32 + 31.11) * 100) / 100 });
    expect(s.summary.atRisk).toBe(Math.round(s.charges.reduce((t, c) => t + c.atRisk, 0) * 100) / 100);
    expect(s.charges[0]).toMatchObject({ room: "1312", folioRoom: "1321", status: "wrong_room", headline: "Room 1312: charge posted to room 1321" });
    expect(s.charges.map((c) => c.atRisk)).toEqual([...s.charges.map((c) => c.atRisk)].sort((a, b) => b - a));
    expect(s.pos.sourceNet).toBe(s.pos.tyllNet);
    expect(s.pos.bills).toBe(12);
    expect(s.pms).toMatchObject({ rooms: 250, inHouse: 203, guests: 324 });
    expect(s.pos).toMatchObject({ cancelled: 1, refunds: 1, removedLines: 1, discountedBills: 1, compedLines: 1, refundLines: 1, roomChargesWithoutRoom: 0 });
  });

  it("replays as last night of any business date with the same figures", async () => {
    const a = await runSample(SAMPLE_DATE);
    const b = await runSample("2026-10-12");
    expect(b.businessDate).toBe("2026-10-12");
    expect(b.summary).toEqual(a.summary);
    expect(b.charges.map((c) => [c.room, c.min, c.status])).toEqual(a.charges.map((c) => [c.room, c.min, c.status]));
    expect(b.pms.inHouse).toBe(a.pms.inHouse);
  });

  it("is for the roles that see guest bills across the hotel, checked on the server", async () => {
    const allowed = USERS.filter((u) => can(u, "adapters.view")).map((u) => u.role);
    expect(new Set(allowed)).toEqual(new Set(["owner", "gm", "controller", "fnb_director"]));
    for (const id of ["u-chef", "u-buy", "u-emp", "u-rm"]) {
      const u = USERS.find((x) => x.id === id);
      if (!u) continue;
      expect(await adapterSampleFor(u)).toMatchObject({ ok: false, status: 403 });
      expect(canOpenPath(u, "/settings/adapters")).toBe(false);
      expect(canOpenPath(u, "/settings")).toBe(true);
    }
    const fnb = await adapterSampleFor(user("u-fnb"));
    expect(fnb.ok).toBe(true);
    expect(canOpenPath(user("u-fc"), "/settings/adapters")).toBe(true);
  });

  it("keeps the demo on simulated data and labels both adapters as built, not connected, unverified", () => {
    const by = new Map(DATA_SOURCES.map((s) => [s.id, s]));
    expect(by.get("pos")!.state).toBe("simulated");
    expect(by.get("pms")!.state).toBe("simulated");
    for (const id of ["pos-lightspeed", "pms-mews"]) {
      expect(by.get(id)).toMatchObject({ state: "adapter_built", verified: false, detail: "/settings/adapters" });
      expect(by.get(id)!.note).toMatch(/sample responses only/);
    }
  });

  it("feeds the room charge rule the same shape as the simulated PMS", async () => {
    const { pms } = sampleAdapters();
    const charges: RoomCharge[] = await pms.fetchRoomCharges("lis", SAMPLE_DATE);
    for (const c of charges) {
      expect(c.propertyId).toBe("lis");
      expect(c.date).toBe(SAMPLE_DATE);
      expect(typeof c.expected).toBe("number");
      expect(Array.isArray(c.posted)).toBe(true);
    }
  });
});
