// Demo reset: puts the seeded demonstration records for one scenario back to their starting state, so a story can be
// shown again. Only in demo mode, only for the owner or general manager, and only the demo store is touched:
// accounts, sessions, the audit log and every file outside the store stay as they are.
import type { User } from "../types";
import { emptyNotify } from "./notify";
import { seedOps } from "./ops-seed";
import { seedGuest } from "./guest-seed";
import { mutateStore } from "./purchasing-store";
import { seedStage6 } from "./stage6-seed";
import { DEMO_MODE, audit } from "./auth";

export type ResetScope = "stock" | "purchasing" | "events" | "guest" | "sales" | "all";
const SCOPES: ResetScope[] = ["stock", "purchasing", "events", "guest", "sales", "all"];

export const mayReset = (user: User) => DEMO_MODE && (user.role === "owner" || user.role === "gm");

export function resetDemo(user: User, raw: unknown): { ok: true; scope: ResetScope } | { ok: false; status: number; error: string } {
  if (!DEMO_MODE) return { ok: false, status: 404, error: "Not available." };
  if (!mayReset(user)) return { ok: false, status: 403, error: "Only the owner or general manager can reset demo data." };
  const scope = SCOPES.find((x) => x === raw);
  if (!scope) return { ok: false, status: 400, error: "Choose what to reset." };
  const has = (s: ResetScope) => scope === "all" || scope === s;
  mutateStore((x) => {
    const six = seedStage6();
    if (has("stock")) x.stockLog = six.stockLog;
    if (has("purchasing") || has("events")) { x.requests = []; x.plans = []; x.finance = six.finance; x.seq = 0; }
    if (has("events") || has("sales")) { const ops = seedOps(); x.events = ops.events; x.support = ops.support; x.assignments = ops.assignments; Object.assign(x.counters, ops.counters); for (const k of Object.keys(x.counters)) if (/^(SR|EVT)-/.test(k) && !(k in ops.counters)) delete x.counters[k]; }
    if (has("sales")) x.sales = six.sales;
    if (has("guest")) x.guest = seedGuest();
    if (has("purchasing") || has("events")) for (const k of Object.keys(x.counters)) if (/^INV-/.test(k)) delete x.counters[k];
    // Notices may point at records that no longer exist; start the inbox afresh for the reset area.
    x.notify = scope === "all" ? emptyNotify() : { ...x.notify, notices: [], emails: x.notify.emails };
  });
  audit(user.id, "Demo data reset", `Scope: ${scope}`, "");
  return { ok: true, scope };
}
