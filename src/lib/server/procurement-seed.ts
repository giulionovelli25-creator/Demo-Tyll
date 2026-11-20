// Starting purchasing master data for the demo hotel: supplier terms, the catalogue each supplier sells to the hotel,
// and par levels. Fictional companies, people, phone numbers and addresses (.example). Prices are the demo price list.
import { INGREDIENTS, ingredientById, storeOwner, supplierById } from "../data/catalog";
import { getDataset, getOutletStock } from "../data/generate";
import { quotesFor, supplierName } from "../data/purchasing-rules";
import { stockAreaOf } from "../data/locations";
import { avgDailyUsage, orderPack, usageFromSales } from "../domain/inventory";
import { VAT_SCHEMES, suggestPar } from "../domain/procurement";
import type { CatalogueLine, OutboxEmail, ParRecord, PurchasingSettings, SupplierAccount } from "../types";
import { DEMO_TODAY, addDays, rel } from "../util";

export interface ProcurementShape {
  suppliers: SupplierAccount[];
  catalogue: CatalogueLine[];
  pars: ParRecord[];
  settings: Record<string, PurchasingSettings>;
  outbox: OutboxEmail[];
}

type Terms = Omit<SupplierAccount, "id" | "propertyId" | "name" | "active">;
const TERMS: Record<string, Terms> = {
  meat: { contact: "Rui Ribeiro", phone: "+351 21 000 0101", orderEmail: "encomendas@carnes-ribeiro.example", deliveryDays: [1, 2, 3, 4, 5, 6], cutOff: "14:00", minOrderValue: 150, paymentTerms: "30 days from invoice", leadDays: 1 },
  sea: { contact: "Marta Sousa", phone: "+351 21 000 0102", orderEmail: "pedidos@peixaria-atlantico.example", deliveryDays: [2, 3, 4, 5, 6], cutOff: "12:00", minOrderValue: 120, paymentTerms: "15 days from invoice", leadDays: 1 },
  produce: { contact: "Joana Tejo", phone: "+351 21 000 0103", orderEmail: "orders@hortas-tejo.example", deliveryDays: [1, 2, 3, 4, 5, 6], cutOff: "16:00", minOrderValue: 80, paymentTerms: "30 days from invoice", leadDays: 1 },
  dry: { contact: "Paulo Lusa", phone: "+351 21 000 0104", orderEmail: "encomendas@mercearia-lusa.example", deliveryDays: [1, 3, 5], cutOff: "15:00", minOrderValue: 200, paymentTerms: "30 days end of month", leadDays: 2 },
  wine: { contact: "Inês Douro", phone: "+351 22 000 0105", orderEmail: "orders@douro-cellars.example", deliveryDays: [2, 4], cutOff: "12:00", minOrderValue: 250, paymentTerms: "45 days end of month", leadDays: 2 },
  bev: { contact: "Carlos Fonte", phone: "+351 21 000 0106", orderEmail: "pedidos@fonte-clara.example", deliveryDays: [1, 3, 5], cutOff: "14:00", minOrderValue: 150, paymentTerms: "30 days end of month", leadDays: 1 },
  ware: { contact: "Sofia Horeca", phone: "+351 21 000 0107", orderEmail: "vendas@horeca-iberica.example", deliveryDays: [3], cutOff: "12:00", minOrderValue: 300, paymentTerms: "60 days end of month", leadDays: 5 },
  hk: { contact: "Teresa Linho", phone: "+351 21 000 0108", orderEmail: "orders@linho-lisboa.example", deliveryDays: [2, 5], cutOff: "12:00", minOrderValue: 200, paymentTerms: "30 days end of month", leadDays: 3 },
  // The backup butcher takes orders until 22:00 for a delivery by 09:30 the next morning, every day, at a higher price.
  "meat-alt": { contact: "Nuno Central", phone: "+351 21 000 0201", orderEmail: "orders@talho-central.example", deliveryDays: [0, 1, 2, 3, 4, 5, 6], cutOff: "22:00", minOrderValue: 150, paymentTerms: "30 days from invoice", leadDays: 1, notes: "Backup butcher. Orders by 22:00 arrive by 09:30 the next morning." },
  "sea-alt": { contact: "Elena Mar", phone: "+351 21 000 0202", orderEmail: "pedidos@mar-azul.example", deliveryDays: [2, 4, 6], cutOff: "11:00", minOrderValue: 200, paymentTerms: "30 days from invoice", leadDays: 2 },
  "produce-alt": { contact: "Miguel Verde", phone: "+351 21 000 0203", orderEmail: "orders@quinta-verde.example", deliveryDays: [1, 3, 5], cutOff: "15:00", minOrderValue: 120, paymentTerms: "30 days from invoice", leadDays: 1 },
  "dry-alt": { contact: "Ana Oasis", phone: "+351 21 000 0204", orderEmail: "orders@oasis-foodservice.example", deliveryDays: [2, 4], cutOff: "14:00", minOrderValue: 300, paymentTerms: "30 days end of month", leadDays: 2 },
  "bev-alt": { contact: "Luís Ibéria", phone: "+351 21 000 0205", orderEmail: "orders@iberia-drinks.example", deliveryDays: [2, 4], cutOff: "13:00", minOrderValue: 200, paymentTerms: "30 days end of month", leadDays: 2 },
};

/** Packs as suppliers sell them. Liquids by the case or keg; everything else from the item's pack. */
const LIQUID_PACKS: Record<string, { size: number; label: string }> = {
  wine: { size: 9, label: "Case of 12 × 75 cl" }, rum: { size: 6, label: "Case of 6 × 1 L" }, vodka: { size: 6, label: "Case of 6 × 1 L" }, liqueur: { size: 6, label: "Case of 6 × 1 L" },
  cream: { size: 6, label: "Case of 6 × 1 L" }, milk: { size: 12, label: "Case of 12 × 1 L" }, soda: { size: 6, label: "Case of 24 × 25 cl" }, beerkeg: { size: 30, label: "Keg of 30 L" },
  stock: { size: 5, label: "Case of 5 × 1 L" }, oil: { size: 10, label: "Drum of 10 L" }, oliveoil: { size: 5, label: "Tin of 5 L" }, chem: { size: 5, label: "Can of 5 L" },
};

export function packOf(ingredientId: string): { size: number; label: string } {
  const g = ingredientById[ingredientId];
  if (LIQUID_PACKS[g.id]) return LIQUID_PACKS[g.id];
  if (g.unit === "each") return { size: g.packSize, label: `Case of ${g.packSize}` };
  const n = orderPack(g);
  return { size: n, label: n === 1 ? "Per kg" : n < 1 ? `Pack of ${Math.round(n * 1000)} g` : `Pack of ${n} kg` };
}

/** EAN-13 with a valid check digit, in the 29 range kept for in-house codes, so it can never match a real product. */
export function ean13(n: number): string {
  const body = `29${String(n).padStart(10, "0")}`;
  const sumOf = body.split("").reduce((s, d, i) => s + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return `${body}${(10 - (sumOf % 10)) % 10}`;
}

/** Outlets are topped up from the main store in these steps: a six-pack, a bottle of wine, half a kilo or litre. */
export const issueStep = (ingredientId: string) => (ingredientById[ingredientId].unit === "each" ? 6 : ingredientId === "wine" ? 0.75 : 0.5);
const ceilStep = (n: number, step: number) => Math.round(Math.max(step, Math.ceil(n / step - 1e-9) * step) * 1000) / 1000;

const ALT_OF: Record<string, string> = { meat: "meat-alt", sea: "sea-alt", produce: "produce-alt", dry: "dry-alt", bev: "bev-alt" };

export function seedProcurement(): ProcurementShape {
  const propertyId = "lis";
  const scheme = VAT_SCHEMES.PT;
  const ids = [...new Set([...INGREDIENTS.map((g) => g.supplierId), ...INGREDIENTS.map((g) => ALT_OF[g.supplierId]).filter(Boolean)])];
  const suppliers: SupplierAccount[] = ids.filter((id) => TERMS[id]).map((id) => ({ id, propertyId, name: supplierById[id]?.name ?? supplierName(id), active: true, ...TERMS[id] }));
  const catalogue: CatalogueLine[] = [];
  INGREDIENTS.forEach((g, i) => {
    const pack = packOf(g.id);
    const vatRate = scheme.rates[stockAreaOf(g.id)];
    quotesFor(g.id, propertyId, DEMO_TODAY).forEach((q, k) => {
      if (!TERMS[q.supplierId]) return;
      catalogue.push({ propertyId, supplierId: q.supplierId, ingredientId: g.id, code: `${q.supplierId.replace("-alt", "").toUpperCase().slice(0, 3)}${k ? "A" : ""}-${String(i + 1).padStart(4, "0")}`, barcode: ean13((i + 1) * 10 + k), packSize: pack.size, packLabel: pack.label, agreedPrice: q.unitPrice, vatRate, preferred: q.usual });
    });
  });
  // Par levels from four weeks of use: the minimum covers the supplier's lead time and a day's safety, the maximum one order cycle more.
  const avg = avgDailyUsage(getDataset().dayItems, propertyId);
  const at = `${rel(-21)}T10:00`;
  const pars: ParRecord[] = INGREDIENTS.filter((g) => g.dept !== "glassware" && g.dept !== "supplies").map((g) => {
    const terms = TERMS[g.supplierId];
    const cycle = terms ? Math.max(1, Math.round(7 / terms.deliveryDays.length)) : 3;
    const p = suggestPar(avg.get(g.id) ?? 0, terms?.leadDays ?? g.leadDays, cycle, 1, packOf(g.id).size);
    return { propertyId, location: storeOwner(propertyId, g.id) ?? "main", ingredientId: g.id, min: p.min, max: p.max, by: "u-fnb", at, source: "seed" as const };
  }).filter((p) => p.max > 0);
  // Each bar and kitchen keeps working stock of what it counts at close: at least a day of use, topped up to two and a half.
  const from = addDays(DEMO_TODAY, -28);
  const counted = new Set(getOutletStock().checks.map((c) => `${c.outletId}|${c.ingredientId}`));
  for (const key of [...counted].sort()) {
    const [outletId, ingredientId] = key.split("|");
    const use = (usageFromSales(getDataset().dayItems, (r) => r.outletId === outletId && r.date >= from && r.date < DEMO_TODAY).get(ingredientId) ?? 0) / 28;
    if (use <= 0) continue;
    const step = issueStep(ingredientId);
    pars.push({ propertyId, location: outletId, ingredientId, min: ceilStep(use, step), max: ceilStep(use * 2.5, step), by: "u-fnb", at, source: "seed" });
  }
  const settings: Record<string, PurchasingSettings> = {
    lis: { valuation: "wac", vatScheme: "PT", costCentres: [{ id: "4100", name: "F&B food" }, { id: "4200", name: "F&B beverage" }, { id: "4300", name: "Banquets" }, { id: "4500", name: "Operating supplies" }] },
  };
  return { suppliers, catalogue, pars, settings, outbox: [] };
}
