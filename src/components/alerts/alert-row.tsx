"use client";
import Link from "next/link";
import { BellOff, Check, RotateCcw } from "lucide-react";
import { OutletDot, StatusPill, cn, toast } from "@/components/ui";
import { useAlertMemory, type AlertState, type FeedAlert } from "@/lib/alert-feed";

const KIND_WORDS: Record<FeedAlert["kind"], string> = { stock: "Stock", money: "Money", pour: "Pour Control", waste: "Waste", margin: "Menu", supplier: "Supplier" };

/** What happened, why it matters in money, and the one next step. */
export function AlertRow({ alert, money, userId, state, compact }: { alert: FeedAlert; money: (n: number) => string; userId?: string; state?: AlertState; compact?: boolean }) {
  const remember = useAlertMemory((s) => s.set);
  const change = (next: AlertState, said: string) => {
    if (!userId) return;
    remember(userId, alert.id, next);
    toast.done(said);
  };
  const quiet = "inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-[13px] text-graphite transition-colors duration-200 hover:bg-mist";
  return (
    <li className="flex flex-col gap-3 border-t border-hair px-4 py-4 first:border-t-0 sm:flex-row sm:items-center sm:px-6">
      <div className="min-w-0 flex-1">
        {!compact && <div className="mb-2 flex flex-wrap items-center gap-2">
          <StatusPill rag={alert.rag}>{alert.rag === "red" ? "Act today" : alert.rag === "amber" ? "This week" : "Can wait"}</StatusPill>
          <span className="text-xs text-steel">{KIND_WORDS[alert.kind]}, {alert.where}</span>
        </div>}
        <p className="text-[15px] font-medium text-ink">{alert.what}</p>
        <p className="mt-1 text-sm text-graphite">{compact ? <><OutletDot id={alert.outletId} />{alert.where}</> : alert.why}</p>
      </div>
      {alert.amount !== null && <p className="shrink-0 sm:w-32 sm:text-end"><span className="num text-lg font-medium text-money">{money(alert.amount)}</span> <span className="text-xs text-steel sm:block">{alert.amountWord}</span></p>}
      <div className="flex shrink-0 flex-wrap items-center gap-1">
        <Link href={alert.next.href} className={cn("inline-flex h-10 items-center rounded-full px-4 text-[13px] font-medium transition-colors duration-200", "bg-accent-soft text-accent-ink hover:bg-line")}>{alert.next.label}</Link>
        {userId && state === "open" && (
          <>
            {alert.caseHref ? <Link href={alert.caseHref} className={quiet}><Check size={15} aria-hidden /> Resolve</Link> : <button type="button" className={quiet} onClick={() => change("resolved", "Marked as resolved.")}><Check size={15} aria-hidden /> Resolve</button>}
            <button type="button" className={quiet} onClick={() => change("snoozed", "Snoozed until tomorrow.")}><BellOff size={15} aria-hidden /> Snooze</button>
          </>
        )}
        {userId && state && state !== "open" && <button type="button" className={quiet} onClick={() => change("open", "Back in your open alerts.")}><RotateCcw size={15} aria-hidden /> Reopen</button>}
      </div>
    </li>
  );
}
