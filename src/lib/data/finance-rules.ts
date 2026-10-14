// Demo finance set-up: departments that hold a budget, October budgets, and the hotel's other spending earlier in the
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

export const BUDGET_MONTH = { label: "October 2026", from: "2026-10-01", to: "2026-10-31" };

/** October budgets in each hotel's own currency (Dubai AED, Doha QAR). */
export const BUDGETS: Record<string, Record<FinDept, number>> = {
  dxb: { fnb: 260000, events: 60000, hk: 38000, eng: 25000 },
  doh: { fnb: 265000, events: 45000, hk: 30000, eng: 20000 },
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

/** Spending recorded earlier in October outside F&B purchasing. Simulated demo history. */
export const HISTORY_EXPENSES: HistoryExpense[] = [
  { id: "EXP-DXB-H01", propertyId: "dxb", dept: "hk", date: "2026-10-02", supplier: "Linen & Amenities Co.", description: "Guest amenity restock", amount: 8400 },
  { id: "EXP-DXB-H02", propertyId: "dxb", dept: "hk", date: "2026-10-05", supplier: "Linen & Amenities Co.", description: "Laundry chemicals", amount: 3150 },
  { id: "EXP-DXB-H03", propertyId: "dxb", dept: "hk", date: "2026-10-09", supplier: "Gulf Linen Services", description: "Linen rental, first week", amount: 6200 },
  { id: "EXP-DXB-H04", propertyId: "dxb", dept: "eng", date: "2026-10-03", supplier: "Coolair Technical", description: "Air-conditioning filter replacement", amount: 4800 },
  { id: "EXP-DXB-H05", propertyId: "dxb", dept: "eng", date: "2026-10-07", supplier: "Al Noor Building Supplies", description: "Plumbing parts", amount: 2350 },
  { id: "EXP-DXB-H06", propertyId: "dxb", dept: "eng", date: "2026-10-10", supplier: "Aqua Pools LLC", description: "Pool pump service", amount: 5600 },
  { id: "EXP-DXB-H07", propertyId: "dxb", dept: "events", date: "2026-10-04", supplier: "Bloom Florists", description: "Flowers, 4 October gala", amount: 9800 },
  { id: "EXP-DXB-H08", propertyId: "dxb", dept: "events", date: "2026-10-04", supplier: "Stagecraft AV", description: "Sound and screens, 4 October gala", amount: 12400 },
  { id: "EXP-DXB-H09", propertyId: "dxb", dept: "events", date: "2026-10-11", supplier: "Gulf Linen Services", description: "Table linen hire", amount: 3900 },
  { id: "EXP-DOH-H01", propertyId: "doh", dept: "hk", date: "2026-10-03", supplier: "Doha Hotel Supplies", description: "Guest amenity restock", amount: 7100 },
  { id: "EXP-DOH-H02", propertyId: "doh", dept: "hk", date: "2026-10-08", supplier: "Doha Hotel Supplies", description: "Cleaning chemicals", amount: 2600 },
  { id: "EXP-DOH-H03", propertyId: "doh", dept: "eng", date: "2026-10-06", supplier: "Pearl Technical Services", description: "Lift maintenance visit", amount: 6900 },
  { id: "EXP-DOH-H04", propertyId: "doh", dept: "eng", date: "2026-10-12", supplier: "Pearl Technical Services", description: "Lighting repairs", amount: 1850 },
  { id: "EXP-DOH-H05", propertyId: "doh", dept: "events", date: "2026-10-05", supplier: "Corniche Events", description: "Stage and lighting, wedding", amount: 14200 },
];
