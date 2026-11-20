// Builds the investigation explanation from recorded facts.
// In this demo the wording is assembled by rules, not by a language model, and it is labelled that way on screen.
import { ingredientById, itemById, outletById, propertyById, staffById } from "../data/catalog";
import type { Dataset } from "../data/generate";
import type { CountRecord, Exception, Order, RoomCharge } from "../types";
import { addDays, fmtDate, fmtMoney, fmtQty, fmtTime } from "../util";
import { POLICY, REMOVAL_TYPES, belowMenu, fmtClock, folioTime, ringFinding, ringOnBill, type Pattern } from "./detect";
import { cheapName, mixLabelById, mixValue } from "./till-rules";
import { countVariance, countVarianceValue } from "./inventory";
import { BOUGHT_USED_CAUSES, boughtQty, itemWords } from "./bought-used";
import { breakfastCount, guestCount, nearbyBreakfastFact, rateName } from "./guests";
import { COVER_RULES, SERVICE_LABEL, VIA_LABEL, fmtStay, guestWords, nearbyFact, sameParty } from "./covers";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
import { lineValue, orderTotals } from "./orders";

export interface StockEvidence {
  ingredientId: string;
  count: CountRecord;
  variance: number;
  value: number;
}

export interface Explanation {
  whatHappened: string;
  /** Facts taken directly from the records. */
  facts: string[];
  /** Explanations that fit the facts. None of them is established. */
  possibleCauses: string[];
  recommended: string[];
  message: string;
  stock: StockEvidence[];
  stockNote?: string;
  patternNote?: string;
  similarAtOutlet: number;
}

const login = (id?: string) => (id ? (staffById[id]?.name ?? id) : "not recorded");

/** The most recent count of each ingredient in the removed items, as supporting stock evidence. */
function stockEvidence(data: Dataset, counts: readonly CountRecord[], order: Order, e: Exception): StockEvidence[] {
  const ids = new Set<string>();
  for (const l of order.lines) {
    if (l.state !== "removed_post" && !order.voided) continue;
    const recipe = itemById[l.itemId].recipe ?? [];
    const main = [...recipe].sort((a, b) => ingredientById[b.ingredientId].cost * b.qty - ingredientById[a.ingredientId].cost * a.qty)[0];
    if (main) ids.add(main.ingredientId);
  }
  const out: StockEvidence[] = [];
  for (const ingredientId of ids) {
    const latest = counts
      .filter((c) => c.propertyId === e.propertyId && c.ingredientId === ingredientId && c.date <= e.date && c.date >= addDays(e.date, -10))
      .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    if (latest) out.push({ ingredientId, count: latest, variance: countVariance(latest), value: countVarianceValue(latest) });
  }
  return out;
}

/** The order is passed in when the caller fetched it; otherwise it is looked up in the dataset. */
export function explain(e: Exception, data: Dataset, counts: readonly CountRecord[], patterns: readonly Pattern[], fetched?: Order): Explanation {
  const currency = propertyById[e.propertyId].currency;
  const money = (n: number) => fmtMoney(n, currency, { decimals: n % 1 !== 0 });
  const order = fetched ?? (e.orderId ? data.ordersById.get(e.orderId) : undefined);
  const charge: RoomCharge | undefined = e.chargeId ? data.chargesById.get(e.chargeId) : undefined;
  const outlet = e.outletId ? outletById[e.outletId] : undefined;
  const from = addDays(e.date, -(POLICY.patternWindowDays - 1));
  const similarAtOutlet = data.exceptions.filter((x) => x.id !== e.id && x.outletId === e.outletId && x.type === e.type && x.date >= from && x.date <= e.date).length;
  const pattern = REMOVAL_TYPES.includes(e.type) ? patterns.find((p) => p.outletId === e.outletId && p.staffId === e.staffId) : undefined;
  const patternNote = pattern
    ? `${pattern.cases} of the ${pattern.outletCases} unapproved removals at ${outlet?.name} in the last ${POLICY.patternWindowDays} days were made under this POS login, ${Math.round(pattern.eveningShare * 100)}% of them after 6 PM. A login shows who was signed in to the terminal. It does not show who pressed the button.`
    : undefined;

  const base: Explanation = { whatHappened: e.headline, facts: [], possibleCauses: [], recommended: [], message: "", stock: [], patternNote, similarAtOutlet };

  if (charge && e.type.startsWith("room_charge")) {
    const posted = charge.posted.reduce((s, x) => s + x, 0);
    base.facts = [
      `${charge.description}: ${money(charge.expected)} for room ${charge.room}, recorded at ${fmtTime(charge.min)}.`,
      charge.posted.length === 0 ? "No matching line exists on the guest bill in the PMS." : `The guest bill shows ${charge.posted.length} matching line${charge.posted.length > 1 ? "s" : ""} totalling ${money(posted)}.`,
      "Sales are counted once, at the outlet. A room posting moves the amount to the guest bill and does not add revenue.",
    ];
    if (e.type === "room_charge_wrong_room") {
      base.facts.splice(1, 1, `The guest bill of room ${charge.room} has no matching line. The folio line for this charge is on room ${charge.folioRoom}.`);
      if (charge.checkoutMin !== undefined) base.facts.push(`Room ${charge.room} checked out on ${folioTime(charge.date, charge.checkoutMin)}.`);
      base.whatHappened = `A ${money(charge.expected)} charge for room ${charge.room} reached the guest bill of room ${charge.folioRoom}.`;
      base.possibleCauses = ["The room number was keyed by hand and two digits were swapped or one key was off.", "The guest gave a different room number, or moved rooms during the stay.", "The bill was signed in a hurry and the room number was hard to read."];
      base.recommended = [
        `Move the posting from room ${charge.folioRoom} to room ${charge.room} before room ${charge.folioRoom} checks out, so that guest is not billed for it.`,
        charge.checkoutMin !== undefined ? `Room ${charge.room} has checked out: ask the front office to charge the card on file, with the signed bill as support.` : `Post the charge to room ${charge.room} while the guest is still in house.`,
        "Record what was done here. The amount counts as recovered once it is on the right bill.",
      ];
      base.message = `The ${money(charge.expected)} charge signed to room ${charge.room} at ${fmtTime(charge.min)} reached the guest bill of room ${charge.folioRoom}. ${
        charge.checkoutMin !== undefined
          ? `Room ${charge.room} has already checked out, so please take it off room ${charge.folioRoom} and charge it to the card on file as a late charge.`
          : `Please move it to room ${charge.room} and check whether that guest has already checked out.`
      }`;
    } else if (e.type === "room_charge_after_checkout") {
      if (charge.checkoutMin !== undefined && charge.postedMin !== undefined) base.facts.push(`The guest checked out on ${folioTime(charge.date, charge.checkoutMin)}. The posting reached the bill on ${folioTime(charge.date, charge.postedMin)}.`);
      base.whatHappened = `A ${money(posted)} charge for room ${charge.room} reached the guest bill after the guest had checked out.`;
      base.possibleCauses = charge.source === "minibar"
        ? ["Housekeeping found the minibar used while servicing the room after departure.", "The minibar was not checked before the guest settled the bill."]
        : ["The posting waited in the interface queue between the till and the PMS.", "The guest settled the bill before the outlet closed the check."];
      base.recommended = [
        "Ask the front office to charge the card on file as a late charge, if the hotel's terms allow it.",
        "If the card cannot be charged, close this case as a loss so it is counted once.",
        charge.source === "minibar" ? "Check minibars in departure rooms before the guest reaches the front desk." : "Check the interface queue in the morning, before the busiest check-out hour.",
      ];
      base.message = `A ${money(posted)} charge for room ${charge.room} reached the bill after the guest checked out. Please post it to the card on file as a late charge, or tell me if it cannot be collected.`;
    } else if (e.type === "room_charge_missing") {
      base.whatHappened = `A ${money(charge.expected)} charge for room ${charge.room} was recorded but is not on the guest bill.`;
      base.possibleCauses = ["The interface between the POS and the PMS dropped the posting.", "The room number was entered incorrectly and the posting was rejected.", "The guest had already checked out when the charge was sent."];
      base.recommended = ["Check whether the guest is still in house.", "If so, post the charge to the room and note it here as recovered.", "If the guest has left, decide with the front office whether to bill the card on file."];
      base.message = `The charge of ${money(charge.expected)} was recorded at ${fmtTime(charge.min)} but no matching line reached the bill for room ${charge.room}. Please check whether the guest is still in house and post the charge before check-out.`;
    } else if (e.type === "room_charge_duplicate") {
      base.whatHappened = `The same ${money(charge.expected)} charge appears ${charge.posted.length} times on the bill for room ${charge.room}.`;
      base.possibleCauses = ["The posting was sent twice after an interface timeout.", "A manual posting was added on top of the automatic one."];
      base.recommended = ["Remove the extra posting before the guest checks out.", "Record the correction here. Removing a duplicate protects the guest and is not lost revenue."];
      base.message = `The guest bill for room ${charge.room} carries this charge ${charge.posted.length} times. One posting of ${money(charge.expected)} is expected. Please remove the extra line before check-out.`;
    } else {
      base.whatHappened = `The guest bill for room ${charge.room} shows ${money(posted)}. The recorded charge is ${money(charge.expected)}.`;
      base.possibleCauses = ["The amount was keyed manually and mistyped.", "A discount or service charge was applied on one side only."];
      base.recommended = ["Compare the outlet check with the guest bill line.", "Correct the posting and record the result here."];
      base.message = `The recorded charge is ${money(charge.expected)} but the guest bill shows ${money(posted)}. Please compare the two and correct the posting.`;
    }
    return base;
  }

  if (e.type === "bought_not_used" && e.boughtUsed && e.ingredientId) {
    const b = e.boughtUsed;
    const q = (n: number) => boughtQty(n, e.ingredientId!);
    const name = itemWords(e.ingredientId);
    const excess = b.excess ?? Math.max(0, b.gap - b.lastDelivery);
    // A hotel wide check has no outlet, so "similar cases at this outlet" does not apply.
    base.similarAtOutlet = 0;
    base.whatHappened = `${cap(q(b.gap))} more ${name} came in than the till and the waste log account for, over the 30 days to ${fmtDate(b.to)}.`;
    base.facts = [
      `${cap(q(b.bought))} received from suppliers in ${b.deliveries} deliver${b.deliveries === 1 ? "y" : "ies"}${b.movedIn > 0 ? `, and ${q(b.movedIn)} moved in from outside the hotel` : ""}.`,
      `${cap(q(b.sold))} used by the recipes of what was sold, including complimentary items.`,
      `${cap(q(b.waste))} logged as waste or breakage${b.movedOut > 0 ? `, and ${q(b.movedOut)} moved out for use outside the till` : ""}.`,
      `That leaves ${q(b.gap)}, ${Math.round(b.share * 100)}% of what was used.`,
      `The last delivery brought ${q(b.lastDelivery)}, which may still be on the shelf. The ${q(excess)} beyond it are worth about ${fmtMoney(Math.round(e.exposure), currency)} at the price paid.`,
    ];
    base.possibleCauses = BOUGHT_USED_CAUSES.map((c) => c.title);
    base.recommended = [`Count ${name} in every store and bar.`, ...BOUGHT_USED_CAUSES.slice(1).map((c) => c.check)];
    base.message = `Over the last 30 days the hotel received ${q(b.bought)} of ${name} and the records account for ${q(b.used)}. The difference of ${q(b.gap)} is an estimate until a count confirms it. Please count it, and check whether it goes into anything the till has no recipe for.`;
    return base;
  }

  if (e.type === "cheaper_item_rung" && e.mix) {
    const m = e.mix;
    const l = mixLabelById[m.labelId];
    const where = outlet?.name ?? propertyById[e.propertyId].name;
    const premium = l.name;
    const cheap = cheapName(l);
    const n = m.bottles * m.perBottle;
    const value = fmtMoney(Math.round(mixValue(m)), currency);
    const wine = m.rule === "premium";
    base.whatHappened = wine
      ? `In the 7 days to ${fmtDate(m.to)}, ${m.bottles} bottles of ${l.name} went to ${where}, enough for about ${n} glasses. ${m.billed} were billed as reserve, while ${m.cheapBilled} glasses of ${cheap} were billed.`
      : `In the 7 days to ${fmtDate(m.to)}, ${m.bottles} bottles of ${l.name} went to ${where}, enough for about ${n} single measures. The bills account for ${m.billed}, with ${m.cheapBilled} singles.`;
    base.facts = [
      `${m.bottles} full bottles were issued to the bar for empties handed back, against ${m.before.bottles} a week on average in the weeks before.`,
      wine ? `Each bottle gives about ${m.perBottle} glasses of 150 ml.` : `Each bottle gives about ${m.perBottle} single measures of 50 ml. A double counts as two.`,
      wine ? `${m.billed} glasses of ${premium} were billed, against ${m.before.billed} a week before.` : `${m.billed} measures were billed, against ${m.before.billed} a week before.`,
      wine ? `${m.cheapBilled} glasses of ${cheap} were billed at the same bar, against ${m.before.cheapBilled} a week before.` : `${m.cheapBilled} singles were billed, against ${m.before.cheapBilled} a week before.`,
      `That leaves about ${m.gap} ${l.unit} the bills do not account for, worth about ${value} at the ${fmtMoney(m.priceGap, currency)} difference per serve. An estimate.`,
    ];
    base.possibleCauses = wine
      ? [`${premium} rung on the ${cheap} key.`, `${l.name} poured for ${cheap} when the house bottle ran out at the bar.`, "Glasses poured and not rung up at all.", "Bottles opened for a tasting or an event billed somewhere else."]
      : ["Doubles rung on the single key.", "Measures poured by hand, larger than the standard.", "Gin used for cocktails rung on another key."];
    base.recommended = [
      "Count the open and full bottles at the bar, to confirm the week.",
      wine ? `Ask the bar team which key they use for ${premium}.` : "Ask the bar team how they ring a double.",
      "Check whether any bottles went to an event or a tasting.",
      "If the bills were right, close as a legitimate correction. If not, record the amount as a loss.",
    ];
    base.message = wine
      ? `${m.bottles} bottles of ${l.name} went to the bar in the 7 days to ${fmtDate(m.to)}, enough for about ${n} glasses, and ${m.billed} were billed as reserve. The ${m.gap} glasses not billed as reserve are about ${value} at the difference to ${cheap}, an estimate. Please count the bar's bottles and check which key the team uses for the reserve.`
      : `${m.bottles} bottles of ${l.name} went to the bar in the 7 days to ${fmtDate(m.to)}, about ${n} single measures, and the bills account for ${m.billed}. The ${m.gap} measures not billed are about ${value} if they were doubles rung as singles, an estimate. Please count the bar's bottles and check how the team rings a double.`;
    return base;
  }

  if (e.type === "breakfast_not_charged" && e.breakfast) {
    const b = e.breakfast;
    const where = outlet?.name ?? propertyById[e.propertyId].name;
    const value = fmtMoney(e.exposure, currency);
    const n = breakfastCount(b.notCharged);
    base.whatHappened = `Room ${b.room} was ticked in at breakfast at ${fmtTime(b.min)} with ${guestCount(b.guests)}. Not charged: ${breakfastCount(b.notCharged)}.`;
    base.facts = [
      `The breakfast list at ${where} shows room ${b.room}, ${guestCount(b.guests)}, ticked in at ${fmtTime(b.min)}.`,
      b.rate
        ? `Last night's in-house list in the PMS has room ${b.room} with ${guestCount(b.registered)} registered. Rate: ${rateName(b.rate)}. ${b.included > 0 ? `Breakfast is in the rate for ${guestCount(b.included)}, so ${breakfastCount(b.toCharge)} to charge.` : "Breakfast is not in the rate."}`
        : `Room ${b.room} is not on last night's in-house list in the PMS, so no rate covers the breakfast.`,
      b.charged.length ? `Charged or paid that morning: ${breakfastCount(b.toCharge - b.notCharged)}, on bill ${b.charged.map((x) => x.orderId).join(" and ")}.` : `No breakfast bill was charged to room ${b.room} that morning.`,
      nearbyBreakfastFact(b),
      `The breakfast price that morning was ${fmtMoney(b.price, currency)}, so ${n} ${b.notCharged === 1 ? "is" : "are"} ${value}.`,
      b.staysOn ? `Room ${b.room} is on the in-house list again that night: the guest had not checked out.` : `Room ${b.room} is not on that night's in-house list: the guest checked out that day.`,
    ];
    base.possibleCauses = [
      "The guest paid at the table and the bill was opened under another room or a table number.",
      "The host ticked the wrong room on the list.",
      "A manager offered the breakfast and it was not recorded.",
      "The breakfast was served and never rung up.",
    ];
    base.recommended = [
      `Ask the breakfast host whether room ${b.room} came down, and how the guests paid.`,
      b.staysOn ? `If the guest had breakfast, post ${n} to room ${b.room} before check-out, with the guest's agreement.` : `The guest has checked out: ask the front office whether ${n} can go on the card on file, with the guest's agreement.`,
      "If a bill is found, or a rate with breakfast covers the room, close as a legitimate correction. If the breakfast is posted, record it as recovered; if it cannot be charged, as a loss.",
    ];
    base.message = `Room ${b.room} was ticked in at breakfast at ${where} at ${fmtTime(b.min)} with ${guestCount(b.guests)}, ${b.included > 0 ? `on a rate with breakfast for ${guestCount(b.included)}` : "on a rate without breakfast"}. Tyll found ${n} not charged to the room or paid at the table: ${value} at the breakfast price. Please check with the breakfast host${b.staysOn ? " and post it to the room before check-out" : ""}.`;
    return base;
  }

  if (e.type === "seated_no_bill" && e.booking) {
    const b = e.booking;
    const where = outlet?.name ?? propertyById[e.propertyId].name;
    const meal = SERVICE_LABEL[b.service].toLowerCase();
    const value = fmtMoney(e.exposure, currency);
    const stay = b.leftMin === undefined ? null : fmtStay(b.leftMin - b.seatedMin);
    base.whatHappened = `A booking for ${b.party} was seated at ${b.table} at ${fmtTime(b.seatedMin)}${stay ? ` and stayed ${stay}` : ""}. No bill was found for the table.`;
    base.facts = [
      `The reservation book shows booking ${b.bookingId}, for ${b.party} at ${fmtTime(b.bookedFor)}, made ${VIA_LABEL[b.via]}${b.room ? ` by the guest in room ${b.room}` : ""}.`,
      b.leftMin === undefined ? `The host marked it seated at ${b.table} at ${fmtTime(b.seatedMin)}. No finish time was recorded.` : `The host marked it seated at ${b.table} at ${fmtTime(b.seatedMin)} and the table finished at ${fmtTime(b.leftMin)}.`,
      `No bill at ${b.table} was opened between ${fmtTime(b.from)} and ${fmtTime(b.to)}.${b.atTable.length ? (b.atTable.length === 1 ? " The table had 1 other bill that day, outside that time." : ` The table had ${b.atTable.length} other bills that day, all outside that time.`) : ""}`,
      nearbyFact(b, where),
      `The ${meal} spend per guest at ${where} over the ${COVER_RULES.spendDays} days before was ${fmtMoney(b.spendPerGuest, currency)}, so ${b.party} guests are about ${value}. An estimate.`,
    ];
    base.possibleCauses = [
      "The party joined another table and paid on its bill.",
      "The host marked the wrong booking as seated, or the party sat at a different table.",
      "The bill was opened under another table number.",
      "The meal was served and never billed, or the party left without paying.",
    ];
    base.recommended = [
      `Ask the host and the server for that section where the party sat and which bill they paid.`,
      `Look for a bill around ${fmtTime(b.seatedMin)} with more guests than its own booking.`,
      ...b.nearby.filter((o) => o.matchedTo && sameParty(o.covers, b.party)).slice(0, 2).map((o) => `Bill ${o.orderId}, for ${guestWords(o.covers)} at ${o.table}, is matched to booking ${o.matchedTo}. Ask the host which of the two bookings sat there.`),
      ...(b.room ? [`The booking was made by the guest in room ${b.room}. If the guest is still in house and dined, the front office can add the meal to the room with the guest's agreement.`] : []),
      "If a bill is found, close as a legitimate correction. If the meal was served and not billed, record the amount as a loss, or as recovered if it is paid.",
    ];
    base.message = `At ${where}, a booking for ${b.party} was seated at ${b.table} ${b.leftMin === undefined ? `at ${fmtTime(b.seatedMin)}` : `from ${fmtTime(b.seatedMin)} to ${fmtTime(b.leftMin)}`}, and Tyll found no bill for the table, nor an unmatched bill for a party of that size nearby. That is about ${value} at the ${meal} spend per guest, an estimate. Please check with the host and the server whether the party paid on another bill.`;
    return base;
  }

  if (e.type === "stock_shortfall") {
    const count = counts.find((c) => c.id === e.countId);
    if (!count) return base;
    const g = ingredientById[count.ingredientId];
    const variance = countVariance(count);
    const value = countVarianceValue(count);
    const share = Math.abs(value) > 0 ? e.exposure / Math.abs(value) : 1;
    base.stock = [{ ingredientId: count.ingredientId, count, variance, value }];
    base.facts = [
      `On ${fmtDate(count.date, true)} ${fmtQty(count.counted, g.unit)} of ${g.name} was counted against ${fmtQty(count.expected, g.unit)} expected.`,
      `Expected stock is the previous count plus deliveries, less recipe use, recorded waste and transfers.`,
      share < 0.999
        ? `${outlet?.name} used ${Math.round(share * 100)}% of this item in the week before the count, so ${money(e.exposure)} of the ${money(Math.abs(value))} shortfall is charged to it.`
        : `The full ${money(e.exposure)} is charged to ${outlet?.name}.`,
    ];
    base.possibleCauses = [
      "Waste, spillage or breakage that was not logged.",
      "Portions larger than the recipe, or a recipe that is out of date.",
      "A delivery recorded for more than arrived, or a transfer not recorded.",
      "A counting error, in this count or the one before.",
      "Stock taken without a sale.",
    ];
    base.recommended = [
      `Recount ${g.name} to rule out a counting error.`,
      "Check the delivery notes and transfers since the previous count.",
      "Compare portioning in the kitchen with the recipe.",
      "Ask the team whether any waste went unrecorded, and log it if so.",
    ];
    base.message = `${g.name} at ${outlet?.name ?? propertyById[e.propertyId].name} was ${fmtQty(Math.abs(variance) * share, g.unit)} short at the ${fmtDate(count.date)} count, worth ${money(e.exposure)}. Please recount the item and check deliveries, waste and portioning before recording an outcome.`;
    return base;
  }

  if (!order) return base;
  const t = orderTotals(order);
  const removed = order.lines.filter((l) => l.state === "removed_post" && !l.approvedBy);
  base.stock = stockEvidence(data, counts, order, e);
  if (base.stock.length > 0) {
    const s = base.stock[0];
    const g = ingredientById[s.ingredientId];
    base.stockNote =
      s.variance < 0
        ? `The last count of ${g.name} at ${propertyById[e.propertyId].name} was ${fmtQty(Math.abs(s.variance), g.unit)}${g.unit === "each" ? " units" : ""} short of expected (${money(Math.abs(s.value))}). That is consistent with items leaving stock without a sale, but it cannot show that this particular item was served.`
        : `The last count of ${g.name} matched expected stock, so stock records neither support nor rule out that this item was served.`;
  }

  const opened = `Order ${order.id} opened at ${fmtTime(order.openMin)} on ${order.table.toLowerCase()} under POS login ${login(order.staffId)}, for ${order.covers} guest${order.covers === 1 ? "" : "s"}.`;
  const paidBy = order.payment === "room" ? `charged to room ${order.room}` : `paid by ${order.payment}`;

  if (e.type === "bill_reopened" && order.reopened) {
    const r = order.reopened;
    const drop = r.paid - t.net;
    const taken = order.lines.filter((l) => l.state === "removed_post" && (l.removedMin ?? 0) >= r.min);
    const what = taken.map((l) => `${l.qty} × ${itemById[l.itemId].name}`).join(" and ");
    const after = r.min - order.closeMin;
    base.whatHappened = `The bill was ${paidBy} at ${fmtTime(order.closeMin)} for ${money(r.paid)}, reopened ${after} minutes later and closed again at ${money(t.net)}: ${money(drop)} less than the guests paid.`;
    base.facts = [
      opened,
      `${cap(paidBy)} at ${fmtTime(order.closeMin)}: ${money(r.paid)}.`,
      `Reopened at ${fmtTime(r.min)} under POS login ${login(r.by)}.${what ? ` ${cap(what)} taken off at ${fmtTime(taken[0].removedMin ?? r.min)}.` : ""}`,
      ...taken.filter((l) => l.completedMin !== undefined && l.completedMin <= order.closeMin).map((l) => `The kitchen display marked ${itemById[l.itemId].name} ready at ${fmtTime(l.completedMin!)}, before the guests paid.`),
      `Closed again at ${fmtTime(r.closedMin)} for ${money(t.net)}. Reason recorded: ${r.reason ?? "none"}. Approval recorded: ${login(r.approvedBy)}.`,
    ];
    base.possibleCauses = [
      "A dish was sent back after payment and taken off without asking a manager.",
      "The bill was rung for the wrong table and corrected late.",
      "The items were served and paid for, and then taken off the bill.",
    ];
    base.recommended = [
      "Ask the manager on duty whether a dish was sent back and agreed to come off.",
      order.payment === "cash" ? "Compare the cash count for the shift with what the guests paid, not with the bill as it is now." : "Compare the payment record with the bill as it is now.",
      "If the change was agreed, add the approval and close as a legitimate correction. If not, record the amount as a loss.",
    ];
    base.message = `This bill was ${paidBy} for ${money(r.paid)} at ${fmtTime(order.closeMin)} and reopened ${after} minutes later.${what ? ` ${cap(what)} came off and` : ""} it closed again at ${money(t.net)}, with no reason or approval recorded. Please check whether the change was agreed with a manager.`;
    return base;
  }

  if (e.type === "price_override") {
    const line = order.lines.find((l) => l.state === "kept" && belowMenu(l) && !l.till?.approvedBy);
    if (!line?.till) return base;
    const item = itemById[line.itemId];
    const how = { open_item: "an open item", misc: "the misc button", override: "a price changed by hand" }[line.till.kind];
    const below = Math.round((1 - line.unitPrice / line.till.menuPrice) * 100);
    base.whatHappened = `${line.qty} × ${item.name} ${line.qty === 1 ? "was" : "were"} charged at ${money(line.unitPrice)} each through ${how}. The menu price is ${money(line.till.menuPrice)}.`;
    base.facts = [
      opened,
      `The ${item.station} ticket shows ${line.qty} × ${item.name}.`,
      `Menu price ${money(line.till.menuPrice)} each. Charged ${money(line.unitPrice)} each, ${below}% below.`,
      `Reason recorded: ${line.till.reason ?? "none"}. Approval recorded: ${login(line.till.approvedBy)}.`,
      `The guest ${paidBy === "paid by card" || paidBy === "paid by cash" ? `paid ${money(t.net)}` : `was charged ${money(t.net)}`} at ${fmtTime(order.closeMin)}.`,
    ];
    base.possibleCauses = ["A price agreed with the guest at the table and not recorded.", "The item is missing from the till's menu, so it was rung by hand.", "The wrong price was typed."];
    base.recommended = [
      "Ask the manager on duty whether the price was agreed.",
      "If the item is missing from the till's menu, add it so it is not rung by hand again.",
      "If it was agreed, add the approval and close as a legitimate correction. If not, record the difference as a loss.",
    ];
    base.message = `${item.name} was charged at ${money(line.unitPrice)} through ${how}, ${below}% below the menu price of ${money(line.till.menuPrice)}, with no approval recorded. Please check whether the price was agreed.`;
    return base;
  }

  if (e.type === "duplicate_ring") {
    const ring = ringFinding(order);
    if (!ring) return base;
    const guests = `${order.covers} guest${order.covers === 1 ? "" : "s"}`;
    if (ring.kind === "twice") {
      const item = itemById[ring.second.itemId];
      const ready = order.lines.filter((l) => l.itemId === item.id && l.state === "kept" && l.completedMin !== undefined).length;
      base.whatHappened = `${item.name} was entered twice, ${ring.seconds} seconds apart. ${ringOnBill(order, ring) === ring.total ? "The bill charges" : "Those entries charge"} for ${ring.total} and the table had ${guests}.`;
      base.facts = [
        opened,
        `First entry at ${fmtClock(ring.first.enteredMin, ring.first.enteredSec)}, second at ${fmtClock(ring.second.enteredMin, ring.second.enteredSec)}.`,
        item.station === "kitchen" ? `The kitchen display marked ${ready} of the entries ready.` : "The bar has no completion screen, so there is no record of how many were poured.",
        `The guest ${paidBy === "paid by card" || paidBy === "paid by cash" ? "paid" : "was charged"} ${money(t.net)} at ${fmtTime(order.closeMin)}, ${money(lineValue(ring.second))} of it for the second entry.`,
      ];
      base.possibleCauses = ["The button was pressed twice, and the guest was charged for one too many.", "Two were ordered and entered one after the other.", "One entry was meant for another table."];
      base.message = `${item.name} was entered twice within ${ring.seconds} seconds on a bill for ${guests}. Please check how many were served, and refund the guest if one was charged in error.`;
    } else {
      const l = ring.line;
      const item = itemById[l.itemId];
      base.whatHappened = `${l.qty} × ${item.name} were rung in one entry, on a bill for ${guests}.`;
      base.facts = [
        opened,
        `${l.qty} × ${item.name} entered at ${fmtTime(l.enteredMin)} in one line, ${money(lineValue(l))}.`,
        `The rule looks at ${POLICY.quantityMin} or more of one item at more than ${POLICY.quantityPerGuest} a guest.`,
        `The guest ${paidBy === "paid by card" || paidBy === "paid by cash" ? "paid" : "was charged"} ${money(t.net)} at ${fmtTime(order.closeMin)}.`,
      ];
      base.possibleCauses = ["A quantity keyed by mistake, such as 12 for 2.", "A round for a larger party rung on this table.", "Items for another table or for staff rung here."];
      base.message = `${l.qty} × ${item.name} were rung in one entry on a bill for ${guests}. Please check how many were served, and refund the guest if the quantity was keyed in error.`;
    }
    base.recommended = [
      "Ask the team on shift how many were served.",
      "If the guest was charged for too many, refund the difference to the guest and note the refund here.",
      "Close as a legitimate correction either way. The value is what the guest was charged, so a refund is not money recovered.",
    ];
    return base;
  }

  if (REMOVAL_TYPES.includes(e.type) && removed.length > 0) {
    const first = removed[0];
    const item = itemById[first.itemId];
    const wait = (first.removedMin ?? 0) - (first.sentMin ?? 0);
    const station = item.station;
    const what = removed.map((l) => itemById[l.itemId].name).join(" and ");
    const prepared = e.type === "prepared_not_charged";
    base.whatHappened = `${what} ${removed.length > 1 ? "were" : "was"} removed from the bill ${wait} minutes after the preparation ticket was sent to the ${station}. The final bill does not include ${removed.length > 1 ? "them" : "it"}.`;
    base.facts = [
      `Order ${order.id} opened at ${fmtTime(order.openMin)} on ${order.table.toLowerCase()} with items worth ${money(t.original)}.`,
      `The ${station} ticket for ${what} printed at ${fmtTime(first.sentMin ?? 0)}.`,
      prepared ? `The kitchen display marked it ready at ${fmtTime(first.completedMin ?? 0)}, before it was removed.` : station === "bar" ? "The bar has no completion screen, so there is no record of whether the drink was made." : "The kitchen display has no completion record for it.",
      `It was removed at ${fmtTime(first.removedMin ?? 0)} under POS login ${login(first.removedBy)}. Reason recorded: none. Approval recorded: none.`,
      `The guest paid ${money(t.net)} at ${fmtTime(order.closeMin)}. The removed value is ${money(t.removedPost)}.`,
    ];
    base.possibleCauses = [
      "The guest cancelled the item before it was made, and the removal was not given a reason.",
      "The item was made, could not be served, and was not logged as waste.",
      "The item was served and left off the bill.",
      "The item was entered by mistake and corrected late.",
    ];
    base.recommended = [
      `Ask the ${station} team on shift whether the item was ${station === "bar" ? "poured" : "prepared"} and where it went.`,
      "Check whether a supervisor approved the removal verbally.",
      "If it was wasted, log it in Stock Count and Waste so the count matches. If it was served, record the loss or the amount recovered.",
    ];
    base.message = `The ${item.name === "Coca-Cola" ? "Coke" : what} was removed from the customer's bill ${wait === 6 ? "six" : wait} minutes after the preparation ticket was sent to the ${station}. The final bill does not include the ${item.dept === "beverage" ? "drink" : "item"}. Please verify whether the item was prepared or served and whether the cancellation was authorized.`;
    return base;
  }

  if (e.type === "unexplained_void") {
    base.whatHappened = `The whole order, worth ${money(t.original)}, was voided at ${fmtTime(order.voided!.min)} after its items had been sent for preparation.`;
    base.facts = [
      `Order ${order.id} opened at ${fmtTime(order.openMin)} on ${order.table.toLowerCase()} under POS login ${login(order.staffId)}.`,
      `${order.lines.length} item${order.lines.length > 1 ? "s were" : " was"} sent for preparation.`,
      `Void reason recorded: ${order.voided!.reason ?? "none"}. Approval recorded: ${login(order.voided!.approvedBy)}.`,
      "No payment was taken.",
    ];
    base.possibleCauses = ["The guests left before paying.", "The order was a duplicate of another check.", "The order was served and closed without payment."];
    base.recommended = ["Look for a second check on the same table at the same time.", "Ask the shift supervisor why the void was not approved.", "If the food was made and not served, log it as waste."];
    base.message = `The order was voided after ${order.lines.length} item${order.lines.length > 1 ? "s" : ""} had been sent for preparation, with no ${order.voided!.reason ? "approval" : "reason or approval"} recorded. Please confirm whether the items were served and why the order was voided.`;
    return base;
  }

  if (e.type === "unusual_refund" && order.refund) {
    const billed = t.net + t.refunds;
    const late = order.refund.min - order.closeMin;
    base.whatHappened = `${money(order.refund.amount)} of a ${money(billed)} bill was refunded ${late} minutes after payment.`;
    base.facts = [
      `Order ${order.id} was paid by ${order.payment} at ${fmtTime(order.closeMin)}.`,
      `The refund was issued at ${fmtTime(order.refund.min)}. Reason recorded: ${order.refund.reason ?? "none"}. Approval recorded: ${login(order.refund.approvedBy)}.`,
      `Policy asks for a reason and a manager approval on refunds above ${Math.round(POLICY.refundMaxShare * 100)}% of a bill.`,
    ];
    base.possibleCauses = ["A genuine complaint handled without recording the reason.", "A double charge corrected by refund.", "A refund issued after the guest had left."];
    base.recommended = ["Match the refund to the card terminal record.", "Ask the manager on duty whether they approved it.", "If the refund was valid, add the reason and close as a legitimate correction."];
    base.message = `A refund of ${money(order.refund.amount)} was issued ${late} minutes after the guest paid, ${order.refund.reason ? "without a recorded approval" : "with no reason recorded"}. Please confirm who approved it and that it reached the guest.`;
    return base;
  }

  if (e.type === "unusual_discount") {
    base.whatHappened = `A ${order.discountPct}% discount (${money(t.discounts)}) was applied to this bill.`;
    base.facts = [
      `Order ${order.id} was closed at ${fmtTime(order.closeMin)} under POS login ${login(order.staffId)}.`,
      `Discount reason recorded: ${order.discountReason ?? "none"}. Approval recorded: ${login(order.discountApprovedBy)}.`,
      `Policy allows discounts up to ${POLICY.discountMaxPct}% with a reason and an approval.`,
    ];
    base.possibleCauses = ["An agreed offer applied without its reason code.", "A goodwill gesture not approved at the time.", "The wrong discount key was pressed."];
    base.recommended = ["Ask the manager on duty whether the discount was agreed.", "If it was, add the reason and close as a legitimate correction.", "If not, record the amount as a loss."];
    base.message = `A ${order.discountPct}% discount worth ${money(t.discounts)} was applied with ${!order.discountReason ? "no reason" : "no approval"} recorded. Please confirm whether it was agreed.`;
    return base;
  }

  if (e.type === "excessive_comp") {
    const comped = order.lines.filter((l) => l.state === "comped");
    const what = comped.map((l) => itemById[l.itemId].name).join(", ");
    base.whatHappened = `${what} (${money(t.comps)}) was given free of charge on this order.`;
    base.facts = [
      `Order ${order.id} was closed at ${fmtTime(order.closeMin)} under POS login ${login(order.staffId)}.`,
      `Reason recorded: ${comped[0].reason ?? "none"}. Approval recorded: ${login(comped[0].approvedBy)}.`,
      `Complimentary items above ${money(POLICY.compMaxValue)} per order need a manager's approval.`,
    ];
    base.possibleCauses = ["Service recovery agreed by a manager and not recorded.", "A guest of the hotel whose bill should go to a house account.", "An item given away without agreement."];
    base.recommended = ["Confirm with the manager on duty.", "If agreed, add the reason and approval, then close as a legitimate correction."];
    base.message = `${what} worth ${money(t.comps)} was marked complimentary ${comped[0].reason ? "above the approval limit" : "with no reason recorded"}. Please confirm who agreed it.`;
    return base;
  }
  return base;
}
