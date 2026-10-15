"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Banknote, BedDouble, CalendarDays, ClipboardList, FileSearch, FileText, LayoutDashboard, LockKeyhole, LogOut, Menu, Package, PlayCircle, Search, Settings, TrendingUp, UtensilsCrossed, X,
  ChevronDown,
  Landmark,
  Smartphone,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { BrandLoader, TyllLogo, TyllMark } from "@/components/brand";
import { Badge, Button, EmptyState, Field, Segmented, Select, Toaster, cn, report } from "@/components/ui";
import { MENU_ITEMS, PROPERTIES, ROLE_LABEL, outletById, outletLabel, propertyById } from "@/lib/data/catalog";
import { clearDataset, getDataset, hasDataset, hydrateDataset } from "@/lib/data/dataset";
import { api, goToLogin, lockLocally, reloadTo, useSession } from "@/lib/api";
import type { Snapshot } from "@/lib/server/snapshot";
import { MODULE_PATH, allowedOutlets, allowedProperties, canOpen, clampScope, hasWholeProperty, homePath, moduleOfPath, modulesFor, type ModuleId } from "@/lib/domain/access";
import { deliveryOvercharge } from "@/lib/domain/inventory";
import { assessArrival } from "@/lib/domain/operations";
import { useInvestigations, useUser } from "@/lib/hooks";
import { currentRange, useDemo } from "@/lib/store";
import type { Dept, User } from "@/lib/types";
import { DEMO_NOW_MIN, DEMO_TODAY, addDays, fmtDate, fmtRange, fmtTime, type RangePreset } from "@/lib/util";
import { Login } from "./login";
import { NotificationBell } from "./notifications";
import { DemoGuide, DemoPicker } from "./demo-guide";
import { TakeTourButton, TourOffer, Walkthrough } from "./walkthrough";
import { SharedStockSync } from "@/lib/shared-stock";
import { PinScreen } from "./pin";
import { Tour } from "./tour";

const NAV: Record<ModuleId, { label: string; icon: typeof Banknote }> = {
  staff: { label: "Tyll Staff", icon: Smartphone },
  tasks: { label: "My tasks", icon: ClipboardList },
  overview: { label: "Tyll Overview", icon: LayoutDashboard },
  money: { label: "Tyll Money", icon: Banknote },
  stock: { label: "Tyll Stock", icon: Package },
  forecast: { label: "Tyll Forecast", icon: TrendingUp },
  events: { label: "Sales & Events", icon: CalendarDays },
  flow: { label: "Tyll Flow", icon: UtensilsCrossed },
  rooms: { label: "Rooms & Guests", icon: BedDouble },
  investigations: { label: "Investigations", icon: FileSearch },
  finance: { label: "Tyll Finance", icon: Landmark },
  reports: { label: "Reports", icon: FileText },
  settings: { label: "Settings", icon: Settings },
};
/** What each role sees first. Everything else the role may open sits under "More", and search finds it too. */
const PRIMARY: Partial<Record<User["role"], ModuleId[]>> = {
  owner: ["overview", "investigations", "finance", "reports"],
  gm: ["overview", "rooms", "events", "forecast", "finance", "investigations"],
  controller: ["finance", "overview", "investigations", "reports"],
  fnb_director: ["overview", "stock", "forecast", "events", "investigations", "money"],
  restaurant_manager: ["overview", "stock", "forecast", "events", "investigations", "money"],
  chef: ["forecast", "tasks", "stock"],
  purchasing: ["forecast", "stock"],
};

/** The same module named for what this role does there. Routes do not change. */
const ROLE_NAV: Partial<Record<User["role"], Partial<Record<ModuleId, string>>>> = {
  purchasing: { forecast: "Purchasing", stock: "Stock and suppliers" },
  chef: { forecast: "Kitchen planning", tasks: "Kitchen tasks" },
};

const ORDER: ModuleId[] = ["staff", "tasks", "overview", "money", "stock", "forecast", "events", "flow", "rooms", "investigations", "finance", "reports", "settings"];

const subscribe = () => () => {};
const useHydrated = () => useSyncExternalStore(subscribe, () => true, () => false);

interface SessionInfo {
  userId: string;
  pinRequired: boolean;
  pinUnlocked: boolean;
  pinExpiresAt: number | null;
  demoPin?: string;
}

export function AppShell({ children }: { children: ReactNode }) {
  const hydrated = useHydrated();
  const pathname = usePathname();
  if (!hydrated) return <BrandLoader />;
  if (pathname === "/login") return <Login />;
  return <Authed>{children}</Authed>;
}

/**
 * Asks the server who is signed in, shows the PIN keypad while management data is locked,
 * and loads only the data the server releases for this user.
 */
function Authed({ children }: { children: ReactNode }) {
  const session = useSession();
  const signIn = useDemo((s) => s.signIn);
  const user = useUser();

  const refresh = useCallback(async () => {
    let info: SessionInfo;
    try {
      info = await api<SessionInfo>("/api/auth/session");
    } catch {
      goToLogin();
      return;
    }
    signIn(info.userId);
    if (info.pinRequired && !info.pinUnlocked) {
      lockLocally();
      useSession.getState().set({ userId: info.userId, demoPin: info.demoPin });
      return;
    }
    if (!hasDataset()) {
      try {
        hydrateDataset(await api<Snapshot>("/api/data"));
      } catch {
        return;
      }
    }
    useSession.getState().set({ status: "ready", userId: info.userId, demoPin: info.demoPin, pinExpiresAt: info.pinExpiresAt });
  }, [signIn]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);

  // Activity keeps the PIN unlock alive. Without it, the server re-locks after its idle limit.
  useEffect(() => {
    if (session.status !== "ready") return;
    let last = 0;
    const onActivity = () => {
      if (Date.now() - last < 60000) return;
      last = Date.now();
      api<{ pinExpiresAt: number | null }>("/api/auth/ping", { method: "POST", body: {} }).then((r) => useSession.getState().set({ pinExpiresAt: r.pinExpiresAt })).catch(() => undefined);
    };
    window.addEventListener("pointerdown", onActivity);
    window.addEventListener("keydown", onActivity);
    return () => {
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("keydown", onActivity);
    };
  }, [session.status]);

  // Check again the moment the unlock is due to expire.
  useEffect(() => {
    if (!session.pinExpiresAt) return;
    const t = setTimeout(refresh, Math.max(1000, session.pinExpiresAt - Date.now() + 500));
    return () => clearTimeout(t);
  }, [session.pinExpiresAt, refresh]);

  if (session.status === "locked" && session.userId) return <PinScreen userId={session.userId} demoPin={session.demoPin} onUnlocked={refresh} />;
  if (session.status !== "ready" || !user) return <BrandLoader />;
  return <><SharedStockSync user={user} /><Signed user={user}>{children}</Signed></>;
}

/** Tyll Staff: phone-first, no management chrome. The same session, PIN and records. */
function StaffFrame({ user, children }: { user: User; children: ReactNode }) {
  const signOut = useDemo((s) => s.signOut);
  // Concierge and bell captains also have a desk view; frontline staff stay in Tyll Staff.
  const frontline = user.role === "employee" || user.role === "storekeeper";
  const others = frontline ? [] : modulesFor(user).filter((m) => !["staff", "tasks", "settings"].includes(m));
  const leave = async () => {
    await api("/api/auth/logout", { method: "POST", body: {} }).catch(() => undefined);
    signOut();
    clearDataset();
    reloadTo("/login");
  };
  return (
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-hair bg-paper/90 px-4 backdrop-blur">
        <Link href="/staff" className="flex items-center gap-2" aria-label="Tyll Staff home"><TyllLogo height={20} /><span className="text-[13px] text-steel">Staff</span></Link>
        <span className="flex items-center gap-1">
          <TakeTourButton user={user} label="Tour" className="border-0 px-2" />
          <NotificationBell />
          {others.length > 0 && <Link href={MODULE_PATH[others[0]]} className="rounded-full px-3 py-2 text-[13px] text-graphite hover:bg-mist">Full Tyll</Link>}
          <button type="button" onClick={leave} className="rounded-full px-3 py-2 text-[13px] text-graphite hover:bg-mist">Sign out</button>
        </span>
      </header>
      <main className="mx-auto w-full max-w-md px-4 pb-24 pt-5">{children}</main>
      <DemoGuide user={user} />
      <Walkthrough />
      <TourOffer user={user} />
      <Toaster />
    </div>
  );
}

function Signed({ user, children }: { user: User; children: ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const current = moduleOfPath(pathname);
  const allowed = canOpen(user, current);
  if (current === "staff" && allowed) return <StaffFrame user={user}>{children}</StaffFrame>;
  return (
    <div className="flex min-h-screen">
      <Sidebar user={user} active={current} open={menuOpen} onClose={() => setMenuOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={user} onMenu={() => setMenuOpen(true)} />
        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 pb-24 pt-5 sm:px-6 lg:px-8">
          {allowed ? (
            children
          ) : (
            <EmptyState title="This area is outside your role" action={<Link href={homePath(user)}><Button variant="primary">Go to your home page</Button></Link>}>
              {ROLE_LABEL[user.role]} accounts cannot open {NAV[current].label}.
            </EmptyState>
          )}
        </main>
      </div>
      <Tour />
      <DemoGuide user={user} />
      <Walkthrough />
      <TourOffer user={user} />
      <Toaster />
    </div>
  );
}

function Sidebar({ user, active, open, onClose }: { user: User; active: ModuleId; open: boolean; onClose: () => void }) {
  const modules = modulesFor(user);
  const openCases = useInvestigations().filter((i) => i.status !== "closed").length;
  const canTour = user.role !== "employee" && user.role !== "storekeeper";
  const [picking, setPicking] = useState(false);
  const all = ORDER.filter((m) => modules.includes(m) && m !== "settings");
  const first = PRIMARY[user.role];
  const items = first ? all.filter((m) => first.includes(m)) : all;
  const more = first ? all.filter((m) => !first.includes(m)) : [];
  const [showMore, setShowMore] = useState(more.includes(active));
  return (
    <>
      {open && <button type="button" aria-label="Close menu" className="no-print fixed inset-0 z-40 bg-ink/25 md:hidden" onClick={onClose} />}
      <aside
        className={cn(
          "no-print fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col border-r border-line bg-paper transition-transform duration-300 ease-tyll md:sticky md:top-0 md:h-screen md:w-[72px] md:translate-x-0 xl:w-[248px]",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-[68px] items-center justify-between px-6 md:justify-center md:px-0 xl:justify-between xl:px-6">
          <Link href={homePath(user)} aria-label="Tyll home" className="flex items-center">
            <span className="md:hidden xl:block"><TyllLogo height={26} priority /></span>
            <span className="hidden md:block xl:hidden"><TyllMark size={22} /></span>
          </Link>
          <button type="button" className="rounded-full p-1.5 text-steel hover:bg-mist md:hidden" onClick={onClose} aria-label="Close menu"><X size={18} /></button>
        </div>
        <nav data-tour="nav" aria-label="Main" className="scroll-thin flex-1 overflow-y-auto px-3 py-2 md:px-2.5 xl:px-3">
          <ul className="space-y-0.5">
            {[...items, ...(showMore ? more : []), "settings" as ModuleId].filter((m) => modules.includes(m)).map((m, idx, list) => {
              const divider = more.length > 0 && m === "settings" ? (
                <li key="more" className="pt-1">
                  <button type="button" onClick={() => setShowMore((v) => !v)} aria-expanded={showMore} className="flex h-9 w-full items-center gap-3 rounded-xl px-3 text-[13px] text-steel hover:bg-cloud hover:text-ink md:justify-center md:px-0 xl:justify-start xl:px-3">
                    <ChevronDown size={16} className={cn("transition-transform", showMore && "rotate-180")} aria-hidden /><span className="md:hidden xl:inline">{showMore ? "Fewer tools" : `More tools (${more.length})`}</span>
                  </button>
                </li>
              ) : null;
              void idx; void list;
              const { icon: Icon } = NAV[m];
              const label = ROLE_NAV[user.role]?.[m] ?? NAV[m].label;
              const on = active === m;
              return (
                <Fragment key={m}>{divider}<li>
                  <Link
                    href={MODULE_PATH[m]}
                    onClick={onClose}
                    aria-current={on ? "page" : undefined}
                    title={label}
                    className={cn(
                      "group relative flex h-10 items-center gap-3 rounded-xl px-3 text-sm transition-colors duration-300 ease-tyll md:justify-center md:px-0 xl:justify-start xl:px-3",
                      on ? "bg-mist text-ink" : "text-steel hover:bg-cloud hover:text-ink",
                    )}
                  >
                    {on && <span className="absolute left-0 top-2.5 h-5 w-[3px] rounded-full bg-ink md:-left-2.5 xl:-left-3" aria-hidden />}
                    <Icon size={18} strokeWidth={1.6} aria-hidden />
                    <span className="md:hidden xl:inline">{label}</span>
                    {m === "investigations" && openCases > 0 && (
                      <span className="num ml-auto rounded-full bg-ink px-1.5 text-[11px] leading-[18px] text-paper md:absolute md:right-1.5 md:top-1 xl:static">{openCases}</span>
                    )}
                  </Link>
                </li></Fragment>
              );
            })}
          </ul>
        </nav>
        <div className="space-y-3 border-t border-hair p-4 md:p-2.5 xl:p-4">
          <TakeTourButton user={user} className="h-10 w-full justify-start gap-3 rounded-xl px-3 text-sm md:justify-center md:px-0 xl:justify-start xl:px-3" label="Take a tour" labelClass="md:hidden xl:inline" />
          {canTour && (
            <button type="button" data-tour="guide" onClick={() => { setPicking(true); onClose(); }} title="Guided demo" className="flex h-10 w-full items-center gap-3 rounded-xl border border-line px-3 text-sm text-ink transition-colors duration-300 ease-tyll hover:bg-mist md:justify-center md:px-0 xl:justify-start xl:px-3">
              <PlayCircle size={18} strokeWidth={1.6} aria-hidden />
              <span className="md:hidden xl:inline">Guided demo</span>
            </button>
          )}
          <p className="text-xs leading-relaxed text-steel md:hidden xl:block">Demonstration with simulated data. Business date {fmtDate(DEMO_TODAY, true)}, {fmtTime(DEMO_NOW_MIN)}.</p>
        </div>
      </aside>
      {picking && <DemoPicker user={user} onClose={() => setPicking(false)} />}
    </>
  );
}

const PRESETS: { value: RangePreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "7 days" },
  { value: "month", label: "30 days" },
  { value: "custom", label: "Custom" },
];

function Topbar({ user, onMenu }: { user: User; onMenu: () => void }) {
  const rawScope = useDemo((s) => s.scope);
  const setScope = useDemo((s) => s.setScope);
  const preset = useDemo((s) => s.preset);
  const custom = useDemo((s) => s.custom);
  const setPreset = useDemo((s) => s.setPreset);
  const scope = clampScope(user, rawScope);
  const props = allowedProperties(user);
  const outlets = allowedOutlets(user).filter((id) => scope.propertyId === "all" || outletById[id].propertyId === scope.propertyId);
  const [panel, setPanel] = useState<null | "search" | "alerts" | "profile" | "dates">(null);
  const toggle = (p: typeof panel) => setPanel((cur) => (cur === p ? null : p));
  // Ctrl+K or Cmd+K opens search from anywhere.
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPanel((cur) => (cur === "search" ? null : "search")); } };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  // Staff and the events team have no outlets to choose between.
  // The outlet and date pickers drive sales figures; roles without outlet sales do not see them.
  const showScope = !["employee", "event_manager", "sales", "sales_director", "storekeeper"].includes(user.role) && !user.deptId;

  return (
    <div className="no-print sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur-md">
      <div className="mx-auto flex min-h-[68px] w-full max-w-[1440px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:px-6 lg:px-8">
        <button type="button" onClick={onMenu} className="rounded-full p-2 text-graphite hover:bg-mist md:hidden" aria-label="Open menu"><Menu size={20} /></button>
        {showScope ? (
          <div className="order-last flex min-w-0 basis-full flex-wrap items-center gap-2 md:order-none md:basis-auto md:flex-1">
            <Select label="Property" hideLabel className="w-[calc(50%-4px)] sm:w-[190px]" value={scope.propertyId} onChange={(e) => setScope({ propertyId: e.target.value })} disabled={props.length === 1}>
              {props.length > 1 && <option value="all">All properties</option>}
              {props.map((id) => <option key={id} value={id}>{propertyById[id].name}</option>)}
            </Select>
            <Select label="Outlet" hideLabel className="w-[calc(50%-4px)] sm:w-[170px]" value={scope.outletId} onChange={(e) => setScope({ outletId: e.target.value })} disabled={outlets.length === 1}>
              {outlets.length > 1 && <option value="all">All outlets</option>}
              {outlets.map((id) => <option key={id} value={id}>{scope.propertyId === "all" ? outletLabel(id) : outletById[id].name}</option>)}
            </Select>
            <Select label="Department" hideLabel className="w-[calc(50%-4px)] sm:w-[150px]" value={scope.dept} onChange={(e) => setScope({ dept: e.target.value as "all" | Dept })}>
              <option value="all">All departments</option>
              <option value="food">Kitchen (food)</option>
              <option value="beverage">Bar (beverage)</option>
            </Select>
            <div className="relative min-w-0 max-w-full">
              <Segmented label="Period" value={preset} onChange={(v) => (v === "custom" ? setPanel("dates") : (setPreset(v), setPanel(null)))} options={PRESETS.map((p) => (p.value === "custom" && preset === "custom" ? { ...p, label: fmtRange(custom) } : p))} />
              {panel === "dates" && <DatePanel onClose={() => setPanel(null)} />}
            </div>
          </div>
        ) : (
          <p className="min-w-0 flex-1 truncate text-sm text-steel">{allowedOutlets(user)[0] ? `${outletById[allowedOutlets(user)[0]].name}, ` : ""}{propertyById[props[0]].name}</p>
        )}
        <div className="ml-auto flex items-center gap-1">
          <span data-tour="search"><IconButton label="Search (Ctrl K)" onClick={() => toggle("search")} active={panel === "search"}><Search size={18} strokeWidth={1.7} /></IconButton></span>
          <AlertsButton user={user} />
          <div className="relative">
            <button type="button" onClick={() => toggle("profile")} aria-expanded={panel === "profile"} aria-haspopup="menu" className="ml-1 flex items-center gap-2.5 rounded-full border border-line py-1 pl-1 pr-3 text-left transition-colors duration-300 ease-tyll hover:border-fog">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-xs font-medium text-paper" aria-hidden>{user.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}</span>
              <span className="hidden leading-tight sm:block">
                <span className="block text-[13px] text-ink">{user.name}</span>
                <span className="block text-[11px] text-steel">{ROLE_LABEL[user.role]}</span>
              </span>
            </button>
            {panel === "profile" && <ProfileMenu user={user} onClose={() => setPanel(null)} />}
          </div>
        </div>
      </div>
      {panel === "search" && <SearchPanel user={user} onClose={() => setPanel(null)} />}
    </div>
  );
}

function IconButton({ label, onClick, active, children }: { label: string; onClick: () => void; active?: boolean; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className={cn("relative rounded-full p-2.5 text-graphite transition-colors duration-300 ease-tyll hover:bg-mist", active && "bg-mist text-ink")}>
      {children}
    </button>
  );
}

function useDismiss(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.parentElement?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return ref;
}

function DatePanel({ onClose }: { onClose: () => void }) {
  const custom = useDemo((s) => s.custom);
  const setCustom = useDemo((s) => s.setCustom);
  const [from, setFrom] = useState(custom.from);
  const [to, setTo] = useState(custom.to);
  const [error, setError] = useState("");
  const ref = useDismiss(onClose);
  return (
    <div ref={ref} className="animate-rise absolute right-0 top-12 z-40 w-[300px] rounded-2xl border border-line bg-paper p-4 shadow-float">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const r = setCustom({ from, to });
          if (r.ok) onClose();
          else setError(r.error);
        }}
      >
        <Field label="From" type="date" value={from} min={addDays(DEMO_TODAY, -28)} max={DEMO_TODAY} onChange={(e) => setFrom(e.target.value)} />
        <Field label="To" type="date" value={to} max={DEMO_TODAY} onChange={(e) => setTo(e.target.value)} error={error || undefined} />
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" type="submit">Apply dates</Button>
        </div>
      </form>
    </div>
  );
}

function ProfileMenu({ user, onClose }: { user: User; onClose: () => void }) {
  const signOut = useDemo((s) => s.signOut);
  const ref = useDismiss(onClose);
  const pinRequired = useSession((s) => s.pinExpiresAt !== null);
  const lock = async () => {
    onClose();
    await api("/api/auth/lock", { method: "POST", body: {} }).catch(() => undefined);
    lockLocally();
  };
  const leave = async () => {
    await api("/api/auth/logout", { method: "POST", body: {} }).catch(() => undefined);
    signOut();
    clearDataset();
    reloadTo("/login");
  };
  return (
    <div ref={ref} role="menu" className="animate-rise absolute right-0 top-12 z-40 w-[280px] rounded-2xl border border-line bg-paper p-2 shadow-float">
      <div className="px-3 py-2.5">
        <p className="text-sm text-ink">{user.name}</p>
        <p className="text-xs text-steel">{user.title}</p>
      </div>
      <div className="border-t border-hair pt-1">
        <div className="px-1 py-1" onClick={onClose}><TakeTourButton user={user} here label="Tour this page" className="w-full border-0 px-2 py-2 text-sm" /></div>
        <Link role="menuitem" href="/settings" onClick={onClose} className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-graphite hover:bg-mist"><Settings size={16} strokeWidth={1.7} /> Settings and access</Link>
        {pinRequired && (
          <button role="menuitem" type="button" onClick={lock} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-graphite hover:bg-mist">
            <LockKeyhole size={16} strokeWidth={1.7} /> Lock now
          </button>
        )}
        <button role="menuitem" type="button" onClick={leave} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-graphite hover:bg-mist">
          <LogOut size={16} strokeWidth={1.7} /> Sign out
        </button>
      </div>
    </div>
  );
}

interface Alert {
  id: string;
  text: string;
  detail: string;
  href: string;
  tone: "warn" | "neg" | "neutral";
}

function useAlerts(user: User): Alert[] {
  const investigations = useInvestigations();
  const wasteLogs = useDemo((s) => s.wasteLogs);
  const roomState = useDemo((s) => s.roomState);
  const arrivalState = useDemo((s) => s.arrivalState);
  return useMemo(() => {
    const data = getDataset();
    const out: Alert[] = [];
    const open = investigations.filter((i) => i.status !== "closed");
    const today = open.filter((i) => i.date === DEMO_TODAY);
    const overdue = open.filter((i) => i.deadline && i.deadline < DEMO_TODAY);
    if (today.length) out.push({ id: "today", text: `${today.length} new case${today.length === 1 ? "" : "s"} today`, detail: today[0].headline, href: "/investigations", tone: "warn" });
    if (overdue.length) out.push({ id: "overdue", text: `${overdue.length} investigation${overdue.length === 1 ? " is" : "s are"} past deadline`, detail: "Open the Money Back List and sort by deadline.", href: "/investigations", tone: "neg" });
    const props = allowedProperties(user);
    if (canOpen(user, "stock")) {
      const issues = data.deliveries.filter((d) => props.includes(d.propertyId) && d.status === "delivered" && d.date >= addDays(DEMO_TODAY, -1) && deliveryOvercharge(d) > 0);
      if (issues.length) out.push({ id: "suppliers", text: `${issues.length} supplier invoice${issues.length === 1 ? "" : "s"} differ from what was delivered`, detail: "Since yesterday. See Stock, Suppliers.", href: "/stock?tab=suppliers", tone: "warn" });
      const pending = wasteLogs.filter((w) => !w.synced).length;
      if (pending) out.push({ id: "offline", text: `${pending} waste entr${pending === 1 ? "y" : "ies"} waiting to synchronise`, detail: "Recorded offline on this device.", href: "/stock?tab=log", tone: "neutral" });
    }
    if (canOpen(user, "rooms")) {
      const risky = data.arrivals.filter((a) => hasWholeProperty(user, a.propertyId) && (arrivalState[a.id] ?? a.status) !== "checked_in").filter((a) => {
        const room = data.rooms.find((r) => r.propertyId === a.propertyId && r.number === a.room);
        const v = assessArrival({ ...a, status: arrivalState[a.id] ?? a.status }, room ? { ...room, ...roomState[room.id] } : undefined, DEMO_NOW_MIN);
        return v.risk === "late" || v.risk === "waiting";
      });
      if (risky.length) out.push({ id: "rooms", text: `${risky.length} arriving guest${risky.length === 1 ? "" : "s"} may wait for a room`, detail: "See Rooms for the rooms to prioritise.", href: "/rooms", tone: "warn" });
    }
    return out;
  }, [investigations, user, wasteLogs, roomState, arrivalState]);
}

function AlertsButton({ user }: { user: User }) {
  const alerts = useAlerts(user);
  return <NotificationBell attention={alerts} />;
}

interface Hit {
  group: string;
  label: string;
  detail: string;
  href?: string;
  run?: () => void;
}

function SearchPanel({ user, onClose }: { user: User; onClose: () => void }) {
  const [q, setQ] = useState("");
  const router = useRouter();
  const setScope = useDemo((s) => s.setScope);
  const investigations = useInvestigations();
  const ref = useDismiss(onClose);
  // Orders are searched on the server, which only returns orders from outlets this user may see.
  const [orderHits, setOrderHits] = useState<{ q: string; hits: { id: string; outletId: string; date: string; openMin: number }[] }>({ q: "", hits: [] });
  useEffect(() => {
    const term = q.trim();
    if (term.length < 3 || !canOpen(user, "money")) return;
    const t = setTimeout(() => {
      api<{ hits: { id: string; outletId: string; date: string; openMin: number }[] }>(`/api/orders?q=${encodeURIComponent(term)}`).then((r) => setOrderHits({ q: term, hits: r.hits })).catch(() => setOrderHits({ q: term, hits: [] }));
    }, 250);
    return () => clearTimeout(t);
  }, [q, user]);
  // Saved records (requests, events, rooms, invoices and more) come from the server, already limited to this person.
  const [recordHits, setRecordHits] = useState<{ q: string; hits: { group: string; label: string; detail: string; href: string }[] }>({ q: "", hits: [] });
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const t = setTimeout(() => {
      api<{ hits: { group: string; label: string; detail: string; href: string }[] }>(`/api/search?q=${encodeURIComponent(term)}`).then((r) => setRecordHits({ q: term, hits: r.hits })).catch(() => setRecordHits({ q: term, hits: [] }));
    }, 200);
    return () => clearTimeout(t);
  }, [q]);
  const [recent, setRecent] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem("tyll-recent-search") ?? "[]") as string[]; } catch { return []; } });
  const remember = (term: string) => {
    const next = [term, ...recent.filter((r) => r !== term)].slice(0, 5);
    setRecent(next);
    try { localStorage.setItem("tyll-recent-search", JSON.stringify(next)); } catch { /* private window */ }
  };
  const hits = useMemo<Hit[]>(() => {
    const term = q.trim().toLowerCase();
    if (term.length < 2) return [];
    const outlets = allowedOutlets(user);
    const out: Hit[] = [];
    for (const m of modulesFor(user)) if (NAV[m].label.toLowerCase().includes(term)) out.push({ group: "Pages", label: NAV[m].label, detail: "Open", href: MODULE_PATH[m] });
    for (const p of PROPERTIES) if (allowedProperties(user).includes(p.id) && p.name.toLowerCase().includes(term)) out.push({ group: "Properties", label: p.name, detail: "Show this hotel", run: () => setScope({ propertyId: p.id }) });
    for (const id of outlets) {
      const o = outletById[id];
      if (`${o.name} ${o.kind}`.toLowerCase().includes(term)) out.push({ group: "Outlets", label: outletLabel(id), detail: o.kind, run: () => { setScope({ outletId: id }); router.push("/"); } });
    }
    if (canOpen(user, "overview")) {
      for (const it of MENU_ITEMS) {
        if (it.name.toLowerCase().includes(term) && outlets.some((id) => outletById[id].menu.some((m) => m.itemId === it.id))) out.push({ group: "Menu items", label: it.name, detail: it.category, href: `/menu/${it.id}` });
      }
    }
    if (canOpen(user, "investigations")) {
      for (const i of investigations.filter((x) => `${x.id} ${x.headline}`.toLowerCase().includes(term)).slice(0, 5)) out.push({ group: "Investigations", label: i.headline, detail: `${i.id.replace("EX-", "")} · ${fmtDate(i.date)}`, href: `/investigations/${i.id}` });
    }
    if (term.length >= 3 && orderHits.q.toLowerCase() === term) {
      for (const o of orderHits.hits) out.push({ group: "Orders", label: o.id, detail: `${outletById[o.outletId].name} · ${fmtDate(o.date)} ${fmtTime(o.openMin)}`, href: `/money/orders/${o.id}` });
    }
    if (recordHits.q.toLowerCase() === term) for (const h of recordHits.hits) if (!(h.group === "Features" && out.some((o) => o.href === h.href))) out.push(h);
    // Records first, then screens and places.
    const rank = (g: string) => (g === "Features" ? 1 : ["Pages", "Properties", "Outlets"].includes(g) ? 2 : 0);
    return out.sort((a, b) => rank(a.group) - rank(b.group)).slice(0, 40);
  }, [q, user, investigations, router, setScope, orderHits, recordHits]);
  const groups = [...new Set(hits.map((h) => h.group))];
  return (
    <div className="border-t border-line bg-paper">
      <div ref={ref} className="mx-auto w-full max-w-[1440px] px-4 py-4 sm:px-6 lg:px-8">
        <div className="relative">
          <Search size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-steel" aria-hidden />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search records and screens: Coca-Cola, PR-DXB-0001, room 1211, Guest Connect" aria-label="Search" className="h-12 w-full rounded-full border border-line bg-cloud pl-11 pr-4 text-[15px] placeholder:text-fog" />
        </div>
        {q.trim().length < 2 && recent.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 px-1 text-sm">
            <span className="text-xs text-steel">Recent</span>
            {recent.map((r) => <button key={r} type="button" onClick={() => setQ(r)} className="rounded-full border border-line px-3 py-1 text-graphite hover:bg-mist">{r}</button>)}
          </div>
        )}
        {q.trim().length >= 2 && (
          <div className="scroll-thin mt-3 max-h-[50vh] overflow-y-auto">
            {hits.length === 0 && <p className="px-2 py-3 text-sm text-steel">{recordHits.q !== q.trim() ? "Searching" : <>Nothing you can open matches &ldquo;{q}&rdquo;. Try an item such as Coca-Cola, a reference such as PR-DXB-0001, a room number or a screen such as What to buy.</>}</p>}
            {groups.map((g) => (
              <div key={g} className="mb-2">
                <p className="px-2 py-1 text-xs text-steel">{g}</p>
                <ul>
                  {hits.filter((h) => h.group === g).map((h, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        onClick={() => {
                          remember(q.trim());
                          h.run?.();
                          if (h.href) router.push(h.href);
                          onClose();
                        }}
                        className="flex w-full items-center justify-between gap-4 rounded-xl px-3 py-2 text-left text-sm hover:bg-mist"
                      >
                        <span className="truncate text-ink">{h.label}</span>
                        <span className="shrink-0 text-xs text-steel">{h.detail}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Small banner pages use to say their figures come from simulated records. */
export function SimulatedBadge({ children = "Simulated data" }: { children?: ReactNode }) {
  return <Badge tone="neutral">{children}</Badge>;
}

export { report, currentRange };
