// Where stock lives, in the order someone walks the storeroom. A manager can change the order once, for everyone.
import { ingredientById } from "./catalog";

export const COUNT_LOCATIONS = [
  { id: "walkin", name: "Walk in fridge" },
  { id: "produce", name: "Produce fridge" },
  { id: "freezer", name: "Freezer" },
  { id: "dry", name: "Dry store" },
  { id: "cellar", name: "Wine and spirits cellar" },
  { id: "bar", name: "Bar store" },
  { id: "glass", name: "Glass and china racks" },
] as const;

export type LocationId = (typeof COUNT_LOCATIONS)[number]["id"];
export const DEFAULT_ROUTE: LocationId[] = COUNT_LOCATIONS.map((l) => l.id);

const FROZEN = new Set(["icecream", "lobster"]);
const DAIRY = new Set(["cheddar", "parmesan", "mozzarella", "creamcheese", "labneh", "butter", "cream", "milk", "eggs"]);
const SPIRITS = new Set(["wine", "rum", "vodka", "liqueur"]);

/** Which location an item is kept in. */
export function locationOf(ingredientId: string): LocationId {
  const g = ingredientById[ingredientId];
  if (g.dept === "glassware") return "glass";
  if (FROZEN.has(g.id)) return "freezer";
  if (SPIRITS.has(g.id)) return "cellar";
  if (g.supplierId === "bev" || (g.dept === "beverage" && g.supplierId === "produce")) return "bar";
  if (g.supplierId === "produce") return "produce";
  if (g.supplierId === "meat" || g.supplierId === "sea" || DAIRY.has(g.id)) return "walkin";
  return "dry";
}

/** Categories for the Stock page's monthly view. */
export const CATEGORIES = [
  { id: "meat", name: "Meat and fish", suppliers: ["meat", "sea"] },
  { id: "produce", name: "Fresh produce", suppliers: ["produce"] },
  { id: "bakery", name: "Bakery", suppliers: ["bakery"] },
  { id: "dry", name: "Dairy and dry goods", suppliers: ["dry"] },
  { id: "drinks", name: "Drinks", suppliers: ["bev"] },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];
export const categoryOf = (ingredientId: string): CategoryId | null =>
  CATEGORIES.find((c) => (c.suppliers as readonly string[]).includes(ingredientById[ingredientId].supplierId))?.id ?? null;

/** The three parts of Stock and of Log waste. Food and drinks are used up. Inventory is reused until it breaks. */
export const STOCK_AREAS = [
  { id: "food", name: "Food" },
  { id: "drinks", name: "Drinks" },
  { id: "inventory", name: "Inventory" },
] as const;

export type StockArea = (typeof STOCK_AREAS)[number]["id"];
export function stockAreaOf(ingredientId: string): StockArea {
  const g = ingredientById[ingredientId];
  if (g.dept === "glassware" || g.dept === "supplies") return "inventory";
  return g.supplierId === "bev" ? "drinks" : "food";
}
