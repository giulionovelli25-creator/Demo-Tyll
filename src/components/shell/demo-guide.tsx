"use client";
// Guided demo: a short list of stories, then one small card that says what to do next. It uses the real screens,
// records and sign-in; it never performs an action for you or claims one happened. Switching person is a real
// sign-out and sign-in. Reset puts that story's demo records back to their seeded start.
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, ExternalLink, Minus, PlayCircle, RotateCcw, UserRound, X } from "lucide-react";
import { useState } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Button, cn, toast } from "@/components/ui";
import { HERO_EXCEPTION_ID } from "@/lib/data/constants";
import { ROLE_LABEL, userById } from "@/lib/data/catalog";
import { api, reloadTo } from "@/lib/api";
import { usePlanDrafts } from "@/lib/plan-hooks";
import { useShared } from "@/lib/shared-stock";
import { useDemo } from "@/lib/store";
import type { User } from "@/lib/types";

type Scope = "stock" | "purchasing" | "events" | "guest" | "sales";
interface Step { text: string; as?: string; href?: string }
interface Scenario { id: string; title: string; summary: string; scope: Scope; steps: Step[]; main?: boolean }

export const SCENARIOS: Scenario[] = [
  {
    id: "cokes", main: true, scope: "stock", title: "Where did the Cokes go?", summary: "Follow an eight-can Coca-Cola difference from an alert to the evidence and an outcome.",
    steps: [
      { as: "u-rm", href: "/", text: "Sara, The Terrace's manager, sees the stock alert at the top of her Overview." },
      { href: "/stock?tab=where", text: "Open Where did it go? and choose Coca-Cola: 40 opening + 10 received − 12 counted = 38 used, but sales explain 30. 8 cans are unexplained." },
      { text: "Open the possible explanations. Each is a hypothesis to check, not an accusation." },
      { href: `/investigations/${HERO_EXCEPTION_ID}`, text: "Open the linked order: a Coke removed from a bill six minutes after its ticket went to the bar." },
      { href: "/stock?tab=where", text: "If the evidence supports it, record a correction (such as a late waste entry) and watch the unexplained quantity recalculate." },
      { href: `/investigations/${HERO_EXCEPTION_ID}`, text: "Assign the case, or record its outcome with an amount." },
      { as: "u-owner", href: "/", text: "Back on the owner's Overview, open issues and potential loss reflect what Sara recorded." },
    ],
  },
  {
    id: "wine", main: true, scope: "stock", title: "Why are we using more wine than expected?", summary: "Compare 3,000 ml expected with 3,750 ml used, and test a different standard pour.",
    steps: [
      { as: "u-fnb", href: "/stock?tab=where", text: "Marco, F&B director, opens Where did it go? and chooses House wine: 20 glasses × 150 ml = 3,000 ml expected; 3,750 ml used, 750 ml more." },
      { text: "Read the evidence and the measurement note: an open bottle's count is approximate, so small differences are within measurement uncertainty." },
      { href: "/stock?tab=recipes", text: "In Recipes and costs, set the house wine pour to 175 ml. Expected becomes 3,500 ml and the difference 250 ml." },
      { href: "/forecast?tab=buy", text: "What to buy now uses the same 175 ml standard, so wine needs change with it." },
      { href: "/stock?tab=where", text: "Record the decision on the case. Overpouring stays a possibility until someone observes it. The beef example (1.8 kg over) is in the same list." },
    ],
  },
  {
    id: "forecast", main: true, scope: "purchasing", title: "Predict a shortage and order what we need", summary: "One purchase request travels from the restaurant to purchasing, accounting and the storeroom.",
    steps: [
      { as: "u-rm", href: "/forecast?tab=buy", text: "Sara opens What to buy. Change the expected guests and watch the quantities recalculate." },
      { text: "Open a line's explanation: requirement + safety stock − usable stock − deliveries already coming." },
      { text: "Create the purchase request and submit it to purchasing." },
      { as: "u-buy", href: "/forecast?tab=approvals", text: "Nadia (Purchasing) has a notification in the bell. Open the same request, review quantities and supplier, and approve." },
      { as: "u-fc", href: "/finance?tab=approvals", text: "Priya (Accounting) is notified next. Review the cost against the budget and approve, reject or request changes." },
      { as: "u-gm", href: "/forecast?tab=approvals", text: "Only if the total is over AED 5,000: James, the general manager, gives the final approval. Otherwise skip this step." },
      { as: "u-store", href: "/staff?do=receive", text: "Ahmed (Storekeeper) records the delivery on his phone, entering what actually arrived." },
      { as: "u-rm", href: "/forecast?tab=buy", text: "Back in What to buy, stock is higher only by what was received, and Sara was notified of each decision." },
    ],
  },
  {
    id: "event", main: true, scope: "events", title: "Organise a conference without staffing problems", summary: "Plan a conference, find who is free in other departments, and get the loan approved.",
    steps: [
      { as: "u-events", href: "/events?tab=events&event=EVT-DXB-0001", text: "Yasmin (Events) opens the conference. Change guests to 120 in Details and see food, stock and staff recalculate." },
      { href: "/events?tab=events&event=EVT-DXB-0001&step=3", text: "Requirements show the kitchen's portions and any ingredient shortage. A shortage can go to Purchasing as a request." },
      { href: "/events?tab=events&event=EVT-DXB-0001&step=4", text: "Staffing shows the shortage. Choose Find staff, pick someone free with the right skill, and send the request." },
      { as: "u-rm", href: "/events?tab=support", text: "Sara manages the lending team and is notified. Approve, decline or suggest someone else. Tyll checks for clashing shifts." },
      { as: "u-events", href: "/events?tab=events&event=EVT-DXB-0001&step=4", text: "Back on the event, coverage shows the approved person. Nobody moves without that approval." },
    ],
  },
  {
    id: "connect", main: true, scope: "guest", title: "Find dinner for a guest in seconds", summary: "The front desk asks a hotel restaurant for a table; the restaurant answers.",
    steps: [
      { as: "u-fo", href: "/rooms?tab=connect", text: "Leila (Front Office) opens Guest Connect, chooses Restaurant, 2 guests and a time, and sees which venues are likely to have room." },
      { text: "Enter the room number and choose Request table at The Terrace. It shows 'Waiting for the venue': nothing is confirmed yet." },
      { as: "u-rm", href: "/rooms?tab=tables", text: "Sara is notified. She accepts or suggests another time; accepting checks the seats again." },
      { as: "u-fo", href: "/rooms?tab=connect", text: "Leila sees the answer in her bell. After telling the guest, she marks it Confirmed with the guest." },
    ],
  },
  {
    id: "rooms", main: true, scope: "guest", title: "Prevent a guest from waiting for their room", summary: "A VIP suite is predicted late; housekeeping fixes it and the front desk sees it ready.",
    steps: [
      { as: "u-fo", href: "/rooms?tab=readiness", text: "Leila sees suite 1211 predicted late for its 21:30 arrival. Open it to read why." },
      { href: "/rooms?tab=readiness&room=dxb-1211", text: "Choose Clean first. Housekeeping is notified." },
      { as: "u-hk", href: "/rooms?tab=housekeeping&room=dxb-1211", text: "Grace (Housekeeping) adds a helper; the ready time moves earlier." },
      { as: "u-maid", href: "/staff?do=rooms", text: "Maria finishes the room on her phone. It goes to inspection, not straight to ready." },
      { as: "u-hk", href: "/rooms?tab=housekeeping&room=dxb-1211", text: "Grace inspects and passes it." },
      { as: "u-fo", href: "/rooms?tab=readiness", text: "Leila sees 1211 Ready. Ready means the room is prepared; it does not mean the guest has checked in." },
      { href: "/rooms?tab=bell", text: "Optional: request luggage help for the room; the bell captain is notified." },
    ],
  },
  {
    id: "sales", scope: "sales", title: "Sales opportunity to confirmed event", summary: "A proposal is accepted and becomes one event for operations.",
    steps: [
      { as: "u-sales", href: "/events?tab=opportunities", text: "Noor creates an opportunity: Conference, 120 guests." },
      { text: "Create proposal, enter a price, save: Tyll shows the price, estimated direct cost and contribution." },
      { text: "Mark as sent, record the customer's acceptance, then Confirm business." },
      { as: "u-events", href: "/events?tab=events", text: "Yasmin sees the event once, with the menu and guests carried over." },
    ],
  },
  {
    id: "waste", scope: "stock", title: "Staff log waste on a phone", summary: "A steward logs breakage; the manager sees it and stock changes once.",
    steps: [
      { as: "u-emp", href: "/staff?do=breakage", text: "Omar taps Log breakage, Wine glasses, 3, Save." },
      { as: "u-rm", href: "/stock?tab=log", text: "Sara sees the entry under Recent entries at your outlets, and stock is 3 lower." },
    ],
  },
  {
    id: "invoice", scope: "purchasing", title: "Invoice that does not match the delivery", summary: "Finance compares order, delivery and invoice.",
    steps: [
      { as: "u-fc", href: "/finance?tab=invoices&invoice=INV-DXB-1011-MEAT", text: "Priya opens Gulf Prime Meats' invoice: 22 kg chicken ordered, 18 received, 22 invoiced. Flag it or request a correction." },
    ],
  },
];

interface GuideState { scenario: string | null; step: number; min: boolean; set(v: Partial<Omit<GuideState, "set">>): void }
export const useGuide = create<GuideState>()(persist((set) => ({ scenario: null, step: 0, min: false, set: (v) => set(v) }), { name: "tyll-guide-v1" }));

const who = (id: string) => `${userById[id].name.split(" ")[0]} (${ROLE_LABEL[userById[id].role]})`;

async function switchTo(userId: string, next: string) {
  await api("/api/auth/logout", { method: "POST", body: {} }).catch(() => undefined);
  reloadTo(`/login?as=${userId}&next=${encodeURIComponent(next)}`);
}

/** Resets one story's records on the server and this browser's own entries, so nothing stale is replayed. */
async function resetScenario(sc: Scenario): Promise<boolean> {
  try {
    await api("/api/demo/reset", { method: "POST", body: { scope: sc.scope, confirm: true } });
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Could not reset.");
    return false;
  }
  const keep = { scope: useDemo.getState().scope };
  useDemo.getState().resetDemo();
  useDemo.setState(keep);
  useShared.getState().set({ waste: [], corrections: [], counts: [] });
  usePlanDrafts.getState().bump();
  toast.done(`${sc.title}: demo records are back to their starting point.`);
  return true;
}

export function DemoPicker({ user, onClose }: { user: User; onClose: () => void }) {
  const set = useGuide((s) => s.set);
  const setTour = useDemo((s) => s.setTour);
  const [more, setMore] = useState(false);
  const start = (sc: Scenario) => { set({ scenario: sc.id, step: 0, min: false }); onClose(); };
  const list = SCENARIOS.filter((s) => (more ? !s.main : s.main));
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/25 p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label="Guided demo" onClick={onClose}>
      <div className="animate-rise max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-t-3xl border border-line bg-paper p-5 shadow-float sm:rounded-3xl sm:p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[22px] tracking-[-0.02em]">Guided demo</h2>
            <p className="mt-1 text-sm text-steel">Choose a story. A small card tells you what to do; you perform each action yourself on the real screens.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-2 text-steel hover:bg-mist"><X size={18} /></button>
        </div>
        <ul className="mt-4 space-y-2">
          {!more && (
            <li>
              <button type="button" onClick={() => { setTour(true, 0); onClose(); }} className="flex w-full items-start gap-3 rounded-2xl border border-line px-4 py-3 text-left hover:bg-cloud">
                <PlayCircle size={18} className="mt-0.5 shrink-0" aria-hidden />
                <span><span className="block text-[15px] text-ink">Five-minute owner tour</span><span className="block text-[13px] text-steel">The owner spots a problem, the manager investigates, the owner sees the result.</span></span>
              </button>
            </li>
          )}
          {list.map((sc, i) => (
            <li key={sc.id}>
              <button type="button" onClick={() => start(sc)} className="flex w-full items-start gap-3 rounded-2xl border border-line px-4 py-3 text-left hover:bg-cloud">
                <span className="num mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-mist text-xs">{i + 1}</span>
                <span><span className="block text-[15px] text-ink">{sc.title}</span><span className="block text-[13px] text-steel">{sc.summary} · {sc.steps.length} steps</span></span>
              </button>
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => setMore((m) => !m)} className="mt-3 text-sm text-graphite underline-offset-2 hover:underline">{more ? "Back to the main stories" : "More short demos"}</button>
        <p className="mt-4 text-xs text-steel">Demonstration with fictional people and simulated data. Signed in as {user.name}.</p>
      </div>
    </div>
  );
}

export function DemoGuide({ user }: { user: User }) {
  const { scenario, step, min, set } = useGuide();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const sc = SCENARIOS.find((s) => s.id === scenario);
  if (!sc) return null;
  const at = Math.min(step, sc.steps.length - 1);
  const cur = sc.steps[at];
  // The account a step is meant for: its own, or the last one named before it.
  const asId = cur.as ?? [...sc.steps.slice(0, at)].reverse().find((s) => s.as)?.as;
  const wrongPerson = !!asId && asId !== user.id;
  const canReset = user.role === "owner" || user.role === "gm";
  if (min) {
    return (
      <button type="button" onClick={() => set({ min: false })} className="no-print fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border border-line bg-paper px-4 py-2.5 text-sm shadow-float">
        <PlayCircle size={16} aria-hidden /> {sc.title} · step {at + 1} of {sc.steps.length}
      </button>
    );
  }
  return (
    <section aria-label="Guided demo" className="no-print fixed inset-x-3 bottom-3 z-40 rounded-2xl border border-line bg-paper p-4 shadow-float sm:inset-x-auto sm:right-4 sm:w-[380px]">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[12px] text-steel">{sc.title} · Step {at + 1} of {sc.steps.length}</p>
        <span className="flex">
          <button type="button" onClick={() => set({ min: true })} aria-label="Minimise guide" className="rounded-full p-1 text-steel hover:bg-mist"><Minus size={15} /></button>
          <button type="button" onClick={() => set({ scenario: null, step: 0 })} aria-label="Exit guided demo" className="rounded-full p-1 text-steel hover:bg-mist"><X size={15} /></button>
        </span>
      </div>
      <div className="mt-1 h-1 rounded-full bg-mist"><div className="h-1 rounded-full bg-ink transition-[width] duration-500 ease-tyll" style={{ width: `${((at + 1) / sc.steps.length) * 100}%` }} /></div>
      <p className="mt-3 text-[15px] leading-snug text-ink">{cur.text}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {wrongPerson ? (
          <Button size="sm" variant="primary" onClick={() => switchTo(asId!, cur.href ?? "/")}><UserRound size={14} /> Sign in as {who(asId!)}</Button>
        ) : cur.href ? <Button size="sm" variant="primary" onClick={() => router.push(cur.href!)}><ExternalLink size={14} /> Go there</Button> : null}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-hair pt-3">
        <span className="flex gap-1">
          <Button size="sm" variant="ghost" disabled={at === 0} onClick={() => set({ step: at - 1 })}><ChevronLeft size={14} /> Previous</Button>
          <Button size="sm" variant="ghost" disabled={at === sc.steps.length - 1} onClick={() => set({ step: at + 1 })}>Next <ChevronRight size={14} /></Button>
        </span>
        {confirming ? (
          canReset ? (
            <span className="flex gap-1">
              <Button size="sm" variant="danger" onClick={async () => { if (await resetScenario(sc)) { set({ step: 0 }); setConfirming(false); } }}>Reset now</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Keep</Button>
            </span>
          ) : <Button size="sm" variant="ghost" onClick={() => switchTo("u-owner", "/")}>Sign in as Layla to reset</Button>
        ) : <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}><RotateCcw size={14} /> Reset</Button>}
      </div>
      {confirming && canReset && <p className={cn("mt-2 text-xs text-steel")}>Puts this story&rsquo;s demo records back to their seeded start{sc.scope === "stock" ? ", and clears this browser's demo changes" : ""}. Other stories and accounts are not touched.</p>}
    </section>
  );
}
