// Ingredient costs, recipe costs and selling prices as of a given business date.
import { INGREDIENT_PRICE_CHANGES, MENU_PRICE_CHANGES, ingredientById, itemById, outletById, propertyById } from "../data/catalog";
import type { MenuItem, PriceChange } from "../types";
import { round2 } from "../util";

/** Price changes entered during the demo session, on top of the seeded supplier changes. */
export type PriceOverrides = readonly PriceChange[];

const NO_OVERRIDES: PriceOverrides = [];

function valueAt(base: number, id: string, date: string, changes: readonly PriceChange[]): number {
  let value = base;
  let latest = "";
  for (const c of changes) {
    if (c.id === id && c.from <= date && c.from >= latest) {
      value = c.value;
      latest = c.from;
    }
  }
  return value;
}

/** Ingredient cost per unit in AED (group base price list). */
export function ingredientCostAt(id: string, date: string, overrides: PriceOverrides = NO_OVERRIDES): number {
  const seeded = valueAt(ingredientById[id].cost, id, date, INGREDIENT_PRICE_CHANGES);
  return overrides.length ? valueAt(seeded, id, date, overrides) : seeded;
}

/** Menu price in AED base terms, before the outlet's price factor. */
export function basePriceAt(itemId: string, date: string): number {
  return valueAt(itemById[itemId].price, itemId, date, MENU_PRICE_CHANGES);
}

/** Selling price at an outlet, in that property's own currency. */
export function menuPriceAt(itemId: string, outletId: string, date: string): number {
  return Math.round(basePriceAt(itemId, date) * outletById[outletId].priceFactor);
}

export interface RecipeCostLine {
  ingredientId: string;
  qty: number;
  unitCost: number;
  cost: number;
}

export function recipeBreakdown(item: MenuItem, date: string, overrides: PriceOverrides = NO_OVERRIDES): RecipeCostLine[] {
  return (item.recipe ?? []).map((l) => {
    const unitCost = ingredientCostAt(l.ingredientId, date, overrides);
    return { ingredientId: l.ingredientId, qty: l.qty, unitCost, cost: l.qty * unitCost };
  });
}

const costCache = new WeakMap<PriceOverrides, Map<string, number>>();

/** Cost of one portion in AED base terms. Items without a recipe fall back to their standard cost. */
export function itemCostAt(itemId: string, date: string, overrides: PriceOverrides = NO_OVERRIDES): number {
  let cache = costCache.get(overrides);
  if (!cache) costCache.set(overrides, (cache = new Map()));
  const key = `${itemId}|${date}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const item = itemById[itemId];
  const cost = item.recipe
    ? recipeBreakdown(item, date, overrides).reduce((s, l) => s + l.cost, 0)
    : (item.standardCost ?? 0);
  cache.set(key, cost);
  return cost;
}

/** Cost of one portion at a property, in that property's own currency. */
export function itemCostAtProperty(itemId: string, propertyId: string, date: string, overrides: PriceOverrides = NO_OVERRIDES) {
  return itemCostAt(itemId, date, overrides) * propertyById[propertyId].costFactor;
}

export interface ItemEconomics {
  price: number;
  cost: number;
  grossProfit: number;
  margin: number;
}

export function itemEconomics(itemId: string, outletId: string, date: string, overrides: PriceOverrides = NO_OVERRIDES): ItemEconomics {
  const price = menuPriceAt(itemId, outletId, date);
  const cost = round2(itemCostAtProperty(itemId, outletById[outletId].propertyId, date, overrides));
  const grossProfit = round2(price - cost);
  return { price, cost, grossProfit, margin: price === 0 ? 0 : grossProfit / price };
}
