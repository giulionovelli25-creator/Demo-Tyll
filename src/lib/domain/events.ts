// Event requirements: portions, drinks, ingredients, staff and estimated cost. Pure arithmetic on the event's own
// inputs, the menu's recipes and stated demo assumptions, so the same event always gives the same answer.
import { itemById, propertyById } from "../data/catalog";
import { HOURLY_RATE_AED, type Skill } from "../data/workforce";
import type { Assignment, EventRecord, EventStatus, RecipeChange, ServiceFormat, ServiceId, StaffRatios, SupportRequest } from "../types";
import { fxRate } from "../util";
import { ingredientsFor } from "./planning";
import { itemCostAtProperty } from "./pricing";

export const SERVICES: Record<ServiceId, { label: string; kind: "food" | "drink"; items: { itemId: string; perGuest: number }[] }> = {
  coffee_break: { label: "Coffee break", kind: "drink", items: [{ itemId: "cappuccino", perGuest: 1.5 }, { itemId: "still", perGuest: 0.5 }, { itemId: "cheesecake", perGuest: 0.5 }] },
  breakfast_buffet: { label: "Breakfast buffet", kind: "food", items: [{ itemId: "club", perGuest: 0.5 }, { itemId: "oj", perGuest: 1 }, { itemId: "cappuccino", perGuest: 1 }] },
  lunch_buffet: { label: "Lunch buffet", kind: "food", items: [{ itemId: "caesar", perGuest: 0.6 }, { itemId: "shawarma", perGuest: 0.5 }, { itemId: "mezze", perGuest: 0.5 }, { itemId: "salmon", perGuest: 0.3 }, { itemId: "fondant", perGuest: 0.5 }] },
  set_menu: { label: "Set menu", kind: "food", items: [{ itemId: "caesar", perGuest: 1 }, { itemId: "shawarma", perGuest: 0.25 }, { itemId: "salmon", perGuest: 0.35 }, { itemId: "lambchops", perGuest: 0.4 }, { itemId: "fondant", perGuest: 1 }] },
  three_course: { label: "Three-course dinner", kind: "food", items: [{ itemId: "soup", perGuest: 1 }, { itemId: "tenderloin", perGuest: 0.5 }, { itemId: "salmon", perGuest: 0.5 }, { itemId: "fondant", perGuest: 1 }] },
  cocktail: { label: "Cocktail reception", kind: "food", items: [{ itemId: "mezze", perGuest: 0.6 }, { itemId: "fries", perGuest: 0.4 }, { itemId: "mojito", perGuest: 1 }, { itemId: "sparkling", perGuest: 0.5 }] },
  soft_drinks: { label: "Soft drinks", kind: "drink", items: [{ itemId: "coke", perGuest: 1 }, { itemId: "oj", perGuest: 0.5 }, { itemId: "still", perGuest: 1 }] },
  wine: { label: "Wine service", kind: "drink", items: [{ itemId: "wine", perGuest: 2 }] },
};

/** Demo staffing assumptions by service format: guests per person. Editable on each event. */
export const DEFAULT_RATIOS: Record<ServiceFormat, StaffRatios> = {
  seated: { waiter: 15, bartender: 50, chef: 40, setup: 30, supervisor: 60, runner: 40, cleaning: 50 },
  buffet: { waiter: 25, bartender: 60, chef: 50, setup: 30, supervisor: 80, runner: 50, cleaning: 50 },
  reception: { waiter: 30, bartender: 40, chef: 60, setup: 40, supervisor: 80, runner: 0, cleaning: 60 },
  theatre: { waiter: 60, bartender: 0, chef: 0, setup: 25, supervisor: 100, runner: 0, cleaning: 60 },
};

export const ROLE_ORDER: (keyof StaffRatios)[] = ["waiter", "bartender", "chef", "setup", "supervisor", "runner", "cleaning"];

/** Events that use stock and staff. Drafts and cancelled events do not. */
export const COMMITTED: EventStatus[] = ["planning", "ready", "in_progress"];
export const isCommitted = (e: Pick<EventRecord, "status">) => COMMITTED.includes(e.status);

export interface PortionLine {
  itemId: string;
  /** Calculated from guests and portions per guest, across all services. */
  calculated: number;
  /** What will be prepared: the kitchen's figure if it changed it, else the calculation. */
  portions: number;
  /** Each service's share, for the explanation. */
  from: { service: ServiceId; guests: number; perGuest: number; units: number }[];
}

/** Portions by dish and drink. A dish served in two services is added once per service, never per guest twice. */
export function eventPortions(e: Pick<EventRecord, "services" | "kitchenPortions">): PortionLine[] {
  const out = new Map<string, PortionLine>();
  for (const s of e.services) {
    for (const it of s.items) {
      if (!itemById[it.itemId] || it.perGuest <= 0) continue;
      const units = s.guests * it.perGuest;
      const line = out.get(it.itemId) ?? { itemId: it.itemId, calculated: 0, portions: 0, from: [] };
      line.calculated += units;
      line.from.push({ service: s.id, guests: s.guests, perGuest: it.perGuest, units });
      out.set(it.itemId, line);
    }
  }
  return [...out.values()].map((l) => {
    const calculated = Math.ceil(l.calculated - 1e-9);
    const k = e.kitchenPortions?.[l.itemId];
    return { ...l, calculated, portions: k !== undefined && itemById[l.itemId].dept === "food" ? k : calculated };
  }).sort((a, b) => b.portions - a.portions);
}

/** Ingredients for the event, through the recipes and any corrected standards. */
export const eventIngredients = (e: EventRecord, recipes: readonly RecipeChange[] = []) =>
  ingredientsFor(eventPortions(e).map((p) => ({ itemId: p.itemId, date: e.date, units: p.portions })), recipes);

/** What the event still needs from the storeroom: its ingredients less anything already issued to it. */
export function eventStoreNeed(e: EventRecord, recipes: readonly RecipeChange[] = []): Map<string, number> {
  const out = new Map<string, number>();
  for (const [g, q] of eventIngredients(e, recipes)) {
    const issued = e.issued.filter((i) => i.ingredientId === g).reduce((s, i) => s + i.qty, 0);
    out.set(g, Math.max(0, q - issued));
  }
  return out;
}

export const EVENT_SKILL: Record<keyof StaffRatios, Skill> = { waiter: "waiter", bartender: "bartender", chef: "chef", setup: "setup", supervisor: "supervisor", runner: "runner", cleaning: "cleaning" };

/** When each role works: setup before the event, cleaning after it, the kitchen from setup to service end. */
export function roleWindow(e: Pick<EventRecord, "start" | "end" | "setupStart" | "cleanupEnd">, role: keyof StaffRatios): { start: number; end: number } {
  if (role === "setup") return { start: e.setupStart, end: e.start };
  if (role === "cleaning") return { start: e.end, end: e.cleanupEnd };
  if (role === "chef") return { start: e.setupStart, end: e.end };
  return { start: e.start, end: e.end };
}

export interface RoleNeed {
  role: keyof StaffRatios;
  skill: Skill;
  required: number;
  rule: string;
  window: { start: number; end: number };
}

/** People needed by role, rounded up. Kitchen roles only when food is served, bartenders only with a bar service. */
export function staffNeeds(e: EventRecord): RoleNeed[] {
  const food = e.services.some((s) => SERVICES[s.id].kind === "food");
  const bar = e.services.some((s) => s.id === "wine" || s.id === "cocktail" || s.id === "soft_drinks");
  return ROLE_ORDER.flatMap((role) => {
    const ratio = e.ratios[role];
    if (!ratio || ratio <= 0) return [];
    if (role === "chef" && !food) return [];
    if (role === "bartender" && !bar) return [];
    if ((role === "setup" && e.setupStart >= e.start) || (role === "cleaning" && e.cleanupEnd <= e.end)) return [];
    const required = Math.ceil(e.guests / ratio - 1e-9);
    return [{ role, skill: EVENT_SKILL[role], required, rule: `1 per ${ratio} guests`, window: roleWindow(e, role) }];
  });
}

export interface Coverage extends RoleNeed {
  confirmed: number;
  requested: number;
  stillNeeded: number;
}

/** Required against confirmed people. Requests waiting for a decision are shown, never counted as cover. */
export function coverage(e: EventRecord, assignments: readonly Assignment[], requests: readonly SupportRequest[]): Coverage[] {
  return staffNeeds(e).map((n) => {
    const confirmed = assignments.filter((a) => a.eventId === e.id && a.status === "confirmed" && a.skill === n.skill).length;
    const requested = requests.filter((r) => r.eventId === e.id && r.skill === n.skill && r.status !== "cancelled").reduce((s, r) => s + r.items.filter((i) => i.status === "pending" || i.status === "alternative").length, 0);
    return { ...n, confirmed, requested, stillNeeded: Math.max(0, n.required - confirmed) };
  });
}

export interface EventCost {
  food: number;
  drink: number;
  labour: number;
  /** Labour for people still to be found, inside the labour figure. */
  labourExtra: number;
  total: number;
  revenue: number | null;
  contribution: number | null;
}

/** Estimated operational cost in the hotel's currency. Ingredient cost from recipes; labour at demo hourly rates. */
export function eventCost(e: EventRecord, cover: Coverage[]): EventCost {
  const currency = propertyById[e.propertyId].currency;
  let food = 0, drink = 0;
  for (const p of eventPortions(e)) {
    const c = p.portions * itemCostAtProperty(p.itemId, e.propertyId, e.date);
    if (itemById[p.itemId].dept === "food") food += c;
    else drink += c;
  }
  const fx = fxRate("AED", currency);
  let labour = 0, labourExtra = 0;
  for (const c of cover) {
    const hours = Math.max(0, c.window.end - c.window.start) / 60;
    const rate = HOURLY_RATE_AED[c.skill] * fx;
    labour += c.required * hours * rate;
    labourExtra += c.stillNeeded * hours * rate;
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const total = food + drink + labour;
  const revenue = e.pricePerGuest ? e.pricePerGuest * e.guests : null;
  return { food: r2(food), drink: r2(drink), labour: r2(labour), labourExtra: r2(labourExtra), total: r2(total), revenue: revenue === null ? null : r2(revenue), contribution: revenue === null ? null : r2(revenue - total) };
}

/** A new event's services, scaled to its guests. */
export const serviceFor = (id: ServiceId, guests: number) => ({ id, guests, items: SERVICES[id].items.map((i) => ({ ...i })) });

export const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;
