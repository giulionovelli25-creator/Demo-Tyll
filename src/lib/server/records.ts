// Decisions and corrections saved on the demo server (overnight feature 8). The rules are the ones the browser runs
// (`lib/domain/records.ts`); here they run again with the signed-in person's own session and data, and the result is
// kept in the store with the person and the role. Each person receives only the records their role may see.
import { BREAKFAST_EXAMPLE_EXCEPTION_ID, COVERS_EXAMPLE_EXCEPTION_ID, TILL_EXAMPLE_EXCEPTION_IDS } from "../data/constants";
import { getDataset, getOutletStock } from "../data/generate";
import { allowedOutlets, allowedProperties, can, canOpen, hasWholeProperty, type Permission } from "../domain/access";
import { OP_KINDS, applyRecordOp, closedDetail, type RecordEnv, type RecordOp, type Records } from "../domain/records";
import type { AuditEntry, Exception, UsagePeriod, User } from "../types";
import { DATA_START, DEMO_NOW_MIN, DEMO_TODAY } from "../util";
import { publicDemo } from "./auth";
import { loadStore, mutateStore, emptyRecordsShape, type RecordsShape, type Shape } from "./purchasing-store";
import { snapshotFor } from "./snapshot";
import { sharedCounts, sharedWaste } from "./stock-log";
import { workspaceInfo, WORKSPACE_TTL_MS } from "./workspace";

/** The permission each change needs, checked before the rules run. Closing a notice, or resolving or snoozing an alert,
 * needs none: it is the person's own. */
export const OP_PERMISSION: Record<RecordOp["kind"], Permission | null> = {
  "investigation.assign": "investigation.assign",
  "investigation.note": "investigation.note",
  "investigation.review": "investigation.note",
  "investigation.close": "investigation.close",
  "investigation.reopen": "investigation.reopen",
  "case.fromCount": "investigation.assign",
  "case.fromPeriod": "investigation.assign",
  "stock.recount": "stock.count",
  "recipe.standard": "stock.editPrices",
  "delivery.receipt": "stock.count",
  "price.set": "stock.editPrices",
  "purchase.approve": "forecast.approve",
  "purchase.withdraw": "forecast.approve",
  "forecast.inputs": "forecast.approve",
  "flow.status": "flow.updateOrder",
  "alert.dismiss": null,
  "alert.state": null,
};

const recordsOf = (s: Shape): RecordsShape => s.records ?? emptyRecordsShape();

/** The world as the server sees it for one person: only the flags, counts and periods they may see. */
export function serverEnv(user: User, s: Shape = loadStore()): RecordEnv {
  const snap = snapshotFor(user);
  const d = getDataset();
  const props = new Set(allowedProperties(user));
  return {
    user,
    today: DEMO_TODAY,
    nowMin: DEMO_NOW_MIN,
    now: new Date().toISOString(),
    dataStart: DATA_START,
    exception: (id) => snap.exceptions.find((e) => e.id === id),
    exceptionForPeriod: (pid) => snap.exceptions.find((e) => e.period?.id === pid),
    seedState: (id) => snap.seedInvestigations[id],
    count: (id) => [...snap.counts, ...sharedCounts(s)].find((c) => c.id === id && props.has(c.propertyId)),
    period: (p) => {
      // Never trust a period sent by the browser: take the server's own, if this person may see its outlet.
      const found = getOutletPeriod(p?.id);
      return found && allowedOutlets(user).includes(found.outletId) ? found : null;
    },
    // Never trust the outlet or item sent by the browser: take the count's own from the server's stock periods.
    countCheck: (checkId) => countCheckOf(checkId) ?? null,
    delivery: (id) => d.deliveries.find((x) => x.id === id),
    liveOrderOutlet: (id) => d.liveOrders.find((o) => o.id === id)?.outletId,
    waste: () => sharedWaste(s),
  };
}

const getOutletPeriod = (id: unknown) => (typeof id === "string" ? getOutletStock().periods.find((p) => p.id === id) : undefined);

/** Every outlet count that opens or closes a stock period, by id, built once per set of periods. */
const checkIndex = new WeakMap<readonly UsagePeriod[], Map<string, { outletId: string; ingredientId: string }>>();
export function countCheckOf(checkId: string): { outletId: string; ingredientId: string } | undefined {
  const periods = getOutletStock().periods;
  let index = checkIndex.get(periods);
  if (!index) {
    index = new Map();
    for (const p of periods) for (const c of [p.from, p.to]) index.set(c.id, { outletId: c.outletId, ingredientId: c.ingredientId });
    checkIndex.set(periods, index);
  }
  return index.get(checkId);
}

/** The full saved records as the rules see them, with this person's own closed notices and alerts. */
const asRecords = (r: RecordsShape, user: User): Records => {
  const { dismissed, alertStatesBy, applied: _applied, ...rest } = r;
  void _applied;
  return { ...rest, dismissedAlerts: dismissed[user.id] ?? [], alertStates: alertStatesBy?.[user.id] ?? {} };
};

/**
 * Who closed the checked examples, as the demo's history of saved changes: the outlet's manager closed each one the day
 * after. Worked out from the seeded cases, so it always agrees with them and comes back with them after a reset.
 */
export function seededHistory(): AuditEntry[] {
  const d = getDataset();
  const ids = [...TILL_EXAMPLE_EXCEPTION_IDS, COVERS_EXAMPLE_EXCEPTION_ID, BREAKFAST_EXAMPLE_EXCEPTION_ID];
  const out: AuditEntry[] = [];
  ids.forEach((id, i) => {
    const st = d.seedInvestigations[id];
    const e = d.exceptions.find((x) => x.id === id);
    if (!st || !e || st.status !== "closed" || !st.closedAt || !st.closedBy) return;
    out.push({ at: `${st.closedAt}T${String(9 + i).padStart(2, "0")}:${String(10 + i * 7).padStart(2, "0")}:00.000Z`, userId: st.closedBy, role: "restaurant_manager", action: "Investigation closed", detail: closedDetail(id, st.outcome ?? "inconclusive", st.confirmedLoss, st.recovered), ref: id });
  });
  return out.sort((a, b) => (a.at < b.at ? 1 : -1));
}

/** Whether a stock case opened by hand may be seen: the same rule as the flags in `snapshotFor`. */
function seesCase(user: User, e: Exception): boolean {
  const staff = user.role === "employee" || user.role === "chef";
  if (staff || user.role === "purchasing") return false;
  return e.outletId ? allowedOutlets(user).includes(e.outletId) : hasWholeProperty(user, e.propertyId);
}

/** What one person receives: the records about what their role may see, nothing else. */
export function recordsView(user: User, r: RecordsShape): Records {
  const snap = snapshotFor(user);
  const stockCases = r.stockCases.filter((e) => seesCase(user, e));
  const visible = new Set([...snap.exceptions.map((e) => e.id), ...stockCases.map((e) => e.id)]);
  const outlets = new Set(allowedOutlets(user));
  const props = new Set(allowedProperties(user));
  // Operational staff and the head chef see quantities without money, so prices stay with the roles that see costs.
  const money = user.role !== "employee" && user.role !== "chef";
  const planner = canOpen(user, "forecast");
  const d = getDataset();
  const liveOutlet = new Map(d.liveOrders.map((o) => [o.id, o.outletId]));
  const deliveryProp = new Map(d.deliveries.map((x) => [x.id, x.propertyId]));
  const auditAll = can(user, "settings.audit");
  // The seeded history is part of the starting data, so it is there after a reset too.
  const history = [...r.audit, ...seededHistory()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return {
    recordSeq: r.recordSeq,
    investigations: Object.fromEntries(Object.entries(r.investigations).filter(([id]) => visible.has(id))),
    stockCases,
    // Only recounts of a real count, at its own outlet, for the outlets this person may see.
    recounts: r.recounts.filter((x) => { const c = countCheckOf(x.checkId); return !!c && c.outletId === x.outletId && outlets.has(c.outletId); }),
    recipeChanges: user.role === "employee" ? [] : r.recipeChanges,
    receiptCorrections: r.receiptCorrections.filter((x) => props.has(x.propertyId ?? deliveryProp.get(x.deliveryId) ?? "")),
    priceOverrides: money ? r.priceOverrides : [],
    priceLog: money ? r.priceLog : [],
    approvals: planner ? r.approvals.filter((a) => props.has(a.propertyId)) : [],
    forecastInputs: planner ? Object.fromEntries(Object.entries(r.forecastInputs).filter(([p]) => props.has(p))) : {},
    flowStatus: Object.fromEntries(Object.entries(r.flowStatus).filter(([id]) => outlets.has(liveOutlet.get(id) ?? ""))),
    dismissedAlerts: r.dismissed[user.id] ?? [],
    // Resolve and snooze on Alerts are the person's own, like closed notices.
    alertStates: r.alertStatesBy?.[user.id] ?? {},
    // About a case: whoever may see the case. Anything else: the person's own changes, or everyone's for the roles that
    // keep the audit trail (owner, general manager, financial controller).
    audit: history.filter((a) => (a.ref ? visible.has(a.ref) : auditAll || a.userId === user.id)).slice(0, 400),
  };
}

export interface RecordsOut {
  records: Records;
  /** Public demo: this visitor's own workspace, so Settings can say where changes are kept. */
  workspace: { startedAt: string; lastUsedAt: string; keptHours: number } | null;
  shared: boolean;
}

export function recordsFor(user: User): RecordsOut {
  // Load first: on a visitor's first request this creates their workspace, so its dates are there to report.
  const records = recordsView(user, recordsOf(loadStore()));
  const info = workspaceInfo();
  return {
    records,
    workspace: info ? { startedAt: info.startedAt, lastUsedAt: info.lastUsedAt, keptHours: WORKSPACE_TTL_MS / 3600000 } : null,
    shared: !publicDemo(),
  };
}

type Fail = { ok: false; status: number; error: string };

/** Validates a change sent by a browser, applies it with the server's own data, and saves it once. */
export function applyRecord(user: User, body: Record<string, unknown>): ({ ok: true; id?: string } & RecordsOut) | Fail {
  const op = body.op as RecordOp | undefined;
  if (!op || typeof op !== "object" || !OP_KINDS.includes(op.kind)) return { ok: false, status: 400, error: "Unknown change." };
  const need = OP_PERMISSION[op.kind];
  if (need && !can(user, need)) return { ok: false, status: 403, error: "Your role cannot do this." };
  const key = typeof body.key === "string" && body.key.length <= 80 ? `${user.id}:${body.key}` : null;
  const s = loadStore();
  const r = recordsOf(s);
  if (key && r.applied.includes(key)) return { ok: true, ...recordsFor(user) };
  const result = applyRecordOp(asRecords(r, user), op, serverEnv(user, s));
  if (!result.ok) return { ok: false, status: result.forbidden ? 403 : 400, error: result.error };
  mutateStore((x) => {
    const { dismissedAlerts, alertStates, ...rest } = result.rec;
    const before = recordsOf(x);
    x.records = {
      ...rest, dismissed: { ...before.dismissed, [user.id]: dismissedAlerts }, alertStatesBy: { ...before.alertStatesBy, [user.id]: alertStates },
      applied: key ? [...before.applied, key].slice(-500) : before.applied,
    };
  });
  return { ok: true, id: result.id, ...recordsFor(user) };
}
