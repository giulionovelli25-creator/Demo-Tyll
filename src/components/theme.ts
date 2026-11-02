// One icon per module. Colour stays restrained: the same quiet navy tile everywhere, so the money copper and the status colours stand out.
import { Banknote, Bell, BedDouble, CalendarDays, ClipboardList, FileSearch, FileText, Landmark, LayoutDashboard, LayoutGrid, Package, Settings, ShoppingCart, Smartphone, Trash2, UtensilsCrossed, type LucideIcon } from "lucide-react";
import type { ModuleId } from "@/lib/domain/access";

export const MODULE_ICON: Record<ModuleId, LucideIcon> = {
  staff: Smartphone, tasks: ClipboardList, overview: LayoutDashboard, money: Banknote, stock: Package, forecast: ShoppingCart, events: CalendarDays,
  flow: UtensilsCrossed, rooms: BedDouble, investigations: FileSearch, finance: Landmark, reports: FileText, settings: Settings, alerts: Bell, more: LayoutGrid, waste: Trash2,
};
