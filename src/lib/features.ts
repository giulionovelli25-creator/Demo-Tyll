// What the demo shows. Everything switched off here stays in the code and the data, with its permissions and tests:
// it is only taken out of the interface (menus, links, search, tours, cards) and its addresses lead to the Overview.
// Set a switch to true to bring that part back, in this one place.
import type { ModuleId } from "./domain/access";
import type { Role } from "./types";

export const FEATURES = {
  /** Tyll Flow, live kitchen and bar ticket timing (/flow). A different product, and it runs on simulated tickets only. */
  flow: false,
  /** Rooms and guest experience (/rooms): room readiness, housekeeping, guest requests, Guest Connect, bell and luggage,
   * and the roles only it uses (front office, housekeeping manager, concierge, bell captain). */
  rooms: false,
  /** Screens marked Preview: Events and staffing (/events), Sales and performance (/performance), Tips (/money?tab=tips). */
  previews: false,
  /** Expiring soon, batch use-by tracking (/stock?tab=expiry), with its alert and daily bell notice. A real hotel would
   * need batch entry at every delivery first. */
  expiry: false,
  /** Other tools (/more): a list of tools that are now in the menu or switched off above. */
  otherTools: false,
  /** The Revenue card on the Overview, with revenue and an estimated profit. Revenue detail stays on Revenue and Reports;
   * the Overview shows money Tyll found instead (supplier invoices to query). */
  overviewRevenue: false,
} as const;

export type FeatureId = keyof typeof FEATURES;

/** Modules that belong to a switch. A module whose switch is off is left out of every menu and link. */
const MODULE_FEATURE: Partial<Record<ModuleId, FeatureId>> = { flow: "flow", rooms: "rooms", events: "previews", more: "otherTools" };

/** Roles that only use a switched off part. They leave the role lists (sign in, Settings) while it is off. */
const ROLE_FEATURE: Partial<Record<Role, FeatureId>> = { front_office: "rooms", housekeeping_manager: "rooms", concierge: "rooms", bell_captain: "rooms", event_manager: "previews", sales: "previews", sales_director: "previews" };

export const featureOn = (f: FeatureId): boolean => FEATURES[f];
/** Whether a module is shown at all. Access is still decided by the role (lib/domain/access.ts). */
export const moduleShown = (m: ModuleId): boolean => { const f = MODULE_FEATURE[m]; return f ? FEATURES[f] : true; };
export const roleShown = (r: Role): boolean => { const f = ROLE_FEATURE[r]; return f ? FEATURES[f] : true; };

/** Addresses that belong to a switched off part, and where they lead instead. Read by the proxy, so old links never break. */
export function hiddenRedirect(pathname: string, tab: string | null): string | null {
  const root = `/${pathname.split("/")[1]}`;
  if (!FEATURES.flow && root === "/flow") return "/";
  if (!FEATURES.rooms && root === "/rooms") return "/";
  if (!FEATURES.previews && (root === "/events" || root === "/performance")) return "/";
  if (!FEATURES.previews && pathname === "/money" && tab === "tips") return "/money";
  if (!FEATURES.expiry && pathname === "/stock" && tab === "expiry") return "/stock";
  if (!FEATURES.otherTools && root === "/more") return "/";
  return null;
}

/** Whether a link may be shown: false for an address that a switch has turned off. */
export const linkShown = (href: string): boolean => {
  const [p, q] = href.split("?");
  return hiddenRedirect(p, q ? new URLSearchParams(q).get("tab") : null) === null;
};
