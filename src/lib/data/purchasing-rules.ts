// Demo purchasing rules. Each hotel sets its own approval thresholds and budget; nothing here is sent to a supplier.
import { ingredientCostAt } from "../domain/pricing";
import { ingredientById, propertyById, supplierById } from "./catalog";

export interface ApprovalPolicy {
  /** Requests above this total (hotel currency) need accounting approval. 0 means every request. */
  accountingAbove: number;
  /** Requests above this total also need a senior manager's sign-off. */
  managerAbove: number;
  managerLabel: string;
}

/** Demo policies. Dubai sends every request to accounting; Doha lets small ones through after purchasing. */
export const APPROVAL_POLICY: Record<string, ApprovalPolicy> = {
  dxb: { accountingAbove: 0, managerAbove: 5000, managerLabel: "General manager" },
  doh: { accountingAbove: 1500, managerAbove: 8000, managerLabel: "General manager" },
};


/** A second supplier quoting for each category, at a fixed difference from the usual price. */
const ALTERNATIVES: Record<string, { id: string; name: string; factor: number; extraLead: number }> = {
  meat: { id: "meat-alt", name: "Emirates Butchery Co.", factor: 1.06, extraLead: 1 },
  sea: { id: "sea-alt", name: "Gulf Catch Trading", factor: 0.97, extraLead: 1 },
  produce: { id: "produce-alt", name: "Desert Farms Direct", factor: 1.04, extraLead: 0 },
  bakery: { id: "bakery-alt", name: "Artisan Bread House", factor: 1.05, extraLead: 0 },
  dry: { id: "dry-alt", name: "Oasis Foodservice", factor: 0.98, extraLead: 1 },
  bev: { id: "bev-alt", name: "Arabian Drinks Distribution", factor: 1.03, extraLead: 1 },
};

export interface Quote {
  supplierId: string;
  name: string;
  unitPrice: number;
  leadDays: number;
  usual: boolean;
}

/** Prices each supplier quotes for an ingredient, in the hotel's currency. The usual supplier comes first. */
export function quotesFor(ingredientId: string, propertyId: string, date: string): Quote[] {
  const g = ingredientById[ingredientId];
  const base = Math.round(ingredientCostAt(ingredientId, date) * propertyById[propertyId].costFactor * 100) / 100;
  const out: Quote[] = [{ supplierId: g.supplierId, name: supplierById[g.supplierId].name, unitPrice: base, leadDays: g.leadDays, usual: true }];
  const alt = ALTERNATIVES[g.supplierId];
  if (alt) out.push({ supplierId: alt.id, name: alt.name, unitPrice: Math.round(base * alt.factor * 100) / 100, leadDays: g.leadDays + alt.extraLead, usual: false });
  return out;
}

export const supplierName = (id: string) => supplierById[id]?.name ?? Object.values(ALTERNATIVES).find((a) => a.id === id)?.name ?? id;

/** The approval steps a request of this size needs at this hotel, in order. */
export function approvalSteps(propertyId: string, total: number): ("purchasing" | "accounting" | "manager")[] {
  const p = APPROVAL_POLICY[propertyId];
  const steps: ("purchasing" | "accounting" | "manager")[] = ["purchasing"];
  if (total > p.accountingAbove) steps.push("accounting");
  if (total > p.managerAbove) steps.push("manager");
  return steps;
}
