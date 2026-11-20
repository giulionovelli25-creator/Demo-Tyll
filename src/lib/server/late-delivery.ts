// Late delivery prediction on the server: the coming deliveries, what each supplier's record says about them, whether
// lateness would leave a service short, who is told and when, and what people did about it. The rules are in
// lib/domain/late-delivery.ts; the history in lib/data/delivery-history.ts. Arrivals and decisions are saved in the
// store with the person and role. Nothing is sent to a supplier, and emails stay prepared, not sent.
import { USERS, ingredientById, itemById, supplierById, userById } from "../data/catalog";
import { WAGYU_STORY } from "../data/constants";
import { deliveryHistory, windowFor } from "../data/delivery-history";
import { getDataset } from "../data/generate";
import { allowedOutlets, allowedProperties, can } from "../domain/access";
import {
  LATE_RULES, SERVICES, isLate, lateShortfall, localNow, minOf, predict, reliabilityOf, serviceAt, severityOf, stamp, warnPhase,
  type DeliveryTiming, type Prediction, type Reliability, type ServiceId, type ServiceUse, type Shortfall, type WarnPhase,
} from "../domain/late-delivery";
import { orderStage } from "../domain/order-stage";
import { ceilToPack, nextDeliveryDate } from "../domain/procurement";
import type { Role, User } from "../types";
import { DEMO_NOW_MIN, DEMO_TIME_ZONE, DEMO_TODAY, addDays, diffDays, round2 } from "../util";
import { notify, resolve } from "./notify";
import { catalogueFor, createPurchaseOrders, supplierAccount } from "./procurement";
import { loadStore, mutateStore, type Shape } from "./purchasing-store";
import { stockFor } from "./stock";
import type { PlanItem } from "./purchasing";

type Fail = { ok: false; status: number; error: string };
type Result<T = object> = ({ ok: true } & T) | Fail;
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

// ---- Saved records ------------------------------------------------------------------------------------------------

/** A delivery recorded at goods in: when it came and whether it was all there. */
export interface LateArrival { key: string; supplierId: string; date: string; at: string; complete: boolean; missing?: string; by: string; role: Role; recordedAt: string }
export type HandleHow = "backup" | "called" | "prep" | "covered" | "other";
export const HOW_LABEL: Record<HandleHow, string> = { backup: "Ordered from the backup supplier", called: "Called the supplier", prep: "Adjusted prep", covered: "Stock covers it", other: "Handled another way" };
/** What a person did about a delivery at risk. One per delivery: the latest counts. */
export interface LateHandled { key: string; how: HandleHow; note: string; by: string; role: Role; at: string; requestId?: string }
export interface LateShape { arrivals: LateArrival[]; handled: LateHandled[]; /** Notice references already sent, so a warning goes once. */ warned: string[]; /** The day (YYYYMMDD) the story records were last set up. */ storyDay?: string }
export const emptyLate = (): LateShape => ({ arrivals: [], handled: [], warned: [] });
const lateOf = (s: Shape): LateShape => s.lateDelivery ?? emptyLate();

/** The demo clock: the hotel's own date and time. */
export const hotelNow = () => ({ date: DEMO_TODAY, min: DEMO_NOW_MIN });
const nowStamp = () => stamp(DEMO_TODAY, DEMO_NOW_MIN);

// ---- The story ----------------------------------------------------------------------------------------------------

export const STORY_RECEIPT_PREFIX = "RR-STORY-";
export const STORY_WASTE_PREFIX = "W-STORY-";
const STORY_REASON = "No Wagyu mince in the delivery: Carnes Ribeiro & Filhos had none today, did not charge it, and will bring the 5 kg with tomorrow's delivery.";
const STORY_WASTE_NOTE = "Fridge 2 lost temperature this afternoon. The Wagyu mince in it was thrown away.";

/**
 * The late delivery story, on the server like any other record: this morning goods in recorded that the meat delivery
 * came with no Wagyu mince, and this afternoon Mercado's chef logged the Wagyu from a failed fridge as spoiled, which
 * leaves about 2.4 kg for tomorrow. Both carry the person and role. They are kept on today as the business date moves
 * (ids carry the day without dashes, so moving the dates does not pass them off as today's) and come back after a reset.
 */
export function ensureDeliveryStory(propertyId = "lis") {
  const d = getDataset().deliveries.find((x) => x.propertyId === propertyId && x.supplierId === WAGYU_STORY.supplierId && x.date === DEMO_TODAY && x.status === "delivered");
  const line = d?.lines.find((l) => l.ingredientId === WAGYU_STORY.ingredientId);
  const s = loadStore();
  if (!d || !line || !s.records) return;
  const day = DEMO_TODAY.replace(/-/g, "");
  const rid = `${STORY_RECEIPT_PREFIX}${day}`, wid = `${STORY_WASTE_PREFIX}${day}`;
  const receipts = s.records.receiptCorrections.filter((x) => x.id.startsWith(STORY_RECEIPT_PREFIX));
  const wastes = s.stockLog.waste.filter((w) => w.id.startsWith(STORY_WASTE_PREFIX));
  if (receipts.length === 1 && receipts[0].id === rid && receipts[0].deliveryId === d.id && lateOf(s).storyDay === day && wastes.every((w) => w.id === wid)) return;
  const morning = `${DEMO_TODAY}T07:52:00.000Z`, afternoon = `${DEMO_TODAY}T15:40:00.000Z`;
  const receipt = { id: rid, deliveryId: d.id, propertyId, ingredientId: line.ingredientId, received: 0, reason: STORY_REASON, by: "u-store", role: "storekeeper" as const, at: morning, seq: 1 };
  // Tonight's Wagyu without the story's spoiled entry, then the spoiled quantity that leaves the story's 2.4 kg.
  const gm = USERS.find((u) => u.role === "gm" && allowedProperties(u).includes(propertyId))!;
  const spoiledNow = wastes.reduce((t, w) => t + w.qty, 0);
  const est = (stockFor(gm, propertyId, { waste: [], counts: [], overrides: [], recipes: [], receipts: [receipt] }).find((r) => r.ingredientId === line.ingredientId)?.estimated ?? 0) + spoiledNow;
  const spoiled = Math.round((est - WAGYU_STORY.tonight) * 10) / 10;
  mutateStore((x) => {
    if (!x.records) return;
    x.records.receiptCorrections = [...x.records.receiptCorrections.filter((c) => !c.id.startsWith(STORY_RECEIPT_PREFIX)), receipt];
    // Corrections people make later number from 2, so a later one on the same line wins over the story's.
    x.records.recordSeq = Math.max(x.records.recordSeq, 1);
    if (!x.records.audit.some((a) => a.ref === d.id && a.action === "Delivery difference recorded" && a.at === morning)) {
      x.records.audit = [{ at: morning, userId: "u-store", role: "storekeeper", action: "Delivery difference recorded", detail: `${d.id}: ${ingredientById[line.ingredientId].name} received 0, recorded ${line.delivered}. ${STORY_REASON}`, ref: d.id }, ...x.records.audit];
    }
    x.stockLog.waste = x.stockLog.waste.filter((w) => !w.id.startsWith(STORY_WASTE_PREFIX));
    if (spoiled >= 0.3) {
      x.stockLog.waste.push({ id: wid, outletId: "lis-terrace", propertyId, date: DEMO_TODAY, ingredientId: line.ingredientId, qty: spoiled, reason: "spoilage", by: "u-chef", byUser: "u-chef", role: "chef", at: afternoon, synced: true, seq: 999_999, note: STORY_WASTE_NOTE });
    }
    x.lateDelivery ??= emptyLate();
    x.lateDelivery.storyDay = day;
  });
}

// ---- Use by service -----------------------------------------------------------------------------------------------

interface ServiceShare { share: Record<ServiceId, number>; outlets: Record<ServiceId, Record<string, number>>; dishes: Record<ServiceId, Record<string, number>>; /** Sales per unit of the item, per service. */ revenuePerUnit: Record<ServiceId, number> }
let shares: { day: string; map: Map<string, ServiceShare> } | null = null;

/** How the last 28 days' sales used each item across breakfast, lunch and dinner, which outlets and which dishes. */
export function serviceShares(): Map<string, ServiceShare> {
  if (shares?.day === DEMO_TODAY) return shares.map;
  const from = addDays(DEMO_TODAY, -28);
  const raw = new Map<string, { qty: Record<ServiceId, number>; sales: Record<ServiceId, number>; outlets: Record<ServiceId, Record<string, number>>; dishes: Record<ServiceId, Record<string, number>> }>();
  const blank = () => ({ breakfast: 0, lunch: 0, dinner: 0 });
  for (const o of getDataset().orders) {
    if (o.date < from || o.date >= DEMO_TODAY || o.voided) continue;
    const svc = serviceAt(o.openMin);
    for (const l of o.lines) {
      if (l.state === "removed_pre" || l.state === "removed_post") continue;
      for (const r of itemById[l.itemId]?.recipe ?? []) {
        const e = raw.get(r.ingredientId) ?? { qty: blank(), sales: blank(), outlets: { breakfast: {}, lunch: {}, dinner: {} }, dishes: { breakfast: {}, lunch: {}, dinner: {} } };
        const q = r.qty * l.qty;
        e.qty[svc] += q;
        e.sales[svc] += l.unitPrice * l.qty;
        e.outlets[svc][o.outletId] = (e.outlets[svc][o.outletId] ?? 0) + q;
        e.dishes[svc][l.itemId] = (e.dishes[svc][l.itemId] ?? 0) + q;
        raw.set(r.ingredientId, e);
      }
    }
  }
  const map = new Map<string, ServiceShare>();
  for (const [id, e] of raw) {
    const total = e.qty.breakfast + e.qty.lunch + e.qty.dinner;
    if (total <= 0) continue;
    map.set(id, {
      share: { breakfast: e.qty.breakfast / total, lunch: e.qty.lunch / total, dinner: e.qty.dinner / total },
      outlets: e.outlets, dishes: e.dishes,
      revenuePerUnit: { breakfast: e.qty.breakfast ? e.sales.breakfast / e.qty.breakfast : 0, lunch: e.qty.lunch ? e.sales.lunch / e.qty.lunch : 0, dinner: e.qty.dinner ? e.sales.dinner / e.qty.dinner : 0 },
    });
  }
  shares = { day: DEMO_TODAY, map };
  return map;
}

// ---- Coming deliveries --------------------------------------------------------------------------------------------

export interface ComingDelivery {
  key: string;
  supplierId: string;
  date: string;
  window: { from: string; to: string };
  value: number;
  items: { ingredientId: string; qty: number }[];
  /** A purchase order in Tyll, or a delivery the supplier confirmed (simulated). */
  orderId?: string;
  poNumber?: string;
}

/** Deliveries still to come in the next two days: confirmed by suppliers, or approved orders in Tyll not yet arrived. */
export function comingFor(propertyId: string, s: Shape = loadStore()): ComingDelivery[] {
  const out: ComingDelivery[] = [];
  const last = addDays(DEMO_TODAY, 2);
  for (const d of deliveryHistory()) {
    if (d.propertyId !== propertyId || d.arrivedAt || d.date <= DEMO_TODAY || d.date > last) continue;
    out.push({ key: `${d.supplierId}|${d.date}`, supplierId: d.supplierId, date: d.date, window: d.window, value: d.value, items: d.items });
  }
  for (const r of s.requests) {
    if (r.propertyId !== propertyId || !r.expectedAt || r.deliveryId) continue;
    const stage = orderStage(r);
    if (stage !== "sent" && stage !== "on_the_way") continue;
    const date = r.expectedAt.slice(0, 10);
    if (r.expectedAt <= nowStamp() || date > last) continue;
    const supplierId = r.supplierId ?? r.lines[0]?.supplierId ?? "";
    const from = r.expectedAt.slice(11, 16);
    out.push({ key: `PR:${r.id}`, supplierId, date, window: { from, to: stamp(date, minOf(from) + 60).slice(11, 16) }, value: round2(r.lines.reduce((t, l) => t + l.qty * l.unitPrice, 0)), items: r.lines.map((l) => ({ ingredientId: l.ingredientId, qty: l.qty })), orderId: r.id, poNumber: r.poNumber });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.window.from.localeCompare(b.window.from));
}

/** The record the prediction reads: the simulated history and deliveries recorded at goods in, earlier days only. */
export function timingRecord(s: Shape = loadStore()): DeliveryTiming[] {
  const recorded: DeliveryTiming[] = lateOf(s).arrivals.filter((a) => !a.key.startsWith("PR:")).map((a) => {
    const base = deliveryHistory().find((d) => `${d.supplierId}|${d.date}` === a.key);
    return { ...(base ?? { id: a.key, propertyId: "lis", supplierId: a.supplierId, date: a.date, orderedAt: a.at, window: windowFor(a.supplierId, a.date), value: 0, items: [] }), arrivedAt: a.at, complete: a.complete, source: "recorded" as const, recordedBy: a.by };
  });
  const keys = new Set(recorded.map((r) => `${r.supplierId}|${r.date}`));
  return [...deliveryHistory().filter((d) => !keys.has(`${d.supplierId}|${d.date}`)), ...recorded];
}

// ---- Deliveries at risk -------------------------------------------------------------------------------------------

export interface RiskItem {
  ingredientId: string;
  name: string;
  unit: string;
  /** Stock when the delivery day starts, and the quantity on the delivery. */
  stockAtStart: number;
  onDelivery: number;
  use: ServiceUse;
  shortfall: Shortfall | null;
  /** Dishes and outlets that use it in the short service, most used first. */
  dishes: { itemId: string; name: string }[];
  outletIds: string[];
  /** Sales the short quantity would have made, an estimate at the service's sales per unit. */
  valueAtRisk: number;
}

export type RiskStatus = "alert" | "covered" | "on_time" | "learning" | "arrived" | "handled";

export interface RiskRow {
  key: string;
  supplierId: string;
  supplier: string;
  date: string;
  window: { from: string; to: string };
  orderId?: string;
  poNumber?: string;
  prediction: Prediction;
  status: RiskStatus;
  severity: "red" | "amber" | null;
  /** Items short in a service, worst first, then the rest of the delivery. */
  items: RiskItem[];
  valueAtRisk: number;
  /** When people are told: the evening before, or the morning before prep. Null outside those times. */
  phase: WarnPhase;
  arrival?: LateArrival & { byName: string };
  handled?: LateHandled & { byName: string; label: string };
  /** The backup supplier for the first short item, when it would deliver, and the quantity a backup order would ask for. */
  backup: { supplierId: string; name: string; arrives: string; phone: string; qty: number; unit: string } | null;
  supplierPhone: string;
}

export interface RiskOut { now: { date: string; min: number }; rows: RiskRow[] }

const nameOf = (id: string) => userById[id]?.name ?? "Someone";
const RANK: Record<RiskStatus, number> = { alert: 0, covered: 1, on_time: 2, learning: 3, handled: 4, arrived: 5 };

/**
 * Every coming delivery with its prediction and whether lateness would leave a service short, for one hotel.
 * `items` is the month plan's items (stock on hand and predicted use by day); the plan's stock is the Stock page's.
 */
export function deliveryRiskFor(user: User, propertyId: string, planItems: readonly PlanItem[], s: Shape = loadStore()): RiskOut {
  const now = hotelNow();
  if (!can(user, "deliveries.view") || !allowedProperties(user).includes(propertyId)) return { now, rows: [] };
  const record = timingRecord(s);
  const share = serviceShares();
  const late = lateOf(s);
  const mine = new Set(allowedOutlets(user));
  const tomorrow = addDays(DEMO_TODAY, 1);
  const rows: RiskRow[] = [];
  for (const c of comingFor(propertyId, s)) {
    const p = predict(record, c, DEMO_TODAY);
    const k = diffDays(c.date, tomorrow);
    const items: RiskItem[] = c.items.map((it) => {
      const plan = planItems.find((x) => x.ingredientId === it.ingredientId);
      const g = ingredientById[it.ingredientId];
      const sh = share.get(it.ingredientId);
      const dayNeed = plan?.needByDay[k] ?? 0;
      const before = (plan?.needByDay ?? []).slice(0, k).reduce((t, x) => t + x, 0);
      const stockAtStart = Math.max(0, (plan?.onHand ?? 0) - before);
      const use: ServiceUse = { breakfast: dayNeed * (sh?.share.breakfast ?? 0), lunch: dayNeed * (sh?.share.lunch ?? 0), dinner: dayNeed * (sh?.share.dinner ?? 0) };
      const shortfall = plan && sh && p.verdict === "likely" ? lateShortfall(c.date, stockAtStart, use, c.window, p.likelyArrival) : null;
      const svc = shortfall?.service;
      const dishes = svc && sh ? Object.entries(sh.dishes[svc]).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => ({ itemId: id, name: itemById[id].name })) : [];
      const outletIds = svc && sh ? Object.entries(sh.outlets[svc]).filter(([, q]) => q > 0).sort((a, b) => b[1] - a[1]).map(([o]) => o) : [];
      return { ingredientId: it.ingredientId, name: g?.name ?? it.ingredientId, unit: g?.unit ?? "", stockAtStart, onDelivery: it.qty, use, shortfall, dishes, outletIds, valueAtRisk: shortfall && svc && sh ? Math.round(shortfall.short * sh.revenuePerUnit[svc]) : 0 };
    });
    items.sort((a, b) => Number(!!b.shortfall) - Number(!!a.shortfall) || b.valueAtRisk - a.valueAtRisk);
    const short = items.filter((i) => i.shortfall);
    // A restaurant manager is warned about the outlets they run; the rest of the hotel's deliveries show as context.
    const touches = user.outletIds === "all" || short.some((i) => i.outletIds.some((o) => mine.has(o)));
    const arrival = late.arrivals.find((a) => a.key === c.key);
    const handled = late.handled.find((h) => h.key === c.key);
    const status: RiskStatus = arrival ? "arrived" : short.length && touches ? (handled ? "handled" : "alert") : p.verdict === "learning" ? "learning" : p.verdict === "on_time" ? "on_time" : "covered";
    const worst = short.map((i) => severityOf(i.shortfall!));
    const backupLine = short[0] ? catalogueFor(propertyId, short[0].ingredientId, s).find((x) => !x.preferred && x.supplierId !== c.supplierId) : undefined;
    const acct = backupLine ? supplierAccount(propertyId, backupLine.supplierId, s) : undefined;
    rows.push({
      key: c.key, supplierId: c.supplierId, supplier: supplierById[c.supplierId]?.name ?? c.supplierId, date: c.date, window: c.window, orderId: c.orderId, poNumber: c.poNumber,
      prediction: p, status, severity: short.length ? (worst.includes("red") ? "red" : "amber") : null, items,
      valueAtRisk: short.reduce((t, i) => t + i.valueAtRisk, 0),
      phase: short.length ? warnPhase(now, c.date, short[0].shortfall!.neededBy) : null,
      arrival: arrival ? { ...arrival, byName: nameOf(arrival.by) } : undefined,
      handled: handled ? { ...handled, byName: nameOf(handled.by), label: HOW_LABEL[handled.how] } : undefined,
      backup: backupLine && acct && short[0] ? { supplierId: backupLine.supplierId, name: acct.name, phone: acct.phone, arrives: nextDeliveryDate(DEMO_TODAY, DEMO_NOW_MIN, acct.cutOff, Math.max(acct.leadDays, ingredientById[backupLine.ingredientId].leadDays), acct.deliveryDays), qty: ceilToPack(short[0].shortfall!.short, backupLine.packSize), unit: short[0].unit } : null,
      supplierPhone: supplierAccount(propertyId, c.supplierId, s)?.phone ?? "",
    });
  }
  rows.sort((a, b) => RANK[a.status] - RANK[b.status] || Number(b.severity === "red") - Number(a.severity === "red") || b.valueAtRisk - a.valueAtRisk || (b.prediction.chance ?? 0) - (a.prediction.chance ?? 0) || a.date.localeCompare(b.date));
  return { now, rows };
}

// ---- Telling people -----------------------------------------------------------------------------------------------

const SERVICE_WORD: Record<ServiceId, string> = { breakfast: "breakfast", lunch: "lunch", dinner: "dinner" };
const dayWord = (date: string) => (date === DEMO_TODAY ? "today" : date === addDays(DEMO_TODAY, 1) ? "tomorrow" : date);

/** The line every warning leads with, what hurts first: "Wagyu beef mince short before lunch tomorrow: Carnes Ribeiro & Filhos likely late". */
export function headline(r: RiskRow): string {
  const i = r.items.find((x) => x.shortfall);
  return i ? `${i.name} short before ${SERVICE_WORD[i.shortfall!.service]} ${dayWord(r.date)}: ${r.supplier} likely late` : `${r.supplier} delivery ${dayWord(r.date)} ${r.window.from} likely late`;
}

/**
 * Sends each warning once per phase, through the bell (and a prepared email): to Purchasing, the head chef, and the
 * restaurant managers of the outlets that would be short. Runs when the demo is opened, like the expiry notice.
 */
export function ensureLateNotices(propertyId: string, rows: readonly RiskRow[]) {
  const due = rows.filter((r) => r.status === "alert" && r.phase);
  if (!due.length) return;
  const s = loadStore();
  const sent = new Set(lateOf(s).warned);
  const fresh = due.filter((r) => !sent.has(`${r.key}|${r.phase}`));
  if (!fresh.length) return;
  mutateStore((x) => {
    x.lateDelivery ??= emptyLate();
    for (const r of fresh) {
      const ref = `${r.key}|${r.phase}`;
      if (x.lateDelivery.warned.includes(ref)) continue;
      x.lateDelivery.warned.push(ref);
      const outlets = new Set(r.items.filter((i) => i.shortfall).flatMap((i) => i.outletIds));
      const to = USERS.filter((u) => allowedProperties(u).includes(propertyId) && can(u, "deliveries.handle") && (u.role === "purchasing" || u.role === "chef" || (u.role === "restaurant_manager" && (u.outletIds === "all" || u.outletIds.some((o) => outlets.has(o))))));
      notify(x, {
        to, type: "late-delivery", ref, propertyId,
        title: headline(r),
        body: `${r.prediction.sentence} This is a prediction from the supplier's record. ${r.backup ? `${r.backup.name} can deliver ${dayWord(r.backup.arrives)}. ` : ""}Order from the backup supplier, call the supplier or adjust prep in Tyll.`,
        href: `/forecast?risk=${encodeURIComponent(r.key)}`, email: true,
      });
    }
  });
}

/** Works out the warnings for the whole hotel, whoever opened the page, and sends the ones that are due. */
export function warnFromPlan(propertyId: string, planItems: readonly PlanItem[]) {
  const gm = USERS.find((u) => u.role === "gm" && allowedProperties(u).includes(propertyId));
  if (gm) ensureLateNotices(propertyId, deliveryRiskFor(gm, propertyId, planItems).rows);
}

// ---- Acting on it -------------------------------------------------------------------------------------------------

const clean = (v: unknown, max = 300) => String(v ?? "").trim().slice(0, max);

/**
 * Records what a person did about a delivery at risk. "backup" also creates a draft purchase order at the backup
 * supplier for the shortfall, which still needs approval and is never sent from here.
 */
export function handleRisk(user: User, propertyId: string, body: Record<string, unknown>, planItems: readonly PlanItem[]): Result<{ handled: LateHandled; requestId?: string; warnings?: string[] }> {
  if (!can(user, "deliveries.handle")) return fail(403, "Your role cannot act on deliveries.");
  if (!allowedProperties(user).includes(propertyId)) return fail(403, "This hotel is outside your access.");
  const how = clean(body.how, 20) as HandleHow;
  if (!(how in HOW_LABEL)) return fail(400, "Choose what you did.");
  const note = clean(body.note);
  if (how === "other" && note.length < 3) return fail(400, "Say what you did.");
  const risk = deliveryRiskFor(user, propertyId, planItems);
  const row = risk.rows.find((r) => r.key === clean(body.key, 80));
  if (!row) return fail(404, "This delivery is not in your list of coming deliveries.");
  if (row.status === "arrived") return fail(409, "This delivery has arrived already.");
  let requestId: string | undefined;
  let warnings: string[] | undefined;
  if (how === "backup") {
    if (!can(user, "purchase.create")) return fail(403, "Your role cannot create purchase orders.");
    const item = row.items.find((i) => i.ingredientId === clean(body.ingredientId, 40)) ?? row.items.find((i) => i.shortfall);
    if (!item?.shortfall) return fail(400, "Nothing on this delivery runs short, so there is nothing to order from a backup.");
    const line = catalogueFor(propertyId, item.ingredientId).find((x) => !x.preferred && x.supplierId !== row.supplierId);
    if (!line) return fail(400, `${item.name} has no backup supplier in the catalogue.`);
    const qty = ceilToPack(item.shortfall.short, line.packSize);
    const made = createPurchaseOrders(user, propertyId, [{ ingredientId: item.ingredientId, qty, supplierId: line.supplierId, requirement: item.shortfall.need, available: item.shortfall.have }], {
      source: "manual",
      notes: `Backup for ${row.supplier}, delivery ${row.date} ${row.window.from}, which is likely to be late (${row.prediction.sentence.replace(/\.$/, "")}). ${item.name} is needed by ${item.shortfall.neededBy.slice(11)} for ${item.shortfall.service}. Please deliver by then.`,
    });
    if (!made.ok) return made;
    requestId = made.orders[0]?.id;
    warnings = made.warnings;
  }
  const handled: LateHandled = { key: row.key, how, note, by: user.id, role: user.role, at: new Date().toISOString(), requestId };
  mutateStore((x) => {
    x.lateDelivery ??= emptyLate();
    x.lateDelivery.handled = [...x.lateDelivery.handled.filter((h) => h.key !== row.key), handled];
    resolve(x, "late-delivery", `${row.key}|evening`);
    resolve(x, "late-delivery", `${row.key}|morning`);
  });
  return { ok: true, handled, requestId, warnings };
}

/** Takes back a "handled" mark: the delivery is at risk again. */
export function reopenRisk(user: User, body: Record<string, unknown>): Result {
  if (!can(user, "deliveries.handle")) return fail(403, "Your role cannot act on deliveries.");
  const key = clean(body.key, 80);
  if (!lateOf(loadStore()).handled.some((h) => h.key === key)) return fail(404, "Nothing was recorded for this delivery.");
  mutateStore((x) => { if (x.lateDelivery) x.lateDelivery.handled = x.lateDelivery.handled.filter((h) => h.key !== key); });
  return { ok: true };
}

/** One tap at goods in: the delivery has arrived, now, complete or with something missing. */
export function recordArrival(user: User, body: Record<string, unknown>): Result<{ arrival: LateArrival }> {
  if (!can(user, "purchase.receive")) return fail(403, "Your role does not receive deliveries.");
  const key = clean(body.key, 80);
  const propertyId = allowedProperties(user)[0];
  const c = propertyId ? comingFor(propertyId).find((x) => x.key === key) ?? todaysDue(propertyId).find((x) => x.key === key) : undefined;
  if (!c) return fail(404, "This delivery is not expected.");
  if (lateOf(loadStore()).arrivals.some((a) => a.key === key)) return fail(409, "This delivery was recorded already.");
  const complete = body.complete !== false;
  const missing = clean(body.missing, 200);
  if (!complete && missing.length < 2) return fail(400, "Say what is missing.");
  const arrival: LateArrival = { key, supplierId: c.supplierId, date: c.date, at: nowStamp(), complete, ...(complete ? {} : { missing }), by: user.id, role: user.role, recordedAt: new Date().toISOString() };
  mutateStore((x) => {
    x.lateDelivery ??= emptyLate();
    x.lateDelivery.arrivals.push(arrival);
    resolve(x, "late-delivery", `${key}|evening`);
    resolve(x, "late-delivery", `${key}|morning`);
  });
  return { ok: true, arrival };
}

/** Deliveries due today with no arrival recorded yet. In the simulated data today's have all come, so this is usually empty. */
function todaysDue(propertyId: string): ComingDelivery[] {
  return deliveryHistory().filter((d) => d.propertyId === propertyId && d.date === DEMO_TODAY && !d.arrivedAt).map((d) => ({ key: `${d.supplierId}|${d.date}`, supplierId: d.supplierId, date: d.date, window: d.window, value: d.value, items: d.items }));
}

/** What goods in sees: today's and tomorrow's deliveries, each with its window and whether it has been recorded. */
export function goodsInFor(user: User): Result<{ rows: (ComingDelivery & { supplier: string; arrival?: LateArrival })[] }> {
  if (!can(user, "purchase.receive")) return fail(403, "Your role does not receive deliveries.");
  const propertyId = allowedProperties(user)[0];
  if (!propertyId) return { ok: true, rows: [] };
  const late = lateOf(loadStore());
  const rows = [...todaysDue(propertyId), ...comingFor(propertyId).filter((c) => !c.orderId && c.date <= addDays(DEMO_TODAY, 1))].map((c) => ({ ...c, supplier: supplierById[c.supplierId]?.name ?? c.supplierId, arrival: late.arrivals.find((a) => a.key === c.key) }));
  return { ok: true, rows };
}

// ---- Supplier reliability -----------------------------------------------------------------------------------------

export interface ReliabilityRow extends Reliability { name: string; usualWindow: string }

/** On time rate, delay, weekday pattern and confidence for every supplier with a delivery record. */
export function reliabilityFor(user: User, propertyId: string, weeks: number): Result<{ rows: ReliabilityRow[]; weeks: number }> {
  if (!can(user, "deliveries.view")) return fail(403, "Your role cannot see supplier reliability.");
  if (!allowedProperties(user).includes(propertyId)) return fail(403, "This hotel is outside your access.");
  const w = weeks === 4 ? 4 : 12;
  const record = timingRecord().filter((d) => d.propertyId === propertyId);
  const ids = [...new Set(record.map((d) => d.supplierId))];
  const rows = ids.map((id) => {
    const last = [...record].reverse().find((d) => d.supplierId === id);
    return { ...reliabilityOf(record, id, DEMO_TODAY, w), name: supplierById[id]?.name ?? id, usualWindow: last ? `${last.window.from} to ${last.window.to}` : "" };
  });
  // Learning suppliers last; the rest from the least reliable, which need a manager first.
  rows.sort((a, b) => Number(a.confidence === "learning") - Number(b.confidence === "learning") || (a.onTimeRate ?? 1) - (b.onTimeRate ?? 1));
  return { ok: true, rows, weeks: w };
}

/** For tests and the worked example: whether a recorded delivery counts as late. */
export const countsLate = isLate;
export { SERVICES, LATE_RULES, localNow, DEMO_TIME_ZONE };
