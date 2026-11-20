// Simphony on recorded sample responses: the demo connection. The menu as read at 06:00 and one night of Mercado's
// guest checks, replayed as last night. No call leaves the server; nothing here is a live Oracle account.
import checks from "./fixtures/simphony-guest-checks.json";
import menu from "./fixtures/simphony-menu.json";
import { SimphonyPos, type SimphonyChecks, type SimphonyConfig, type SimphonyMenu } from "./simphony";
import { SampleError } from "./sample";
import { recording, type SourceRequest, type Transport } from "./transport";

export const SIMPHONY_SAMPLE_DATE = checks.busDt;
/** The menu sync runs at this time each morning, like the automatic ordering run. */
export const SIMPHONY_SYNC_TIME = "06:00";

export const SIMPHONY_CONFIG: SimphonyConfig = {
  propertyId: "lis", timeZone: "Europe/Lisbon", locRef: "LIS01",
  outlets: { "lis-terrace": { rvcNum: 21, code: "MER" } },
  items: {
    1001: "burger", 1002: "club", 1003: "caesar", 1004: "salmon", 1005: "tenderloin", 1006: "lobster", 1007: "risotto", 1008: "pizza", 1009: "lambchops",
    1012: "fishchips", 1013: "fondant", 1014: "cheesecake", 1015: "fries", 1016: "soup", 1017: "kidspasta",
    2001: "coke", 2002: "oj", 2003: "cappuccino", 2004: "mojito", 2005: "martini", 2006: "wine", 2007: "still", 2008: "sparkling", 2009: "beer",
  },
  modifiers: { 9101: "double", 9201: "no-cheese" },
  staff: { 14671: "MER-S1", 14672: "MER-S2", 14673: "MER-S3" },
  roomTender: ["Room charge"],
};

/** Answers the adapter's two requests from the recorded responses, the checks moved to `date`. */
export function simphonySampleTransport(date = SIMPHONY_SAMPLE_DATE): Transport {
  return async (req: SourceRequest) => {
    if (req.system !== "simphony") throw new SampleError(`No sample for ${req.system}.`);
    if (req.method === "GET" && /^\/menus\/LIS01\/rvc\/21$/.test(req.path)) return menu as unknown as SimphonyMenu;
    if (req.method === "POST" && req.path === "/bi/getGuestChecks") {
      if ((req.body as { busDt?: string })?.busDt !== date) return { locRef: "LIS01", busDt: (req.body as { busDt?: string })?.busDt, guestChecks: [] };
      return JSON.parse(JSON.stringify(checks).split(SIMPHONY_SAMPLE_DATE).join(date)) as SimphonyChecks;
    }
    throw new SampleError(`No sample for ${req.method} ${req.path}.`);
  };
}

export function sampleSimphony(date = SIMPHONY_SAMPLE_DATE) {
  const transport = recording(simphonySampleTransport(date));
  return { pos: new SimphonyPos(SIMPHONY_CONFIG, transport), transport };
}
