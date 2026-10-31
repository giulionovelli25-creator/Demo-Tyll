// A soft colour per module, for its icons and page header. Navigation only: status keeps green, amber and red.
import { Banknote, BedDouble, CalendarDays, ClipboardList, FileSearch, FileText, Landmark, LayoutDashboard, Package, Settings, Smartphone, TrendingUp, UtensilsCrossed, type LucideIcon } from "lucide-react";
import type { CSSProperties } from "react";
import type { ModuleId } from "@/lib/domain/access";

export const MODULE_ICON: Record<ModuleId, LucideIcon> = {
  staff: Smartphone, tasks: ClipboardList, overview: LayoutDashboard, money: Banknote, stock: Package, forecast: TrendingUp, events: CalendarDays,
  flow: UtensilsCrossed, rooms: BedDouble, investigations: FileSearch, finance: Landmark, reports: FileText, settings: Settings,
};

export const MODULE_THEME: Record<ModuleId, { color: string; soft: string }> = {
  forecast: { color: "#4a3fb5", soft: "#efedfb" }, // Purchasing Prediction: violet
  stock: { color: "#0f6f74", soft: "#e2f2f2" }, // Stock and waste: teal
  finance: { color: "#1f5aa6", soft: "#e6eefa" }, // Reconciliation: blue
  money: { color: "#1f5aa6", soft: "#e6eefa" },
  events: { color: "#b24a2a", soft: "#fbece5" }, // Events and staffing: terracotta
  rooms: { color: "#a33a68", soft: "#f9e9f0" }, // Rooms and guests: rose
  reports: { color: "#5a4a8a", soft: "#f0edf7" }, // Sales and performance: plum
  overview: { color: "#3b3f9c", soft: "#ececf8" }, // Overview: the accent
  investigations: { color: "#6b4a9e", soft: "#f1ebf8" },
  flow: { color: "#7a5a2e", soft: "#f5efe4" },
  tasks: { color: "#0e6a8a", soft: "#e2f1f6" },
  staff: { color: "#0e6a8a", soft: "#e2f1f6" },
  settings: { color: "#4b5563", soft: "#eef0f3" },
};

/** CSS variables for a module's colour; children use var(--mod) and var(--mod-soft). */
export const moduleStyle = (m: ModuleId) => ({ "--mod": MODULE_THEME[m].color, "--mod-soft": MODULE_THEME[m].soft }) as CSSProperties;
