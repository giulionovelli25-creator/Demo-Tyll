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
/**
 * Late delivery prediction: today's meat delivery from Carnes Ribeiro & Filhos came with no Wagyu mince (not charged);
 * the 5 kg are owed with tomorrow's delivery, which the supplier's record says is likely to be late. Mercado's chef also
 * threw away the Wagyu from the fridge that lost temperature this afternoon, which leaves about `tonight` kg for tomorrow.
 */
export const WAGYU_STORY = { ingredientId: "wagyu", supplierId: "meat", backupId: "meat-alt", owed: 5, tonight: 2.4 } as const;
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
/**
 * Booked against billed covers (overnight feature 6). The worked example: last night at Mercado a booking for four, made
 * by phone by the guest in room 1108, was seated at 8:12 PM and marked finished at 10:04 PM, and no bill was opened at its
 * table that evening, nor for a party of that size anywhere near the time. The table is the first of `tables` with no
 * bill near the time (bills pick their tables at random). The checked example, two days ago at lunch: a booking for four
 * with no bill at its table; the guests had joined colleagues already seated and paid on their bill (legitimate). Both
 * parties are larger than any walk-in bill at Mercado, so no bill nearby can be theirs.
 */
export const COVERS_STORY = { outletId: "lis-terrace", date: -1, party: 4, bookedFor: 20 * 60, seatedMin: 20 * 60 + 12, leftMin: 22 * 60 + 4, room: "1108", tables: [31, 27, 35, 23, 39, 19, 11, 6] } as const;
export const COVERS_EXAMPLE = { outletId: "lis-terrace", date: -2, party: 4, bookedFor: 13 * 60, seatedMin: 13 * 60 + 5, leftMin: 14 * 60 + 18, tables: [12, 16, 8, 29, 33, 4] } as const;
export const COVERS_STORY_BOOKING_ID = `BK-MER-${mmdd(rel(-1))}-90`;
export const COVERS_STORY_EXCEPTION_ID = `EX-${COVERS_STORY_BOOKING_ID}`;
export const COVERS_EXAMPLE_BOOKING_ID = `BK-MER-${mmdd(rel(-2))}-90`;
export const COVERS_EXAMPLE_EXCEPTION_ID = `EX-${COVERS_EXAMPLE_BOOKING_ID}`;
/**
 * Hotel guests against outlet charges (overnight feature 7). The worked example: this morning at Mercado the breakfast
 * host ticked room 1517 in, one guest on an advance purchase, room only rate. No breakfast was charged to the
 * room and no breakfast bill was paid at the table near the time (the first of `times` with none in the window); the guest stays tonight, so it can still go on the room.
 * One guest, because the public demo's flagged bills sit just under the Overview's money lost story (a test pins them).
 * The room is the first of `rooms` with no breakfast bill charged to it that morning, the time the first of `times` with no
 * breakfast bill paid at the table near it. The checked example, two days ago: room 1204, registered for two on a rate
 * with breakfast, came to breakfast with three; the third breakfast was posted to the room before check-out (recovered).
 */
export const BREAKFAST_STORY = { date: 0, guests: 1, registered: 1, rate: "ADV-RO", rooms: ["1517", "1519", "1611", "1406", "1722", "1315"], times: [7 * 60 + 42, 7 * 60 + 18, 8 * 60 + 5, 6 * 60 + 55, 9 * 60 + 12, 9 * 60 + 40] } as const;
export const BREAKFAST_EXAMPLE = { date: -2, guests: 3, registered: 2, rate: "BAR-BB", rooms: ["1204", "1208", "1311", "1702"], times: [8 * 60 + 20, 8 * 60 + 45, 7 * 60 + 50, 9 * 60 + 5] } as const;
export const BREAKFAST_STORY_VISIT_ID = `BF-MER-${mmdd(DEMO_TODAY)}-900`;
export const BREAKFAST_STORY_EXCEPTION_ID = `EX-${BREAKFAST_STORY_VISIT_ID}`;
export const BREAKFAST_EXAMPLE_VISIT_ID = `BF-MER-${mmdd(rel(-2))}-900`;
export const BREAKFAST_EXAMPLE_EXCEPTION_ID = `EX-${BREAKFAST_EXAMPLE_VISIT_ID}`;
