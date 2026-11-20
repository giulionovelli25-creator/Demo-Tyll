// Ingredient prices from approved supplier invoices: the weighted average cost over the last 90 days, the last invoice
// price and the contract price, per ingredient. A price typed by hand is an explained override: who, when and why, and
// it can be taken back so the invoice price applies again. Recipes and stock values read the same figure.
import { INGREDIENTS, supplierById } from "../data/catalog";
import { allowedProperties, can } from "../domain/access";
import { ingredientCostAt } from "../domain/pricing";
import type { Role, User } from "../types";
import { DEMO_TODAY, addDays, round2 } from "../util";
import { approvedInvoiceLines } from "./finance";
import { catalogueFor } from "./procurement";
import { loadStore, type Shape } from "./purchasing-store";
import type { Result } from "./purchasing";

export const PRICE_WINDOW_DAYS = 90;
export const PRICE_BASIS = "Valued at weighted average cost from supplier invoices";

export interface IngredientPrice {
  ingredientId: string;
  /** Weighted average over approved invoices in the window: quantity times price, over quantity. */
  wac: number | null;
  invoices: number;
  last: { price: number; date: string; supplier: string; ref: string } | null;
  contract: { price: number; supplier: string } | null;
  override: { price: number; by: string; role: Role; at: string; reason: string } | null;
  /** The price recipes and stock use: the override, else the invoice average, else the list price. */
  effective: number;
  basis: "override" | "invoices" | "list";
}

/** Pure: every ingredient's prices from invoice lines and the overrides in force. */
export function priceTable(s: Shape, propertyId: string, today = DEMO_TODAY): IngredientPrice[] {
  const from = addDays(today, -PRICE_WINDOW_DAYS);
  const lines = approvedInvoiceLines(s, propertyId).filter((l) => l.date >= from && l.date <= today);
  const rec = s.records;
  return INGREDIENTS.filter((g) => g.dept !== "glassware" && g.dept !== "supplies").map((g) => {
    const mine = lines.filter((l) => l.ingredientId === g.id);
    const qty = mine.reduce((t, l) => t + l.qty, 0);
    const wac = qty > 0 ? round2(mine.reduce((t, l) => t + l.qty * l.price, 0) / qty) : null;
    const lastLine = mine.at(-1);
    const cat = catalogueFor(propertyId, g.id, s)[0];
    const ov = rec?.priceOverrides.find((p) => p.id === g.id);
    const log = ov ? rec?.priceLog.find((e) => e.ingredientId === g.id && !e.cleared) : undefined;
    const override = ov && log ? { price: ov.value, by: log.by, role: log.role, at: log.at, reason: log.reason ?? "No reason given (set before reasons were asked)" } : null;
    const effective = override?.price ?? wac ?? round2(ingredientCostAt(g.id, today));
    return {
      ingredientId: g.id, wac, invoices: new Set(mine.map((l) => l.ref)).size,
      last: lastLine ? { price: round2(lastLine.price), date: lastLine.date, supplier: supplierById[lastLine.supplierId]?.name ?? lastLine.supplierId, ref: lastLine.ref } : null,
      contract: cat ? { price: cat.agreedPrice, supplier: supplierById[cat.supplierId]?.name ?? cat.supplierId } : null,
      override, effective, basis: override ? "override" : wac !== null ? "invoices" : "list",
    };
  });
}

export function ingredientPricesFor(user: User, propertyId: string): Result<{ prices: IngredientPrice[]; basis: string; windowDays: number; mayEdit: boolean }> {
  if (!allowedProperties(user).includes(propertyId)) return { ok: false, status: 403, error: "This hotel is outside your access." };
  if (!can(user, "stock.review") && !can(user, "stock.editPrices") && !can(user, "prep.plan")) return { ok: false, status: 403, error: "Your role cannot see ingredient prices." };
  return { ok: true, prices: priceTable(loadStore(), propertyId), basis: PRICE_BASIS, windowDays: PRICE_WINDOW_DAYS, mayEdit: can(user, "stock.editPrices") };
}
