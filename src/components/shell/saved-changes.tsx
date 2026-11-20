"use client";
// Settings: where changes are kept (overnight feature 8). "Demo data" says that every change is saved on the demo
// server with the person and role, and, in the public demo, that the visitor works in a workspace of their own.
// "Saved changes" lists them, newest first, five at a time.
import Link from "next/link";
import { Download, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Button, EmptyState, Note, Panel, textLink, toast } from "@/components/ui";
import { ROLE_LABEL } from "@/lib/data/catalog";
import { can } from "@/lib/domain/access";
import { api, useSession } from "@/lib/api";
import { personName } from "@/lib/hooks";
import { usePlanDrafts } from "@/lib/plan-hooks";
import { pullRecords, useRecordsMeta } from "@/lib/records-sync";
import { useShared } from "@/lib/shared-stock";
import { useDemo } from "@/lib/store";
import type { AuditEntry, User } from "@/lib/types";
import { DEMO_TODAY, downloadCsv, fmtDate, fmtTime } from "@/lib/util";

/** A saved time as the hotel reads it: the date and the time in Lisbon, in the demo's usual format. */
function when(iso: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return `${fmtDate(`${parts.year}-${parts.month}-${parts.day}`)}, ${fmtTime(Number(parts.hour) * 60 + Number(parts.minute))}`;
}
const roleOf = (a: AuditEntry) => (a.role ? ROLE_LABEL[a.role] : "");
/** Changes whose detail holds words someone typed (a note or a reason): shown as written. Tyll builds the others from
 * its own words, figures and names, so they are translated like the rest of the page. */
const TYPED = new Set(["Note added", "Recount recorded", "Standard quantity changed", "Delivery difference recorded", "Waste entry corrected", "Count accepted", "Count rejected"]);

/** Who may put the records back to the start: the owner or general manager, or any visitor in their own public demo workspace. */
export function useMayReset(user: User): boolean {
  const publicDemo = useSession((s) => !!s.demoRoles);
  return publicDemo || user.role === "owner" || user.role === "gm";
}

export function DemoDataPanel({ user }: { user: User }) {
  const reset = useDemo((s) => s.resetDemo);
  const bump = usePlanDrafts((s) => s.bump);
  const meta = useRecordsMeta();
  const publicDemo = useSession((s) => !!s.demoRoles);
  const mayReset = useMayReset(user);
  const [confirming, setConfirming] = useState(false);

  const run = async () => {
    try {
      await api("/api/demo/reset", { method: "POST", body: { scope: "all", confirm: true } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not reset.");
      return;
    }
    const keep = { scope: useDemo.getState().scope };
    reset();
    useDemo.setState(keep);
    useShared.getState().set({ waste: [], corrections: [], counts: [] });
    await pullRecords().catch(() => undefined);
    setConfirming(false);
    bump();
    toast.done(publicDemo ? "Your workspace is back to the starting demo data." : "All demo records restored to their starting point.");
  };

  return (
    <Panel title="Demo data" description={`Business date ${fmtDate(DEMO_TODAY, true)}. Every change is saved on the demo server with the name and role of the person who made it: waste, counts, investigation decisions, price changes and corrections.`}>
      {publicDemo && (
        <div className="mb-4 rounded-[var(--radius-control)] border border-line bg-cloud px-4 py-3 text-sm">
          <p className="text-ink">Your own demo workspace</p>
          <p className="mt-1 text-[13px] text-graphite">Other visitors never see your changes, and nothing they change reaches you. Your changes stay when you switch role.</p>
          {meta.workspace && (
            <p className="mt-1 text-[13px] text-steel">
              <span>Last used {when(meta.workspace.lastUsedAt)}</span>. <span>{`Kept for ${meta.workspace.keptHours} hours after it was last used.`}</span>
            </p>
          )}
        </div>
      )}
      <p className="max-w-[70ch] text-sm text-graphite">
        {publicDemo ? "Reset puts your workspace back to the starting demo data and clears its notifications. Other visitors are not affected."
          : mayReset ? "Reset puts every seeded demo record back to its starting point on the server, and clears notifications. Sign-in accounts and the access log are kept."
          : "Only the owner or general manager can reset the demo records."}
        {!publicDemo && mayReset && " To reset one story only, use Reset in the guided demo."}
      </p>
      {mayReset && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {confirming ? (
            <>
              <Button variant="danger" onClick={run}><RotateCcw size={15} /> Yes, reset everything</Button>
              <Button variant="ghost" onClick={() => setConfirming(false)}>Keep my changes</Button>
            </>
          ) : (
            <Button onClick={() => setConfirming(true)}><RotateCcw size={15} /> Reset demo data</Button>
          )}
        </div>
      )}
    </Panel>
  );
}

/** Changes saved on the demo server, newest first: everyone's for the roles that keep the audit trail, otherwise one's own. */
export function SavedChanges({ user }: { user: User }) {
  const audit = useDemo((s) => s.audit);
  const pending = useDemo((s) => s.pendingOps.filter((p) => p.userId === s.userId).length);
  const loaded = useRecordsMeta((s) => s.loaded);
  const all = can(user, "settings.audit");
  const [everything, setEverything] = useState(false);
  const rows = everything ? audit : audit.slice(0, 5);

  return (
    <Panel
      title="Saved changes"
      description={<>
        {all ? "Every change saved on the demo server, newest first, with who made it and in which role." : "Your changes saved on the demo server, newest first. Owners, general managers and financial controllers see everyone's."}
        {/* The rest of the demo runs on a simulated clock (8:55 PM); these are real times, so say what they are. */}
        <span className="mt-1 block">Times are when the change reached the demo server.</span>
      </>}
      action={all && audit.length > 0 ? <Button size="sm" onClick={() => { downloadCsv(`tyll-changes-${DEMO_TODAY}.csv`, [["Time", "Person", "Role", "Change", "Detail"], ...audit.map((a) => [a.at, personName(a.userId), roleOf(a), a.action, a.detail])]); toast.done("Saved changes exported."); }}><Download size={14} /> Export CSV</Button> : undefined}
      flush
    >
      {pending > 0 && <div className="px-5 pb-3 sm:px-6"><Note>{pending === 1 ? "1 change is waiting to reach the server." : `${pending} changes are waiting to reach the server.`} It is sent as soon as the connection allows.</Note></div>}
      {audit.length === 0 ? (
        <div className="px-5 pb-6 sm:px-6">{loaded ? <EmptyState title="Nothing saved yet">What you change, such as waste you log, a count or a decision on a case, appears here with your name and role.</EmptyState> : <Note>Loading the saved changes.</Note>}</div>
      ) : (
        <>
          <ul className="divide-y divide-hair border-t border-hair">
            {rows.map((a, i) => (
              <li key={`${a.at}-${i}`} className="grid gap-x-6 gap-y-1 px-5 py-3 text-sm sm:grid-cols-[132px_minmax(0,220px)_minmax(0,1fr)] sm:px-6">
                <span className="num text-[13px] text-steel sm:pt-px">{when(a.at)}</span>
                {/* Phones read the change first, then who made it; wider screens keep three columns. */}
                <span className="order-2 min-w-0 text-[13px] text-steel sm:order-none"><span translate="no" className="text-graphite sm:text-ink">{personName(a.userId)}</span>{a.role && <><span className="sm:hidden">, </span><span className="sm:block">{roleOf(a)}</span></>}</span>
                <span className="order-1 min-w-0 sm:order-none">
                  <span className="text-ink">{a.action}</span>
                  <span className="mt-0.5 block break-words text-[13px] text-graphite"><bdi translate={TYPED.has(a.action) ? "no" : undefined}>{a.detail}</bdi></span>
                  {a.ref && <span className="mt-1 hidden sm:block"><Link prefetch={false} href={`/investigations/${encodeURIComponent(a.ref)}`} className={textLink}>Open the case</Link></span>}
                </span>
                {a.ref && <span className="order-3 sm:hidden"><Link prefetch={false} href={`/investigations/${encodeURIComponent(a.ref)}`} className={textLink}>Open the case</Link></span>}
              </li>
            ))}
          </ul>
          {audit.length > 5 && <div className="border-t border-hair px-5 py-3 sm:px-6"><button type="button" onClick={() => setEverything((v) => !v)} className={textLink}>{everything ? "Show the five newest" : `Show all ${audit.length} changes`}</button></div>}
        </>
      )}
    </Panel>
  );
}
