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
  { id: "drinks", name: "Beverage", suppliers: ["bev"] },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];
export const categoryOf = (ingredientId: string): CategoryId | null =>
  CATEGORIES.find((c) => (c.suppliers as readonly string[]).includes(ingredientById[ingredientId].supplierId))?.id ?? null;

/** The three parts of Stock and of Log waste. Food and drinks are used up. Inventory is reused until it breaks. */
export const STOCK_AREAS = [
  { id: "food", name: "Food" },
  { id: "drinks", name: "Beverage" },
  { id: "inventory", name: "Inventory" },
] as const;

export type StockArea = (typeof STOCK_AREAS)[number]["id"];
export function stockAreaOf(ingredientId: string): StockArea {
  const g = ingredientById[ingredientId];
  if (g.dept === "glassware" || g.dept === "supplies") return "inventory";
  return g.supplierId === "bev" ? "drinks" : "food";
}

/** How a hotel files its stock: food and beverage, each by category, then inventory. Lists show items under these headings, in this order. */
export const STOCK_GROUPS = [
  { id: "meat", area: "food", name: "Meat and fish" },
  { id: "produce", area: "food", name: "Fresh produce" },
  { id: "dairy", area: "food", name: "Dairy and eggs" },
  { id: "bakery", area: "food", name: "Bakery" },
  { id: "dry", area: "food", name: "Dry goods" },
  { id: "wine", area: "drinks", name: "Wine" },
  { id: "spirits", area: "drinks", name: "Spirits and liqueurs" },
  { id: "soft", area: "drinks", name: "Soft drinks" },
  { id: "coffee", area: "drinks", name: "Coffee" },
  { id: "glass", area: "inventory", name: "Glassware" },
  { id: "china", area: "inventory", name: "China and serving" },
  { id: "supplies", area: "inventory", name: "Hotel supplies" },
] as const;

export type StockGroupId = (typeof STOCK_GROUPS)[number]["id"];
const GLASSES = new Set(["wineglass", "highball", "rocks", "flute", "beerglass", "waterglass"]);

export function stockGroupOf(ingredientId: string): StockGroupId {
  const g = ingredientById[ingredientId];
  if (g.dept === "supplies") return "supplies";
  if (g.dept === "glassware") return GLASSES.has(g.id) ? "glass" : "china";
  if (g.id === "wine") return "wine";
  if (g.id === "rum" || g.id === "vodka" || g.id === "liqueur") return "spirits";
  if (g.id === "coffee") return "coffee";
  if (g.supplierId === "bev") return "soft";
  if (DAIRY.has(g.id) || g.id === "icecream") return "dairy";
  if (g.supplierId === "meat" || g.supplierId === "sea") return "meat";
  if (g.supplierId === "produce") return "produce";
  if (g.supplierId === "bakery") return "bakery";
  return "dry";
}

/** Rows under their category, keeping the order they came in. Empty categories are left out. */
export function groupByStock<T>(rows: readonly T[], idOf: (row: T) => string) {
  return STOCK_GROUPS.map((group) => ({ ...group, rows: rows.filter((r) => stockGroupOf(idOf(r)) === group.id) })).filter((g) => g.rows.length > 0);
}
