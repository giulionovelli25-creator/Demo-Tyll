import { DEMO_TODAY, rel } from "../util";

const mmdd = (iso: string) => `${iso.slice(5, 7)}${iso.slice(8, 10)}`;
/** The worked example used in the guided demo: a Coke removed from a bill after it was sent to the bar. Tonight's order. */
export const HERO_ORDER_ID = `MER-${mmdd(DEMO_TODAY)}-198`;
export const HERO_EXCEPTION_ID = `EX-${HERO_ORDER_ID}`;
/** Yesterday's meat invoice, billed for 4 kg of beef that did not arrive. */
export const HERO_INVOICE_ID = `INV-LIS-${mmdd(rel(-1))}-MEAT`;
