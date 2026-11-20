// The morning menu sync from Simphony (demo connection, recorded responses). Once a business day at 06:00 it reads the
// till's menu for Mercado and compares it with the dishes Tyll costs: a price change updates the dish's price and its
// margin, a dish no longer on the till is archived, and a new dish is costed at a labelled standard cost until the chef
// confirms its recipe, starting from a suggested one. The chef is told on the bell.
import { MENU_ITEMS, itemById } from "../data/catalog";
import { ingredientById } from "../data/catalog";
import { can } from "../domain/access";
import { MODIFIER_RULES, applyModifiers, diffMenu, standardCost, suggestRecipe, type MenuChanges, type ModifierRule, type PosMenuItem, type Suggestion } from "../domain/menu-sync";
import { ingredientCostAt } from "../domain/pricing";
import type { RecipeLine, Role, User } from "../types";
import { DEMO_TODAY, addDays, round2 } from "../util";
import { SIMPHONY_CONFIG, SIMPHONY_SYNC_TIME, sampleSimphony } from "./integrations/simphony-sample";
import { notify, peopleWith, resolve } from "./notify";
import { loadStore, mutateStore } from "./purchasing-store";
import type { Result } from "./purchasing";

const OUTLET = "lis-terrace";
const fail = (status: number, error: string) => ({ ok: false as const, status, error });

export interface NewDish {
  posId: string;
  name: string;
  dept: "food" | "beverage";
  category: string;
  price: number;
  /** Until the recipe is confirmed: the group's standard cost share of the price. */
  standardCost: number;
  suggestion: Suggestion;
  status: "needs_recipe" | "confirmed";
  confirmed?: { at: string; by: string; role: Role; recipe: RecipeLine[] };
}

export interface MenuSyncShape {
  day: string;
  /** Local time of the sync, YYYY-MM-DDTHH:MM. */
  at: string;
  source: "simphony";
  changes: { added: string[]; priceChanged: MenuChanges["priceChanged"]; removed: MenuChanges["removed"] };
  /** The till's price where it differs from the menu Tyll started with. */
  prices: Record<string, number>;
  archived: Record<string, { at: string; name: string }>;
  newDishes: NewDish[];
}

const unitCost = (g: string) => ingredientCostAt(g, DEMO_TODAY);
/** The dishes Tyll costs at Mercado, at their current prices: the menu, with earlier syncs applied. */
function known(s: MenuSyncShape | undefined) {
  const ids = [...new Set(Object.values(SIMPHONY_CONFIG.items))];
  return ids.filter((id) => itemById[id] && !s?.archived[id]).map((id) => ({ itemId: id, name: itemById[id].name, price: s?.prices[id] ?? itemById[id].price }));
}

/** Runs the sync once per business day, at or after 06:00 hotel time. Safe to call on every read. */
export async function ensureMenuSync(): Promise<MenuSyncShape | undefined> {
  const cur = loadStore().menuSync;
  if (cur?.day === DEMO_TODAY) return cur;
  let menu: PosMenuItem[];
  try {
    menu = await sampleSimphony().pos.readMenu(OUTLET);
  } catch {
    return cur;
  }
  return mutateStore((x) => {
    if (x.menuSync?.day === DEMO_TODAY) return x.menuSync;
    const before = x.menuSync;
    const diff = diffMenu(menu, known(before));
    const next: MenuSyncShape = {
      day: DEMO_TODAY, at: `${DEMO_TODAY}T${SIMPHONY_SYNC_TIME}`, source: "simphony",
      changes: { added: diff.added.filter((a) => !before?.newDishes.some((d) => d.posId === a.posId)).map((a) => a.posId), priceChanged: diff.priceChanged, removed: diff.removed },
      prices: { ...(before?.prices ?? {}) }, archived: { ...(before?.archived ?? {}) }, newDishes: [...(before?.newDishes ?? [])],
    };
    for (const p of diff.priceChanged) next.prices[p.itemId] = p.to;
    for (const r of diff.removed) next.archived[r.itemId] = { at: next.at, name: r.name };
    for (const a of diff.added) {
      if (next.newDishes.some((d) => d.posId === a.posId)) continue;
      next.newDishes.push({ posId: a.posId, name: a.name, dept: a.dept, category: a.category, price: a.price, standardCost: standardCost(a.price, a.dept), suggestion: suggestRecipe(a.name, a.category, MENU_ITEMS, unitCost), status: "needs_recipe" });
    }
    x.menuSync = next;
    const waiting = next.newDishes.filter((d) => d.status === "needs_recipe");
    if (waiting.length) {
      notify(x, { to: peopleWith("prep.plan", "lis", (u) => u.role === "chef" || u.role === "fnb_director"), type: "menu-new-dish", ref: `menu-${DEMO_TODAY}`, propertyId: "lis", title: `${waiting.length} new ${waiting.length === 1 ? "dish needs a recipe" : "dishes need a recipe"}`, body: `${waiting.map((d) => d.name).join(" and ")} came from Simphony at ${SIMPHONY_SYNC_TIME}. Until the recipe is confirmed, ${waiting.length === 1 ? "it is" : "they are"} costed at a standard cost.`, href: "/stock?tab=recipes&view=new" });
    }
    return next;
  });
}

const cost = (lines: RecipeLine[]) => round2(lines.reduce((s, l) => s + l.qty * unitCost(l.ingredientId), 0));

export interface ModifierExample { bill: string; item: string; modifier: string; effect: string; ingredient: string; standard: number; used: number; unit: string }

export interface MenuOut {
  sync: { at: string; label: string; source: "simphony" } | null;
  changes: MenuSyncShape["changes"] & { addedNames: string[] };
  prices: Record<string, number>;
  archived: MenuSyncShape["archived"];
  newDishes: (NewDish & { suggestedCost: number; recipeCost: number | null })[];
  modifiers: ModifierRule[];
  examples: ModifierExample[];
  mayConfirm: boolean;
}

/** One line for the Recipes page: "Menu synced from Simphony at 06:00: 2 new dishes, 1 price change, 1 dish removed". */
export function syncLine(s: MenuSyncShape): string {
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const parts = [s.changes.added.length && n(s.changes.added.length, "new dish", "new dishes"), s.changes.priceChanged.length && n(s.changes.priceChanged.length, "price change", "price changes"), s.changes.removed.length && n(s.changes.removed.length, "dish removed", "dishes removed")].filter(Boolean);
  return `Menu synced from Simphony at ${s.at.slice(11, 16)}: ${parts.length ? parts.join(", ") : "no changes"}`;
}

/** Last night's modifiers from the till, and what each did to the recipe. */
async function examples(): Promise<ModifierExample[]> {
  const day = addDays(DEMO_TODAY, -1);
  const { orders } = await sampleSimphony(day).pos.readDay(OUTLET, day);
  const out: ModifierExample[] = [];
  for (const o of orders) {
    o.lines.forEach((l, i) => {
      const mods = o.modifiers[i];
      const recipe = itemById[l.itemId]?.recipe;
      if (!mods?.length || !recipe) return;
      for (const id of [...new Set(mods)]) {
        const rule = MODIFIER_RULES.find((r) => r.id === id);
        if (!rule) continue;
        const portions = mods.filter((m) => m === id).length;
        const line = recipe.find((x) => rule.ingredients.includes(x.ingredientId));
        if (!line) continue;
        const after = applyModifiers([line], [id])[0]?.qty ?? 0;
        out.push({ bill: o.id, item: itemById[l.itemId].name, modifier: rule.name, effect: rule.effect, ingredient: ingredientById[line.ingredientId].name, standard: round2(line.qty * portions * 1000) / 1000, used: round2(after * portions * 1000) / 1000, unit: ingredientById[line.ingredientId].unit });
      }
    });
  }
  return out;
}

export async function menuFor(user: User): Promise<Result<{ menu: MenuOut }>> {
  if (!can(user, "stock.review") && !can(user, "stock.editPrices") && !can(user, "prep.plan")) return fail(403, "Your role cannot see recipes.");
  const s = await ensureMenuSync();
  return {
    ok: true,
    menu: {
      sync: s ? { at: s.at, label: syncLine(s), source: "simphony" } : null,
      changes: { ...(s?.changes ?? { added: [], priceChanged: [], removed: [] }), addedNames: (s?.changes.added ?? []).map((id) => s!.newDishes.find((d) => d.posId === id)?.name ?? id) },
      prices: s?.prices ?? {}, archived: s?.archived ?? {},
      newDishes: (s?.newDishes ?? []).map((d) => ({ ...d, suggestedCost: cost(d.suggestion.lines), recipeCost: d.confirmed ? cost(d.confirmed.recipe) : null })),
      modifiers: MODIFIER_RULES, examples: await examples().catch(() => []), mayConfirm: can(user, "prep.plan") || can(user, "stock.editPrices"),
    },
  };
}

/** The chef confirms a new dish's recipe, as suggested or changed. From then on the dish is costed from the recipe. */
export function confirmRecipe(user: User, body: Record<string, unknown>): Result<{ dish: NewDish }> {
  if (!can(user, "prep.plan") && !can(user, "stock.editPrices")) return fail(403, "The chef or a manager who sets prices confirms recipes.");
  const posId = typeof body.posId === "string" ? body.posId : "";
  const raw = Array.isArray(body.lines) ? (body.lines as Record<string, unknown>[]) : [];
  if (!raw.length || raw.length > 30) return fail(400, "A recipe needs at least one ingredient.");
  const lines: RecipeLine[] = [];
  for (const l of raw) {
    const g = ingredientById[String(l.ingredientId)];
    const qty = Number(l.qty);
    if (!g) return fail(400, "Unknown ingredient in the recipe.");
    if (!Number.isFinite(qty) || qty <= 0 || qty > 20) return fail(400, `Enter a quantity per portion for ${g.name}.`);
    if (lines.some((x) => x.ingredientId === g.id)) return fail(400, `${g.name} appears twice.`);
    lines.push({ ingredientId: g.id, qty: Math.round(qty * 10000) / 10000 });
  }
  const out = mutateStore((x) => {
    const d = x.menuSync?.newDishes.find((n) => n.posId === posId);
    if (!d) return null;
    if (d.status === "confirmed") return "done" as const;
    d.status = "confirmed";
    d.confirmed = { at: new Date().toISOString(), by: user.id, role: user.role, recipe: lines };
    if (!x.menuSync!.newDishes.some((n) => n.status === "needs_recipe")) resolve(x, "menu-new-dish", `menu-${x.menuSync!.day}`);
    return d;
  });
  if (out === null) return fail(404, "This dish is not waiting for a recipe.");
  if (out === "done") return fail(409, "This recipe was already confirmed.");
  return { ok: true, dish: out };
}
