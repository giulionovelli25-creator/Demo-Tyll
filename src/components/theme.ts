// One icon and one accent per module. The accent is a token set: see data-mod in tokens.css.
import { Banknote, Bell, BedDouble, CalendarDays, ClipboardList, FileSearch, FileText, Landmark, LayoutDashboard, LayoutGrid, Package, Settings, ShoppingCart, Smartphone, Trash2, UtensilsCrossed, Wine, type LucideIcon } from "lucide-react";
import type { ModuleId } from "@/lib/domain/access";

export const MODULE_ICON: Record<ModuleId, LucideIcon> = {
  staff: Smartphone, tasks: ClipboardList, overview: LayoutDashboard, money: Banknote, stock: Package, forecast: ShoppingCart, events: CalendarDays,
  flow: UtensilsCrossed, rooms: BedDouble, investigations: FileSearch, finance: Landmark, reports: FileText, settings: Settings, alerts: Bell, more: LayoutGrid, waste: Trash2, drinks: Wine,
};

export const MODULE_TONE: Record<ModuleId, string> = {
  overview: "indigo", alerts: "indigo", more: "indigo",
  waste: "teal", stock: "teal",
  forecast: "violet",
  money: "blue", finance: "blue", investigations: "blue",
  drinks: "rose",
  reports: "plum", settings: "slate",
  events: "terracotta", rooms: "rose", flow: "brown", tasks: "cyan", staff: "cyan",
};

/** Each outlet's colours: tone for the app's accent, mark for dots and bars. */
export const OUTLET_TONE: Record<string, { tone: string; mark: string }> = {
  "dxb-lune": { tone: "burgundy", mark: "rose" },
  "dxb-terrace": { tone: "emerald", mark: "green" },
  "dxb-pool": { tone: "azure", mark: "blue" },
  "dxb-lobby": { tone: "violet", mark: "violet" },
  "dxb-ird": { tone: "bronze", mark: "amber" },
  "doh-dana": { tone: "burgundy", mark: "rose" },
  "doh-souq": { tone: "emerald", mark: "green" },
  "doh-sky": { tone: "azure", mark: "blue" },
  "doh-ird": { tone: "bronze", mark: "amber" },
};
