"use client";
// A small "?" next to a term. Click or press Enter to read a one- or two-sentence explanation; Escape, a click
// elsewhere or the close button dismisses it. Works with a keyboard and is announced to screen readers.
import { HelpCircle, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/components/ui";

/** Explanations used in more than one place, so every screen says the same thing. */
export const HELP = {
  buy: "Tyll estimates which ingredients you need from expected demand, the stock you can use and deliveries already on the way. You can change any quantity before asking for approval.",
  prep: "How many portions the kitchen should prepare, from past sales, bookings, occupancy and events. The chef can assign each dish to someone in the kitchen.",
  approvals: "Purchase requests waiting for a decision. Each step (purchasing, accounting, and the general manager for large amounts) reviews the items and costs before the order goes ahead.",
  where: "Compares what the stock count says was used with what recorded sales, recipes, waste and transfers explain. What is left is an unexplained difference to look into, not proof of loss.",
  waste: "Record anything thrown away, broken or spoiled. Each entry lowers estimated stock once and appears for the manager straight away.",
  counts: "Enter what is actually on the shelf. Counts from staff wait for a manager to accept them before stock changes.",
  support: "Ask another department to lend a qualified employee for a few hours. Their manager must approve; nobody is moved without that approval.",
  plan: "Create an event and Tyll works out the portions, ingredients, staff and an estimated cost from the menu and guest numbers.",
  guestConnect: "Ask a restaurant, bar, spa or activity in the hotel whether it can take a guest. Nothing is confirmed until the venue accepts.",
  readiness: "Which arriving guests' rooms will be ready in time, estimated from the room's status and the housekeepers on shift. Estimates, not promises.",
  housekeeping: "Assign rooms, add help, follow cleaning and inspect rooms before they are released as ready.",
  bell: "Luggage requests from the front desk, assigned by the bell captain and followed to the room.",
  tables: "Requests from the front desk or concierge for a table at your outlet. Accept, decline or suggest another time.",
  service: "Measured from recorded times: rooms ready by arrival, requests finished within target. It does not measure guest satisfaction.",
  opContribution: "An estimate from the revenue and costs Tyll holds: sales, food and drink used, labour and allocated overheads. It is not the hotel's full accounting profit.",
  potentialLoss: "The value of open cases that have not been checked yet. It becomes a confirmed loss or recovered money only when a case is closed.",
  invoices: "Each supplier invoice is checked three ways: what was ordered, what arrived and what was billed. A difference is a fact to check, not proof of wrongdoing.",
  budgets: "Budget against recorded expenses. Invoices awaiting review and approved orders are shown separately, never added to recorded spending.",
  opportunities: "Potential business. Expected values are sales estimates, not revenue.",
  proposals: "Quotes for customers, costed with the event calculation. A proposal becomes an event only when the business is confirmed.",
  confirmed: "Confirmed deals and their events. Contract value is not revenue until the event happens and accounting records it.",
  staffApp: "Your tasks and the quick actions your job needs. Everything you save here is seen by your manager straight away.",
} as const;

export function Help({ text, label = "What is this?", className }: { text: string; label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <span ref={ref} className={cn("relative inline-flex align-middle", className)}>
      <button type="button" aria-label={label} aria-expanded={open} aria-controls={id} onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen((o) => !o); }}
        className="inline-flex h-6 w-6 items-center justify-center rounded-full text-fog transition-colors hover:text-graphite focus-visible:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink">
        <HelpCircle size={15} strokeWidth={1.8} aria-hidden />
      </button>
      {open && (
        <span id={id} role="note" className="animate-rise absolute left-1/2 top-7 z-50 w-[min(280px,80vw)] -translate-x-1/2 rounded-2xl border border-line bg-paper p-3 pr-8 text-left text-[13px] font-normal leading-relaxed tracking-normal text-graphite shadow-float">
          {text}
          <button type="button" aria-label="Close" onClick={(e) => { e.stopPropagation(); setOpen(false); }} className="absolute right-2 top-2 rounded-full p-1 text-steel hover:bg-mist"><X size={13} /></button>
        </span>
      )}
    </span>
  );
}
