// Demo reset: puts the seeded demonstration records for one scenario back to their starting state, so a story can be
// shown again. Only in demo mode, only for the owner or general manager, and only the demo store is touched:
// accounts, sessions, the audit log and every file outside the store stay as they are.
import { defaultAuto } from "../domain/auto-order";
import { seedProcurement } from "./procurement-seed";
import { userById } from "../data/catalog";
import type { User } from "../types";
import { emptyNotify } from "./notify";
import { seedOps } from "./ops-seed";
import { seedRequests } from "./orders-seed";
import { seedGuest } from "./guest-seed";
import { emptyRecordsShape, mutateStore, type RecordsShape } from "./purchasing-store";
import { getDataset } from "../data/generate";
import { inWorkspace, sweepWorkspaces, workspaceId } from "./workspace";
import { seedStage6 } from "./stage6-seed";
import { DEMO_MODE, audit, publicDemo } from "./auth";

export type ResetScope = "stock" | "purchasing" | "events" | "guest" | "sales" | "all";
const SCOPES: ResetScope[] = ["stock", "purchasing", "events", "guest", "sales", "all"];

/** The owner or general manager resets the shared records. In the public demo every visitor may reset their own workspace. */
export const mayReset = (user: User) => DEMO_MODE && (user.role === "owner" || user.role === "gm" || (publicDemo() && workspaceId() !== null));

const STOCK_TYPES = new Set(["usage_variance", "stock_shortfall", "bought_not_used"]);
/** The saved decisions and corrections that belong to one reset area. */
function resetRecords(r: RecordsShape | undefined, scope: ResetScope, user: User): RecordsShape {
  const now = new Date().toISOString();
  const entry = { at: now, userId: user.id, role: user.role, action: "Demo data reset", detail: `Scope: ${scope}` };
  if (!r || scope === "all") return { ...emptyRecordsShape(), audit: [entry] };
  const out: RecordsShape = { ...r, audit: [entry, ...r.audit].slice(0, 400) };
  if (scope === "stock") {
    const types = new Map(getDataset().exceptions.map((e) => [e.id, e.type as string]));
    const stockCase = (id: string) => id.startsWith("EX-STK-") || id.startsWith("EX-BU-") || STOCK_TYPES.has(types.get(id) ?? "");
    out.investigations = Object.fromEntries(Object.entries(r.investigations).filter(([id]) => !stockCase(id)));
    Object.assign(out, { stockCases: [], recounts: [], recipeChanges: [], receiptCorrections: [], priceOverrides: [], priceLog: [] });
  }
  if (scope === "purchasing" || scope === "events") Object.assign(out, { approvals: [], forecastInputs: {} });
  return out;
}

export function resetDemo(user: User, raw: unknown): { ok: true; scope: ResetScope } | { ok: false; status: number; error: string } {
  if (!DEMO_MODE) return { ok: false, status: 404, error: "Not available." };
  if (!mayReset(user)) return { ok: false, status: 403, error: "Only the owner or general manager can reset demo data." };
  const scope = SCOPES.find((x) => x === raw);
  if (!scope) return { ok: false, status: 400, error: "Choose what to reset." };
  const has = (s: ResetScope) => scope === "all" || scope === s;
  mutateStore((x) => {
    const six = seedStage6();
    if (has("stock")) { x.stockLog = six.stockLog; x.stockTakes = []; x.cashUps = []; x.boughtUsedChecks = []; x.waiterCoaching = []; x.emptyScans = []; x.menuSync = undefined; x.stockTakeStoryDay = undefined; x.expiryDecisions = undefined; }
    if (has("purchasing") || has("events")) { x.requests = seedRequests(); x.plans = []; x.finance = six.finance; x.seq = x.requests.length; x.autoOrder = defaultAuto(); x.procurement = seedProcurement(); x.lateDelivery = undefined; }
    if (has("events") || has("sales")) { const ops = seedOps(); x.events = ops.events; x.support = ops.support; x.assignments = ops.assignments; Object.assign(x.counters, ops.counters); for (const k of Object.keys(x.counters)) if (/^(SR|EVT)-/.test(k) && !(k in ops.counters)) delete x.counters[k]; }
    if (has("sales")) x.sales = six.sales;
    if (has("guest")) x.guest = seedGuest();
    if (has("purchasing") || has("events")) for (const k of Object.keys(x.counters)) if (/^(INV-|MAIL)/.test(k)) delete x.counters[k];
    if (has("stock")) for (const k of Object.keys(x.counters)) if (/^(ST-|CU$|wc-|ES$)/.test(k)) delete x.counters[k];
    // Notices may point at records that no longer exist; start the inbox afresh for the reset area.
    x.notify = scope === "all" ? emptyNotify() : { ...x.notify, notices: [], emails: x.notify.emails };
    x.expiryChecks = {};
    x.records = resetRecords(x.records, scope, user);
  });
  audit(user.id, "Demo data reset", `Scope: ${scope}`, "");
  return { ok: true, scope };
}

/** Public demo: each visitor works in a workspace of their own (`workspace.ts`). The shared set, used only without a
 * workspace cookie, returns to the start at most once an hour, when someone enters. */
const FRESHEN_MS = 60 * 60 * 1000;
let freshened = 0;
export function freshenPublicDemo(now = Date.now()) {
  if (!publicDemo()) return;
  // Workspaces nobody has used for a day are removed; a visitor's own workspace is never reset behind their back.
  sweepWorkspaces(now);
  if (now - freshened < FRESHEN_MS) return;
  freshened = now;
  // The shared set is used only by a request without a workspace cookie.
  inWorkspace(null, () => resetDemo(userById["u-gm"], "all"));
}
