// Role-based access. Every query and every mutation goes through these checks,
// so hiding a button is never the only thing standing between a user and data.
import { OUTLETS, PROPERTIES, outletById } from "../data/catalog";
import type { Currency, Role, Scope, User } from "../types";

export type ModuleId = "overview" | "money" | "stock" | "forecast" | "events" | "flow" | "rooms" | "investigations" | "reports" | "settings" | "tasks";

export type Permission =
  | "investigation.assign"
  | "investigation.note"
  | "investigation.close"
  | "investigation.reopen"
  | "stock.logWaste"
  | "stock.count"
  | "stock.editPrices"
  | "forecast.approve"
  | "flow.updateOrder"
  | "rooms.manage"
  | "reports.export"
  | "settings.reset"
  | "settings.audit"
  /** Create and submit purchase requests from a forecast. */
  | "purchase.create"
  /** Purchasing department review: quantities, suppliers and prices. */
  | "purchase.review"
  /** Accounting review of the spend. */
  | "purchase.approveFinance"
  /** Senior manager sign-off where a hotel's policy asks for it. */
  | "purchase.approveManager"
  /** Record that an approved order has arrived. Stock rises only then. */
  | "purchase.receive"
  /** Create and change kitchen preparation plans. */
  | "prep.plan"
  /** Tick off preparation tasks. */
  | "prep.complete"
  /** Create and change events. */
  | "events.plan"
  /** Ask other departments for staff. */
  | "staff.request"
  /** Release staff from a department the user manages. Which departments is checked separately. */
  | "staff.lend";

const MODULES: Record<Role, ModuleId[]> = {
  owner: ["overview", "money", "stock", "forecast", "events", "flow", "rooms", "investigations", "reports", "settings"],
  gm: ["overview", "money", "stock", "forecast", "events", "flow", "rooms", "investigations", "reports", "settings"],
  controller: ["overview", "money", "stock", "forecast", "rooms", "investigations", "reports", "settings"],
  fnb_director: ["overview", "money", "stock", "forecast", "events", "flow", "investigations", "reports", "settings"],
  restaurant_manager: ["overview", "money", "stock", "forecast", "events", "flow", "investigations", "reports", "settings"],
  // Purchasing sees requests, stock and suppliers, not sales. The head chef sees preparation and stock, not finances.
  purchasing: ["forecast", "stock", "settings"],
  chef: ["forecast", "events", "tasks", "stock", "flow", "settings"],
  // Sales and events: events, their purchasing and staff. No outlet sales.
  event_manager: ["events", "forecast", "settings"],
  employee: ["tasks", "stock", "flow", "settings"],
};

const PERMISSIONS: Record<Role, Permission[]> = {
  owner: ["investigation.assign", "investigation.note", "investigation.close", "investigation.reopen", "stock.logWaste", "stock.count", "stock.editPrices", "forecast.approve", "flow.updateOrder", "rooms.manage", "reports.export", "settings.reset", "settings.audit", "purchase.create", "purchase.approveManager", "prep.plan", "events.plan", "staff.request", "staff.lend"],
  gm: ["investigation.assign", "investigation.note", "investigation.close", "investigation.reopen", "stock.logWaste", "stock.count", "stock.editPrices", "forecast.approve", "flow.updateOrder", "rooms.manage", "reports.export", "settings.reset", "settings.audit", "purchase.create", "purchase.approveManager", "prep.plan", "events.plan", "staff.request", "staff.lend"],
  controller: ["investigation.assign", "investigation.note", "investigation.close", "investigation.reopen", "stock.editPrices", "reports.export", "settings.reset", "settings.audit", "purchase.approveFinance"],
  fnb_director: ["investigation.assign", "investigation.note", "investigation.close", "investigation.reopen", "stock.logWaste", "stock.count", "stock.editPrices", "forecast.approve", "flow.updateOrder", "reports.export", "settings.reset", "purchase.create", "prep.plan", "events.plan", "staff.request", "staff.lend"],
  restaurant_manager: ["investigation.assign", "investigation.note", "investigation.close", "stock.logWaste", "stock.count", "forecast.approve", "flow.updateOrder", "reports.export", "settings.reset", "purchase.create", "prep.plan", "prep.complete", "staff.request", "staff.lend"],
  event_manager: ["settings.reset", "purchase.create", "events.plan", "staff.request", "staff.lend"],
  purchasing: ["stock.count", "settings.reset", "purchase.review", "purchase.receive"],
  chef: ["stock.logWaste", "stock.count", "flow.updateOrder", "settings.reset", "purchase.create", "prep.plan", "prep.complete", "staff.request"],
  employee: ["stock.logWaste", "stock.count", "flow.updateOrder", "settings.reset", "prep.complete"],
};

export const MODULE_PATH: Record<ModuleId, string> = {
  overview: "/", money: "/money", stock: "/stock", forecast: "/forecast", events: "/events", flow: "/flow", rooms: "/rooms",
  investigations: "/investigations", reports: "/reports", settings: "/settings", tasks: "/tasks",
};

export const modulesFor = (user: User): ModuleId[] => MODULES[user.role];
export const canOpen = (user: User, module: ModuleId) => MODULES[user.role].includes(module);
export const can = (user: User, permission: Permission) => PERMISSIONS[user.role].includes(permission);
export const homePath = (user: User) => (user.role === "employee" ? "/tasks" : user.role === "purchasing" ? "/forecast?tab=approvals" : user.role === "chef" ? "/forecast?tab=prep" : user.role === "event_manager" ? "/events" : "/");

/** Which module a URL path belongs to, for route guarding. */
export function moduleOfPath(path: string): ModuleId {
  if (path === "/" || path.startsWith("/menu")) return "overview";
  const first = path.split("/")[1] as ModuleId;
  return first in MODULE_PATH ? first : "overview";
}

export function allowedProperties(user: User): string[] {
  return user.propertyIds === "all" ? PROPERTIES.map((p) => p.id) : user.propertyIds;
}

export function allowedOutlets(user: User): string[] {
  const props = new Set(allowedProperties(user));
  return OUTLETS.filter((o) => props.has(o.propertyId) && (user.outletIds === "all" || user.outletIds.includes(o.id))).map((o) => o.id);
}

export const canSeeOutlet = (user: User, outletId: string) => allowedOutlets(user).includes(outletId);

/** Property-wide records (minibar, spa, rooms) need access to the whole property, not one outlet. */
export const hasWholeProperty = (user: User, propertyId: string) => allowedProperties(user).includes(propertyId) && user.outletIds === "all";

/** Forces a requested scope back inside what the user may see. */
export function clampScope(user: User, scope: Scope): Scope {
  const props = allowedProperties(user);
  const outlets = allowedOutlets(user);
  let { propertyId, outletId } = scope;
  if (outletId !== "all" && !outlets.includes(outletId)) outletId = "all";
  if (outletId !== "all") propertyId = outletById[outletId].propertyId;
  if (propertyId !== "all" && !props.includes(propertyId)) propertyId = "all";
  if (propertyId === "all" && props.length === 1) propertyId = props[0];
  if (outletId === "all" && outlets.length === 1) outletId = outlets[0];
  return { propertyId, outletId, dept: scope.dept };
}

/** The outlets a scope resolves to for this user. Never returns an outlet the user may not see. */
export function scopeOutlets(user: User, scope: Scope): string[] {
  const s = clampScope(user, scope);
  return allowedOutlets(user).filter((id) => (s.outletId === "all" ? s.propertyId === "all" || outletById[id].propertyId === s.propertyId : id === s.outletId));
}

/** Group views are reported in AED. A single-property view uses that property's own currency. */
export function scopeCurrency(user: User, scope: Scope): Currency {
  const props = new Set(scopeOutlets(user, scope).map((id) => outletById[id].propertyId));
  if (props.size === 1) return PROPERTIES.find((p) => props.has(p.id))!.currency;
  return "AED";
}

export class AccessError extends Error {}

export function assertCan(user: User | undefined, permission: Permission, outletId?: string): asserts user is User {
  if (!user) throw new AccessError("Sign in to continue.");
  if (!can(user, permission)) throw new AccessError(`Your role cannot do this (${permission}).`);
  if (outletId && !canSeeOutlet(user, outletId)) throw new AccessError("This outlet is outside your access.");
}
