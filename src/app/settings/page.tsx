"use client";
import { PurchasingSettings } from "@/components/purchasing/purchasing-settings";
import { Check, Minus } from "lucide-react";
import { Badge, Note, PageHeader, Panel, TableWrap, Td, Th, cn, rowClass, textLink } from "@/components/ui";
import { DemoDataPanel, SavedChanges } from "@/components/shell/saved-changes";
import Link from "next/link";
import { DATA_SOURCES, type ConnectionState } from "@/lib/adapters";
import { ROLE_LABEL, USERS, outletById, propertyById } from "@/lib/data/catalog";
import { allowedOutlets, allowedProperties, can, canOpen, type ModuleId, type Permission } from "@/lib/domain/access";
import { POLICY } from "@/lib/domain/detect";
import { BOUGHT_USED_RULES } from "@/lib/domain/bought-used";
import { COVER_RULES } from "@/lib/domain/covers";
import { MIX_RULES } from "@/lib/domain/till-rules";
import { WAITER_RULES } from "@/lib/domain/waiters";
import { useApi, useUser } from "@/lib/hooks";
import { NotificationSettings } from "@/components/shell/notification-settings";
import { VisitConsentSetting } from "@/components/shell/visit-consent";
import type { Role } from "@/lib/types";


const ROLES: Role[] = ["owner", "gm", "controller", "fnb_director", "restaurant_manager", "event_manager", "purchasing", "chef", "front_office", "housekeeping_manager", "concierge", "bell_captain", "employee"];
const MODULE_ROWS: [ModuleId, string][] = [["overview", "Overview"], ["money", "Revenue"], ["stock", "Stock"], ["forecast", "Predictions"], ["flow", "Flow"], ["rooms", "Rooms"], ["investigations", "Investigations"], ["reports", "Reports"]];
/**
 * Every permission in the matrix, with the row it shows as in Roles and permissions, or null for steps that belong to a
 * workflow of their own (purchasing approvals, housekeeping, sales). A Record, so a new permission does not build until
 * it is given a row or left out on purpose, and the table cannot drift from PERMISSIONS in access.ts.
 */
const PERMISSION_LABEL: Record<Permission, string | null> = {
  "investigation.assign": "Assign investigations", "investigation.note": null, "investigation.close": "Record an outcome and close", "investigation.reopen": "Reopen closed cases",
  "stock.logWaste": "Log waste", "stock.logEmpty": "Log empty bottles", "stock.count": "Record stock counts", "stock.editPrices": "Change ingredient prices",
  "stock.boughtUsed": "See bought against used and mark it checked", "stock.review": null,
  "forecast.approve": "Approve purchase suggestions", "flow.updateOrder": "Change order status", "rooms.manage": "Manage rooms and housekeeping",
  "roomcharge.view": "See the room charge check", "till.view": "See the till rule check", "covers.view": "See booked against billed covers",
  "guests.view": "See hotel guests against outlet charges", "waiters.view": "See drinks per guest by waiter", "waiters.coach": "Record coaching",
  "adapters.view": "See the POS and PMS adapters on sample data",
  "reports.export": "Export reports", "settings.audit": "See the audit trail", "settings.reset": null,
  "purchase.create": null, "purchase.review": null, "purchase.approveFinance": null, "purchase.approveFnb": null, "purchase.approveManager": null, "purchase.receive": null,
  "prep.plan": null, "prep.complete": null, "events.plan": null, "staff.request": null, "staff.lend": null, "rooms.view": null, "hk.manage": null, "hk.clean": null,
  "fo.desk": null, "concierge": null, "bell.dispatch": null, "bell.task": null, "gc.respond": null, "finance.view": null, "finance.review": null,
  "sales.work": null, "sales.approve": null, "sales.view": null,
};
const PERMISSION_ROWS = (Object.entries(PERMISSION_LABEL) as [Permission, string | null][]).filter((r): r is [Permission, string] => r[1] !== null);
const STATE: Record<ConnectionState, { label: string; tone: "neutral" | "warn" | "ink" | "accent" }> = { simulated: { label: "Simulated", tone: "ink" }, adapter_built: { label: "Adapter built, not yet connected to a live account", tone: "accent" }, not_connected: { label: "Not connected", tone: "warn" }, planned: { label: "Planned", tone: "neutral" } };

const Mark = ({ on }: { on: boolean }) => (on ? <Check size={16} className="mx-auto text-pos" aria-label="Yes" /> : <Minus size={16} className="mx-auto text-fog" aria-label="No" />);

export default function SettingsPage() {
  const user = useUser()!;
  const mayAudit = can(user, "settings.audit");
  const maySample = can(user, "adapters.view");
  const { data: security } = useApi<{ entries: { at: string; name: string; action: string; detail: string; ip: string }[] }>(mayAudit ? "/api/audit" : null);
  const sample = (role: Role) => USERS.find((u) => u.role === role)!;

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" question="Who changed what, and is it saved?" lead="What this demo is connected to, who can see what, and every change saved on the demo server." />

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[1fr_1.4fr]">
        <Panel title="Your access">
          <dl className="space-y-3 text-sm">
            <div><dt className="text-[13px] text-steel">Signed in as</dt><dd>{user.name}, {user.title}</dd></div>
            <div><dt className="text-[13px] text-steel">Role</dt><dd>{ROLE_LABEL[user.role]}</dd></div>
            <div><dt className="text-[13px] text-steel">Hotels</dt><dd>{allowedProperties(user).map((p) => propertyById[p].name).join(", ")}</dd></div>
            <div><dt className="text-[13px] text-steel">Outlets</dt><dd>{user.outletIds === "all" ? "All outlets in those hotels" : allowedOutlets(user).map((o) => outletById[o].name).join(", ")}</dd></div>
          </dl>
          <Note className="mt-4">The server checks your session, role and PIN before every page and every data request, and sends only the records your role may see. Every change you make is saved on the demo server with your name and role.</Note>
        </Panel>

        <DemoDataPanel user={user} />
      </div>

      <NotificationSettings />

      <Panel title="Cookies" description="Whether cookies may record which pages you open in this demo, for the Tyll team. No name, email or IP address is recorded; records are kept for 90 days.">
        <VisitConsentSetting />
      </Panel>

      <Panel title="Data sources" description="Tyll reads from the hotel's existing systems and changes nothing in them. This is what stands behind each figure in the demo." flush>
        <TableWrap>
          <table className="w-full min-w-[860px] text-sm">
            <thead><tr><Th>System</Th><Th>Status</Th><Th>Supplies</Th><Th>In this demo</Th></tr></thead>
            <tbody>
              {DATA_SOURCES.map((s) => (
                <tr key={s.id} className={rowClass}>
                  <Td><span className="text-ink">{s.system}</span><span translate="no" className="block font-mono text-[11.5px] text-steel">{s.kind}</span></Td>
                  <Td className="max-w-[210px]">
                    {/* The long "adapter built" label wraps inside its pill rather than widening the column. */}
                    <Badge tone={STATE[s.state].tone} className={s.state === "adapter_built" ? "!h-auto min-h-[22px] !whitespace-normal py-0.5 leading-snug" : undefined}>{STATE[s.state].label}</Badge>
                    {s.verified === false && <span className="mt-1 block text-xs text-steel">Unverified</span>}
                  </Td>
                  <Td className="max-w-[280px] text-graphite">{s.supplies}</Td>
                  <Td className="max-w-[360px] text-graphite">{s.note}{s.detail && maySample && <span className="mt-1 block"><Link prefetch={false} href={s.detail} className={textLink}>See it run on sample responses</Link></span>}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        <Note className="px-6 py-4">Each source sits behind a typed adapter interface in <span translate="no" className="font-mono">src/lib/adapters.ts</span>. Connecting a real system means writing one adapter. Screens and calculations stay as they are.</Note>
      </Panel>

      <Panel title="Roles and permissions" description="The six demo accounts and what each role can open and do." flush>
        <TableWrap>
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr><Th> </Th>{ROLES.map((r) => <Th key={r} className={cn("text-center", r === user.role && "text-ink")}>{ROLE_LABEL[r]}{r === user.role && <span className="block text-xs font-normal">you</span>}</Th>)}</tr>
            </thead>
            <tbody>
              <tr className={rowClass}><Td className="text-steel">Sees</Td>{ROLES.map((r) => <Td key={r} className="text-center text-xs text-graphite">{sample(r).propertyIds === "all" ? "Both hotels" : sample(r).outletIds === "all" ? "Lisbon, all outlets" : "Mercado"}</Td>)}</tr>
              {MODULE_ROWS.map(([m, label]) => <tr key={m} className={rowClass}><Td className="min-w-[210px]">Open {label}</Td>{ROLES.map((r) => <Td key={r}><Mark on={canOpen(sample(r), m)} /></Td>)}</tr>)}
              {PERMISSION_ROWS.map(([p, label]) => <tr key={p} className={rowClass}><Td className="min-w-[210px]">{label}</Td>{ROLES.map((r) => <Td key={r}><Mark on={can(sample(r), p)} /></Td>)}</tr>)}
            </tbody>
          </table>
        </TableWrap>
      </Panel>

      {canOpen(user, "forecast") && <PurchasingSettings propertyId={allowedProperties(user)[0] ?? "lis"} />}
      <Panel title="Detection thresholds" description="The rules behind Finance's flags. A hotel agrees these during onboarding. They are fixed in this demo.">
        <dl className="grid grid-cols-2 gap-x-8 gap-y-4 text-sm md:grid-cols-4">
          <div><dt className="text-[13px] text-steel">Discount limit</dt><dd className="num text-lg">{POLICY.discountMaxPct}%</dd></div>
          <div><dt className="text-[13px] text-steel">Complimentary limit per order</dt><dd className="num text-lg">{POLICY.compMaxValue}</dd></div>
          <div><dt className="text-[13px] text-steel">Refund share needing review</dt><dd className="num text-lg">{Math.round(POLICY.refundMaxShare * 100)}%</dd></div>
          <div><dt className="text-[13px] text-steel">Late refund</dt><dd className="num text-lg">{POLICY.refundLateMinutes} min</dd></div>
          <div><dt className="text-[13px] text-steel">Room charge tolerance</dt><dd className="num text-lg">{POLICY.roomChargeTolerance.toFixed(2)}</dd></div>
          <div><dt className="text-[13px] text-steel">Pattern window</dt><dd className="num text-lg">{POLICY.patternWindowDays} days</dd></div>
          <div><dt className="text-[13px] text-steel">Pattern, minimum cases</dt><dd className="num text-lg">{POLICY.patternMinCases}</dd></div>
          <div><dt className="text-[13px] text-steel">Pattern, minimum share</dt><dd className="num text-lg">{Math.round(POLICY.patternMinShare * 100)}%</dd></div>
          <div><dt className="text-[13px] text-steel">Same item rung twice within</dt><dd className="num text-lg">{POLICY.duplicateSeconds} s</dd></div>
          <div><dt className="text-[13px] text-steel">Unusual quantity of one item</dt><dd className="num text-lg">{POLICY.quantityMin}</dd></div>
          <div><dt className="text-[13px] text-steel">Price set by hand, below the menu</dt><dd className="num text-lg">{Math.round(POLICY.priceBelowShare * 100)}%</dd></div>
          <div><dt className="text-[13px] text-steel">Premium bottles beyond billed</dt><dd className="num text-lg">{Math.round(MIX_RULES.minShare * 100)}%</dd></div>
          <div><dt className="text-[13px] text-steel">Party left before ordering, within</dt><dd className="num text-lg">{COVER_RULES.leftEarly} min</dd></div>
          <div><dt className="text-[13px] text-steel">Bought beyond the last delivery</dt><dd className="num text-lg">{BOUGHT_USED_RULES.minValue}</dd></div>
          <div><dt className="text-[13px] text-steel">Bought gap, share of use</dt><dd className="num text-lg">{Math.round(BOUGHT_USED_RULES.minShare * 100)}%</dd></div>
          <div><dt className="text-[13px] text-steel">Drinks per guest below colleagues</dt><dd className="num text-lg">{Math.round(WAITER_RULES.below * 100)}%</dd></div>
        </dl>
      </Panel>

      <SavedChanges user={user} />

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
