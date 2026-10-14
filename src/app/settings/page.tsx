"use client";
import { Check, Download, Minus, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Badge, Button, EmptyState, Note, PageHeader, Panel, TableWrap, Td, Th, cn, rowClass, toast } from "@/components/ui";
import { DATA_SOURCES } from "@/lib/adapters";
import { ROLE_LABEL, USERS, outletById, propertyById, userById } from "@/lib/data/catalog";
import { allowedOutlets, allowedProperties, can, canOpen, type ModuleId, type Permission } from "@/lib/domain/access";
import { POLICY } from "@/lib/domain/detect";
import { useApi, useUser } from "@/lib/hooks";
import { NotificationSettings } from "@/components/shell/notification-settings";
import { api } from "@/lib/api";
import { usePlanDrafts } from "@/lib/plan-hooks";
import { useDemo } from "@/lib/store";
import type { Role } from "@/lib/types";
import { DEMO_TODAY, downloadCsv } from "@/lib/util";

const ROLES: Role[] = ["owner", "gm", "controller", "fnb_director", "restaurant_manager", "event_manager", "purchasing", "chef", "front_office", "housekeeping_manager", "concierge", "bell_captain", "employee"];
const MODULE_ROWS: [ModuleId, string][] = [["overview", "Overview"], ["money", "Money"], ["stock", "Stock"], ["forecast", "Forecast"], ["flow", "Flow"], ["rooms", "Rooms"], ["investigations", "Investigations"], ["reports", "Reports"]];
const PERMISSION_ROWS: [Permission, string][] = [
  ["investigation.assign", "Assign investigations"], ["investigation.close", "Record an outcome and close"], ["investigation.reopen", "Reopen closed cases"],
  ["stock.logWaste", "Log waste"], ["stock.count", "Record stock counts"], ["stock.editPrices", "Change ingredient prices"],
  ["forecast.approve", "Approve purchase suggestions"], ["flow.updateOrder", "Change order status"], ["rooms.manage", "Manage rooms and housekeeping"],
  ["reports.export", "Export reports"], ["settings.audit", "See the audit trail"],
];
const STATE: Record<string, { label: string; tone: "neutral" | "warn" | "ink" }> = { simulated: { label: "Simulated", tone: "ink" }, not_connected: { label: "Not connected", tone: "warn" }, planned: { label: "Planned", tone: "neutral" } };

const Mark = ({ on }: { on: boolean }) => (on ? <Check size={16} className="mx-auto text-pos" aria-label="Yes" /> : <Minus size={16} className="mx-auto text-fog" aria-label="No" />);

export default function SettingsPage() {
  const user = useUser()!;
  const audit = useDemo((s) => s.audit);
  const reset = useDemo((s) => s.resetDemo);
  const [confirming, setConfirming] = useState(false);
  const bump = usePlanDrafts((s) => s.bump);
  const serverReset = user.role === "owner" || user.role === "gm";
  const mayAudit = can(user, "settings.audit");
  const { data: security } = useApi<{ entries: { at: string; name: string; action: string; detail: string; ip: string }[] }>(mayAudit ? "/api/audit" : null);
  const sample = (role: Role) => USERS.find((u) => u.role === role)!;

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" lead="What this demo is connected to, who can see what, and a record of every change made in this browser." />

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[1fr_1.4fr]">
        <Panel title="Your access">
          <dl className="space-y-3 text-sm">
            <div><dt className="text-[13px] text-steel">Signed in as</dt><dd>{user.name}, {user.title}</dd></div>
            <div><dt className="text-[13px] text-steel">Role</dt><dd>{ROLE_LABEL[user.role]}</dd></div>
            <div><dt className="text-[13px] text-steel">Hotels</dt><dd>{allowedProperties(user).map((p) => propertyById[p].name).join(", ")}</dd></div>
            <div><dt className="text-[13px] text-steel">Outlets</dt><dd>{user.outletIds === "all" ? "All outlets in those hotels" : allowedOutlets(user).map((o) => outletById[o].name).join(", ")}</dd></div>
          </dl>
          <Note className="mt-4">The server checks your session, role and PIN before every page and every data request, and sends only the records your role may see. Changes you make are still saved in this browser; moving them to the server is the next step.</Note>
        </Panel>

        <Panel title="Demo data" description={`Business date ${DEMO_TODAY}. Shared records (requests, events, rooms, sales, finance, waste) are on the demo server; investigation decisions and price changes are kept in this browser.`}>
          <p className="max-w-[70ch] text-sm text-graphite">{serverReset ? "Reset puts every seeded demo record back to its starting point, on the server and in this browser, and clears notifications. Sign-in accounts and the access log are kept." : "Reset clears the changes kept in this browser. Only the owner or general manager can reset the shared demo records."} To reset one story only, use Reset in the guided demo.</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {confirming ? (
              <>
                <Button variant="danger" onClick={async () => {
                  if (serverReset) { try { await api("/api/demo/reset", { method: "POST", body: { scope: "all", confirm: true } }); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not reset."); return; } }
                  reset(); setConfirming(false); bump(); toast.done(serverReset ? "All demo records restored to their starting point." : "This browser's demo changes were cleared.");
                }}><RotateCcw size={15} /> Yes, reset everything</Button>
                <Button variant="ghost" onClick={() => setConfirming(false)}>Keep my changes</Button>
              </>
            ) : (
              <Button onClick={() => setConfirming(true)}><RotateCcw size={15} /> Reset demo data</Button>
            )}
          </div>
        </Panel>
      </div>

      <NotificationSettings />

      <Panel title="Data sources" description="Tyll reads from the hotel's existing systems and changes nothing in them. This is what stands behind each figure in the demo." flush>
        <TableWrap>
          <table className="w-full min-w-[860px] text-sm">
            <thead><tr><Th>System</Th><Th>Status</Th><Th>Supplies</Th><Th>In this demo</Th></tr></thead>
            <tbody>
              {DATA_SOURCES.map((s) => (
                <tr key={s.id} className={rowClass}>
                  <Td><span className="text-ink">{s.system}</span><span className="block font-mono text-[11.5px] text-steel">{s.kind}</span></Td>
                  <Td><Badge tone={STATE[s.state].tone}>{STATE[s.state].label}</Badge></Td>
                  <Td className="max-w-[280px] text-graphite">{s.supplies}</Td>
                  <Td className="max-w-[360px] text-graphite">{s.note}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        <Note className="px-6 py-4">Each source sits behind a typed adapter interface in <span className="font-mono">src/lib/adapters.ts</span>. Connecting a real system means writing one adapter. Screens and calculations stay as they are.</Note>
      </Panel>

      <Panel title="Roles and permissions" description="The six demo accounts and what each role can open and do." flush>
        <TableWrap>
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr><Th> </Th>{ROLES.map((r) => <Th key={r} className={cn("text-center", r === user.role && "text-ink")}>{ROLE_LABEL[r]}{r === user.role && <span className="block text-[11px] font-normal">you</span>}</Th>)}</tr>
            </thead>
            <tbody>
              <tr className={rowClass}><Td className="text-steel">Sees</Td>{ROLES.map((r) => <Td key={r} className="text-center text-xs text-graphite">{sample(r).propertyIds === "all" ? "Both hotels" : sample(r).outletIds === "all" ? "Dubai, all outlets" : "The Terrace"}</Td>)}</tr>
              {MODULE_ROWS.map(([m, label]) => <tr key={m} className={rowClass}><Td>Open {label}</Td>{ROLES.map((r) => <Td key={r}><Mark on={canOpen(sample(r), m)} /></Td>)}</tr>)}
              {PERMISSION_ROWS.map(([p, label]) => <tr key={p} className={rowClass}><Td>{label}</Td>{ROLES.map((r) => <Td key={r}><Mark on={can(sample(r), p)} /></Td>)}</tr>)}
            </tbody>
          </table>
        </TableWrap>
      </Panel>

      <Panel title="Detection thresholds" description="The rules behind Tyll Money's flags. A hotel agrees these during onboarding. They are fixed in this demo.">
        <dl className="grid grid-cols-2 gap-x-8 gap-y-4 text-sm md:grid-cols-4">
          <div><dt className="text-[13px] text-steel">Discount limit</dt><dd className="num text-lg">{POLICY.discountMaxPct}%</dd></div>
          <div><dt className="text-[13px] text-steel">Complimentary limit per order</dt><dd className="num text-lg">{POLICY.compMaxValue}</dd></div>
          <div><dt className="text-[13px] text-steel">Refund share needing review</dt><dd className="num text-lg">{Math.round(POLICY.refundMaxShare * 100)}%</dd></div>
          <div><dt className="text-[13px] text-steel">Late refund</dt><dd className="num text-lg">{POLICY.refundLateMinutes} min</dd></div>
          <div><dt className="text-[13px] text-steel">Room charge tolerance</dt><dd className="num text-lg">{POLICY.roomChargeTolerance.toFixed(2)}</dd></div>
          <div><dt className="text-[13px] text-steel">Pattern window</dt><dd className="num text-lg">{POLICY.patternWindowDays} days</dd></div>
          <div><dt className="text-[13px] text-steel">Pattern, minimum cases</dt><dd className="num text-lg">{POLICY.patternMinCases}</dd></div>
          <div><dt className="text-[13px] text-steel">Pattern, minimum share</dt><dd className="num text-lg">{Math.round(POLICY.patternMinShare * 100)}%</dd></div>
        </dl>
      </Panel>

      <Panel
        title="Audit trail"
        description="Every sign-in and every change made in this browser, newest first."
        action={mayAudit && audit.length > 0 ? <Button size="sm" onClick={() => { downloadCsv(`tyll-audit-${DEMO_TODAY}.csv`, [["Time", "User", "Action", "Detail"], ...audit.map((a) => [a.at, userById[a.userId]?.name ?? a.userId, a.action, a.detail])]); toast.done("Audit trail exported."); }}><Download size={14} /> Export CSV</Button> : undefined}
        flush
      >
        {!mayAudit ? (
          <div className="px-6 pb-6"><Note>Your role cannot see the audit trail. Owners, general managers and financial controllers can.</Note></div>
        ) : audit.length === 0 ? (
          <div className="px-6 pb-6"><EmptyState title="Nothing recorded yet">Assign an investigation, log waste or change a price and it appears here.</EmptyState></div>
        ) : (
          <div className="scroll-thin max-h-[420px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-paper"><tr><Th>Time</Th><Th>User</Th><Th>Action</Th><Th>Detail</Th></tr></thead>
              <tbody>
                {audit.map((a, i) => (
                  <tr key={i} className={rowClass}>
                    <Td className="num whitespace-nowrap text-graphite">{new Date(a.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</Td>
                    <Td className="whitespace-nowrap">{userById[a.userId]?.name ?? a.userId}</Td>
                    <Td className="whitespace-nowrap text-ink">{a.action}</Td>
                    <Td className="text-graphite">{a.detail}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {mayAudit && (
        <Panel title="Sign-in and access log" description="Recorded on the server: sign-ins, failed attempts, lockouts, PIN unlocks and data requests." flush>
          {security === undefined ? <div className="px-6 pb-6"><Note>Loading the log.</Note></div> : !security ? <div className="px-6 pb-6"><Note>The log could not be loaded.</Note></div> : (
            <div className="scroll-thin max-h-[360px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-paper"><tr><Th>Time</Th><Th>Account</Th><Th>Event</Th><Th>Detail</Th></tr></thead>
                <tbody>
                  {security.entries.slice(0, 150).map((a, i) => (
                    <tr key={i} className={rowClass}>
                      <Td className="num whitespace-nowrap text-graphite">{new Date(a.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</Td>
                      <Td className="whitespace-nowrap">{a.name}</Td>
                      <Td className={cn("whitespace-nowrap", /failed|locked|blocked/i.test(a.action) ? "text-warn" : "text-ink")}>{a.action}</Td>
                      <Td className="text-graphite">{a.detail}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      <Panel title="Before real customer use" description="This is a demonstration. These are the main pieces of work between it and a production system.">
        <ul className="grid gap-x-10 gap-y-2.5 text-sm text-graphite md:grid-cols-2">
          <li>Single sign-on and multi-factor sign-in through the hotel&rsquo;s identity provider.</li>
          <li>A managed database with backups in place of the local file store and browser storage.</li>
          <li>Tested adapters for each customer&rsquo;s POS, PMS, stock and accounting systems.</li>
          <li>Reconciliation of Tyll&rsquo;s totals against the systems of record, per property.</li>
          <li>An independent security review and penetration test.</li>
          <li>Monitoring, alerting and an incident process.</li>
          <li>Data-protection agreements, hosting location and retention rules for each country.</li>
          <li>Legal review of staff-related monitoring and of tip rules in each jurisdiction.</li>
        </ul>
      </Panel>

    </div>
  );
}
