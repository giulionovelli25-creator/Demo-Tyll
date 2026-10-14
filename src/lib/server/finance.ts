// Finance: supplier invoices checked against orders and deliveries, spending by stage, budgets and reports.
// Invoices come from two real sources: the dataset's delivered purchase orders (each with its supplier invoice) and
// Tyll purchase orders whose invoice accounting records here. Nothing is copied: every figure is worked out from those
// records, so Purchasing, Stock and Finance read the same thing. Payments are not recorded anywhere in Tyll.
import { ingredientById, propertyById, supplierById } from "../data/catalog";
import { getDataset } from "../data/generate";
import { BUDGETS, BUDGET_MONTH, CATEGORY_LABEL, FIN_DEPTS, FIN_DEPT_LABEL, HISTORY_EXPENSES, type FinCategory, type FinDept } from "../data/finance-rules";
import { allowedProperties, can } from "../domain/access";
import { coverage, eventCost, isCommitted } from "../domain/events";
import { matchDeliveryLine, type MatchIssue } from "../domain/inventory";
import type { Currency, InvoiceReview, InvoiceStatus, PurchaseRequest, TyllInvoice, User } from "../types";
import { DEMO_TODAY, addDays } from "../util";
import { loadStore, mutateStore, nextNumber, type Shape } from "./purchasing-store";

type Fail = { ok: false; status: number; error: string };
export type Result<T = object> = ({ ok: true } & T) | Fail;
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });
const r2 = (n: number) => Math.round(n * 100) / 100;
const now = () => new Date().toISOString();
const text = (v: unknown, max = 400) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export const deptOfRequest = (r: Pick<PurchaseRequest, "deptId" | "eventId">): FinDept => (r.eventId ? "events" : r.deptId?.endsWith("-hk") ? "hk" : r.deptId ? "eng" : "fnb");
const categoryOf = (d: FinDept): FinCategory => FIN_DEPTS.find((x) => x.id === d)!.category;

// ---- Invoices ------------------------------------------------------------------------------------------------------

export interface InvoiceLineView {
  ingredientId: string;
  name: string;
  unit: string;
  ordered: number;
  received: number;
  invoiced: number;
  poPrice: number;
  invoicePrice: number;
  issues: MatchIssue[];
  /** Invoiced beyond what was received at the agreed price. A difference to check, not a finding of wrongdoing. */
  overcharge: number;
}

export interface InvoiceView {
  id: string;
  source: "delivery" | "tyll";
  propertyId: string;
  currency: Currency;
  supplierId: string;
  supplierName: string;
  supplierRef: string;
  poNumber: string;
  requestId?: string;
  date: string;
  dept: FinDept;
  lines: InvoiceLineView[];
  total: number;
  poValue: number;
  receivedValue: number;
  overcharge: number;
  status: InvoiceStatus;
  corrected: boolean;
  history: { at: string; by: string; action: string; note?: string }[];
}

const OPEN: InvoiceStatus[] = ["to_check", "matched", "flagged", "correction_requested", "approved"];
const NEEDS_CHECK: InvoiceStatus[] = ["to_check", "flagged", "correction_requested", "matched"];

function view(base: Omit<InvoiceView, "lines" | "total" | "poValue" | "receivedValue" | "overcharge" | "currency" | "supplierName">, raw: Omit<InvoiceLineView, "issues" | "overcharge" | "name" | "unit">[]): InvoiceView {
  const lines = raw.map((l) => {
    const m = matchDeliveryLine({ ingredientId: l.ingredientId, ordered: l.ordered, delivered: l.received, invoiced: l.invoiced, poPrice: l.poPrice, invoicePrice: l.invoicePrice });
    const g = ingredientById[l.ingredientId];
    return { ...l, name: g.name, unit: g.unit, issues: m.issues, overcharge: m.overcharge };
  });
  return {
    ...base, lines, currency: propertyById[base.propertyId].currency, supplierName: supplierById[base.supplierId]?.name ?? base.supplierId,
    total: r2(lines.reduce((s, l) => s + l.invoiced * l.invoicePrice, 0)), poValue: r2(lines.reduce((s, l) => s + l.ordered * l.poPrice, 0)),
    receivedValue: r2(lines.reduce((s, l) => s + l.received * l.poPrice, 0)), overcharge: r2(lines.reduce((s, l) => s + l.overcharge, 0)),
  };
}

/** Invoices for the dataset's delivered orders, with any review accounting has made. */
function datasetInvoices(s: Shape, props: Set<string>): InvoiceView[] {
  return getDataset().deliveries.filter((d) => d.status === "delivered" && props.has(d.propertyId)).map((d) => {
    const id = `INV-${d.id.replace(/^PO-/, "")}`;
    const review: InvoiceReview | undefined = s.finance.reviews[id];
    const raw = d.lines.map((l) => {
      const c = review?.corrected?.find((x) => x.ingredientId === l.ingredientId);
      return { ingredientId: l.ingredientId, ordered: l.ordered, received: l.delivered, invoiced: c ? c.qty : l.invoiced, poPrice: l.poPrice, invoicePrice: c ? c.unitPrice : l.invoicePrice };
    });
    const first = view({ id, source: "delivery", propertyId: d.propertyId, supplierId: d.supplierId, supplierRef: `${d.supplierId.toUpperCase()}-${d.id.split("-")[2]}`, poNumber: d.id, date: d.date, dept: "fnb", status: "posted", corrected: !!review?.corrected, history: [] }, raw);
    // Without a review: a matching invoice was recorded before the demo; one with a difference waits for a check.
    const status = review?.status ?? (first.overcharge > 0 ? "to_check" : "posted");
    const history = review?.history ?? (status === "posted" ? [{ at: `${d.date}T12:00:00.000Z`, by: "system", action: "Matched and recorded as an expense", note: "Demo history, before Tyll" }] : [{ at: `${d.date}T12:00:00.000Z`, by: "system", action: "Invoice received; it differs from the order or delivery" }]);
    return { ...first, status, history };
  });
}

function tyllInvoices(s: Shape, props: Set<string>): InvoiceView[] {
  return s.finance.invoices.filter((i) => props.has(i.propertyId)).map((i) => {
    const r = s.requests.find((x) => x.id === i.requestId)!;
    const raw = i.lines.map((l) => {
      const rl = r.lines.find((x) => x.ingredientId === l.ingredientId)!;
      return { ingredientId: l.ingredientId, ordered: rl.qty, received: rl.received ?? 0, invoiced: l.qty, poPrice: rl.unitPrice, invoicePrice: l.unitPrice };
    });
    return view({ id: i.id, source: "tyll", propertyId: i.propertyId, supplierId: i.supplierId, supplierRef: i.supplierRef, poNumber: i.poNumber, requestId: i.requestId, date: i.date, dept: deptOfRequest(r), status: i.status, corrected: !!i.original, history: i.history }, raw);
  });
}

const allInvoices = (s: Shape, props: Set<string>) => [...tyllInvoices(s, props), ...datasetInvoices(s, props)].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? 1 : -1));

export function invoicesFor(user: User, propertyId?: string): Result<{ invoices: InvoiceView[]; toInvoice: { requestId: string; poNumber: string; propertyId: string; supplierId: string; supplierName: string; receivedValue: number; currency: Currency }[] }> {
  if (!can(user, "finance.view")) return fail(403, "Your role cannot open finance records.");
  const props = new Set(allowedProperties(user).filter((p) => !propertyId || p === propertyId));
  const s = loadStore();
  // Received Tyll orders still waiting for a supplier's invoice, one per supplier on the order.
  const toInvoice = s.requests.filter((r) => r.status === "received" && props.has(r.propertyId)).flatMap((r) =>
    [...new Set(r.lines.map((l) => l.supplierId))].filter((sup) => !s.finance.invoices.some((i) => i.requestId === r.id && i.supplierId === sup)).map((sup) => ({
      requestId: r.id, poNumber: r.poNumber ?? r.id, propertyId: r.propertyId, supplierId: sup, supplierName: supplierById[sup]?.name ?? sup, currency: propertyById[r.propertyId].currency,
      receivedValue: r2(r.lines.filter((l) => l.supplierId === sup).reduce((t, l) => t + (l.received ?? 0) * l.unitPrice, 0)),
    })));
  return { ok: true, invoices: allInvoices(s, props), toInvoice };
}

export function invoiceById(user: User, id: string): Result<{ invoice: InvoiceView }> {
  if (!can(user, "finance.view")) return fail(403, "Your role cannot open finance records.");
  const inv = allInvoices(loadStore(), new Set(allowedProperties(user))).find((i) => i.id === id);
  return inv ? { ok: true, invoice: inv } : fail(404, "This invoice is not available.");
}

type LineIn = { ingredientId: string; qty: number; unitPrice: number };
function readLines(raw: unknown, allowed: Set<string>): Result<{ lines: LineIn[] }> {
  if (!Array.isArray(raw) || !raw.length) return fail(400, "Enter the invoiced lines.");
  const lines: LineIn[] = [];
  for (const x of raw as Record<string, unknown>[]) {
    const id = String(x.ingredientId);
    if (!allowed.has(id)) return fail(400, "That item is not on this order.");
    const qty = Number(x.qty), price = Number(x.unitPrice);
    if (!Number.isFinite(qty) || qty < 0 || qty > 100000 || !Number.isFinite(price) || price < 0 || price > 100000) return fail(400, `Check the quantity and price for ${ingredientById[id].name}.`);
    lines.push({ ingredientId: id, qty: r2(qty), unitPrice: r2(price) });
  }
  if (new Set(lines.map((l) => l.ingredientId)).size !== lines.length) return fail(400, "Each item can appear once.");
  return { ok: true, lines };
}

/** Accounting enters a supplier's invoice for a received Tyll order. Simulated: no invoice arrives electronically. */
export function recordInvoice(user: User, body: Record<string, unknown>): Result<{ invoice: InvoiceView }> {
  if (!can(user, "finance.review")) return fail(403, "Only accounting can record supplier invoices.");
  const s = loadStore();
  const r = s.requests.find((x) => x.id === body.requestId);
  if (!r || !allowedProperties(user).includes(r.propertyId)) return fail(404, "This order is not available.");
  if (r.status !== "received") return fail(409, "Record the delivery before the invoice, so the three figures can be compared.");
  const supplierId = String(body.supplierId ?? "");
  const mine = r.lines.filter((l) => l.supplierId === supplierId);
  if (!mine.length) return fail(400, "That supplier is not on this order.");
  if (s.finance.invoices.some((i) => i.requestId === r.id && i.supplierId === supplierId)) return fail(409, "An invoice from this supplier is already recorded for this order.");
  const ref = text(body.supplierRef, 40);
  if (ref.length < 2) return fail(400, "Enter the supplier's invoice number.");
  if (s.finance.invoices.some((i) => i.supplierId === supplierId && i.supplierRef.toLowerCase() === ref.toLowerCase())) return fail(409, `Invoice ${ref} from this supplier is already recorded.`);
  const read = readLines(body.lines, new Set(mine.map((l) => l.ingredientId)));
  if (!read.ok) return read;
  const id = mutateStore((x) => {
    const n = nextNumber(x, `INV-${r.propertyId.toUpperCase()}`);
    const inv: TyllInvoice = { id: `INV-${r.propertyId.toUpperCase()}-${String(n).padStart(4, "0")}`, propertyId: r.propertyId, requestId: r.id, poNumber: r.poNumber ?? r.id, supplierId, supplierRef: ref, date: DEMO_TODAY, lines: read.lines, status: "to_check", recordedBy: user.id, history: [{ at: now(), by: user.id, action: "Supplier invoice recorded", note: "Entered from the supplier's document. Simulated in this demo." }] };
    x.finance.invoices.push(inv);
    return inv.id;
  });
  const inv = invoiceById(user, id);
  if (!inv.ok) return inv;
  // A clean match is marked so; any difference stays to check.
  if (inv.invoice.overcharge === 0 && inv.invoice.lines.every((l) => !l.issues.includes("price_above_po"))) {
    mutateStore((x) => { const i = x.finance.invoices.find((y) => y.id === id)!; i.status = "matched"; });
    return invoiceById(user, id);
  }
  return inv;
}

/** Review steps. Every step records who, when and why; the original figures are never overwritten. */
export function invoiceAction(user: User, id: string, body: Record<string, unknown>): Result<{ invoice: InvoiceView }> {
  if (!can(user, "finance.review")) return fail(403, "Only accounting can review invoices.");
  const cur = invoiceById(user, id);
  if (!cur.ok) return cur;
  const inv = cur.invoice;
  if (body.expect !== undefined && body.expect !== inv.status) return fail(409, "Someone else updated this invoice. Refresh and try again.");
  if (inv.status === "posted" && body.action !== "note") return fail(409, "This invoice is already recorded as an expense.");
  const action = String(body.action ?? "");
  const note = text(body.note);
  let to: InvoiceStatus = inv.status;
  let label = "";
  let lines: LineIn[] | undefined;
  switch (action) {
    case "flag":
      if (note.length < 3) return fail(400, "Describe the difference.");
      to = "flagged"; label = "Difference flagged"; break;
    case "request_correction":
      if (note.length < 3) return fail(400, "Say what the supplier should correct.");
      to = "correction_requested"; label = "Correction requested from the supplier"; break;
    case "record_correction": {
      if (!["correction_requested", "flagged", "to_check"].includes(inv.status)) return fail(409, "Request a correction first.");
      const read = readLines(body.lines, new Set(inv.lines.map((l) => l.ingredientId)));
      if (!read.ok) return read;
      lines = read.lines;
      label = "Corrected invoice recorded"; break;
    }
    case "approve":
      if (!["to_check", "matched", "flagged", "correction_requested"].includes(inv.status)) return fail(409, "This invoice cannot be approved now.");
      if ((inv.overcharge > 0 || inv.lines.some((l) => l.issues.includes("price_above_po"))) && note.length < 10) return fail(409, "Differences remain. Resolve them, or approve with a note explaining why the difference is accepted.");
      to = "approved"; label = inv.overcharge > 0 ? "Approved with the difference accepted" : "Invoice approved"; break;
    case "post":
      if (inv.status !== "approved") return fail(409, "Approve the invoice before recording it as an expense.");
      to = "posted"; label = "Recorded as an expense in Tyll (demo). No payment is made or recorded."; break;
    case "note":
      if (note.length < 2) return fail(400, "Write a note first.");
      label = "Note"; break;
    default:
      return fail(400, "Unknown action.");
  }
  mutateStore((x) => {
    const entry = { at: now(), by: user.id, action: label, note: note || undefined };
    if (inv.source === "tyll") {
      const i = x.finance.invoices.find((y) => y.id === id)!;
      if (lines) { i.original = i.original ?? i.lines; i.lines = lines; }
      i.status = to;
      i.history.push(entry);
    } else {
      const rv: InvoiceReview = x.finance.reviews[id] ?? { status: inv.status, history: [...inv.history] };
      if (lines) rv.corrected = lines;
      rv.status = to;
      rv.history.push(entry);
      x.finance.reviews[id] = rv;
    }
  });
  // After a correction, the invoice is checked again against the order and the delivery.
  if (lines) {
    const again = invoiceById(user, id);
    if (!again.ok) return again;
    const clean = again.invoice.overcharge === 0 && again.invoice.lines.every((l) => !l.issues.includes("price_above_po"));
    mutateStore((x) => {
      if (inv.source === "tyll") x.finance.invoices.find((y) => y.id === id)!.status = clean ? "matched" : "to_check";
      else x.finance.reviews[id].status = clean ? "matched" : "to_check";
    });
  }
  return invoiceById(user, id);
}

// ---- Spending by stage ---------------------------------------------------------------------------------------------

export type SpendStage = "requested" | "committed" | "received" | "invoice" | "recorded";
export const STAGE_LABEL: Record<SpendStage, string> = { requested: "Requested, in approval", committed: "Approved order, not delivered", received: "Delivered, no invoice yet", invoice: "Invoice recorded, not yet an expense", recorded: "Recorded expense" };

export interface SpendEntry {
  id: string;
  ref: string;
  propertyId: string;
  dept: FinDept;
  category: FinCategory;
  date: string;
  supplier: string;
  description: string;
  amount: number;
  stage: SpendStage;
  source: "dataset" | "tyll" | "history";
  href?: string;
}

/** Every spending record for one hotel, each at its current stage and counted once. */
export function spendEntries(s: Shape, propertyId: string): SpendEntry[] {
  const props = new Set([propertyId]);
  const out: SpendEntry[] = [];
  for (const i of [...datasetInvoices(s, props), ...tyllInvoices(s, props)]) {
    out.push({ id: i.id, ref: i.poNumber, propertyId, dept: i.dept, category: categoryOf(i.dept), date: i.date, supplier: i.supplierName, description: `Invoice ${i.supplierRef}`, amount: i.total, stage: i.status === "posted" ? "recorded" : "invoice", source: i.source === "tyll" ? "tyll" : "dataset", href: `/finance?tab=invoices&invoice=${i.id}` });
  }
  for (const h of HISTORY_EXPENSES.filter((x) => x.propertyId === propertyId)) {
    out.push({ id: h.id, ref: h.id, propertyId, dept: h.dept, category: categoryOf(h.dept), date: h.date, supplier: h.supplier, description: `${h.description} (simulated history)`, amount: h.amount, stage: "recorded", source: "history" });
  }
  // Tyll orders: whatever part is not yet covered by an invoice, at its stage.
  for (const r of s.requests.filter((x) => x.propertyId === propertyId && !["draft", "rejected"].includes(x.status))) {
    const dept = deptOfRequest(r);
    for (const sup of new Set(r.lines.map((l) => l.supplierId))) {
      if (s.finance.invoices.some((i) => i.requestId === r.id && i.supplierId === sup)) continue;
      const ls = r.lines.filter((l) => l.supplierId === sup);
      const stage: SpendStage = r.status === "received" ? "received" : r.status === "approved" ? "committed" : "requested";
      const amount = r2(ls.reduce((t, l) => t + (stage === "received" ? l.received ?? 0 : l.qty) * l.unitPrice, 0));
      out.push({ id: `${r.id}-${sup}`, ref: r.poNumber ?? r.id, propertyId, dept, category: categoryOf(dept), date: r.updatedAt.slice(0, 10) > DEMO_TODAY ? DEMO_TODAY : r.updatedAt.slice(0, 10), supplier: supplierById[sup]?.name ?? sup, description: `${r.id}, ${ls.length} item${ls.length === 1 ? "" : "s"}`, amount, stage, source: "tyll", href: `/forecast?tab=approvals&request=${r.id}` });
    }
  }
  return out;
}

export interface BudgetRow {
  dept: FinDept;
  label: string;
  budget: number;
  recorded: number;
  invoices: number;
  committed: number;
  requested: number;
  /** Budget less recorded expenses. */
  remaining: number;
  /** Budget less recorded, invoiced and committed amounts: what is left if everything open is spent. */
  remainingIfSpent: number;
}

const inPeriod = (date: string, period: string) => (period === "week" ? date >= addDays(DEMO_TODAY, -6) && date <= DEMO_TODAY : date >= BUDGET_MONTH.from && date <= BUDGET_MONTH.to);

export function budgetRows(s: Shape, propertyId: string, period = "month"): BudgetRow[] {
  // Recorded expenses and the dataset's invoices count in their own month; Tyll's open orders count until settled.
  const entries = spendEntries(s, propertyId).filter((e) => !(e.stage === "recorded" || (e.stage === "invoice" && e.source === "dataset")) || inPeriod(e.date, period));
  return FIN_DEPTS.map((d) => {
    const mine = entries.filter((e) => e.dept === d.id);
    const sumOf = (st: SpendStage[]) => r2(mine.filter((e) => st.includes(e.stage)).reduce((t, e) => t + e.amount, 0));
    const budget = period === "month" ? BUDGETS[propertyId][d.id] : 0;
    const recorded = sumOf(["recorded"]), invoices = sumOf(["invoice"]), committed = sumOf(["committed", "received"]), requested = sumOf(["requested"]);
    return { dept: d.id, label: d.label, budget, recorded, invoices, committed, requested, remaining: r2(budget - recorded), remainingIfSpent: r2(budget - recorded - invoices - committed) };
  });
}

/** The budget figure Purchasing and approvers see on a request: the same records as Finance, for that department. */
export function budgetForRequest(propertyId: string, dept: FinDept, exceptId?: string) {
  const s = loadStore();
  const row = budgetRows({ ...s, requests: s.requests.filter((r) => r.id !== exceptId) }, propertyId).find((r) => r.dept === dept)!;
  // Tyll's own approved orders are shown as one figure; everything else already recorded or invoiced is "spent before".
  const tyll = spendEntries({ ...s, requests: s.requests.filter((r) => r.id !== exceptId) }, propertyId).filter((e) => e.dept === dept && e.source === "tyll" && e.stage !== "requested" && (e.stage !== "recorded" || inPeriod(e.date, "month")));
  const committed = r2(tyll.reduce((t, e) => t + e.amount, 0));
  const spentBefore = r2(row.recorded + row.invoices + row.committed - committed);
  return { month: BUDGET_MONTH.label, label: FIN_DEPT_LABEL[dept], budget: row.budget, spentBefore, committed, available: r2(row.budget - spentBefore - committed) };
}

// ---- Finance home and reports --------------------------------------------------------------------------------------

const readProperty = (user: User, raw: unknown): string | null => {
  const props = allowedProperties(user);
  const p = typeof raw === "string" ? raw : props[0];
  return props.includes(p) ? p : null;
};

export function financeHome(user: User, propertyId?: string): Result<{ approvals: number; invoices: number; overBudget: string[]; propertyId: string }> {
  if (!can(user, "finance.view")) return fail(403, "Your role cannot open finance records.");
  const p = readProperty(user, propertyId);
  if (!p) return fail(403, "This hotel is outside your access.");
  const s = loadStore();
  const props = new Set(allowedProperties(user));
  const approvals = can(user, "purchase.approveFinance") ? s.requests.filter((r) => r.status === "accounting" && props.has(r.propertyId) && r.createdBy !== user.id).length : 0;
  const invoices = allInvoices(s, new Set([p])).filter((i) => NEEDS_CHECK.includes(i.status) || i.status === "approved").length;
  const overBudget = budgetRows(s, p).filter((b) => b.remaining < 0 || b.remainingIfSpent < 0).map((b) => b.label);
  return { ok: true, approvals, invoices, overBudget, propertyId: p };
}

export function financeReport(user: User, q: { propertyId?: string; period?: string; dept?: string; category?: string }) {
  if (!can(user, "finance.view")) return fail(403, "Your role cannot open finance records.");
  const p = readProperty(user, q.propertyId);
  if (!p) return fail(403, "This hotel is outside your access.");
  const period = q.period === "week" ? "week" : "month";
  const s = loadStore();
  const dept = FIN_DEPTS.some((d) => d.id === q.dept) ? (q.dept as FinDept) : null;
  const category = q.category && q.category in CATEGORY_LABEL ? (q.category as FinCategory) : null;
  const entries = spendEntries(s, p).filter((e) => (!dept || e.dept === dept) && (!category || e.category === category) && (!(e.stage === "recorded" || (e.stage === "invoice" && e.source === "dataset")) || inPeriod(e.date, period)));
  const budgets = budgetRows(s, p, period).filter((b) => (!dept || b.dept === dept) && (!category || categoryOf(b.dept) === category));
  const invoices = allInvoices(s, new Set([p]));
  const exceptions = invoices.filter((i) => i.overcharge > 0 && i.status !== "posted").map((i) => ({ id: i.id, date: i.date, supplier: i.supplierName, poNumber: i.poNumber, amount: i.overcharge, status: i.status, issues: [...new Set(i.lines.flatMap((l) => l.issues))] }));
  // Event estimates are operational figures from the event plan, not recorded spending.
  const events = s.events.filter((e) => e.propertyId === p && isCommitted(e) && e.date >= DEMO_TODAY).map((e) => {
    const c = eventCost(e, coverage(e, s.assignments, s.support));
    return { id: e.id, name: e.name, date: e.date, guests: e.guests, food: c.food, drink: c.drink, labour: c.labour, total: c.total, revenue: c.revenue };
  });
  return { ok: true as const, propertyId: p, currency: propertyById[p].currency, period, month: BUDGET_MONTH.label, budgets, entries, exceptions, events };
}

/** One notice for the owner when a department is over budget on recorded spending, or a large invoice difference is open. */
export function financeAlerts(user: User): { id: string; text: string; href: string; action: string }[] {
  if (!can(user, "finance.view")) return [];
  const s = loadStore();
  const out: { id: string; text: string; href: string; action: string }[] = [];
  for (const p of allowedProperties(user)) {
    const over = budgetRows(s, p).filter((b) => b.remainingIfSpent < 0);
    if (over.length) out.push({ id: `fin-budget-${p}-${over.map((o) => o.dept).join("")}`, text: `${propertyById[p].name}: ${over[0].label} is set to exceed its ${BUDGET_MONTH.label} budget once open orders and invoices are recorded.`, href: `/finance?tab=reports&report=budget&propertyId=${p}`, action: "Review budget" });
    if (can(user, "finance.review")) {
      const big = allInvoices(s, new Set([p])).filter((i) => i.overcharge > 0 && NEEDS_CHECK.includes(i.status));
      if (big.length) out.push({ id: `fin-inv-${p}-${big.length}`, text: `${big.length} supplier invoice${big.length === 1 ? "" : "s"} at ${propertyById[p].name} differ from what was ordered or delivered.`, href: `/finance?tab=invoices&propertyId=${p}`, action: "Check invoices" });
    }
  }
  return user.role === "owner" ? out.filter((a) => a.id.startsWith("fin-budget")).slice(0, 1) : out;
}

export { OPEN as OPEN_INVOICE };
