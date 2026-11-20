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
 * Bought against used: Coca-Cola for the whole hotel. For the three weeks before the last full count every drinks
 * delivery brought two more cases than the bars needed, and sales did not follow. The check flags it every day.
 */
export const BOUGHT_STORY = { ingredientId: "coke", extraPerDelivery: 48, fromDay: -24 } as const;
export const BOUGHT_STORY_EXCEPTION_ID = `EX-BU-LIS-COKE-${mmdd(DEMO_TODAY)}`;
