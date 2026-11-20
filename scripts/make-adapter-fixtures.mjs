// Writes the sample responses the Lightspeed and Mews adapters are tested on (src/lib/server/integrations/fixtures).
// They are written by hand to the shapes in each system's public API documentation, with simulated Grand Hotel Lumière
// data for one business day, 18 Nov 2026 (Lisbon is on UTC in November, so local and UTC clock times agree).
// They are not recordings of a live account. Run: node scripts/make-adapter-fixtures.mjs
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const OUT = new URL("../src/lib/server/integrations/fixtures/", import.meta.url);
const D = "2026-11-18";
const NEXT = "2026-11-19";
const uuid = (seed) => {
  const h = createHash("sha256").update(`tyll-sample:${seed}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const s2 = (n) => r2(n).toFixed(2);
const at = (day, hm, sec = 0) => `${day}T${hm}:${String(sec).padStart(2, "0")}.000Z`;
// Long lists are written one record per line, so a diff still shows which record changed.
const write = (name, data) => {
  const big = Object.entries(data).find(([, v]) => Array.isArray(v) && v.length > 50);
  const text = big
    ? `{\n${Object.entries(data).map(([k, v]) => (k === big[0] ? `"${k}": [\n${v.map((x) => JSON.stringify(x)).join(",\n")}\n]` : `"${k}": ${JSON.stringify(v)}`)).join(",\n")}\n}`
    : JSON.stringify(data, null, 1);
  writeFileSync(new URL(name, OUT), text + "\n");
};

// ---- Lightspeed Restaurant K Series: GET /f/v2/business-location/{id}/sales-daily?date=2026-11-18 ----

const FOOD = 13, DRINK = 23;
// sku: [name, net price at Mercado, net price at In-Room Dining, VAT %]
const SKU = {
  1001: ["Wagyu beef burger", 22, 25, FOOD], 1002: ["Club sandwich", 18, 21, FOOD], 1003: ["Chicken Caesar salad", 16, 18, FOOD],
  1004: ["Grilled salmon", 29, 33, FOOD], 1005: ["Beef tenderloin", 38, 44, FOOD], 1006: ["Lobster linguine", 39, 45, FOOD],
  1009: ["Lamb chops", 34, 39, FOOD], 1010: ["Truffle risotto", 26, 30, FOOD], 1012: ["Fish and chips", 21, 24, FOOD],
  1013: ["Chocolate fondant", 11, 13, FOOD], 1014: ["Berry cheesecake", 10, 12, FOOD], 1020: ["Breakfast buffet", 26, 30, FOOD],
  2001: ["Coca-Cola", 5, 6, DRINK], 2002: ["Fresh orange juice", 6.5, 7, DRINK], 2003: ["Cappuccino", 4.5, 5, FOOD],
  2006: ["House wine, glass", 9, 10, DRINK], 2007: ["Still water", 4.5, 5, DRINK], 2009: ["Draught beer", 6.5, 7, DRINK],
  9001: ["Corkage", 15, 15, DRINK],
};
let lineSeq = 1000;
const STAFF = { 14671: "Ana Ribeiro", 14672: "Tiago Moreira", 14673: "Joana Lopes", 14677: "Sara Haddad", 14691: "Rui Almeida", 14692: "Marta Pires" };

/** One sales line. `disc` is a share of the line taken off (0.1 for 10%, 1 for a comp). Negative qty takes units back. */
function line(loc, sku, qty, time, staffId, o = {}) {
  const [name, merPrice, irdPrice, rate] = SKU[sku];
  const net = (loc.ird ? irdPrice : merPrice) * qty;
  const gross = r2(net * (1 + rate / 100));
  const disc = r2(gross * (o.disc ?? 0));
  const withTax = r2(gross - disc);
  const without = Math.abs(withTax) < 0.005 ? 0 : o.disc ? r2(withTax / (1 + rate / 100)) : net;
  lineSeq += 1;
  return {
    id: `S${loc.series}.${lineSeq}`,
    totalNetAmountWithTax: s2(withTax),
    totalNetAmountWithoutTax: without.toFixed(6),
    menuListPrice: s2(gross / qty),
    unitCostPrice: "0.00",
    serviceCharge: "0.00",
    serviceChargeType: "NO_SERVICE_CHARGE",
    serviceChargeRate: "0.00",
    discountAmount: disc.toFixed(6),
    taxCode: rate === FOOD ? "PT-INT" : "PT-NOR",
    taxAmount: (withTax - without).toFixed(4),
    taxRatePercentage: s2(rate),
    ...(o.disc ? { discountType: "DISCOUNT", discountCode: o.code, discountName: o.discName } : {}),
    totalDiscountAmount: s2(disc),
    itemId: 141948669100000 + Number(sku),
    sku: String(sku),
    name,
    statisticGroup: rate === FOOD ? "Food" : "Beverage",
    quantity: qty.toFixed(3),
    currency: "EUR",
    revenueCenter: loc.name,
    revenueCenterId: loc.rc,
    timeOfSale: at(o.day ?? D, time, (lineSeq * 7) % 60),
    staffId,
    staffName: STAFF[staffId],
    deviceId: loc.device,
    deviceName: loc.deviceName,
    ...(o.voidReason ? { voidReason: o.voidReason } : {}),
  };
}

function sale(loc, n, o) {
  const lines = o.lines;
  const total = r2(lines.reduce((s, l) => s + Number(l.totalNetAmountWithTax), 0));
  const fisc = `A${loc.series}.${n}`;
  const pay = o.pay === null ? [] : [{
    code: o.pay?.code ?? "CARD", description: o.pay?.description ?? "Card", paymentMethodId: o.pay?.code === "IKPMS" ? 141948669132901 : o.pay?.code === "CASH" ? 141948669132824 : 141948669132825,
    netAmountWithTax: s2(o.pay?.amount ?? total), currency: "EUR", tip: "0.00", type: "NORMAL", deviceId: String(loc.device), deviceName: loc.deviceName,
    staffId: o.owner, staffName: STAFF[o.owner], ...(o.pay?.room ? { externalReference: o.pay.room } : {}), revenueCenter: loc.name, revenueCenterId: loc.rc,
    fiscId: `T${loc.series}.${n}`, uuid: createHash("md5").update(fisc).digest("base64url") + "==", fiscDate: at(o.day ?? D, o.closed, 5), surcharge: "0.00",
  }];
  return {
    accountReference: createHash("md5").update(`acc${fisc}`).digest("base64url") + "==",
    accountFiscId: fisc,
    receiptId: `R${loc.series}.${n}`,
    source: o.source ?? {},
    salesLines: lines,
    payments: pay,
    timeOfOpening: at(o.day ?? D, o.opened, 12),
    timeClosed: at(o.day ?? D, o.closed, 40),
    cancelled: !!o.cancelled,
    tableNumber: o.table,
    tableName: loc.ird ? `Room ${o.table}` : `Table ${o.table}`,
    ownerName: STAFF[o.owner],
    ownerId: o.owner,
    type: o.type ?? "SALE",
    externalReferences: [],
    nbCovers: o.covers,
    dineIn: !loc.ird,
    deviceId: loc.device,
    deviceName: loc.deviceName,
    ...(o.voidReason ? { voidReason: o.voidReason } : {}),
  };
}

const MER = { name: "Mercado", rc: 141948669132822, series: 70412, device: 75125, deviceName: "Mercado pass" };
const IRD = { name: "In-Room Dining", rc: 141948669132840, series: 70415, device: 75140, deviceName: "IRD desk", ird: true };
const room = (no, amount) => ({ code: "IKPMS", description: "Room charge", room: no, amount });

const mercado = [
  sale(MER, 18, { table: "12", covers: 2, owner: 14671, opened: "12:41", closed: "13:38", lines: [line(MER, 1003, 1, "12:44", 14671), line(MER, 1004, 1, "12:44", 14671), line(MER, 2007, 1, "12:44", 14671), line(MER, 2003, 2, "13:21", 14671)] }),
  sale(MER, 27, { table: "3", covers: 4, owner: 14672, opened: "13:05", closed: "14:22", lines: [
    line(MER, 1001, 2, "13:09", 14672), line(MER, 1012, 1, "13:09", 14672), line(MER, 1002, 1, "13:09", 14672), line(MER, 2001, 3, "13:09", 14672), line(MER, 2009, 1, "13:09", 14672),
    line(MER, 1001, -1, "13:31", 14677, { voidReason: "Kitchen error" }),
  ] }),
  sale(MER, 52, { table: "7", covers: 2, owner: 14673, opened: "20:02", closed: "21:41", pay: room("1312"), lines: [line(MER, 1005, 1, "20:09", 14673), line(MER, 1009, 1, "20:09", 14673), line(MER, 2006, 2, "20:09", 14673), line(MER, 1013, 1, "21:12", 14673)] }),
  sale(MER, 55, { table: "22", covers: 3, owner: 14673, opened: "20:15", closed: "22:04", pay: room("1219"), lines: [
    line(MER, 1004, 2, "20:24", 14673, { disc: 0.1, code: "LOY10", discName: "Loyalty 10%" }), line(MER, 1001, 1, "20:24", 14673, { disc: 0.1, code: "LOY10", discName: "Loyalty 10%" }),
    line(MER, 2006, 3, "20:24", 14673, { disc: 0.1, code: "LOY10", discName: "Loyalty 10%" }), line(MER, 2007, 2, "20:24", 14673, { disc: 0.1, code: "LOY10", discName: "Loyalty 10%" }),
    line(MER, 1014, 2, "21:30", 14673, { disc: 0.1, code: "LOY10", discName: "Loyalty 10%" }),
  ] }),
  sale(MER, 58, { table: "15", covers: 2, owner: 14671, opened: "20:40", closed: "22:12", pay: { code: "CASH", description: "Cash" }, lines: [
    line(MER, 1002, 1, "20:46", 14671), line(MER, 1010, 1, "20:46", 14671), line(MER, 2001, 1, "20:46", 14671), line(MER, 2002, 1, "20:46", 14671),
    line(MER, 1013, 1, "21:50", 14677, { disc: 1, code: "COMP", discName: "Birthday dessert" }),
  ] }),
  sale(MER, 61, { table: "9", covers: 2, owner: 14672, opened: "21:05", closed: "21:20", cancelled: true, voidReason: "Guests left before the drinks came", pay: null, lines: [line(MER, 2001, 2, "21:07", 14672)] }),
  sale(MER, 66, { table: "30", covers: 5, owner: 14671, opened: "21:10", closed: "23:02", lines: [
    line(MER, 1005, 2, "21:18", 14671), line(MER, 1004, 1, "21:18", 14671), line(MER, 1006, 2, "21:18", 14671), line(MER, 2007, 3, "21:18", 14671), line(MER, 9001, 1, "21:18", 14671),
  ] }),
];
// The refund of one beer from table 3's lunch, rung as its own account that points back at the bill.
mercado.push(sale(MER, 70, { table: "3", covers: 4, owner: 14677, opened: "14:38", closed: "14:40", type: "REFUND", voidReason: "Beer was flat", source: { initialAccountId: "A70412.27", previousAccountId: "A70412.27" }, pay: { amount: -r2(6.5 * 1.23) }, lines: [line(MER, 2009, -1, "14:39", 14677)] }));

const ird = [
  sale(IRD, 8, { table: "1512", covers: 2, owner: 14691, opened: "07:12", closed: "07:40", pay: room("1512"), lines: [line(IRD, 1020, 2, "07:13", 14691), line(IRD, 2002, 2, "07:13", 14691), line(IRD, 2003, 2, "07:13", 14691)] }),
  sale(IRD, 12, { table: "1009", covers: 1, owner: 14691, opened: "09:02", closed: "09:31", lines: [line(IRD, 2003, 1, "09:03", 14691), line(IRD, 1014, 1, "09:03", 14691)] }),
  sale(IRD, 21, { table: "1104", covers: 1, owner: 14692, opened: "13:02", closed: "13:30", pay: room("1104"), lines: [line(IRD, 1002, 1, "13:03", 14692), line(IRD, 2001, 1, "13:03", 14692)] }),
  sale(IRD, 33, { table: "1622", covers: 1, owner: 14692, opened: "19:45", closed: "20:20", pay: room("1622"), lines: [line(IRD, 1004, 1, "19:46", 14692), line(IRD, 2006, 1, "19:46", 14692), line(IRD, 2007, 1, "19:46", 14692)] }),
  sale(IRD, 40, { table: "1415", covers: 2, owner: 14692, opened: "22:48", closed: "23:15", pay: room("1415"), lines: [line(IRD, 1001, 1, "22:49", 14692), line(IRD, 2006, 1, "22:49", 14692), line(IRD, 1013, 1, "22:49", 14692)] }),
];
const daily = (sales) => ({ sales, nextStartOfDayAsIso8601: `${NEXT}T05:00:00+00:00`, dataComplete: true });
write("lightspeed-sales-daily-mercado.json", daily(mercado));
write("lightspeed-sales-daily-in-room-dining.json", daily(ird));

// ---- Mews Connector API: resources, reservations (ver 2023-06-06), order items ----

const ENTERPRISE = uuid("enterprise");
const SERVICE_STAY = uuid("service-stay");
const SERVICE_FNB = uuid("service-fnb");
const ADULT = uuid("age-adult"), CHILD = uuid("age-child");
const RATES = [uuid("rate-bb"), uuid("rate-ro"), uuid("rate-corp")];

const resources = [];
for (let floor = 7; floor <= 16; floor++) {
  for (let n = 1; n <= 25; n++) {
    const name = `${floor}${String(n).padStart(2, "0")}`;
    resources.push({ Id: uuid(`room-${name}`), EnterpriseId: ENTERPRISE, IsActive: true, ParentResourceId: null, Name: name, State: (floor * 7 + n) % 5 === 0 ? "Dirty" : "Inspected",
      Descriptions: {}, CreatedUtc: "2019-03-01T09:00:00Z", UpdatedUtc: at(D, "11:20"), DeletedUtc: null, Data: { Discriminator: "Space", Value: { FloorNumber: String(floor) } }, ExternalNames: { "en-US": `Room ${name}` }, Directions: {} });
  }
}
// A meeting room is a resource too; the adapter must not count it as a hotel room.
resources.push({ Id: uuid("space-sala-tejo"), EnterpriseId: ENTERPRISE, IsActive: true, ParentResourceId: null, Name: "Sala Tejo", State: "Clean", Descriptions: {}, CreatedUtc: "2019-03-01T09:00:00Z", UpdatedUtc: at(D, "08:00"), DeletedUtc: null, Data: { Discriminator: "Object", Value: null }, ExternalNames: {}, Directions: {} });

// Rooms with a guest on the night of 18 Nov: 203 of 250, 331 guests. A few stays named for the sample's story.
const named = {
  1312: { adults: 2, from: "2026-11-16", to: NEXT, outUtc: null },
  1321: { adults: 1, from: "2026-11-17", to: "2026-11-20", outUtc: null },
  1219: { adults: 3, from: "2026-11-15", to: "2026-11-21", outUtc: null },
  1512: { adults: 2, from: "2026-11-17", to: "2026-11-20", outUtc: null },
  1104: { adults: 1, from: "2026-11-18", to: "2026-11-22", outUtc: null },
  1622: { adults: 1, from: "2026-11-16", to: NEXT, outUtc: at(NEXT, "08:05") },
  1415: { adults: 2, from: "2026-11-17", to: NEXT, outUtc: at(NEXT, "10:40") },
};
const reservations = [];
const pick = (i, k) => (i * 2654435761 >>> 0) % k;
let guests = 0;
const free = resources.filter((r) => r.Data.Discriminator === "Space").map((r) => r.Name).filter((n) => !named[n]);
const others = free.filter((_, i) => pick(i + 3, 100) < 82).slice(0, 203 - Object.keys(named).length);
for (const [i, name] of [...Object.keys(named), ...others].entries()) {
  const s = named[name];
  const adults = s ? s.adults : 1 + (pick(i, 10) < 5 ? 1 : 0);
  const kids = s ? 0 : pick(i + 11, 10) < 1 ? 1 : 0;
  guests += adults + kids;
  const from = s ? s.from : ["2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17", D][pick(i + 5, 5)];
  const to = s ? s.to : [NEXT, "2026-11-20", "2026-11-21", "2026-11-22"][pick(i + 7, 4)];
  const out = s ? s.outUtc : to === NEXT && pick(i, 3) === 0 ? at(NEXT, `${String(7 + pick(i, 4)).padStart(2, "0")}:${String(pick(i, 60)).padStart(2, "0")}`) : null;
  reservations.push({
    Id: uuid(`res-${name}`), ServiceId: SERVICE_STAY, AccountId: uuid(`guest-${name}`), AccountType: "Customer", CreatorProfileId: uuid("profile-fo"), UpdaterProfileId: uuid("profile-fo"),
    Number: String(48100 + i), State: out ? "Processed" : "Started", Origin: "ChannelManager", CreatedUtc: "2026-10-02T10:14:00Z", UpdatedUtc: out ?? at(from, "15:30"), CancelledUtc: null,
    Options: { OwnerCheckedIn: true, AllCompanionsCheckedIn: true, AnyCompanionCheckedIn: true, ConnectorCheckIn: false },
    RateId: RATES[pick(i + 13, 3)], GroupId: uuid(`group-${name}`), RequestedResourceCategoryId: uuid("category-deluxe"), AssignedResourceId: uuid(`room-${name}`), AssignedResourceLocked: false,
    ScheduledStartUtc: at(from, "14:00"), ActualStartUtc: at(from, `${String(14 + pick(i, 6)).padStart(2, "0")}:${String(pick(i + 1, 60)).padStart(2, "0")}`),
    ScheduledEndUtc: at(to, "12:00"), ActualEndUtc: out, Purpose: pick(i, 3) === 0 ? "Business" : "Leisure",
    PersonCounts: [{ AgeCategoryId: ADULT, Count: adults }, ...(kids ? [{ AgeCategoryId: CHILD, Count: kids }] : [])],
  });
}
// A stay that ended the morning before: it collides with the day but has no guest on the night of 18 Nov.
reservations.push({ ...reservations[reservations.length - 1], Id: uuid("res-early"), AccountId: uuid("guest-early"), Number: "48090", State: "Processed",
  AssignedResourceId: uuid(`room-${free[free.length - 1]}`), ScheduledStartUtc: at("2026-11-16", "14:00"), ActualStartUtc: at("2026-11-16", "16:10"), ScheduledEndUtc: at(D, "12:00"), ActualEndUtc: at(D, "09:45"),
  PersonCounts: [{ AgeCategoryId: ADULT, Count: 2 }] });

const amount = (gross, rate = 13) => ({ Currency: "EUR", NetValue: r2(gross / (1 + rate / 100)), GrossValue: gross, TaxValues: [{ Code: rate === 13 ? "PT-2024-I" : "PT-2024-N", Value: r2(gross - gross / (1 + rate / 100)) }] });
const grossOf = (s) => r2(s.salesLines.reduce((t, l) => t + Number(l.totalNetAmountWithTax), 0));
const bySale = (list, n) => list.find((s) => s.accountFiscId.endsWith(`.${n}`));
let itemSeq = 0;
function posting(saleObj, guestRoom, o = {}) {
  itemSeq += 1;
  const gross = o.gross ?? grossOf(saleObj);
  return {
    Id: uuid(`item-${itemSeq}`), EnterpriseId: ENTERPRISE, AccountId: uuid(`guest-${guestRoom}`), AccountType: "Customer", ServiceId: SERVICE_FNB, ServiceOrderId: uuid(`order-${o.order ?? itemSeq}`),
    Notes: `${saleObj.tableName}, ${saleObj.salesLines.length} items`, BillId: null, AccountingCategoryId: uuid("acc-fnb"), BillingName: saleObj.salesLines[0].revenueCenter,
    ExternalIdentifier: o.noRef ? null : saleObj.receiptId, UnitCount: 1, UnitAmount: amount(gross), Amount: amount(gross), OriginalAmount: amount(o.original ?? gross), RevenueType: "Product",
    CreatorProfileId: uuid("profile-pos"), UpdaterProfileId: uuid("profile-pos"), CreatedUtc: o.created ?? saleObj.timeClosed.replace(/:40\.000Z$/, ":58Z"), UpdatedUtc: o.updated ?? o.created ?? saleObj.timeClosed.replace(/:40\.000Z$/, ":58Z"),
    ConsumedUtc: saleObj.timeClosed.replace(/\.000Z$/, "Z"), CanceledUtc: o.canceled ?? null, ClosedUtc: null, StartUtc: null, AccountingState: o.canceled ? "Canceled" : "Open",
    Type: "ProductOrder", Options: { CanceledWithReservation: false }, Data: { Discriminator: "Product", Rebate: null, Product: { ProductId: uuid("product-fnb"), AgeCategoryId: null } },
  };
}
const items = [
  // Table 7, signed to room 1312: the interface posted it to the guest in room 1321.
  posting(bySale(mercado, 52), "1321"),
  // Table 22, room 1219: posted as signed, after the 10% loyalty discount.
  posting(bySale(mercado, 55), "1219"),
  // Room 1104's lunch: the interface sent it twice, a minute apart.
  posting(bySale(ird, 21), "1104"),
  posting(bySale(ird, 21), "1104", { created: at(D, "13:31", 59).replace(".000", "") }),
  // Room 1622: first posted at the wrong amount and canceled by the front desk, then posted again correctly.
  posting(bySale(ird, 33), "1622", { gross: 41.0, canceled: at(D, "20:34") }),
  posting(bySale(ird, 33), "1622", { created: at(D, "20:35", 12).replace(".000", "") }),
  // Room 1415's late supper reached the account at 11:16 PM, before the guest checked out the next morning.
  posting(bySale(ird, 40), "1415"),
  // Room 1512's breakfast never reached Mews: nothing here.
  // A minibar refill the front desk keyed in by hand on the F&B service, with no receipt id: no bill matches it.
  { ...posting(bySale(ird, 12), "1009", { noRef: true, gross: 14.5 }), BillingName: "Minibar", Notes: "Minibar refill, keyed at the front desk" },
];
// Mews lists newest first.
items.sort((a, b) => b.CreatedUtc.localeCompare(a.CreatedUtc));
reservations.sort((a, b) => b.UpdatedUtc.localeCompare(a.UpdatedUtc));

write("mews-resources.json", { Resources: resources, Cursor: null });
write("mews-reservations.json", { Reservations: reservations, Cursor: null });
write("mews-order-items.json", { OrderItems: items, Cursor: null });
write("sample-meta.json", {
  businessDate: D, timeZone: "Europe/Lisbon", enterpriseId: ENTERPRISE, posServiceIds: [SERVICE_FNB],
  lightspeed: { "lis-terrace": { businessLocationId: 45454565682201, code: "MER" }, "lis-ird": { businessLocationId: 45454565682204, code: "IRD", roomService: true } },
  items: { 1001: "burger", 1002: "club", 1003: "caesar", 1004: "salmon", 1005: "tenderloin", 1006: "lobster", 1009: "lambchops", 1010: "risotto", 1012: "fishchips", 1013: "fondant", 1014: "cheesecake", 1020: "breakfast", 2001: "coke", 2002: "oj", 2003: "cappuccino", 2006: "wine", 2007: "still", 2009: "beer" },
  staff: { 14671: "MER-S1", 14672: "MER-S2", 14673: "MER-S3", 14677: "MER-S7", 14691: "IRD-S1", 14692: "IRD-S2" },
  roomPaymentCodes: ["IKPMS"], cashPaymentCodes: ["CASH"],
  expect: { rooms: 250, inHouse: 203, guests },
});
console.log("written; in house", reservations.length - 1, "guests", guests);
