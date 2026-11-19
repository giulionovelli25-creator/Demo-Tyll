// Automatic ordering. Once a business day, at the time set in the rules, the items the prediction says must be ordered
// today become orders, one per supplier. Fixed rules decide whether an order goes straight to the supplier or waits
// for the usual approval. Simulated: nothing is sent to a supplier from this demo.
import { ingredientById, outletsOfProperty, propertyById, userById } from "../data/catalog";
import { supplierName } from "../data/purchasing-rules";
import { can } from "../domain/access";
import { RUN_TIMES, SEND_LIMITS, defaultAuto, reviewReason, type AutoRun, type AutoSettings } from "../domain/auto-order";
import type { PurchaseRequest, User } from "../types";
import { DEMO_TODAY, addDays, fmtMoney, sum } from "../util";
import { handoff, monthPlanFor, requestTotal, canSee, type PlanItem, type Result } from "./purchasing";
import { catalogueLine, sendPurchaseOrder, settingsOf as purchasingSettings, supplierAccount } from "./procurement";
import { nextDeliveryDate } from "../domain/procurement";
import { DEMO_NOW_MIN } from "../util";
import { loadStore, mutateStore } from "./purchasing-store";
import type { SessionEntries } from "./stock";

const fail = (status: number, error: string): { ok: false; status: number; error: string } => ({ ok: false, status, error });

/** Who may change the rules: the people who answer for what the hotel buys. */
export const mayChangeAuto = (user: User) => can(user, "purchase.approveManager") || user.role === "fnb_director" || can(user, "purchase.review");

const settingsOf = (propertyId: string): AutoSettings | undefined => (loadStore().autoOrder ?? defaultAuto()).settings[propertyId];

/** Runs this morning's automatic ordering once, if it is on and has not run today. Returns the run, or null. */
export function ensureAutoRun(propertyId: string, entries: SessionEntries): AutoRun | null {
  const auto = loadStore().autoOrder ?? defaultAuto();
  const set = auto.settings[propertyId];
  const done = auto.runs.find((r) => r.propertyId === propertyId && r.date === DEMO_TODAY);
  if (done || !set?.on) return done ?? null;
  // The run works with the access of the person who set the rules, never wider.
  const owner = userById[set.changedBy] ?? userById["u-fnb"];
  const res = monthPlanFor(owner, propertyId, entries);
  if (!res.ok) return null;
  const plan = res.plan;
  // Items due today, and tomorrow's too: one day early costs a day of stock, one day late can cost a service.
  const tomorrow = addDays(DEMO_TODAY, 1);
  const due = plan.items.filter((i) => i.orderBy !== null && i.orderBy <= tomorrow && i.nextQty > 0);
  const skipped = due.filter((i) => set.never.includes(i.ingredientId)).map((i) => ({ ingredientId: i.ingredientId, reason: "On the list of items ordered by hand" }));
  const picked = due.filter((i) => !set.never.includes(i.ingredientId));
  const bySupplier = new Map<string, PlanItem[]>();
  for (const i of picked) bySupplier.set(i.supplierId, [...(bySupplier.get(i.supplierId) ?? []), i]);
  const runAt = `${DEMO_TODAY}T${set.time}`;
  const stamp = `${DEMO_TODAY}T${set.time}:00.000Z`;
  const money = (n: number) => fmtMoney(n, propertyById[propertyId].currency);

  const toSend: string[] = [];
  const result = mutateStore((s) => {
    s.autoOrder ??= defaultAuto();
    const again = s.autoOrder.runs.find((r) => r.propertyId === propertyId && r.date === DEMO_TODAY);
    if (again) return again;
    const ids: string[] = [];
    for (const [supplierId, items] of [...bySupplier].sort((a, b) => sum(b[1], (i) => i.nextCost) - sum(a[1], (i) => i.nextCost))) {
      s.seq += 1;
      const id = `PR-${propertyId.toUpperCase()}-${String(s.seq).padStart(4, "0")}`;
      // The supplier's catalogue line gives the pack and VAT, so an automatic order is a full purchase order.
      const lines = items.map((i) => {
        const c = catalogueLine(propertyId, supplierId, i.ingredientId, s);
        return { ingredientId: i.ingredientId, qty: i.nextQty, suggested: i.nextQty, requirement: Math.round(i.predicted * 1000) / 1000, available: Math.round(i.onHand * 1000) / 1000, incoming: Math.round(i.incoming * 1000) / 1000, safety: Math.round(i.buffer * 1000) / 1000, supplierId, unitPrice: c?.agreedPrice ?? i.unitPrice, vatRate: c?.vatRate, packSize: c?.packSize, packLabel: c?.packLabel };
      });
      const acct = supplierAccount(propertyId, supplierId, s);
      const deliveryDate = nextDeliveryDate(DEMO_TODAY, Math.min(DEMO_NOW_MIN, 6 * 60), acct?.cutOff ?? "14:00", Math.max(acct?.leadDays ?? 1, ...items.map((i) => i.leadDays)), acct?.deliveryDays ?? []);
      const cc = purchasingSettings(propertyId, s).costCentres;
      const costCentre = cc.length ? `${cc.find((c) => c.id === (lines.every((l) => l.vatRate === 0.23) ? "4200" : "4100"))?.id ?? cc[0].id} ${cc.find((c) => c.id === (lines.every((l) => l.vatRate === 0.23) ? "4200" : "4100"))?.name ?? cc[0].name}` : undefined;
      const total = requestTotal({ lines });
      const reviews = items.map((i) => ({ i, why: reviewReason(i, i.nextQty, plan) })).filter((x): x is { i: PlanItem; why: string } => !!x.why);
      const held = reviews.length > 0 || total > set.sendUnder;
      const why = reviews.length
        ? `${reviews.map((x) => `${ingredientById[x.i.ingredientId].name}: ${x.why}`).join("; ")}.`
        : total > set.sendUnder ? `Over the ${money(set.sendUnder)} limit for sending without approval.`
        : `Under ${money(set.sendUnder)}, usual supplier, nothing to review.`;
      const r: PurchaseRequest = {
        id, propertyId, outletIds: outletsOfProperty(propertyId).map((o) => o.id), period: plan.period, createdBy: owner.id, createdAt: stamp, updatedAt: stamp,
        status: held ? "purchasing" : "approved", lines, supplierId, deliveryDate, costCentre,
        comment: `Automatic order from the prediction: items due today or tomorrow from ${supplierName(supplierId)}.`,
        auto: { runAt, decision: held ? "held" : "sent", why },
        history: [{ at: stamp, by: owner.id, action: `Created by automatic ordering at ${set.time}`, status: "draft" }],
      };
      if (held) {
        r.history.push({ at: stamp, by: owner.id, action: "Submitted to purchasing by automatic ordering", status: "purchasing", comment: why });
      } else {
        r.poNumber = `PO-${id.slice(3)}`;
        r.history.push({ at: stamp, by: owner.id, action: "Approved by the automatic ordering rule", status: "approved", comment: why });
        toSend.push(id);
      }
      s.requests.push(r);
      handoff(s, r, owner);
      ids.push(id);
    }
    const run: AutoRun = { propertyId, date: DEMO_TODAY, time: set.time, requestIds: ids, skipped, sendUnder: set.sendUnder };
    s.autoOrder.runs = [...s.autoOrder.runs.filter((x) => x.date >= addDays(DEMO_TODAY, -30)), run];
    return run;
  });
  // Orders the rule approved go to the supplier as any purchase order does: by email with the PDF, kept with the order.
  for (const id of toSend) sendPurchaseOrder(owner, id);
  return result;
}

export interface AutoOut {
  settings: AutoSettings;
  run: AutoRun | null;
  /** This morning's orders, as far as this person may see them. */
  orders: PurchaseRequest[];
  mayChange: boolean;
  /** What tomorrow's run would order on today's prediction. */
  next: { date: string; items: number; value: number; neverDue: number };
}

export function autoFor(user: User, propertyId: string, entries: SessionEntries): Result<{ auto: AutoOut }> {
  if (!can(user, "purchase.create")) return fail(403, "Your role cannot see automatic ordering.");
  const run = ensureAutoRun(propertyId, entries);
  const settings = settingsOf(propertyId);
  if (!settings) return fail(404, "Automatic ordering is not set up for this hotel.");
  const plan = monthPlanFor(user, propertyId, entries);
  if (!plan.ok) return plan;
  const tomorrow = addDays(DEMO_TODAY, 1);
  // Tomorrow's run takes what is due by the day after.
  const dueNext = plan.plan.items.filter((i) => i.nextQty > 0 && i.orderBy !== null && i.orderBy <= addDays(DEMO_TODAY, 2));
  const store = loadStore();
  const orders = (run?.requestIds ?? []).map((id) => store.requests.find((r) => r.id === id)).filter((r): r is PurchaseRequest => !!r && canSee(user, r));
  return {
    ok: true,
    auto: {
      settings, run, orders, mayChange: mayChangeAuto(user),
      next: { date: tomorrow, items: dueNext.filter((i) => !settings.never.includes(i.ingredientId)).length, value: Math.round(sum(dueNext.filter((i) => !settings.never.includes(i.ingredientId)), (i) => i.nextCost)), neverDue: dueNext.filter((i) => settings.never.includes(i.ingredientId)).length },
    },
  };
}

/** Changes the rules. They apply from the next morning's run; orders already placed are not touched. */
export function saveAutoSettings(user: User, propertyId: string, body: Record<string, unknown>): Result<{ settings: AutoSettings }> {
  if (!mayChangeAuto(user)) return fail(403, "Only the F&B director, purchasing or the general manager can change automatic ordering.");
  const cur = settingsOf(propertyId);
  if (!cur) return fail(404, "Automatic ordering is not set up for this hotel.");
  const next: AutoSettings = { ...cur };
  if (body.on !== undefined) {
    if (typeof body.on !== "boolean") return fail(400, "Choose on or off.");
    next.on = body.on;
  }
  if (body.time !== undefined) {
    if (!(RUN_TIMES as readonly unknown[]).includes(body.time)) return fail(400, "Choose a run time.");
    next.time = body.time as string;
  }
  if (body.sendUnder !== undefined) {
    if (!(SEND_LIMITS as readonly unknown[]).includes(body.sendUnder)) return fail(400, "Choose a limit.");
    next.sendUnder = body.sendUnder as number;
  }
  if (body.never !== undefined) {
    if (!Array.isArray(body.never) || body.never.length > 100 || body.never.some((g) => typeof g !== "string" || !ingredientById[g])) return fail(400, "Unknown item on the list.");
    next.never = [...new Set(body.never as string[])];
  }
  next.changedBy = user.id;
  next.changedAt = new Date().toISOString().slice(0, 16);
  const settings = mutateStore((s) => {
    s.autoOrder ??= defaultAuto();
    s.autoOrder.settings[propertyId] = next;
    return next;
  });
  return { ok: true, settings };
}
