"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Banknote, Bell, BedDouble, CalendarDays, ChevronDown, ClipboardList, Eye, FileSearch, FileText, GlassWater, Landmark, LayoutDashboard, LayoutGrid, LockKeyhole, LogOut, Moon, Package, PlayCircle, Search, Settings, ShoppingCart, Smartphone, Sparkles, Sun, Trash2, UtensilsCrossed, type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { BrandLoader, TyllLogo, TyllMark } from "@/components/brand";
import { Badge, Button, EmptyState, Field, Segmented, Select, Toaster, cn, report, toast } from "@/components/ui";
import { ROLE_LABEL, outletById, propertyById } from "@/lib/data/catalog";
import { clearDataset, getDataset, hasDataset, hydrateDataset } from "@/lib/data/dataset";
import { api, goToLogin, lockLocally, reloadTo, useSession } from "@/lib/api";
import { AlertFeedProvider } from "@/lib/alert-feed";
import type { Snapshot } from "@/lib/server/snapshot";
import { MODULE_PATH, allowedOutlets, allowedProperties, canOpen, clampScope, hasWholeProperty, homePath, moduleOfPath, modulesFor, type ModuleId } from "@/lib/domain/access";
import { deliveryOvercharge } from "@/lib/domain/inventory";
import { assessArrival } from "@/lib/domain/operations";
import { useInvestigations, useUser } from "@/lib/hooks";
import { currentRange, useDemo } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import type { Dept, User } from "@/lib/types";
import { DEMO_NOW_MIN, DEMO_TODAY, addDays, fmtDate, fmtRange, fmtTime, type RangePreset } from "@/lib/util";
import { BreakageFab, BreakageSheet, mayLogBreakage, useBreakageSheet } from "./breakage";
import { CommandPalette } from "./command-palette";
import { CountFlow } from "@/components/stock/count-flow";
import { Login } from "./login";
import { Welcome } from "./welcome";
import { EarlyAccessBadge, GuidedPath, WhatsNew, startGuidedPath } from "./early-access";
import { NotificationBell } from "./notifications";
import { DemoGuide, DemoPicker } from "./demo-guide";
import { TakeTourButton, TourOffer, Walkthrough } from "./walkthrough";
import { SharedStockSync } from "@/lib/shared-stock";
import { PinScreen } from "./pin";
import { Tour } from "./tour";

const NAV: Record<ModuleId, { label: string; short?: string; icon: LucideIcon }> = {
  overview: { label: "Overview", icon: LayoutDashboard },
  stock: { label: "Stock", icon: Package },
  forecast: { label: "Orders", icon: ShoppingCart },
  money: { label: "Money", icon: Banknote },
  waste: { label: "Waste and Breakage", short: "Waste", icon: Trash2 },
  reports: { label: "Reports", icon: FileText },
  alerts: { label: "All alerts", icon: Bell },
  more: { label: "More tools", icon: LayoutGrid },
  settings: { label: "Settings", icon: Settings },
  staff: { label: "Tyll Staff", icon: Smartphone },
  tasks: { label: "My tasks", icon: ClipboardList },
  events: { label: "Events and Staffing", icon: CalendarDays },
  flow: { label: "Tyll Flow", icon: UtensilsCrossed },
  rooms: { label: "Rooms and Guest Experience", icon: BedDouble },
  investigations: { label: "Money Back List", icon: FileSearch },
  finance: { label: "Reconciliation", icon: Landmark },
};

/** The sidebar, in the order a GM's day goes. Never more than six. Everything else is one click away under the profile menu. */
const PRIMARY: ModuleId[] = ["overview", "stock", "forecast", "money", "waste", "reports"];
/** Which sidebar item lights up on each screen. */
const NAV_HOME: Partial<Record<ModuleId, ModuleId>> = { investigations: "money", finance: "money", alerts: "overview" };

/** Modules still being built. They work with demo data but are marked so nobody mistakes them for finished. */
const IN_DEVELOPMENT: ModuleId[] = ["events", "rooms"];

const PAGES = Object.fromEntries(Object.entries(NAV).map(([m, n]) => [m, n.label])) as Record<ModuleId, string>;

/** The items this person gets, in order. In the public demo every area is open: the link changes role when it must. */
function navFor(user: User, publicDemo: boolean): ModuleId[] {
  const modules = modulesFor(user);
  const home = moduleOfPath(homePath(user).split("?")[0]);
  const lead = PRIMARY.includes(home) ? [] : [home];
  return [...lead, ...PRIMARY.filter((m) => publicDemo || modules.includes(m))].slice(0, 6);
}

function SideItem({ m, active, reload }: { m: ModuleId; active: boolean; reload: boolean }) {
  const { icon: Icon, label, short } = NAV[m];
  const className = cn(
    "relative flex items-center rounded-[var(--radius-control)] text-nav-quiet transition-colors duration-150 ease-tyll hover:bg-nav-hover hover:text-nav-ink",
    "flex-col gap-1 px-1 py-2 text-center text-[11px] leading-tight xl:flex-row xl:gap-3 xl:px-3 xl:py-2.5 xl:text-left xl:text-sm",
    active && "bg-nav-active font-medium text-nav-ink shadow-panel hover:bg-nav-active",
  );
  const body = (
    <>
      <Icon size={18} className={active ? "text-accent-ink" : undefined} aria-hidden />
      <span className="min-w-0 xl:hidden">{short ?? label}</span>
      <span className="hidden min-w-0 xl:inline">{label}</span>
    </>
  );
  return (
    <li>
      {/* A full load lets the public demo change role on the server first. */}
      {reload ? <a href={MODULE_PATH[m]} aria-current={active ? "page" : undefined} className={className}>{body}</a> : <Link href={MODULE_PATH[m]} aria-current={active ? "page" : undefined} className={className}>{body}</Link>}
    </li>
  );
}

const subscribe = () => () => {};

/** Ends the session. In the public demo, the visitor goes back to the welcome screen. */
async function leaveTyll(signOut: () => void) {
  const publicDemo = !!useSession.getState().demoRoles;
  await api("/api/auth/logout", { method: "POST", body: {} }).catch(() => undefined);
  signOut();
  clearDataset();
  reloadTo(publicDemo ? "/welcome" : "/login");
}

/** Public demo: switch to another fictional role at once, then open that role's landing page. */
function RoleSwitcher({ user }: { user: User }) {
  const roles = useSession((s) => s.demoRoles);
  const signOut = useDemo((s) => s.signOut);
  const [busy, setBusy] = useState(false);
  if (!roles) return null;
  const switchTo = async (userId: string) => {
    if (userId === user.id) return;
    setBusy(true);
    try {
      const r = await api<{ home: string }>("/api/auth/demo", { method: "POST", body: { userId } });
      signOut();
      clearDataset();
      reloadTo(r.home);
    } catch (e) {
      report({ ok: false, error: e instanceof Error ? e.message : "That role could not open." }, "");
      setBusy(false);
    }
  };
  const current = roles.some((r) => r.userId === user.id) ? user.id : "";
  return (
    <Select label="View the demo as" hideLabel className="w-[132px] sm:w-[176px]" value={current} disabled={busy} onChange={(e) => switchTo(e.target.value)}>
      {!current && <option value="">{ROLE_LABEL[user.role]}</option>}
      {roles.map((r) => <option key={r.userId} value={r.userId}>{r.label}</option>)}
    </Select>
  );
}
const useHydrated = () => useSyncExternalStore(subscribe, () => true, () => false);

interface SessionInfo {
  userId: string;
  pinRequired: boolean;
  pinUnlocked: boolean;
  pinExpiresAt: number | null;
  demoPin?: string;
  publicDemo?: { userId: string; label: string }[] | null;
}

export function AppShell({ children }: { children: ReactNode }) {
  const hydrated = useHydrated();
  const pathname = usePathname();
  if (!hydrated) return <BrandLoader />;
  if (pathname === "/login") return <Login />;
  if (pathname === "/welcome") return <Welcome />;
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
    useSession.getState().set({ status: "ready", userId: info.userId, demoPin: info.demoPin, pinExpiresAt: info.pinExpiresAt, demoRoles: info.publicDemo ?? null });
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
  const others = frontline ? [] : modulesFor(user).filter((m) => !["staff", "tasks", "settings", "alerts", "more"].includes(m));
  const leave = () => leaveTyll(signOut);
  const publicDemo = useSession((s) => !!s.demoRoles);
  return (
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-hair bg-paper/90 px-4 backdrop-blur">
        <Link href="/staff" className="flex items-center gap-2" aria-label="Tyll Staff home"><TyllLogo height={20} /><span className="text-[13px] text-steel">Staff</span></Link>
        <span className="flex items-center gap-1">
          <TakeTourButton user={user} label="Tour" className="border-0 px-2" />
          <NotificationBell />
          {others.length > 0 && <Link href={MODULE_PATH[others[0]]} className="rounded-full px-3 py-2 text-[13px] text-graphite hover:bg-mist">Full Tyll</Link>}
          <button type="button" onClick={leave} className="rounded-full px-3 py-2 text-[13px] text-graphite hover:bg-mist">{publicDemo ? "Leave demo" : "Sign out"}</button>
        </span>
      </header>
      <main className="mx-auto w-full max-w-md px-4 pb-24 pt-5">{publicDemo ? <GuidedPath /> : <TourOffer user={user} />}{children}</main>
      <DemoGuide user={user} />
      <Walkthrough />
      {mayLogBreakage(user) && <><BreakageFab /><BreakageSheet /></>}
      <Toaster />
    </div>
  );
}

function Signed({ user, children }: { user: User; children: ReactNode }) {
  const pathname = usePathname();
  const current = moduleOfPath(pathname);
  const allowed = canOpen(user, current);
  const publicDemo = useSession((s) => !!s.demoRoles);
  // Following a module link can change role in the public demo, so say so.
  useEffect(() => {
    if (!publicDemo) return;
    try {
      const last = sessionStorage.getItem("tyll-demo-role");
      sessionStorage.setItem("tyll-demo-role", user.id);
      if (last && last !== user.id) toast.done(`Now viewing the demo as ${ROLE_LABEL[user.role]}.`);
    } catch { /* private window */ }
  }, [publicDemo, user.id, user.role]);
  if (current === "staff" && allowed) return <StaffFrame user={user}>{children}</StaffFrame>;
  // The count is a full screen flow: nothing else competes for a thumb.
  if (pathname === "/count" && allowed) return <><CountFlow /><Toaster /></>;
  const preview = IN_DEVELOPMENT.includes(current) || pathname === "/performance";
  const canBreak = mayLogBreakage(user);
  return (
    <AlertFeedProvider>
    <div className="flex min-h-screen">
      <a href="#main" className="no-print sr-only rounded-full bg-accent px-4 py-2 text-sm font-medium text-on-accent focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[80]">Skip to content</a>
      <Sidebar user={user} active={current} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={user} />
        <main id="main" tabIndex={-1} className={cn("mx-auto w-full max-w-[1500px] flex-1 px-4 pb-24 pt-6 outline-none sm:px-6 md:pb-10 lg:px-8", canBreak && "pb-40")}>
          {allowed && (publicDemo ? <GuidedPath offer={pathname === "/more"} /> : pathname === "/more" && <TourOffer user={user} />)}
          {allowed && preview && (
            <p className="mb-4 flex items-start gap-2 rounded-[var(--radius-control)] bg-accent-soft px-4 py-3 text-sm text-accent-ink">
              <Eye size={18} className="mt-px shrink-0" aria-hidden /><span><span className="font-medium">Preview.</span> This module is in development and not yet part of our pilots.</span>
            </p>
          )}
          {allowed ? (
            children
          ) : (
            <EmptyState title="This area is outside your role" action={<Link href={homePath(user)}><Button variant="primary">Go to your home page</Button></Link>}>
              {ROLE_LABEL[user.role]} accounts cannot open {NAV[current].label}.
            </EmptyState>
          )}
        </main>
      </div>
      <PhoneBar user={user} active={current} />
      {canBreak && <><BreakageFab raised /><BreakageSheet /></>}
      <Tour />
      <DemoGuide user={user} />
      <Walkthrough />
      <Toaster />
    </div>
    </AlertFeedProvider>
  );
}

function Sidebar({ user, active }: { user: User; active: ModuleId }) {
  const publicDemo = useSession((s) => !!s.demoRoles);
  // The guided demo switches between many accounts, which the public demo does not offer.
  const canTour = !publicDemo && user.role !== "employee" && user.role !== "storekeeper";
  const [picking, setPicking] = useState(false);
  const lit = NAV_HOME[active] ?? active;
  const items = navFor(user, publicDemo);
  const footButton = "flex w-full items-center rounded-[var(--radius-control)] text-nav-quiet transition-colors duration-150 ease-tyll hover:bg-nav-hover hover:text-nav-ink flex-col gap-1 px-1 py-2 text-[11px] xl:h-10 xl:flex-row xl:gap-3 xl:px-3 xl:py-0 xl:text-sm";
  return (
    <>
      <aside className="no-print sticky top-0 z-30 hidden h-screen w-[88px] shrink-0 flex-col border-r border-nav-line bg-nav md:flex xl:w-[232px]">
        <div className="flex h-16 items-center justify-center gap-2 px-2 xl:justify-start xl:px-5">
          <Link href={homePath(user)} aria-label="Tyll home" className="flex items-center rounded-md">
            <span className="hidden xl:block"><TyllLogo height={24} priority /></span>
            <span className="xl:hidden"><TyllMark size={22} /></span>
          </Link>
          <span className="hidden xl:inline"><EarlyAccessBadge /></span>
        </div>
        <nav data-tour="nav" aria-label="Main" className="scroll-thin flex-1 overflow-y-auto px-2 py-2 xl:px-3">
          <ul className="space-y-1">
            {items.map((m) => <SideItem key={m} m={m} active={lit === m} reload={publicDemo} />)}
          </ul>
        </nav>
        <div className="space-y-1 border-t border-nav-line p-2 xl:p-3">
          {publicDemo ? (
            <button type="button" onClick={() => startGuidedPath()} className={footButton}>
              <PlayCircle size={18} aria-hidden /><span>Guided path</span>
            </button>
          ) : <TakeTourButton user={user} className={cn(footButton, "!rounded-[var(--radius-control)] !border-0 !text-nav-quiet")} label="Take a tour" />}
          {canTour && (
            <button type="button" data-tour="guide" onClick={() => setPicking(true)} title="Guided demo" className={footButton}>
              <PlayCircle size={18} aria-hidden /><span>Guided demo</span>
            </button>
          )}
          <p className="hidden px-3 pt-1 text-xs leading-relaxed text-nav-quiet xl:block">Simulated data. Business date {fmtDate(DEMO_TODAY, true)}, {fmtTime(DEMO_NOW_MIN)}.</p>
        </div>
      </aside>
      {picking && <DemoPicker user={user} onClose={() => setPicking(false)} />}
    </>
  );
}

/** On a phone the same places sit at the bottom, within reach of a thumb. */
function PhoneBar({ user, active }: { user: User; active: ModuleId }) {
  const publicDemo = useSession((s) => !!s.demoRoles);
  const lit = NAV_HOME[active] ?? active;
  const items = navFor(user, publicDemo);
  return (
    <nav aria-label="Main" className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper pb-[env(safe-area-inset-bottom)] md:hidden">
      <ul className="flex">
        {items.map((m) => {
          const { icon: Icon, label, short } = NAV[m];
          const className = cn("relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] text-steel transition-colors duration-150", lit === m && "font-medium text-accent-ink");
          const body = (
            <>
              <span className={cn("flex h-7 w-10 items-center justify-center rounded-full", lit === m && "bg-accent-soft")}><Icon size={18} aria-hidden /></span>
              <span className="max-w-full truncate px-0.5">{short ?? label}</span>
            </>
          );
          return (
            <li key={m} className="min-w-0 flex-1">
              {publicDemo ? <a href={MODULE_PATH[m]} aria-current={lit === m ? "page" : undefined} className={className}>{body}</a> : <Link href={MODULE_PATH[m]} aria-current={lit === m ? "page" : undefined} className={className}>{body}</Link>}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

const PRESETS: { value: RangePreset; label: ReactNode }[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: <><span className="sm:hidden">Yest.</span><span className="hidden sm:inline">Yesterday</span></> },
  { value: "week", label: "7d" },
  { value: "month", label: "30d" },
  { value: "custom", label: "Custom" },
];

/** Hotel, outlet and department in one control. The button always says what is selected. */
function ScopeControl({ user }: { user: User }) {
  const rawScope = useDemo((s) => s.scope);
  const setScope = useDemo((s) => s.setScope);
  const scope = clampScope(user, rawScope);
  const props = allowedProperties(user);
  const outlets = allowedOutlets(user).filter((id) => scope.propertyId === "all" || outletById[id].propertyId === scope.propertyId);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const label = [scope.outletId !== "all" ? outletById[scope.outletId].name : scope.propertyId !== "all" && props.length > 1 ? propertyById[scope.propertyId].name : "All outlets", scope.dept === "food" ? "Kitchen" : scope.dept === "beverage" ? "Bar" : null].filter(Boolean).join(", ");
  return (
    <div className="relative min-w-0">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="dialog" className="flex h-9 max-w-[148px] items-center gap-2 rounded-full border border-line bg-paper px-3 text-[13px] text-ink transition-colors duration-200 hover:bg-cloud sm:max-w-[220px]">
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown size={14} className={cn("shrink-0 text-steel transition-transform duration-200", open && "rotate-180")} aria-hidden />
      </button>
      {open && <ScopePanel onClose={close}>
        {props.length > 1 && (
          <Select label="Hotel" value={scope.propertyId} onChange={(e) => setScope({ propertyId: e.target.value })}>
            <option value="all">All hotels</option>
            {props.map((id) => <option key={id} value={id}>{propertyById[id].name}</option>)}
          </Select>
        )}
        <Select label="Outlet" value={scope.outletId} onChange={(e) => setScope({ outletId: e.target.value })} disabled={outlets.length === 1}>
          {outlets.length > 1 && <option value="all">All outlets</option>}
          {outlets.map((id) => <option key={id} value={id}>{outletById[id].name}</option>)}
        </Select>
        <Select label="Department" value={scope.dept} onChange={(e) => setScope({ dept: e.target.value as "all" | Dept })}>
          <option value="all">All departments</option>
          <option value="food">Kitchen (food)</option>
          <option value="beverage">Bar (beverage)</option>
        </Select>
      </ScopePanel>}
    </div>
  );
}

function ScopePanel({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const ref = useDismiss(onClose);
  return <div ref={ref} role="dialog" aria-label="Choose outlet and department" className="animate-rise absolute left-0 top-11 z-40 w-[280px] space-y-3 rounded-panel border border-line bg-paper p-4 shadow-float">{children}</div>;
}

function Topbar({ user }: { user: User }) {
  const preset = useDemo((s) => s.preset);
  const custom = useDemo((s) => s.custom);
  const setPreset = useDemo((s) => s.setPreset);
  const props = allowedProperties(user);
  const [panel, setPanel] = useState<null | "profile" | "dates">(null);
  const [palette, setPalette] = useState(false);
  const [news, setNews] = useState(false);
  const [theme, toggleTheme] = useTheme();
  const openBreakage = useBreakageSheet((b) => b.set);
  const pathname = usePathname();
  const toggle = (p: typeof panel) => setPanel((cur) => (cur === p ? null : p));
  // Ctrl+K or Cmd+K opens search from anywhere.
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((v) => !v); } };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  // Staff and the events team have no outlets to choose between.
  // The outlet and date pickers drive sales figures; roles without outlet sales do not see them.
  const showScope = !["employee", "event_manager", "sales", "sales_director", "storekeeper"].includes(user.role) && !user.deptId;

  return (
    <>
    <div className="no-print sticky top-0 z-20 border-b border-line bg-paper">
      <div className="mx-auto flex min-h-16 w-full max-w-[1760px] flex-wrap items-center gap-x-2 gap-y-2 px-4 py-2 sm:px-6 lg:gap-x-4 lg:px-8">
        <Link href={homePath(user)} aria-label="Tyll home" className="flex items-center gap-2 rounded-md md:hidden">
          <TyllLogo height={20} priority />
        </Link>
        <span className="hidden min-[440px]:inline md:hidden"><EarlyAccessBadge /></span>
        {showScope ? (
          <div className="order-last flex min-w-0 basis-full items-center gap-2 lg:order-none lg:basis-auto">
            <ScopeControl user={user} />
            <div className="relative min-w-0">
              <Segmented size="sm" label="Date range" value={preset} onChange={(v) => (v === "custom" ? setPanel("dates") : (setPreset(v), setPanel(null)))} options={PRESETS.map((p) => (p.value === "custom" && preset === "custom" ? { ...p, label: fmtRange(custom) } : p))} />
              {panel === "dates" && <DatePanel onClose={() => setPanel(null)} />}
            </div>
          </div>
        ) : (
          <p className="hidden min-w-0 truncate text-sm text-steel sm:block">{allowedOutlets(user)[0] ? `${outletById[allowedOutlets(user)[0]].name}, ` : ""}{propertyById[props[0]].name}</p>
        )}
        <div className="ml-auto flex min-w-0 items-center gap-1">
          <button type="button" data-tour="search" onClick={() => setPalette(true)} aria-label="Search items, outlets and actions" className="flex h-10 items-center gap-2 rounded-full px-3 text-[13px] text-graphite transition-colors duration-200 hover:bg-mist min-[90rem]:border min-[90rem]:border-line">
            <Search size={17} aria-hidden /><span className="hidden min-[90rem]:inline">Search</span><kbd className="hidden rounded-md border border-line px-1.5 text-[11px] text-steel min-[90rem]:inline">{/Mac|iPhone|iPad/.test(navigator.userAgent) ? "Cmd K" : "Ctrl K"}</kbd>
          </button>
          <AlertsButton user={user} />
          {mayLogBreakage(user) && pathname !== "/waste" && <button type="button" onClick={() => openBreakage(true)} className="hidden h-9 items-center gap-2 rounded-full border border-line bg-paper px-3 text-[13px] font-medium text-ink transition-colors duration-150 hover:bg-cloud md:flex"><GlassWater size={15} aria-hidden /> Log breakage</button>}
          <RoleSwitcher user={user} />
          <div className="relative shrink-0">
            <button type="button" onClick={() => toggle("profile")} aria-label="Your profile and settings" aria-expanded={panel === "profile"} aria-haspopup="menu" className="ml-1 flex items-center rounded-full transition-opacity duration-200 hover:opacity-85">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-xs font-medium text-paper" aria-hidden>{user.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}</span>
            </button>
            {panel === "profile" && <ProfileMenu user={user} onClose={() => setPanel(null)} onNews={() => setNews(true)} theme={theme} onTheme={toggleTheme} />}
          </div>
        </div>
      </div>
    </div>
    {palette && <CommandPalette user={user} pages={PAGES} onClose={() => setPalette(false)} />}
    <WhatsNew open={news} onClose={() => setNews(false)} />
    </>
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

function ProfileMenu({ user, onClose, onNews, theme, onTheme }: { user: User; onClose: () => void; onNews: () => void; theme: "dark" | "light"; onTheme: () => void }) {
  const signOut = useDemo((s) => s.signOut);
  const ref = useDismiss(onClose);
  const pinRequired = useSession((s) => s.pinExpiresAt !== null);
  const publicDemo = useSession((s) => !!s.demoRoles);
  const lock = async () => {
    onClose();
    await api("/api/auth/lock", { method: "POST", body: {} }).catch(() => undefined);
    lockLocally();
  };
  const leave = () => leaveTyll(signOut);
  return (
    <div ref={ref} role="menu" className="animate-rise absolute right-0 top-12 z-40 w-[280px] rounded-2xl border border-line bg-paper p-2 shadow-float">
      <div className="px-3 py-2.5">
        <p className="text-sm text-ink">{user.name}</p>
        <p className="text-xs text-steel">{user.title}</p>
      </div>
      <div className="border-t border-hair pt-1">
        <div className="px-1 py-1" onClick={onClose}><TakeTourButton user={user} here label="Tour this page" className="w-full border-0 px-2 py-2 text-sm" /></div>
        <button role="menuitem" type="button" onClick={() => { onClose(); onNews(); }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-graphite hover:bg-mist"><Sparkles size={16} strokeWidth={1.7} /> What&apos;s new</button>
        <button role="menuitem" type="button" onClick={onTheme} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-graphite hover:bg-mist">{theme === "dark" ? <Sun size={16} /> : <Moon size={16} />} {theme === "dark" ? "Light mode" : "Dark mode"}</button>
        <Link role="menuitem" href="/more" onClick={onClose} className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-graphite hover:bg-mist"><LayoutGrid size={16} /> More tools</Link>
        <Link role="menuitem" href="/alerts" onClick={onClose} className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-graphite hover:bg-mist"><Bell size={16} /> All alerts</Link>
        <Link role="menuitem" href="/settings" onClick={onClose} className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-graphite hover:bg-mist"><Settings size={16} /> Settings</Link>
        {pinRequired && !publicDemo && (
          <button role="menuitem" type="button" onClick={lock} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-graphite hover:bg-mist">
            <LockKeyhole size={16} strokeWidth={1.7} /> Lock now
          </button>
        )}
        <button role="menuitem" type="button" onClick={leave} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-graphite hover:bg-mist">
          <LogOut size={16} strokeWidth={1.7} /> {publicDemo ? "Leave demo" : "Sign out"}
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
      if (pending) out.push({ id: "offline", text: `${pending} waste entr${pending === 1 ? "y" : "ies"} waiting to synchronise`, detail: "Recorded offline on this device.", href: "/waste?log=1", tone: "neutral" });
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

/** Small banner pages use to say their figures come from simulated records. */
export function SimulatedBadge({ children = "Simulated data" }: { children?: ReactNode }) {
  return <Badge tone="neutral">{children}</Badge>;
}

export { report, currentRange };
