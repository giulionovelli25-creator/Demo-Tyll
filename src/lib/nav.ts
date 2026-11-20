// The sidebar, grouped into the three sections of tyll.ai. One list, read by the sidebar, the phone menu, the page colour and the Back button.
// Each page appears once. Similar pages are merged into one item and reached by the tabs on that page.
import {
  Banknote, Bell, CalendarClock, CalendarX, ClipboardCheck, ListChecks, Store, FileText, Flag, LayoutDashboard, LayoutGrid, Package, Settings, ShoppingCart, Trash2, Truck, ClipboardList, Wine, type LucideIcon,
} from "lucide-react";
import { moduleOfPath, type ModuleId, type Permission } from "./domain/access";

export interface NavItem {
  id: string;
  label: string;
  /** Shorter label for the narrow rail and the phone bar. */
  short?: string;
  href: string;
  icon: LucideIcon;
  /** Other addresses that are this same item: the tabs on its page. */
  also?: string[];
  /** Only for roles with one of these permissions. */
  needs?: Permission[];
}

export interface NavSection {
  id: "stock" | "purchasing" | "revenue";
  title: string;
  icon: LucideIcon;
  /** The section colour, a data-mod value in tokens.css. */
  tone: string;
  /** Most used first. */
  items: NavItem[];
}

export const PINNED: NavItem[] = [
  { id: "overview", label: "Overview", href: "/", icon: LayoutDashboard },
  { id: "alerts", label: "Alerts", href: "/alerts", icon: Bell },
];

export const SECTIONS: NavSection[] = [
  {
    id: "stock", title: "Stock and waste", icon: Package, tone: "teal",
    items: [
      { id: "stock", label: "Stock levels", short: "Stock", href: "/stock", icon: Package },
      { id: "expiry", label: "Expiring soon", short: "Expiry", href: "/stock?tab=expiry", icon: CalendarX },
      { id: "waste", label: "Waste and breakage", short: "Waste", href: "/waste", icon: Trash2 },
      { id: "missing", label: "Stock takes and missing stock", short: "Counts", href: "/stock?tab=takes", icon: ClipboardCheck, also: ["/stock?tab=where", "/stock?tab=bought", "/stock?tab=counts"] },
      { id: "drinks", label: "Over pouring", short: "Pouring", href: "/drinks", icon: Wine },
    ],
  },
  {
    id: "purchasing", title: "Purchasing", icon: ShoppingCart, tone: "blue",
    items: [
      { id: "toorder", label: "To order", short: "To order", href: "/forecast?tab=toorder", icon: ListChecks, also: ["/forecast?tab=pars"], needs: ["purchase.create"] },
      { id: "auto", label: "Automatic ordering", short: "Auto order", href: "/forecast?tab=auto", icon: CalendarClock, needs: ["purchase.create"] },
      { id: "predictions", label: "Predictions", short: "Predict", href: "/forecast", icon: ShoppingCart, also: ["/forecast?tab=prep", "/forecast?tab=outlook"] },
      { id: "orders", label: "Orders", href: "/forecast?tab=approvals", icon: ClipboardList, also: ["/forecast?tab=buy"] },
      { id: "suppliers", label: "Suppliers", href: "/forecast?tab=suppliers", icon: Store, also: ["/forecast?tab=catalogue"], needs: ["purchase.create"] },
      { id: "deliveries", label: "Deliveries and invoices", short: "Deliveries", href: "/stock?tab=suppliers", icon: Truck, also: ["/finance?tab=invoices", "/finance?tab=approvals", "/finance?tab=reports"] },
    ],
  },
  {
    id: "revenue", title: "Revenue and reconciliation", icon: Banknote, tone: "violet",
    items: [
      { id: "revenue", label: "Revenue", href: "/money", icon: Banknote, also: ["/money?tab=outlets", "/money?tab=waiters", "/money?tab=covers"] },
      { id: "flags", label: "Flagged transactions", short: "Flags", href: "/money?tab=flags", icon: Flag, also: ["/money?tab=mistakes", "/money?tab=cash", "/money?tab=rooms", "/money?tab=till"] },
      { id: "reports", label: "Reports", href: "/reports", icon: FileText },
    ],
  },
];

/** Settings and help, folded at the foot of the sidebar. */
export const FOOT: NavItem[] = [
  { id: "settings", label: "Settings", href: "/settings", icon: Settings },
  { id: "more", label: "Other tools", href: "/more", icon: LayoutGrid },
];

export const ALL_ITEMS: NavItem[] = [...PINNED, ...SECTIONS.flatMap((s) => s.items), ...FOOT];

const split = (href: string) => {
  const [path, query] = href.split("?");
  return { path, tab: query ? new URLSearchParams(query).get("tab") : null };
};

/** The module a link belongs to, for access and for the public demo's role switch. */
export const moduleOfItem = (i: NavItem): ModuleId => moduleOfPath(split(i.href).path);

/** Which sidebar item is the current page. Sub pages light up the item they belong to. */
export function activeItem(pathname: string, tab: string | null): NavItem | null {
  const addresses = ALL_ITEMS.flatMap((i) => [i.href, ...(i.also ?? [])].map((h) => ({ i, ...split(h) })));
  if (tab !== null) {
    const exact = addresses.find((x) => x.path === pathname && x.tab === tab);
    if (exact) return exact.i;
  }
  // Pages found inside another page: All transactions, the Money Back List, the menu, the count.
  const SUB: Record<string, string> = { "/investigations": "flags", "/menu": "revenue", "/performance": "revenue", "/finance": "deliveries", "/count": "stock" };
  const root = `/${pathname.split("/")[1]}`;
  if (SUB[root]) return ALL_ITEMS.find((i) => i.id === SUB[root]) ?? null;
  return addresses.find((x) => x.path === pathname && x.tab === null)?.i ?? null;
}

/** The section a page belongs to, or null for Overview, Alerts, settings and the other tools. */
export function sectionOf(pathname: string, tab: string | null): NavSection | null {
  const item = activeItem(pathname, tab);
  return item ? SECTIONS.find((s) => s.items.includes(item)) ?? null : null;
}

/** Addresses that are a sidebar item's own page, including the tabs on it. They need no Back button. */
export const SIDEBAR_PAGES = new Set(SECTIONS.flatMap((s) => s.items.flatMap((i) => [i.href, ...(i.also ?? [])])));
