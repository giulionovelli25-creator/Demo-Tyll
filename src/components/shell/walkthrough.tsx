"use client";
// "Take a tour": Tyll teaches itself. Each step opens a real page, waits for the element, scrolls to it, dims the rest
// and explains it in a sentence or two. Steps the person cannot open are left out, and a step whose element is not on
// screen (for example the sidebar on a phone) is skipped. The tour never clicks, submits or approves anything.
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Compass, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Button, cn } from "@/components/ui";
import { can, canOpen, moduleOfPath, type ModuleId, type Permission } from "@/lib/domain/access";
import type { User } from "@/lib/types";

interface TourStep { path: string; target: string; title: string; text: string; module?: ModuleId; perm?: Permission }

const S = {
  nav: (path: string): TourStep => ({ path, target: "nav", title: "Your main tools", text: "The tools for your job are here. Less common ones sit under More, so this list stays short." }),
  search: (path: string): TourStep => ({ path, target: "search", title: "Search anything", text: "Find a record or a screen by name, such as Coca-Cola, PR-DXB-0001 or a room number. Press Ctrl+K on a keyboard." }),
  bell: (path: string): TourStep => ({ path, target: "bell", title: "Requests for you", text: "When another team sends you work, it appears here. Tap a notification to open the exact record." }),
  hub: (path: string, title: string, text: string, module: ModuleId): TourStep => ({ path, target: "hub", title, text, module }),
  page: (path: string, title: string, text: string, module: ModuleId, perm?: Permission): TourStep => ({ path, target: "page", title, text, module, perm }),
};

const ownerLike = (u: User): TourStep[] => [
  { path: "/", target: "kpis", title: "How the business is doing", text: "Revenue, costs, estimated operating contribution and potential losses for the period. Tap a figure for its breakdown, or the ? for what it means.", module: "overview" },
  { path: "/", target: "attention", title: "Needs your attention", text: "The few issues worth your time today, most important first. Each one opens its evidence.", module: "overview" },
  { path: "/", target: "compare", title: "Hotels and outlets", text: "How each outlet compares on margin and open issues. Choose a row to narrow every figure to it.", module: "overview" },
  { path: "/", target: "more", title: "More when you want it", text: "Trends, confirmed results, guest experience and confirmed new business are one tap away.", module: "overview" },
  S.page("/investigations", "Investigations", "Every open case with its evidence and what the team decided. Potential losses become confirmed or recovered only when a case is closed.", "investigations"),
  (u.role === "owner" ? S.page : S.hub)("/finance", "Finance", u.role === "owner" ? "Budgets and reports: spending against budget for each department, in each hotel's own currency." : "Approvals, supplier invoices, budgets and reports.", "finance"),
  ...(u.role === "gm" ? [S.hub("/rooms", "Rooms and guests", "Arrivals, room readiness, housekeeping and guest service for the hotel.", "rooms")] : []),
  S.nav("/"), S.search("/"), S.bell("/"),
  { path: "/", target: "guide", title: "Guided demo", text: "Step-by-step stories that show departments working together. Use it to present Tyll." },
];

const TOURS: Partial<Record<User["role"], (u: User) => TourStep[]>> = {
  owner: ownerLike,
  gm: ownerLike,
  controller: () => [
    S.hub("/finance", "Your finance home", "Three choices: approvals waiting for you, supplier invoices to check, and budgets and reports.", "finance"),
    S.page("/finance?tab=approvals", "Approvals", "Purchase requests that need accounting's decision. Open one to see items, supplier, cost and the budget left.", "finance", "purchase.approveFinance"),
    S.page("/finance?tab=invoices", "Invoices", "Each supplier invoice is compared with the order and what arrived. Differences are listed first.", "finance", "finance.review"),
    S.page("/finance?tab=reports", "Budgets and reports", "Spending against budget, open commitments and cost exceptions. Recorded spending is never mixed with orders still open.", "finance"),
    S.nav("/finance"), S.search("/finance"), S.bell("/finance"),
  ],
  restaurant_manager: () => [
    { path: "/", target: "kpis", title: "Your restaurant today", text: "Revenue, margin, open issues and your tasks at a glance.", module: "overview" },
    { path: "/", target: "attention", title: "Tasks and problems", text: "What is waiting for you and the problems at this outlet. Each opens the record.", module: "overview" },
    S.hub("/stock", "Stock", "Check where stock went, log waste and breakage, and count what is on the shelf.", "stock"),
    S.page("/stock?tab=where", "Where did it go?", "Stock used that sales do not explain, item by item. Open one to see the calculation and what to check.", "investigations"),
    S.hub("/forecast", "Forecast", "What to buy, what to prep and the approvals for your requests.", "forecast"),
    S.hub("/events", "Events and staff support", "Ask other teams for staff, or answer their requests for yours.", "events"),
    S.nav("/"), S.search("/"), S.bell("/"),
  ],
  purchasing: () => [
    S.page("/forecast?tab=approvals", "Incoming requests", "Every purchase request waiting for purchasing. Open one to check quantities and choose the supplier, then approve or send it back.", "forecast"),
    S.bell("/forecast?tab=approvals"),
    S.hub("/stock", "Stock and deliveries", "Stock levels, and supplier deliveries that did not match the order.", "stock"),
    S.search("/forecast?tab=approvals"),
  ],
  chef: () => [
    S.page("/forecast?tab=prep", "What to prep", "How many portions to prepare. Assign each dish to someone in your kitchen; they see it on their phone.", "forecast"),
    S.hub("/stock", "Stock", "Log waste, count stock and see what is running low.", "stock"),
    S.page("/events?tab=events", "Events", "Events your kitchen prepares for, with their portions.", "events"),
    S.bell("/forecast?tab=prep"),
  ],
  event_manager: () => [
    S.hub("/events", "Your events home", "Plan an event, follow your events, and ask other departments for staff.", "events"),
    S.page("/events?tab=plan", "Plan an event", "Enter guests, menu and times; Tyll works out portions, ingredients, staff and an estimated cost.", "events", "events.plan"),
    S.page("/events?tab=events", "My events", "Open an event to see staffing shortages and ingredients still to buy. Shortages can go straight to Purchasing.", "events"),
    S.page("/events?tab=support", "Staff support", "Requests you sent to other departments, and their answers.", "events"),
    S.bell("/events"),
  ],
  housekeeping_manager: () => [
    S.hub("/rooms", "Rooms", "Room readiness and your housekeeping board.", "rooms"),
    S.page("/rooms?tab=housekeeping", "Housekeeping", "Rooms waiting, being cleaned and waiting for inspection. Assign rooms, add help and inspect from here.", "rooms", "hk.manage"),
    S.page("/rooms?tab=readiness", "Room readiness", "Which arriving guests' rooms will be ready in time.", "rooms"),
    S.bell("/rooms"),
  ],
  front_office: () => [
    S.hub("/rooms", "Rooms and guests", "Arrivals, guest requests, Guest Connect and luggage.", "rooms"),
    S.page("/rooms?tab=readiness", "Arrivals and room readiness", "Rooms that may be late for their guest are listed first. Open one to ask housekeeping to clean it first.", "rooms"),
    S.page("/rooms?tab=requests", "Guest requests", "Taxis, help in the room and other requests, with who is handling each.", "rooms", "fo.desk"),
    S.page("/rooms?tab=connect", "Guest Connect", "Ask a hotel restaurant, bar, spa or activity for a table or slot. Nothing is confirmed until the venue accepts.", "rooms", "fo.desk"),
    S.bell("/rooms"),
  ],
  concierge: () => [
    S.page("/rooms?tab=requests", "Guest requests", "Guest service requests: take one on, follow it, record the outcome.", "rooms", "concierge"),
    S.page("/rooms?tab=connect", "Guest Connect", "Ask hotel venues for a table or slot and follow their answers.", "rooms", "fo.desk"),
    S.bell("/rooms"),
  ],
  bell_captain: () => [
    S.page("/rooms?tab=bell", "Luggage requests", "New requests from the front desk. Assign each to someone on shift and follow it to the room.", "rooms", "bell.dispatch"),
    S.bell("/rooms?tab=bell"),
  ],
  sales: () => [
    S.hub("/events", "Your sales home", "Opportunities, proposals and confirmed business.", "events"),
    S.page("/events?tab=opportunities", "Opportunities", "Potential business with the next action for each.", "events", "sales.work"),
    S.page("/events?tab=proposals", "Proposals", "Quotes with their price and estimated cost. Confirming one creates the event for operations.", "events", "sales.work"),
    S.bell("/events"),
  ],
  employee: () => [
    { path: "/staff", target: "staff-tasks", title: "Your tasks", text: "Work assigned to you. Tap one to open it.", module: "staff" },
    { path: "/staff", target: "staff-actions", title: "Quick actions", text: "The things your job needs, such as logging waste. Your manager sees what you save straight away.", module: "staff" },
    { path: "/staff", target: "staff-updates", title: "Updates", text: "What you saved recently and news for you.", module: "staff" },
    { path: "/staff", target: "bell", title: "Requests for you", text: "New tasks from your manager arrive here.", module: "staff" },
  ],
};
TOURS.fnb_director = TOURS.restaurant_manager;
TOURS.sales_director = TOURS.sales;
TOURS.storekeeper = TOURS.employee;

/** The steps this person may see. With `here`, only the steps for the current module. */
export function tourFor(user: User, here?: string): TourStep[] {
  const steps = (TOURS[user.role]?.(user) ?? []).filter((s) => (!s.module || canOpen(user, s.module)) && (!s.perm || can(user, s.perm)) && canOpen(user, moduleOfPath(s.path.split("?")[0])));
  if (!here) return steps;
  const mod = moduleOfPath(here);
  const local = steps.filter((s) => moduleOfPath(s.path.split("?")[0]) === mod);
  return local.length ? local : steps;
}

interface TourState { steps: TourStep[] | null; at: number; dir: 1 | -1; start(steps: TourStep[]): void; go(i: number, dir: 1 | -1): void; stop(): void }
export const useWalkthrough = create<TourState>()(persist((set) => ({
  steps: null, at: 0, dir: 1,
  start: (steps) => set({ steps, at: 0, dir: 1 }),
  go: (at, dir) => set({ at, dir }),
  stop: () => set({ steps: null, at: 0 }),
}), { name: "tyll-walkthrough-v1" }));

/** The "Take a tour" button: whole workspace, or just this page. */
export function TakeTourButton({ user, here, className, label = "Take a tour", labelClass }: { user: User; here?: boolean; className?: string; label?: string; labelClass?: string }) {
  const start = useWalkthrough((s) => s.start);
  const pathname = usePathname();
  const steps = tourFor(user, here ? pathname : undefined);
  if (!steps.length) return null;
  return <button type="button" title={label} onClick={() => start(steps)} className={cn("inline-flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-[13px] text-graphite transition-colors hover:bg-mist hover:text-ink", className)}><Compass size={16} className="shrink-0" aria-hidden /> <span className={labelClass}>{label}</span></button>;
}

/** A one-time offer on first sign-in, easy to skip. */
export function TourOffer({ user }: { user: User }) {
  const key = `tyll-tour-offered-${user.id}`;
  const running = useWalkthrough((s) => !!s.steps);
  const start = useWalkthrough((s) => s.start);
  const [show, setShow] = useState(() => { try { return !localStorage.getItem(key); } catch { return false; } });
  const done = () => { try { localStorage.setItem(key, "1"); } catch { /* private window */ } setShow(false); };
  if (!show || running || !tourFor(user).length) return null;
  return (
    <div role="dialog" aria-label="Take a tour" className="no-print animate-rise fixed bottom-4 left-4 right-4 z-40 rounded-2xl border border-line bg-paper p-4 shadow-float sm:left-auto sm:w-[340px] md:left-[96px] xl:left-[272px]">
      <p className="text-[15px] text-ink">New to Tyll?</p>
      <p className="mt-1 text-[13px] text-steel">A one-minute tour shows where your main tools are.</p>
      <div className="mt-3 flex gap-2">
        <Button size="sm" variant="primary" onClick={() => { done(); start(tourFor(user)); }}><Compass size={14} /> Take the tour</Button>
        <Button size="sm" variant="ghost" onClick={done}>Skip</Button>
      </div>
    </div>
  );
}

export function Walkthrough() {
  const { steps, at, dir, go, stop } = useWalkthrough();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // What was found for which step; anything recorded for an earlier step is ignored.
  const [found, setFound] = useState<{ key: string; rect: DOMRect | null; missing: boolean } | null>(null);
  const el = useRef<Element | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const step = steps?.[at];
  const key = step ? `${at}:${step.path}:${step.target}` : "";
  const rect = found?.key === key ? found.rect : null;
  const missing = found?.key === key && found.missing;
  const setRect = useCallback((r: DOMRect) => setFound({ key, rect: r, missing: false }), [key]);
  const here = pathname + (params.toString() ? `?${params}` : "");
  const still = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const next = useCallback(() => { if (!steps) return; if (at >= steps.length - 1) stop(); else go(at + 1, 1); }, [steps, at, go, stop]);
  const back = useCallback(() => { if (at > 0) go(at - 1, -1); }, [at, go]);

  // Open the step's page, then wait for its element.
  useEffect(() => {
    if (!step) return;
    el.current = null;
    if (here !== step.path) router.push(step.path);
    let tries = 0;
    const t = setInterval(() => {
      const found = document.querySelector(`[data-tour="${step.target}"]`);
      const r = found?.getBoundingClientRect();
      if (found && r && r.width > 0 && r.height > 0) {
        clearInterval(t);
        el.current = found;
        found.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "center" });
        setTimeout(() => setRect(found.getBoundingClientRect()), still ? 0 : 350);
      } else if (++tries > 30) {
        clearInterval(t);
        // Not on this screen (such as the sidebar on a phone): move on in the same direction.
        setFound({ key, rect: null, missing: true });
      }
    }, 150);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!missing || !steps) return;
    if (dir === 1) next();
    else if (at > 0) go(at - 1, -1);
    else next();
  }, [missing, dir, steps, at, go, next]);

  // Keep the spotlight on the element as the page scrolls or resizes.
  useEffect(() => {
    if (!step) return;
    // Content can still move after loading (data arriving, fonts, images), so measure again regularly too.
    let last = "";
    const update = () => {
      if (!el.current) return;
      const r = el.current.getBoundingClientRect();
      const sig = `${Math.round(r.top)},${Math.round(r.left)},${Math.round(r.width)},${Math.round(r.height)}`;
      if (sig !== last) { last = sig; setRect(r); }
    };
    const t = setInterval(update, 250);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => { clearInterval(t); window.removeEventListener("scroll", update, true); window.removeEventListener("resize", update); };
  }, [step, setRect]);

  useEffect(() => {
    if (!step) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") stop();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, next, back, stop]);

  useLayoutEffect(() => { if (rect) box.current?.focus({ preventScroll: true }); }, [rect]);

  if (!steps || !step) return null;
  const pad = 8;
  const narrow = typeof window !== "undefined" && window.innerWidth < 640;
  const below = rect ? rect.bottom + 220 < window.innerHeight : true;
  const cardStyle = !rect || narrow ? undefined : {
    top: below ? Math.min(rect.bottom + 14, window.innerHeight - 220) : Math.max(12, rect.top - 14 - 200),
    left: Math.min(Math.max(12, rect.left), window.innerWidth - 372),
  };
  return (
    <div className="no-print">
      {rect ? (
        <div aria-hidden className="pointer-events-none fixed z-[60] rounded-2xl ring-2 ring-paper transition-all duration-300 ease-tyll"
          style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2, boxShadow: "0 0 0 9999px rgba(20,22,26,0.42)" }} />
      ) : <div aria-hidden className="pointer-events-none fixed inset-0 z-[60] bg-ink/20" />}
      <div ref={box} tabIndex={-1} role="dialog" aria-modal="false" aria-label={`Tour, step ${at + 1} of ${steps.length}: ${step.title}`} aria-live="polite"
        className={cn("fixed z-[61] w-auto rounded-2xl border border-line bg-paper p-4 shadow-float outline-none sm:w-[360px]", narrow || !rect ? "inset-x-3 bottom-3 sm:inset-x-auto sm:right-4" : "")}
        style={cardStyle}>
        <div className="flex items-start justify-between gap-3">
          <p className="text-[12px] text-steel">Step {at + 1} of {steps.length}</p>
          <button type="button" onClick={stop} aria-label="Exit tour" className="-mr-1 -mt-1 rounded-full p-1.5 text-steel hover:bg-mist"><X size={15} /></button>
        </div>
        <p className="mt-1 text-[16px] tracking-[-0.01em] text-ink">{step.title}</p>
        <p className="mt-1 text-[14px] leading-snug text-graphite">{rect ? step.text : "Opening the page…"}</p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <span className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={stop}>Skip</Button>
            {at > 0 && <Button size="sm" variant="ghost" onClick={() => go(0, 1)}>Restart</Button>}
          </span>
          <span className="flex gap-2">
            <Button size="sm" disabled={at === 0} onClick={back}>Back</Button>
            <Button size="sm" variant="primary" onClick={next}>{at === steps.length - 1 ? "Finish" : "Next"}</Button>
          </span>
        </div>
      </div>
    </div>
  );
}
