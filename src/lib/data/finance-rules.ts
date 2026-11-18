import { MONTH_START, rel } from "../util";
// Demo finance set-up: departments that hold a budget, this month's budgets, and the hotel's other spending earlier in the
// month. Budgets and the non-F&B history are simulated planning figures, not balances from an accounting system.
// F&B spending is not listed here: it comes from the supplier invoices in the dataset and from Tyll's own orders.

export type FinDept = "fnb" | "events" | "hk" | "eng";
export type FinCategory = "fnb" | "events" | "hk_supplies" | "maintenance";

export const FIN_DEPTS: { id: FinDept; label: string; category: FinCategory }[] = [
  { id: "fnb", label: "Food & beverage stores", category: "fnb" },
  { id: "events", label: "Events", category: "events" },
  { id: "hk", label: "Housekeeping", category: "hk_supplies" },
  { id: "eng", label: "Engineering & maintenance", category: "maintenance" },
];
export const FIN_DEPT_LABEL = Object.fromEntries(FIN_DEPTS.map((d) => [d.id, d.label])) as Record<FinDept, string>;
export const CATEGORY_LABEL: Record<FinCategory, string> = { fnb: "Food & beverage purchasing", events: "Event costs", hk_supplies: "Housekeeping supplies", maintenance: "Maintenance supplies" };

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthEnd = () => { const d = new Date(Date.parse(`${MONTH_START}T00:00:00Z`)); d.setUTCMonth(d.getUTCMonth() + 1, 0); return d.toISOString().slice(0, 10); };
/** The budget month is the business date's month. */
export const BUDGET_MONTH = { label: `${MONTH_NAMES[Number(MONTH_START.slice(5, 7)) - 1]} ${MONTH_START.slice(0, 4)}`, from: MONTH_START, to: monthEnd() };

/** This month's budgets, in euros. */
export const BUDGETS: Record<string, Record<FinDept, number>> = {
  lis: { fnb: 95000, events: 16000, hk: 11000, eng: 7500 },
};

export interface HistoryExpense {
  id: string;
  propertyId: string;
  dept: FinDept;
  date: string;
  supplier: string;
  description: string;
  amount: number;
}

/** Spending recorded in the last few weeks outside F&B purchasing. Simulated demo history. */
export const HISTORY_EXPENSES: HistoryExpense[] = [
  { id: "EXP-LIS-H01", propertyId: "lis", dept: "hk", date: rel(-11), supplier: "Linho Lisboa", description: "Guest amenity restock", amount: 2100 },
  { id: "EXP-LIS-H02", propertyId: "lis", dept: "hk", date: rel(-8), supplier: "Linho Lisboa", description: "Laundry chemicals", amount: 790 },
  { id: "EXP-LIS-H03", propertyId: "lis", dept: "hk", date: rel(-4), supplier: "Lavandaria Tejo", description: "Linen rental, last week", amount: 1550 },
  { id: "EXP-LIS-H04", propertyId: "lis", dept: "eng", date: rel(-10), supplier: "Climatec Lisboa", description: "Air-conditioning filter replacement", amount: 1200 },
  { id: "EXP-LIS-H05", propertyId: "lis", dept: "eng", date: rel(-6), supplier: "Materiais Alfama", description: "Plumbing parts", amount: 590 },
  { id: "EXP-LIS-H06", propertyId: "lis", dept: "eng", date: rel(-3), supplier: "Elevadores Sete Colinas", description: "Lift service visit", amount: 1400 },
  { id: "EXP-LIS-H07", propertyId: "lis", dept: "events", date: rel(-9), supplier: "Flores da Graça", description: "Flowers, gala dinner", amount: 2450 },
  { id: "EXP-LIS-H08", propertyId: "lis", dept: "events", date: rel(-9), supplier: "Palco AV", description: "Sound and screens, gala dinner", amount: 3100 },
  { id: "EXP-LIS-H09", propertyId: "lis", dept: "events", date: rel(-2), supplier: "Lavandaria Tejo", description: "Table linen hire", amount: 980 },
];
