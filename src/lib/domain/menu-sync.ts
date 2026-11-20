// The menu as the till knows it, against the menu Tyll costs. Pure rules, tested in radisson.test.ts:
// what changed (new dishes, price changes, dishes taken off), a suggested recipe for a new dish built from the closest
// dish on the menu, the standard cost a dish carries until its recipe is confirmed, and what a modifier does to a recipe.
// Nothing here is AI: every suggestion says which dish it came from and what was swapped.
import type { MenuItem, RecipeLine } from "../types";

/** A menu item as read from the till, with Tyll's item when the till's number is mapped to one. */
export interface PosMenuItem {
  posId: string;
  name: string;
  /** Food or Beverage, and the family group (Mains, Starters...). */
  dept: "food" | "beverage";
  category: string;
  price: number;
  itemId?: string;
  /** Modifier rule ids the till offers on this item. */
  modifiers: string[];
}

export interface MenuChanges {
  added: PosMenuItem[];
  priceChanged: { itemId: string; name: string; from: number; to: number }[];
  removed: { itemId: string; name: string }[];
}

/** What changed on the till since Tyll last read it. `known` are the items Tyll costs for this outlet, at their prices. */
export function diffMenu(pos: PosMenuItem[], known: { itemId: string; name: string; price: number }[]): MenuChanges {
  const seen = new Set(pos.map((p) => p.itemId).filter(Boolean));
  return {
    added: pos.filter((p) => !p.itemId),
    priceChanged: pos.flatMap((p) => {
      const k = p.itemId ? known.find((x) => x.itemId === p.itemId) : undefined;
      return k && Math.abs(k.price - p.price) >= 0.005 ? [{ itemId: k.itemId, name: k.name, from: k.price, to: p.price }] : [];
    }),
    removed: known.filter((k) => !seen.has(k.itemId)).map((k) => ({ itemId: k.itemId, name: k.name })),
  };
}

/** The share of the price a dish is costed at until its recipe is confirmed: the group's standard food or drink cost. */
export const STANDARD_COST_SHARE = { food: 0.3, beverage: 0.22 } as const;
export const standardCost = (price: number, dept: "food" | "beverage") => Math.round(price * STANDARD_COST_SHARE[dept] * 100) / 100;

/** Ingredients a dish name can point at, by the words a menu uses. */
const NAME_WORDS: Record<string, string[]> = {
  salmon: ["salmon"], hammour: ["sea bass", "seabass", "bass"], lobster: ["lobster"], tenderloin: ["tenderloin", "steak"], wagyu: ["wagyu", "beef burger"],
  chicken: ["chicken"], lamb: ["lamb"], eggplant: ["eggplant", "aubergine"], asparagus: ["asparagus"], truffle: ["truffle"], chocolate: ["chocolate"],
  berries: ["berry", "berries"], lemon: ["lemon"], butter: ["butter"], potato: ["potato", "chips", "fries"], mozzarella: ["mozzarella", "burrata"], rum: ["rum", "mojito"], vodka: ["vodka", "martini"],
};
const mentions = (name: string) => {
  const n = name.toLowerCase();
  return Object.entries(NAME_WORDS).filter(([, words]) => words.some((w) => n.includes(w))).map(([g]) => g);
};
/** The main ingredient of a recipe: the one with the highest share of its cost, given a cost per unit. */
const mainOf = (recipe: RecipeLine[], unitCost: (g: string) => number) => [...recipe].sort((a, b) => b.qty * unitCost(b.ingredientId) - a.qty * unitCost(a.ingredientId))[0]?.ingredientId;

export interface Suggestion {
  lines: RecipeLine[];
  /** The dish it was built from, and the ingredient put in place of that dish's main one. */
  from: { itemId: string; name: string } | null;
  swapped: { from: string; to: string } | null;
  why: string;
}

/**
 * A first recipe for a new dish, for the chef to check: the menu dish in the same category that shares the most of the
 * ingredients the name mentions, with its main ingredient replaced by the one the new name mentions. With no dish to go
 * from, an empty recipe: the chef builds it.
 */
export function suggestRecipe(name: string, category: string, menu: MenuItem[], unitCost: (g: string) => number): Suggestion {
  const want = mentions(name);
  const candidates = menu.filter((m) => m.recipe && m.category === category);
  const scored = candidates.map((m) => {
    const main = mainOf(m.recipe!, unitCost);
    const has = new Set(m.recipe!.map((l) => l.ingredientId));
    // The rest of the dish matters more than its main ingredient, which is swapped anyway.
    const sharedRest = want.filter((g) => has.has(g) && g !== main).length;
    const sharedMain = want.includes(main) ? 1 : 0;
    // A shared word in the dish's name counts most ("Lobster burger" and "Wagyu beef burger" are both burgers).
    // Words that name an ingredient do not count here: that ingredient is swapped in, so it says nothing about the dish.
    const words = name.toLowerCase().split(/\W+/).filter((w) => w.length > 3 && !Object.values(NAME_WORDS).flat().includes(w) && m.name.toLowerCase().includes(w)).length;
    return { m, score: words * 3 + sharedRest * 2 + sharedMain };
  }).sort((a, b) => b.score - a.score);
  const base = scored[0]?.m;
  if (!base || !want.length) return { lines: [], from: null, swapped: null, why: "No similar dish on the menu. Build the recipe from the ingredients." };
  const main = mainOf(base.recipe!, unitCost);
  const to = want.find((g) => !base.recipe!.some((l) => l.ingredientId === g)) ?? null;
  const lines = base.recipe!.map((l) => (to && l.ingredientId === main ? { ingredientId: to, qty: l.qty } : { ...l }));
  return {
    lines, from: { itemId: base.id, name: base.name }, swapped: to && main ? { from: main, to } : null,
    why: to && main ? `Built from ${base.name}, the closest dish in ${category}, with the main ingredient swapped.` : `Built from ${base.name}, the closest dish in ${category}.`,
  };
}

// ---- Modifiers ----------------------------------------------------------------------------------------------------

export interface ModifierRule {
  id: string;
  /** As the till prints it. */
  name: string;
  /** What it does to the recipe, in words. */
  effect: string;
  /** The ingredients it changes and by how much: 2 doubles, 0 removes. */
  ingredients: string[];
  factor: number;
}

/** The modifier rules the demo hotel uses. A till modifier with no rule leaves the recipe as it is, and is listed. */
export const MODIFIER_RULES: ModifierRule[] = [
  { id: "double", name: "Double", effect: "Doubles the spirit", ingredients: ["rum", "vodka", "liqueur"], factor: 2 },
  { id: "no-cheese", name: "No cheese", effect: "Takes the cheese out", ingredients: ["cheddar", "parmesan", "mozzarella"], factor: 0 },
];

/** A recipe with its modifiers applied, for one portion. */
export function applyModifiers(recipe: RecipeLine[], modifierIds: string[], rules: ModifierRule[] = MODIFIER_RULES): RecipeLine[] {
  return recipe.map((l) => {
    let qty = l.qty;
    for (const id of modifierIds) {
      const r = rules.find((x) => x.id === id);
      if (r && r.ingredients.includes(l.ingredientId)) qty *= r.factor;
    }
    return { ingredientId: l.ingredientId, qty: Math.round(qty * 10000) / 10000 };
  }).filter((l) => l.qty > 0);
}
