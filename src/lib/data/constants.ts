import { DEMO_TODAY, rel } from "../util";

const mmdd = (iso: string) => `${iso.slice(5, 7)}${iso.slice(8, 10)}`;
/** The worked example used in the guided demo: a Coke removed from a bill after it was sent to the bar. Tonight's order. */
export const HERO_ORDER_ID = `MER-${mmdd(DEMO_TODAY)}-198`;
export const HERO_EXCEPTION_ID = `EX-${HERO_ORDER_ID}`;
/** Yesterday's meat invoice, billed for 4 kg of beef that did not arrive. */
export const HERO_INVOICE_ID = `INV-LIS-${mmdd(rel(-1))}-MEAT`;
/**
 * The room charge worked example: last night's dinner for three at Mercado, signed to room 1412. The posting reached the
 * guest folio of room 1421, and room 1412 checked out this morning without it.
 */
export const ROOM_STORY_ORDER_ID = `MER-${mmdd(rel(-1))}-299`;
export const ROOM_STORY_CHARGE_ID = `RC-${ROOM_STORY_ORDER_ID}`;
export const ROOM_STORY_EXCEPTION_ID = `EX-${ROOM_STORY_CHARGE_ID}`;
export const ROOM_STORY = { room: "1412", folioRoom: "1421", checkoutMin: 24 * 60 + 10 * 60 + 12 } as const;
/**
 * Bought against used: Coca-Cola for the whole hotel. For about a month a standing order has added three cases (72 cans)
 * to every drinks delivery, and sales did not follow. The cases sit in the main store, where the weekly counts find them,
 * so the right answer to the flag is "Counted: the stock is on the shelf", and to order less. The check flags it every day.
 */
export const BOUGHT_STORY = { ingredientId: "coke", extraPerDelivery: 72, fromDay: -24 } as const;
export const BOUGHT_STORY_EXCEPTION_ID = `EX-BU-LIS-COKE-${mmdd(DEMO_TODAY)}`;
/**
 * Drinks per guest by waiter: on evening shifts at Mercado, Rahul Okafor (POS login MER-S1) sells fewer drinks than the
 * colleagues on the same shifts, and more of his tables have food on the bill and no drink. On day shifts he sells like
 * everyone else, which is why the comparison is made shift by shift. Built by moving whole bills between logins within
 * the same evening (`waiterStory` in generate.ts), so no sale, total or stock figure changes. `share` is the part of his
 * evening bills with drinks that are swapped for a colleague's bill with food and no drink.
 */
export const WAITER_STORY = { outletId: "lis-terrace", staffId: "MER-S1", shift: "evening", share: 0.4 } as const;
/**
 * Till rules (overnight feature 5). The worked example: last night at Mercado a table of three paid cash at 10:07 PM; the
 * bill was reopened at 10:31 PM under the same login, two lamb chops came off, and it closed again lower, with no
 * manager's approval. Built as its own bill (`tillStoryOrder` in generate.ts), so no other record moves.
 */
export const TILL_STORY_ORDER_ID = `MER-${mmdd(rel(-1))}-301`;
export const TILL_STORY_EXCEPTION_ID = `EX-${TILL_STORY_ORDER_ID}`;
/**
 * Cheaper item rung up: in the last seven closed days Bar Azulejo poured about three glasses a day of the Douro reserve red
 * that were not billed as reserve, while house wine went on the bills. `extraPerDay` glasses a day go into the bottles
 * issued to the bar and not into the sales. Historic: five weeks ago, gin doubles rung as singles, since checked and closed.
 */
export const MIX_STORY = { outletId: "lis-lobby", labelId: "reserve", extraPerDay: 3, days: 7 } as const;
export const MIX_STORY_EXCEPTION_ID = `EX-MIX-AZU-RESERVE-${mmdd(rel(-1))}`;
export const MIX_HISTORY = { outletId: "lis-lobby", labelId: "gin", extraPerDay: 5, week: 5 } as const;
/**
 * Two bills from two days ago for the other till rules, already checked by a manager: two salmon dinners at a price changed
 * by hand at In-Room Dining (a loss), and twelve cappuccinos on a bill for two guests at Bar Azulejo (colleagues had
 * joined the table: everything was served, a legitimate correction).
 */
export const TILL_PRICE_ORDER_ID = `IRD-${mmdd(rel(-2))}-301`;
export const TILL_RING_ORDER_ID = `AZU-${mmdd(rel(-2))}-301`;
export const TILL_EXAMPLE_EXCEPTION_IDS = [`EX-${TILL_PRICE_ORDER_ID}`, `EX-${TILL_RING_ORDER_ID}`];
