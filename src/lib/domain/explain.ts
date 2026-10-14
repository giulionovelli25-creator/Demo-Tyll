// Builds the investigation explanation from recorded facts.
// In this demo the wording is assembled by rules, not by a language model, and it is labelled that way on screen.
import { ingredientById, itemById, outletById, propertyById, staffById } from "../data/catalog";
import type { Dataset } from "../data/generate";
import type { CountRecord, Exception, Order, RoomCharge } from "../types";
import { addDays, fmtDate, fmtMoney, fmtQty, fmtTime } from "../util";
import { POLICY, REMOVAL_TYPES, type Pattern } from "./detect";
import { countVariance, countVarianceValue } from "./inventory";
import { orderTotals } from "./orders";

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
    if (e.type === "room_charge_missing") {
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
      "If it was wasted, log it in Tyll Stock so the count matches. If it was served, record the loss or the amount recovered.",
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
