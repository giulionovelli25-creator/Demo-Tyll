"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowLeft, CircleHelp, Menu, Wine,
  Banknote, Bell, BedDouble, CalendarDays, ChevronDown, ClipboardList, Eye, FileSearch, FileText, Landmark, LayoutDashboard, LayoutGrid, LockKeyhole, LogOut, Moon, Package,  PlayCircle, Search, Settings, ShoppingCart, Smartphone, Sparkles, Sun, Trash2, UtensilsCrossed, type LucideIcon,
} from "lucide-react";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, Fragment } from "react";
import { BrandLoader, TyllLogo, TyllMark } from "@/components/brand";
import { Badge, Button, Drawer, EmptyState, Field, Segmented, Select, Toaster, cn, report, toast } from "@/components/ui";
import { useRemembered } from "@/components/disclosure";
import { ALL_ITEMS, FOOT, PINNED, SECTIONS, activeItem, moduleOfItem, sectionOf, type NavItem } from "@/lib/nav";
import { ROLE_LABEL, outletById, propertyById } from "@/lib/data/catalog";
import { clearDataset, getDataset, hasDataset, hydrateDataset } from "@/lib/data/dataset";
import { api, goToLogin, lockLocally, reloadTo, useSession } from "@/lib/api";
import { MODULE_TONE, OUTLET_TONE } from "@/components/theme";
import { backTarget, isMainPage } from "@/lib/back";
import { LanguageLayer, LanguagePicker } from "./language";
import { SilverWave } from "./silver-wave";
import { AlertFeedProvider, useAlertFeed } from "@/lib/alert-feed";
import type { Snapshot } from "@/lib/server/snapshot";
import { MODULE_PATH, allowedOutlets, can, demoRoleFits, allowedProperties, canOpen, clampScope, hasWholeProperty, homePath, moduleOfPath, modulesFor, type ModuleId } from "@/lib/domain/access";
import { deliveryOvercharge } from "@/lib/domain/inventory";
import { assessArrival } from "@/lib/domain/operations";
import { useInvestigations, useUser } from "@/lib/hooks";
import { currentRange, useDemo } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import type { Dept, User } from "@/lib/types";
import { DEMO_NOW_MIN, DEMO_TODAY, addDays, fmtDate, fmtRange, fmtTime, type RangePreset } from "@/lib/util";
import { BreakageFab, BreakageSheet, mayLogBreakage, useBreakageSheet } from "./breakage";
import { CommandPalette } from "./command-palette";
import { CountRoute } from "@/components/stock/take-count";
import { Login } from "./login";
import { Welcome } from "./welcome";
import { GuidedPath, WhatsNew, startGuidedPath } from "./early-access";
import { NotificationBell } from "./notifications";
import { DemoGuide, DemoPicker } from "./demo-guide";
import { TakeTourButton, TourOffer, Walkthrough } from "./walkthrough";
import { SharedStockSync } from "@/lib/shared-stock";
import { PinScreen } from "./pin";
import { Tour } from "./tour";
import { PILOT_URL } from "@/lib/pilot";

const NAV: Record<ModuleId, { label: string; short?: string; icon: LucideIcon }> = {
  overview: { label: "Overview", icon: LayoutDashboard },
  stock: { label: "Stock levels", icon: Package },
  forecast: { label: "Predictions", icon: ShoppingCart },
  money: { label: "Revenue", icon: Banknote },
  drinks: { label: "Over pouring", short: "Pouring", icon: Wine },
  waste: { label: "Log waste", icon: Trash2 },
  reports: { label: "Reports", icon: FileText },
  alerts: { label: "Alerts", icon: Bell },
  more: { label: "Other tools", icon: LayoutGrid },
  settings: { label: "Settings", icon: Settings },
  staff: { label: "Tyll Staff", icon: Smartphone },
  tasks: { label: "My tasks", icon: ClipboardList },
  events: { label: "Events and Staffing", icon: CalendarDays },
  flow: { label: "Tyll Flow", icon: UtensilsCrossed },
  rooms: { label: "Rooms and Guest Experience", icon: BedDouble },
  investigations: { label: "Money Back List", icon: FileSearch },
  finance: { label: "Reconciliation", icon: Landmark },
};

/** Modules still being built. They work with demo data but are marked so nobody mistakes them for finished. */
const IN_DEVELOPMENT: ModuleId[] = ["events", "rooms"];

const PAGES = Object.fromEntries(Object.entries(NAV).map(([m, n]) => [m, n.label])) as Record<ModuleId, string>;

type NavCount = { n: number; label: string };

/** How many things are waiting behind a sidebar item. Amber: they need attention. */
function useNavCounts(): Record<string, NavCount> {
  const { plan, open } = useAlertFeed();
  const critical = plan?.items.filter((i) => i.health === "critical").length ?? 0;
  const red = open.filter((a) => a.rag === "red").length;
  return { ...(critical ? { stock: { n: critical, label: `${critical} critical` } } : {}), ...(red ? { alerts: { n: red, label: `${red} to act on today` } } : {}) };
}

/** In the public demo every area is open: the link changes role when it must. Otherwise only what the role may open. */
function useMayOpen(user: User) {
  const publicDemo = useSession((s) => !!s.demoRoles);
  return useCallback((i: NavItem) => (!i.needs || i.needs.some((p) => can(user, p))) && (publicDemo || canOpen(user, moduleOfItem(i))), [publicDemo, user]);
}

function NavLink({ item, user, active, count, compact, onPick }: { item: NavItem; user: User; active: boolean; count?: NavCount; compact?: boolean; onPick?: () => void }) {
  const publicDemo = useSession((s) => !!s.demoRoles);
  const reload = publicDemo && !demoRoleFits(user, moduleOfItem(item));
  const Icon = item.icon;
  const className = cn(
    "relative flex items-center rounded-[var(--radius-control)] text-nav-quiet transition-colors duration-150 ease-tyll hover:bg-nav-hover hover:text-nav-ink",
    compact ? "flex-col gap-1 px-1 py-2 text-center text-xs leading-tight" : "min-h-9 gap-3 px-3 py-1.5 text-[13.5px]",
    active && "bg-nav-active font-medium text-nav-ink shadow-panel hover:bg-nav-active",
  );
  const body = (
    <>
      {active && <span aria-hidden className={cn("absolute rounded-full bg-accent", compact ? "inset-x-3 top-0 h-[3px]" : "inset-y-2 start-0 w-[3px]")} />}
      <Icon size={17} className={cn("shrink-0", active ? "text-accent" : "text-accent-ink")} aria-hidden />
      <span className={cn("min-w-0", compact ? "truncate" : "leading-snug")}>{compact ? item.short ?? item.label : item.label}</span>
      {count && <span className={cn("num rounded-full bg-warn-soft px-1.5 text-center text-xs font-medium leading-[18px] text-warn", compact ? "absolute end-1 top-1 min-w-[18px]" : "ms-auto min-w-[20px]")}><span aria-hidden>{count.n}</span><span className="sr-only">{count.label}</span></span>}
    </>
  );
  // A full load lets the public demo change role on the server first.
  return reload
    ? <a href={item.href} aria-current={active ? "page" : undefined} className={className} onClick={onPick}>{body}</a>
    : <Link href={item.href} prefetch={false} aria-current={active ? "page" : undefined} className={className} onClick={onPick}>{body}</Link>;
}

/** Overview and Alerts, then the three sections of tyll.ai. Each section is a title that opens its pages; only one is open at a time, starting with the one you are in. */
function NavTree({ user, compact, onPick }: { user: User; compact?: boolean; onPick?: () => void }) {
  const pathname = usePathname();
  const tab = useSearchParams().get("tab");
  const active = activeItem(pathname, tab);
  const current = sectionOf(pathname, tab)?.id ?? null;
  const [open, setOpen] = useState<string | null>(current);
  // Moving to a page in another section opens that section.
  const [seen, setSeen] = useState(current);
  if (current !== seen) { setSeen(current); if (current) setOpen(current); }
  const may = useMayOpen(user);
  const counts = useNavCounts();
  const item = (i: NavItem) => <li key={i.id}><NavLink item={i} user={user} active={active?.id === i.id} count={counts[i.id]} compact={compact} onPick={onPick} /></li>;
  return (
    <>
      <ul data-mod="indigo" className="space-y-0.5">{PINNED.filter(may).map(item)}</ul>
      <div className={compact ? "mt-2 space-y-1" : "mt-3 space-y-1"}>
        {SECTIONS.map((s) => {
          const items = s.items.filter(may);
          if (!items.length) return null;
          const isOpen = open === s.id;
          const waiting = items.reduce((n, i) => n + (counts[i.id]?.n ?? 0), 0);
          const Icon = s.icon;
          return (
            <div key={s.id} data-mod={s.tone}>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : s.id)}
                className={cn(
                  "relative flex w-full items-center rounded-[var(--radius-control)] text-accent-ink transition-colors duration-150 ease-tyll hover:bg-nav-hover",
                  compact ? "flex-col gap-1 px-1 py-2 text-center text-xs font-medium leading-tight" : "min-h-10 gap-3 px-3 py-2 text-start text-[13.5px] font-medium",
                  isOpen && !compact && "bg-accent-soft/60",
                )}
              >
                <Icon size={17} className="shrink-0" aria-hidden />
                <span className={cn("min-w-0 flex-1", compact ? "truncate" : "leading-snug")}>{compact ? s.title.split(" ")[0] : s.title}</span>
                {!isOpen && waiting > 0 && <span className={cn("num rounded-full bg-warn-soft px-1.5 text-xs leading-[18px] text-warn", compact && "absolute end-1 top-1")}><span aria-hidden>{waiting}</span><span className="sr-only">{waiting} waiting</span></span>}
                {!compact && <ChevronDown size={15} className={cn("shrink-0 text-nav-quiet transition-transform duration-150 ease-tyll", isOpen && "rotate-180")} aria-hidden />}
              </button>
              {isOpen && <ul aria-label={s.title} className={cn("mt-0.5 space-y-0.5", !compact && "ms-[22px] border-s border-accent-ink/25 ps-2")}>{items.map(item)}</ul>}
            </div>
          );
        })}
      </div>
    </>
  );
}

/** Settings and help, folded into one title at the foot. */
function FootGroup({ user, compact, onPick }: { user: User; compact?: boolean; onPick?: () => void }) {
  const publicDemo = useSession((s) => !!s.demoRoles);
  const canTour = !publicDemo && user.role !== "employee" && user.role !== "storekeeper";
  const [picking, setPicking] = useState(false);
  const pathname = usePathname();
  const may = useMayOpen(user);
  const here = FOOT.some((i) => pathname === i.href);
  const [state, setState] = useRemembered<"open" | "closed">("nav.foot", "closed");
  const open = state === "open" || here;
  const row = cn("flex w-full items-center rounded-[var(--radius-control)] text-nav-quiet transition-colors duration-150 ease-tyll hover:bg-nav-hover hover:text-nav-ink", compact ? "flex-col gap-1 px-1 py-2 text-xs" : "min-h-9 gap-3 px-3 py-1.5 text-[13.5px]");
  return (
    <div data-mod="slate">
      {!here && (
        <button type="button" aria-expanded={open} onClick={() => setState(open ? "closed" : "open")} className={cn(row, !compact && "font-medium text-nav-ink")}>
          <Settings size={17} aria-hidden /><span className="min-w-0 flex-1 text-start">{compact ? "Settings" : "Settings and help"}</span>
          {!compact && <ChevronDown size={15} className={cn("shrink-0 transition-transform duration-150 ease-tyll", open && "rotate-180")} aria-hidden />}
        </button>
      )}
      {open && (
        <ul className={cn("space-y-0.5", !compact && !here && "ms-[22px] border-s border-nav-line ps-2")}>
          {FOOT.filter(may).filter((i) => !(publicDemo && i.id === "more")).map((i) => <li key={i.id}><NavLink item={i} user={user} active={pathname === i.href} compact={compact} onPick={onPick} /></li>)}
          <li>
            {publicDemo ? (
              <button type="button" onClick={() => { onPick?.(); startGuidedPath(); }} className={row}><CircleHelp size={17} aria-hidden /><span>Help and tour</span></button>
            ) : <TakeTourButton user={user} className={cn(row, "!rounded-[var(--radius-control)] !border-0 !text-nav-quiet")} label="Help and tour" />}
          </li>
          {canTour && <li><button type="button" data-tour="guide" onClick={() => setPicking(true)} className={row}><PlayCircle size={17} aria-hidden /><span>Guided demo</span></button></li>}
        </ul>
      )}
      {picking && <DemoPicker user={user} onClose={() => setPicking(false)} />}
    </div>
  );
}

/** The one quick way to log waste, at the top of the sidebar on every screen. It opens the logging sheet where you are. */
function LogWasteButton({ user, compact }: { user: User; compact?: boolean }) {
  const openLog = useBreakageSheet((b) => b.set);
  if (!mayLogBreakage(user)) return null;
  return (
    <button type="button" onClick={() => openLog(true)} className={cn("flex w-full items-center justify-center rounded-full bg-accent font-medium text-on-accent shadow-panel transition-colors duration-150 ease-tyll hover:bg-accent-hover", compact ? "h-10 flex-col gap-0.5 text-xs" : "h-10 gap-2 text-sm")}>
      <Trash2 size={compact ? 16 : 17} aria-hidden />{compact ? <span className="sr-only">Log waste</span> : "Log waste"}
    </button>
  );
}

const subscribe = () => () => {};

/** Ends the session. The public demo has no sign-in, so it has nothing to leave. */
async function leaveTyll(signOut: () => void) {
  await api("/api/auth/logout", { method: "POST", body: {} }).catch(() => undefined);
  signOut();
  clearDataset();
  reloadTo("/login");
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
    <Select label="View the demo as" hideLabel className="w-[170px] sm:w-[176px]" value={current} disabled={busy} onChange={(e) => switchTo(e.target.value)}>
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
  return <><LanguageLayer /><SilverWave /><Authed>{children}</Authed></>;
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
        <Link prefetch={false} href="/staff" className="flex items-center gap-2" aria-label="Tyll Staff home"><TyllLogo height={20} /><span className="text-[13px] text-steel">Staff</span></Link>
        <span className="flex items-center gap-1">
          <TakeTourButton user={user} label="Tour" className="border-0 px-2" />
          <NotificationBell />
          {others.length > 0 && <Link prefetch={false} href={MODULE_PATH[others[0]]} className="rounded-full px-3 py-2 text-[13px] text-graphite hover:bg-mist">Full Tyll</Link>}
          <LanguagePicker />
          {!publicDemo && <button type="button" onClick={leave} className="rounded-full px-3 py-2 text-[13px] text-graphite hover:bg-mist">Sign out</button>}
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

/** Puts the chosen look on <html>, where tokens.css reads it. In the By outlet look the accent follows the outlet picked in the top bar. */
function useLookSync(user: User) {
  // The look is chosen: section colours and medium waves for everyone. A choice saved by the old Try a look panel no longer applies.
  const colour = "sections" as string;
  const waves = "medium";
  const rawScope = useDemo((s) => s.scope);
  const outletId = clampScope(user, rawScope).outletId;
  useEffect(() => {
    const root = document.documentElement.dataset;
    root.waves = waves;
    if (colour === "sections") { delete root.look; delete root.tone; delete root.outlets; return; }
    root.look = "one";
    if (colour === "outlets") {
      root.outlets = "on";
      root.tone = OUTLET_TONE[outletId]?.tone ?? "indigo";
    } else {
      delete root.outlets;
      root.tone = colour;
    }
  }, [colour, waves, outletId]);
}

// The last main page opened in this tab, so the exit returns there.
let lastMainPage: string | null = null;

/** One exit on every sub page, in the top bar so it stays in reach and never covers the page. Leaving keeps saved drafts and nothing is submitted. */
function BackToMain({ user }: { user: User }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const publicDemo = useSession((s) => !!s.demoRoles);
  const main = isMainPage(pathname, params);
  useEffect(() => { if (main) lastMainPage = pathname; }, [main, pathname]);
  // These roles open the section straight on its only list, so there is no main page to return to.
  const noMainPage = (pathname === "/stock" && user.role === "employee") || (pathname === "/forecast" && (user.role === "employee" || !canOpen(user, "stock")));
  const wanted = noMainPage || !canOpen(user, moduleOfPath(pathname)) ? null : backTarget(pathname, params, lastMainPage, publicDemo ? "" : homePath(user));
  if (!wanted) return null;
  const target = publicDemo || canOpen(user, moduleOfPath(wanted)) ? wanted : homePath(user);
  // Sent home because the role cannot open the main page, and already there.
  if (target !== wanted && target.split("?")[0] === pathname) return null;
  const [tPath, tQuery] = target.split("?");
  const label = activeItem(tPath, tQuery ? new URLSearchParams(tQuery).get("tab") : null)?.label ?? NAV[moduleOfPath(tPath)].label;
  const style = "inline-flex h-9 items-center gap-2 rounded-full border border-line bg-paper px-4 text-sm font-medium text-ink transition-colors duration-150 ease-tyll hover:bg-cloud";
  const body = <><ArrowLeft size={16} aria-hidden /> Back to {label}</>;
  return (
    <div className="mx-auto w-full max-w-[1760px] px-4 pb-2 sm:px-6 lg:px-8">
      {publicDemo && !demoRoleFits(user, moduleOfPath(target.split("?")[0])) ? <a href={target} className={style}>{body}</a> : <Link prefetch={false} href={target} className={style}>{body}</Link>}
    </div>
  );
}

function Signed({ user, children }: { user: User; children: ReactNode }) {
  useLookSync(user);
  const pathname = usePathname();
  const tab = useSearchParams().get("tab");
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
  // The tab says where you are.
  useEffect(() => { document.title = `${NAV[current].label}, Tyll demo`; }, [current]);
  if (current === "staff" && allowed) return <StaffFrame user={user}>{children}</StaffFrame>;
  // The count is a full screen flow: nothing else competes for a thumb.
  if (pathname === "/count" && allowed) return <div data-mod={MODULE_TONE.stock}><CountRoute /><Toaster /></div>;
  const preview = IN_DEVELOPMENT.includes(current) || pathname === "/performance";
  const canBreak = mayLogBreakage(user);
  return (
    <AlertFeedProvider>
    <div className="flex min-h-screen">
      <a href="#main" className="no-print sr-only rounded-full bg-accent px-4 py-2 text-sm font-medium text-on-accent focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-[80]">Skip to content</a>
      <Sidebar user={user} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={user} />
        <main id="main" data-mod={sectionOf(pathname, tab)?.tone ?? MODULE_TONE[current]} tabIndex={-1} className={cn("mx-auto w-full max-w-[1500px] flex-1 px-4 pb-24 pt-6 outline-none sm:px-6 md:pb-10 lg:px-8", canBreak && "md:pb-24")}>
          {allowed && (publicDemo ? <GuidedPath offer={pathname === "/more"} /> : pathname === "/more" && <TourOffer user={user} />)}
          {allowed && preview && (
            <p className="mb-4 flex items-start gap-2 rounded-[var(--radius-control)] bg-accent-soft px-4 py-3 text-sm text-accent-ink">
              <Eye size={18} className="mt-px shrink-0" aria-hidden /><span><span className="font-medium">Preview.</span> This module is in development and not yet part of our pilots.</span>
            </p>
          )}
          {allowed ? (
            children
          ) : (
            <EmptyState title="This area is outside your role" action={<Link prefetch={false} href={homePath(user)}><Button variant="primary">Go to your home page</Button></Link>}>
              {ROLE_LABEL[user.role]} accounts cannot open {NAV[current].label}.
            </EmptyState>
          )}
        </main>
      </div>
      <PhoneBar user={user} />
      {canBreak && <BreakageSheet />}
      <Tour />
      <DemoGuide user={user} />
      <Walkthrough />
      <Toaster />
    </div>
    </AlertFeedProvider>
  );
}

function Sidebar({ user }: { user: User }) {
  return (
    <aside className="no-print sticky top-0 z-30 hidden h-screen w-[88px] shrink-0 flex-col border-e border-nav-line bg-nav backdrop-blur-xl md:flex xl:w-[244px]">
      <div className="flex h-16 shrink-0 items-center justify-center gap-2 px-2 xl:justify-start xl:px-5">
        <Link prefetch={false} href={homePath(user)} aria-label="Tyll home" className="flex items-center rounded-md">
          <span className="hidden xl:block"><TyllLogo height={24} priority /></span>
          <span className="xl:hidden"><TyllMark size={22} /></span>
        </Link>
      </div>
      <div className="shrink-0 px-2 pb-2 xl:px-3">
        <div className="xl:hidden"><LogWasteButton user={user} compact /></div>
        <div className="hidden xl:block"><LogWasteButton user={user} /></div>
      </div>
      <nav data-tour="nav" aria-label="Main" className="scroll-thin flex-1 overflow-y-auto px-2 pb-4 pt-1 xl:px-3">
        <div className="xl:hidden"><NavTree user={user} compact /></div>
        <div className="hidden xl:block"><NavTree user={user} /></div>
      </nav>
      <div className="shrink-0 border-t border-nav-line p-2 xl:p-3">
        <div className="xl:hidden"><FootGroup user={user} compact /></div>
        <div className="hidden xl:block"><FootGroup user={user} /></div>
        <p className="hidden px-3 pt-2 text-xs leading-relaxed text-nav-quiet xl:block">Simulated data. Business date {fmtDate(DEMO_TODAY, true)}, {fmtTime(DEMO_NOW_MIN)}.</p>
      </div>
    </aside>
  );
}

/** On a phone the most used places sit at the bottom, within reach of a thumb. More opens the full menu. */
function PhoneBar({ user }: { user: User }) {
  const pathname = usePathname();
  const tab = useSearchParams().get("tab");
  const section = sectionOf(pathname, tab)?.id ?? null;
  const logs = mayLogBreakage(user);
  const openLog = useBreakageSheet((b) => b.set);
  const counts = useNavCounts();
  const may = useMayOpen(user);
  const [menu, setMenu] = useState(false);
  const closeMenu = useCallback(() => setMenu(false), []);
  const find = (id: string) => ALL_ITEMS.find((i) => i.id === id)!;
  const slots: { item: NavItem; lit: boolean; tone: string }[] = [
    { item: find("overview"), lit: pathname === "/", tone: "indigo" },
    { item: find("stock"), lit: section === "stock" && pathname !== "/waste", tone: "teal" },
    { item: find("waste"), lit: pathname === "/waste", tone: "teal" },
    { item: find("predictions"), lit: section === "purchasing", tone: "blue" },
    { item: find("revenue"), lit: section === "revenue", tone: "violet" },
  ].filter((s) => may(s.item));
  const cell = "relative flex h-16 w-full flex-col items-center justify-center gap-1 text-xs text-steel transition-colors duration-150";
  return (
    <>
      <nav aria-label="Main" className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper pb-[env(safe-area-inset-bottom)] md:hidden">
        <ul className="flex">
          {slots.map(({ item, lit }) => {
            const Icon = item.icon;
            const isLog = item.id === "waste" && logs;
            const body = (
              <>
                <span className={cn("flex h-7 w-10 items-center justify-center rounded-full", isLog ? "bg-accent text-on-accent" : lit ? "bg-indigo-soft text-accent" : "text-steel")}><Icon size={18} aria-hidden /></span>
                {counts[item.id] && <span className="num absolute end-[calc(50%-22px)] top-1.5 min-w-[16px] rounded-full bg-warn-soft px-1 text-center text-xs font-medium leading-4 text-warn"><span aria-hidden>{counts[item.id].n}</span><span className="sr-only">{counts[item.id].label}</span></span>}
                <span className={cn("max-w-full truncate px-0.5", lit && "font-medium text-ink")}>{item.short ?? item.label}</span>
              </>
            );
            return (
              <li key={item.id} className="min-w-0 flex-1">
                {/* Log waste opens where you stand: staff use it mid shift. */}
                {isLog && pathname !== "/waste" ? <button type="button" onClick={() => openLog(true)} className={cell}>{body}</button>
                  : <Link prefetch={false} href={item.href} aria-current={lit ? "page" : undefined} className={cell}>{body}</Link>}
              </li>
            );
          })}
          <li className="min-w-0 flex-1">
            <button type="button" onClick={() => setMenu(true)} aria-expanded={menu} className={cell}>
              <span className="flex h-7 w-10 items-center justify-center rounded-full text-graphite"><Menu size={18} aria-hidden /></span>
              <span>More</span>
            </button>
          </li>
        </ul>
      </nav>
      <Drawer open={menu} onClose={closeMenu} title="Menu">
        <nav aria-label="All pages" className="-mx-3"><NavTree user={user} onPick={closeMenu} /></nav>
        <div className="-mx-3 mt-5 border-t border-hair pt-3"><FootGroup user={user} onPick={closeMenu} /></div>
      </Drawer>
    </>
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
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="dialog" className="flex h-10 max-w-[148px] items-center gap-2 rounded-full border border-line bg-paper px-3 text-[13px] text-ink transition-colors duration-200 hover:bg-cloud sm:max-w-[220px]">
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
  return <div ref={ref} role="dialog" aria-label="Choose outlet and department" className="animate-rise absolute start-0 top-11 z-40 w-[280px] space-y-3 rounded-panel border border-line bg-paper p-4 shadow-float">{children}</div>;
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
  const pathname = usePathname();
  // Main pages show fixed periods, and the sections that follow a date choice carry their own switch.
  const dated = !["/", "/waste", "/stock", "/forecast", "/alerts", "/money", "/reports", "/drinks", "/finance", "/investigations"].includes(pathname);
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
    <div className="no-print sticky top-0 z-20 border-b border-nav-line bg-paper/80 backdrop-blur-xl">
      <div className="mx-auto flex min-h-16 w-full max-w-[1760px] flex-wrap items-center gap-x-2 gap-y-2 px-4 py-2 sm:px-6 lg:gap-x-4 lg:px-8">
        <Link prefetch={false} href={homePath(user)} aria-label="Tyll home" className="-my-2.5 flex items-center gap-2 rounded-md py-2.5 md:hidden">
          <TyllLogo height={20} priority />
        </Link>
        {showScope ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2 lg:flex-nowrap">
            <ScopeControl user={user} />
            {/* On a phone the role switch lives in the profile menu, so the top bar stays one row. */}
            <span className="hidden md:inline lg:hidden"><RoleSwitcher user={user} /></span>
            <div className={cn("relative min-w-0 max-lg:order-last max-lg:basis-full", !dated && "hidden")}>
              <Segmented size="sm" label="Date range" value={preset} onChange={(v) => (v === "custom" ? setPanel("dates") : (setPreset(v), setPanel(null)))} options={PRESETS.map((p) => (p.value === "custom" && preset === "custom" ? { ...p, label: fmtRange(custom) } : p))} />
              {panel === "dates" && <DatePanel onClose={() => setPanel(null)} />}
            </div>
          </div>
        ) : (
          <p className="hidden min-w-0 truncate text-sm text-steel sm:block">{allowedOutlets(user)[0] ? `${outletById[allowedOutlets(user)[0]].name}, ` : ""}{propertyById[props[0]].name}</p>
        )}
        <div className="ms-auto flex min-w-0 items-center gap-1">
          <PilotLink />
          <span className="hidden md:inline-flex"><LanguagePicker /></span>
          <button type="button" data-tour="search" onClick={() => setPalette(true)} aria-label="Search items, outlets and actions" className="flex h-10 items-center gap-2 rounded-full px-3 text-[13px] text-graphite transition-colors duration-200 hover:bg-mist min-[90rem]:border min-[90rem]:border-line">
            <Search size={17} aria-hidden /><span className="hidden min-[90rem]:inline">Search</span><kbd className="hidden rounded-md border border-line px-1.5 text-xs text-steel min-[90rem]:inline">{/Mac|iPhone|iPad/.test(navigator.userAgent) ? "Cmd K" : "Ctrl K"}</kbd>
          </button>
          <AlertsButton user={user} />
          <span className={showScope ? "hidden lg:block" : "hidden md:block"}><RoleSwitcher user={user} /></span>
          <div className="relative shrink-0">
            <button type="button" onClick={() => toggle("profile")} aria-label="Your profile and settings" aria-expanded={panel === "profile"} aria-haspopup="menu" className="ms-1 flex items-center rounded-full transition-opacity duration-200 hover:opacity-85">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-ink text-xs font-medium text-paper" aria-hidden>{user.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}</span>
            </button>
            {panel === "profile" && <ProfileMenu user={user} onClose={() => setPanel(null)} onNews={() => setNews(true)} theme={theme} onTheme={toggleTheme} />}
          </div>
        </div>
      </div>
      <Suspense fallback={null}><BackToMain user={user} /></Suspense>
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
    <div ref={ref} className="animate-rise absolute end-0 top-12 z-40 w-[300px] rounded-2xl border border-line bg-paper p-4 shadow-float">
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
    <div ref={ref} role="menu" className="animate-rise absolute end-0 top-12 z-40 w-[280px] rounded-2xl border border-line bg-paper p-2 shadow-float">
      <div className="px-3 py-2.5">
        <p className="text-sm text-ink">{user.name}</p>
        <p className="text-xs text-steel">{user.title}</p>
      </div>
      <div className="space-y-2 border-t border-hair px-3 py-2 md:hidden">
        <RoleSwitcher user={user} />
        <LanguagePicker />
      </div>
      <div className="border-t border-hair pt-1">
        <div className="px-1 py-1" onClick={onClose}><TakeTourButton user={user} here label="Tour this page" className="w-full border-0 px-2 py-2 text-sm" /></div>
        <button role="menuitem" type="button" onClick={() => { onClose(); onNews(); }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-start text-sm text-graphite hover:bg-mist"><Sparkles size={16} strokeWidth={1.7} /> What&apos;s new</button>
        <button role="menuitem" type="button" onClick={onTheme} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-start text-sm text-graphite hover:bg-mist">{theme === "dark" ? <Sun size={16} /> : <Moon size={16} />} {theme === "dark" ? "Light mode" : "Dark mode"}</button>
        {pinRequired && !publicDemo && (
          <button role="menuitem" type="button" onClick={lock} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-start text-sm text-graphite hover:bg-mist">
            <LockKeyhole size={16} strokeWidth={1.7} /> Lock now
          </button>
        )}
        {!publicDemo && (
          <button role="menuitem" type="button" onClick={leave} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-start text-sm text-graphite hover:bg-mist">
            <LogOut size={16} strokeWidth={1.7} /> Sign out
          </button>
        )}
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

/** The pilot offer, always in the top bar, small and out of the way (the owner asked for it to stay visible on 18 November 2026). */
function PilotLink() {
  return (
    <a href={PILOT_URL} target="_blank" rel="noopener noreferrer" className="me-1 hidden h-9 items-center gap-1.5 rounded-full border border-accent/40 bg-paper px-3.5 text-[13px] font-medium text-accent transition-colors duration-150 hover:bg-accent-soft md:inline-flex">
      <Sparkles size={14} aria-hidden /> Start a free 30-day pilot
    </a>
  );
}

/** Small banner pages use to say their figures come from simulated records. */
export function SimulatedBadge({ children = "Simulated data" }: { children?: ReactNode }) {
  return <Badge tone="neutral">{children}</Badge>;
}

export { report, currentRange };
