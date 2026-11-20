"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowLeft, Check } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, EmptyState, Field, Note, Panel, TableWrap, Td, Th, TextArea, cn, rowClass, textLink, toast } from "@/components/ui";
import { ingredientById, outletById, propertyById } from "@/lib/data/catalog";
import { supplierName } from "@/lib/data/purchasing-rules";
import { deptById } from "@/lib/data/workforce";
import { allowedOutlets, can } from "@/lib/domain/access";
import { personName, useView } from "@/lib/hooks";
import { type RequestDetail, useMutate, useRequest, useRequests } from "@/lib/plan-hooks";
import type { PurchaseRequest, RequestStatus, User } from "@/lib/types";
import { DEMO_TIME_ZONE, DEMO_TODAY, addDays, dayIn, fmtDate, fmtMoney, fmtQty, timeIn, unitLabel } from "@/lib/util";
import { arrivalText, orderStage } from "@/lib/domain/order-stage";
import { supplierById } from "@/lib/data/catalog";
import Link from "next/link";
import { Choice } from "./parts";
import { MATCH_FLAG, PO_STATUS, awaitingDelivery, orderTotals, outstanding, packsText, poStatus } from "@/lib/domain/procurement";

export const STATUS: Record<RequestStatus, { label: string; tone: "neutral" | "warn" | "pos" | "neg" | "ink" }> = {
  draft: { label: "Draft", tone: "neutral" },
  purchasing: { label: "Waiting for purchasing", tone: "warn" },
  accounting: { label: "Waiting for accounting", tone: "warn" },
  fnb: { label: "Waiting for the F&B director", tone: "warn" },
  manager: { label: "Waiting for manager approval", tone: "warn" },
  approved: { label: "Approved, order placed", tone: "pos" },
  received: { label: "Received", tone: "pos" },
  rejected: { label: "Rejected", tone: "neg" },
  changes: { label: "Changes requested", tone: "ink" },
};

type Queue = "purchasing" | "accounting" | "fnb" | "manager" | "approved" | "delivery" | "returned" | "drafts" | "all";
const inQueue = (r: PurchaseRequest, q: Queue, user: User) =>
  q === "all" ? true
    : q === "approved" ? r.status === "approved" || r.status === "received"
      : q === "delivery" ? awaitingDelivery(r)
      : q === "returned" ? r.status === "rejected" || r.status === "changes"
        : q === "drafts" ? r.status === "draft" && (r.createdBy === user.id || can(user, "purchase.review"))
          : r.status === q;

const total = (r: PurchaseRequest) => r.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
const suppliersOf = (r: PurchaseRequest) => [...new Set(r.lines.map((l) => supplierById[l.supplierId]?.name ?? supplierName(l.supplierId)))].join(", ");
const approverOf = (r: PurchaseRequest) => r.history.find((h) => h.action === "Purchasing review approved")?.by;
const arrival = (r: PurchaseRequest) => arrivalText(r.expectedAt, fmtDate, addDays(DEMO_TODAY, 1));
const unitOf = (g: string) => (ingredientById[g].unit === "each" ? "units" : ingredientById[g].unit);
const where = (r: PurchaseRequest) => (r.deptId ? deptById[r.deptId]?.name ?? r.deptId : r.eventId ? "Event" : r.outletIds.length === 1 ? outletById[r.outletIds[0]].name : r.supplierId ? "Main store" : `${r.outletIds.length} outlets`);
/** Times are the hotel's local time, whoever looks at them and from wherever. */
export const hotelTime = (iso?: string, timeZone = DEMO_TIME_ZONE) => (iso ? timeIn(timeZone, new Date(iso)) : "");
const hotelDate = (iso: string, timeZone = DEMO_TIME_ZONE) => dayIn(timeZone, new Date(iso));
/** When a supplier's order is due, or the period an older request covers. */
const forWhen = (r: PurchaseRequest, withDay = false) => (r.deliveryDate ? `Delivery ${fmtDate(r.deliveryDate, withDay)}` : `${fmtDate(r.period.from, withDay)}${r.period.to !== r.period.from ? ` to ${fmtDate(r.period.to, withDay)}` : ""}`);

/** Purchase requests and their approvals. Finance opens the same list and records from its own page. */
export function Approvals({ base = "/forecast?tab=approvals" }: { base?: string }) {
  const params = useSearchParams();
  const id = params.get("request");
  return id ? <RequestView id={id} base={base} /> : <RequestList base={base} />;
}

function RequestList({ base }: { base: string }) {
  const { user } = useView();
  const router = useRouter();
  const params = useSearchParams();
  const { data, error } = useRequests();
  const requests = useMemo(() => data?.requests ?? [], [data]);
  const preferred: Queue = (params.get("queue") as Queue) ?? (can(user, "purchase.review") ? "purchasing" : can(user, "purchase.approveFinance") ? "accounting" : user.role === "fnb_director" ? "fnb" : "all");
  const [queue, setQueue] = useState<Queue>(preferred);
  // A number at the top of Orders opens its queue.
  const asked = params.get("queue") as Queue | null;
  const [seen, setSeen] = useState(asked);
  if (asked !== seen) { setSeen(asked); if (asked) setQueue(asked); }
  useEffect(() => { if (asked) requestAnimationFrame(() => document.getElementById("order-list")?.scrollIntoView({ block: "start", behavior: "smooth" })); }, [asked]);
  const count = (q: Queue) => requests.filter((r) => inQueue(r, q, user)).length;
  const queues: { value: Queue; label: string }[] = [
    { value: "all", label: `All (${count("all")})` },
    { value: "purchasing", label: `Waiting for purchasing (${count("purchasing")})` },
    { value: "accounting", label: `Waiting for accounting (${count("accounting")})` },
    ...(count("fnb") || can(user, "purchase.approveFnb") ? [{ value: "fnb" as Queue, label: `Waiting for the F&B director (${count("fnb")})` }] : []),
    ...(count("manager") || can(user, "purchase.approveManager") ? [{ value: "manager" as Queue, label: `Waiting for manager (${count("manager")})` }] : []),
    { value: "approved", label: `Purchase orders (${count("approved")})` },
    { value: "delivery", label: `Awaiting delivery (${count("delivery")})` },
    { value: "returned", label: `Rejected or changes requested (${count("returned")})` },
    ...(can(user, "purchase.create") ? [{ value: "drafts" as Queue, label: `My drafts (${count("drafts")})` }] : []),
  ];
  const shown = requests.filter((r) => inQueue(r, queue, user));
  // Empty filters stay out of the way. All, and whichever filter is chosen, always show.
  const usefulQueues = queues.filter((q) => q.value === "all" || q.value === queue || count(q.value) > 0);
  return (
    <div id="order-list" className="scroll-mt-24 space-y-5">
      {usefulQueues.length > 1 && <Choice label="Show" value={queue} options={usefulQueues} onChange={setQueue} />}
      <Panel flush>
        {error ? <div className="p-6"><EmptyState title="Requests could not be loaded">{error}</EmptyState></div>
          : !data ? <div className="p-6"><EmptyState title="Loading requests" /></div>
            : shown.length === 0 ? <div className="p-6"><EmptyState title="Nothing here" action={can(user, "purchase.create") ? <Button onClick={() => router.push("/forecast?tab=buy")}>Plan what to buy</Button> : undefined}>No requests in this list.</EmptyState></div> : (
              <TableWrap>
                <table className="w-full min-w-[980px] text-sm">
                  <thead><tr><Th>Order</Th><Th>For</Th><Th>Supplier</Th><Th>Created by</Th><Th>Approved by</Th><Th align="right">Value</Th><Th>Status</Th><Th>Arrival</Th></tr></thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr key={r.id} className={cn(rowClass, "cursor-pointer")} onClick={() => router.push(`${base}&request=${r.id}`)}>
                        <Td><button type="button" className="num whitespace-nowrap text-ink underline-offset-4 hover:underline" onClick={(e) => { e.stopPropagation(); router.push(`${base}&request=${r.id}`); }}>{r.id}</button><span className="block text-xs text-steel">{r.lines.length} item{r.lines.length === 1 ? "" : "s"}</span></Td>
                        <Td>{where(r)}<span className="block text-xs text-steel">{forWhen(r)}</span></Td>
                        <Td>{suppliersOf(r)}</Td>
                        <Td>{r.auto ? <Badge tone="accent">Automatic</Badge> : personName(r.createdBy)}</Td>
                        <Td>{r.auto?.decision === "sent" ? "Automatic rule" : approverOf(r) ? personName(approverOf(r)!) : <span className="text-steel">Not yet</span>}</Td>
                        <Td align="right">{fmtMoney(total(r), propertyById[r.propertyId].currency)}</Td>
                        <Td><OrderBadge r={r} /></Td>
                        <Td className={cn("whitespace-nowrap", orderStage(r) === "late" ? "font-medium text-neg" : "text-graphite")}>{arrival(r) || <span className="text-steel">Not sent</span>}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
        <Note className="px-6 py-4">Requests are stored on the Tyll server, so every department sees the same record. No order is sent to a real supplier.</Note>
      </Panel>
      {(can(user, "purchase.review") || can(user, "purchase.approveFinance") || can(user, "purchase.approveFnb") || can(user, "purchase.approveManager")) && <ExportLinks propertyId={requests[0]?.propertyId ?? "lis"} />}
    </div>
  );
}

/** The path a request takes at its hotel, with when each step happened. */
function Progress({ d }: { d: RequestDetail }) {
  const r = d.request;
  const names: Record<string, string> = { purchasing: "Purchasing review", accounting: "Accounting review", fnb: d.policy.fnbLabel, manager: d.policy.managerLabel };
  const stepsDone = (s: string) => r.history.find((h) => h.action.toLowerCase().startsWith(names[s]?.toLowerCase() ?? s) && h.action.endsWith("approved"));
  const submitted = r.history.find((h) => h.action.startsWith("Submitted") || h.action.startsWith("Resubmitted"));
  const auto = r.auto?.decision === "sent";
  const items = [
    { key: "draft", label: r.auto ? "Created automatically" : "Draft", at: r.history[0]?.at, done: true },
    ...(auto ? [] : [{ key: "submitted", label: "Submitted", at: submitted?.at, done: !!submitted }, ...d.steps.map((s) => ({ key: s, label: names[s], at: stepsDone(s)?.at, done: !!stepsDone(s) }))]),
    { key: "approved", label: auto ? "Approved by the rule" : "Approved", at: r.history.find((h) => h.status === "approved")?.at, done: r.status === "approved" || r.status === "received" },
    { key: "sent", label: "Sent", at: r.history.find((h) => h.action.startsWith("Sent to") || h.action.startsWith("Emailed to") || h.action.startsWith("Order logged for"))?.at, done: !!r.sentAt },
    { key: "delivered", label: d.poStatus === "partly_received" ? "Partly received" : orderStage(r) === "short" ? "Delivered short" : "Delivered", at: r.history.find((h) => h.status === "received")?.at ?? r.receipts?.[0]?.at, done: r.status === "received" || d.poStatus === "partly_received" },
    ...(r.closed ? [{ key: "closed", label: "Closed", at: r.closed.at, done: true }] : []),
  ];
  const time = hotelTime;
  return (
    <ol className="flex flex-wrap items-start gap-x-2 gap-y-3 text-[13px]">
      {items.map((s, i) => (
        <li key={s.key} className="flex items-center gap-2">
          {i > 0 && <span className={cn("h-px w-6", s.done ? "bg-accent" : "bg-line")} aria-hidden />}
          <span className={cn("flex h-6 w-6 items-center justify-center rounded-full border", s.done ? "border-accent bg-accent text-on-accent" : "border-line text-fog")}>{s.done ? <Check size={13} /> : i + 1}</span>
          <span><span className={s.done ? "text-ink" : "text-steel"}>{s.label}</span>{s.at && <span className="block text-xs text-steel">{time(s.at)}</span>}</span>
        </li>
      ))}
      {(r.status === "rejected" || r.status === "changes") && <li><Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge></li>}
    </ol>
  );
}

/** The purchase order's status in one word everyone reads the same way, or Late when the supplier has missed its time. */
export function OrderBadge({ r }: { r: PurchaseRequest }) {
  if (orderStage(r) === "late") return <Badge tone="neg">Late</Badge>;
  const s = PO_STATUS[poStatus(r)];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

const KINDS = [["purchase_orders", "Approved purchase orders"], ["receipts", "Goods receipts"], ["invoices", "Supplier invoices"]] as const;
/** Procurement export: CSV for spreadsheets, JSON for a group procurement platform, and the field list for mapping. */
function ExportLinks({ propertyId }: { propertyId: string }) {
  return (
    <Panel title="Procurement export" description="For the group's procurement or accounting system. One row per line in CSV; one record per document, with its lines, in JSON.">
      <ul className="divide-y divide-hair text-table">
        {KINDS.map(([k, label]) => (
          <li key={k} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="text-ink">{label}</span>
            <span className="flex gap-4">
              <a className={textLink} href={`/api/procurement/export?kind=${k}&propertyId=${propertyId}&format=csv`}>CSV</a>
              <a className={textLink} href={`/api/procurement/export?kind=${k}&propertyId=${propertyId}&format=json`}>JSON</a>
              <a className={textLink} href={`/api/procurement/export?kind=${k}&fields=1`} target="_blank" rel="noreferrer">Fields</a>
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Who the order goes to, when, where it is delivered and booked. The author can change it while it is a draft. */
function PoDetails({ d, editable }: { d: RequestDetail; editable: boolean }) {
  const r = d.request;
  const mutate = useMutate();
  const [date, setDate] = useState(r.deliveryDate ?? "");
  const [cc, setCc] = useState(r.costCentre ?? "");
  const [notes, setNotes] = useState(r.comment ?? "");
  const [busy, setBusy] = useState(false);
  const s = d.supplier;
  const money = (n: number) => fmtMoney(n, d.currency);
  const dirty = date !== (r.deliveryDate ?? "") || cc !== (r.costCentre ?? "") || notes !== (r.comment ?? "");
  const save = async () => {
    setBusy(true);
    const res = await mutate(`/api/purchasing/${r.id}`, { action: "update", deliveryDate: date || undefined, costCentre: cc || undefined, comment: notes });
    setBusy(false);
    if (!res.ok) toast.error(res.error); else toast.done("Order updated.");
  };
  const below = s && d.totals.net < s.minOrderValue;
  return (
    <Panel title="Purchase order" description={s ? `To ${s.name}. Prices are the agreed catalogue prices, before VAT.` : "An older request that mixes suppliers."} action={<a href={`/api/purchasing/${r.id}/pdf`} target="_blank" rel="noreferrer" className={textLink}>{r.sent ? "Open the PDF that was sent" : "Preview the PDF"}</a>}>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <div><dt className="text-xs text-steel">Supplier</dt><dd className="text-ink">{s?.name ?? suppliersOf(r)}</dd>{s && <dd className="text-xs text-steel">{s.contact}, {s.phone}, {s.orderEmail}</dd>}</div>
        {s && <div><dt className="text-xs text-steel">Delivers</dt><dd className="text-ink">{s.deliveryDays.map((x) => DAY[x]).join(", ")}; order by {s.cutOff}</dd><dd className="text-xs text-steel">Minimum order {money(s.minOrderValue)}. {s.paymentTerms}.</dd></div>}
        <div>
          <dt className="text-xs text-steel">Delivery date</dt>
          {editable ? <dd><input type="date" aria-label="Delivery date" value={date} min={addDays(DEMO_TODAY, 1)} onChange={(e) => setDate(e.target.value)} className="mt-1 h-9 rounded-full border border-line bg-paper px-3 text-sm" /></dd> : <dd className="text-ink">{r.deliveryDate ? fmtDate(r.deliveryDate, true) : fmtDate(r.period.from, true)}</dd>}
        </div>
        <div>
          <dt className="text-xs text-steel">Cost centre</dt>
          {editable ? <dd><select aria-label="Cost centre" value={cc} onChange={(e) => setCc(e.target.value)} className="mt-1 h-9 rounded-full border border-line bg-paper px-3 text-sm">{d.costCentres.map((c) => <option key={c} value={c}>{c}</option>)}</select></dd> : <dd className="text-ink">{r.costCentre ?? "Not set"}</dd>}
        </div>
        <div><dt className="text-xs text-steel">Deliver to</dt><dd className="text-ink">{r.outletIds.length === 1 ? outletById[r.outletIds[0]].name : "Main store, receiving dock"}</dd></div>
        <div className="sm:col-span-2">
          <dt className="text-xs text-steel">Notes for the supplier</dt>
          {editable ? <dd><textarea aria-label="Notes for the supplier" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="mt-1 w-full rounded-2xl border border-line bg-paper px-3 py-2 text-sm" /></dd> : <dd className="text-graphite">{r.comment || "None"}</dd>}
        </div>
      </dl>
      {below && <p className="mt-3 rounded-xl bg-warn-soft px-3 py-2 text-[13px] text-ink">This order is {money(d.totals.net)}, below {s!.name}&rsquo;s minimum order of {money(s!.minOrderValue)}. Add items or expect a delivery charge.</p>}
      {editable && dirty && <Button className="mt-3" variant="primary" disabled={busy} onClick={save}>Save changes</Button>}
    </Panel>
  );
}

/** Email the approved order to the supplier, with the PDF; or what was sent and when. */
function SendPanel({ d, user, run, busy }: { d: RequestDetail; user: User; run: (url: string, body: unknown, ok: string) => Promise<boolean>; busy: boolean }) {
  const r = d.request;
  if (!r.supplierId || !d.supplier) return null;
  if (r.sent) {
    return (
      <Panel title="Sent to the supplier (demo: logged, not emailed)">
        <p className="text-sm text-ink">Prepared for {r.sent.to} on {fmtDate(r.sent.at.slice(0, 10), true)} at {r.sent.at.slice(11, 16)}, with {r.sent.pdf}, by {personName(r.sent.by)}.</p>
        <p className="mt-1 text-[13px] text-graphite">Expected {r.deliveryDate ? fmtDate(r.deliveryDate, true) : "on the next delivery day"}. The PDF is kept with the order.</p>
        <a href={`/api/purchasing/${r.id}/pdf`} target="_blank" rel="noreferrer" className={cn(textLink, "mt-3")}>Open the order PDF</a>
        <Note className="mt-3">In this demo the email is logged with its PDF and never sent: no supplier is contacted. With an email provider connected, this would say when the provider accepted it.</Note>
      </Panel>
    );
  }
  if (d.poStatus !== "approved" || !(can(user, "purchase.review") || r.createdBy === user.id)) return null;
  return (
    <Panel title="Send to the supplier">
      <p className="text-sm text-ink">Email {r.poNumber ?? r.id} to {d.supplier.orderEmail} as a PDF. A copy is kept with the order.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" disabled={busy} onClick={() => { if (window.confirm(`Send ${r.poNumber ?? r.id} to ${d.supplier!.name} (${d.supplier!.orderEmail})? In this demo the email is logged with its PDF, not sent.`)) void run(`/api/purchasing/${r.id}`, { action: "send" }, `${r.poNumber ?? r.id} logged for ${d.supplier!.name}. In this demo nothing is emailed.`); }}>Send the order</Button>
        <a href={`/api/purchasing/${r.id}/pdf`} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-full border border-line px-4 text-sm text-ink hover:bg-cloud">Preview the PDF</a>
      </div>
      <Note className="mt-3">In this demo the email is logged with its PDF, not sent.</Note>
    </Panel>
  );
}

/** Ordered, received and invoiced, line by line, with every difference in units and money, and the credit request. */
function MatchPanel({ d, user, run, busy }: { d: RequestDetail; user: User; run: (url: string, body: unknown, ok: string) => Promise<boolean>; busy: boolean }) {
  const r = d.request;
  const m = d.match;
  const [note, setNote] = useState("");
  if (!m || (!r.receipts?.length && !m.invoices.length)) return null;
  const money = (n: number) => fmtMoney(n, d.currency, { decimals: true });
  const unit = (g: string) => (ingredientById[g].unit === "each" ? "units" : ingredientById[g].unit === "l" ? "L" : "kg");
  const mayCredit = can(user, "purchase.review") || can(user, "finance.review") || can(user, "purchase.approveFnb");
  const mayClose = (can(user, "purchase.review") || can(user, "finance.review")) && r.status === "received" && !r.closed;
  const settled = m.invoices.some((i) => ["approved", "posted"].includes(i.status));
  return (
    <Panel title="Three way match" description="What was ordered, what arrived and what the supplier invoiced. Every difference in units and money." flush>
      <TableWrap>
        <table className="w-full min-w-[900px] text-table">
          <thead><tr><Th>Item</Th><Th align="right">Ordered</Th><Th align="right">Received</Th><Th align="right">Invoiced</Th><Th align="right">Order price</Th><Th align="right">Invoice price</Th><Th align="right">Difference</Th></tr></thead>
          <tbody>
            {m.lines.map((l) => (
              <tr key={l.ingredientId} className={rowClass}>
                <Td><span className="text-ink">{ingredientById[l.ingredientId].name}</span>{l.flags.length > 0 && <span className="mt-1 flex flex-wrap gap-1">{l.flags.map((f) => <Badge key={f} tone={f === "damaged" || f === "short" ? "warn" : "neg"}>{MATCH_FLAG[f]}</Badge>)}</span>}</Td>
                <Td align="right">{fmtQty(l.ordered, ingredientById[l.ingredientId].unit)}</Td>
                <Td align="right">{fmtQty(l.received, ingredientById[l.ingredientId].unit)}{l.damaged > 0 && <span className="block text-xs text-warn">{fmtQty(l.damaged, ingredientById[l.ingredientId].unit)} damaged</span>}</Td>
                <Td align="right">{m.invoices.length ? fmtQty(l.invoiced, ingredientById[l.ingredientId].unit) : <span className="text-steel">No invoice</span>}{l.unitsOver > 0 && <span className="block text-xs text-neg">{l.unitsOver} {unit(l.ingredientId)} not received</span>}</Td>
                <Td align="right">{money(l.orderPrice)}{l.agreedPrice !== undefined && Math.abs(l.agreedPrice - l.orderPrice) > 0.004 && <span className="block text-xs text-steel">agreed {money(l.agreedPrice)}</span>}</Td>
                <Td align="right" className={l.flags.includes("price_above_order") ? "font-medium text-neg" : undefined}>{m.invoices.length ? money(l.invoicePrice) : <span className="text-steel">None</span>}</Td>
                <Td align="right" className={l.difference > 0 ? "font-medium text-neg" : "text-ink"}>{l.difference > 0 ? money(l.difference) : "None"}{l.difference > 0 && <span className="block text-xs text-steel">{l.qtyMoney > 0 ? `${money(l.qtyMoney)} units` : ""}{l.qtyMoney > 0 && l.priceMoney > 0 ? ", " : ""}{l.priceMoney > 0 ? `${money(l.priceMoney)} price` : ""}</span>}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      <div className="flex flex-wrap items-baseline justify-between gap-3 px-5 py-4 text-sm sm:px-6">
        <span className="text-graphite">Ordered {money(m.ordered)} · received {money(m.received)} · invoiced {m.invoices.length ? money(m.invoiced) : "not yet"}</span>
        <span className="text-ink">Difference <span className={cn("num ms-2 text-[18px]", m.difference > 0 ? "text-neg" : "text-ink")}>{money(m.difference)}</span></span>
      </div>
      {!m.invoices.length && <Note className="px-6 pb-4">Waiting for the supplier&rsquo;s invoice. Accounting records it under Deliveries and invoices; the match then fills in.</Note>}
      {m.invoices.length > 0 && <p className="px-6 pb-2 text-xs text-steel">Invoice {m.invoices.map((i) => `${i.supplierRef} (${i.status.replace("_", " ")})`).join(", ")}. A difference is something to check with the supplier, not a finding about anyone.</p>}
      {(r.credits ?? []).map((c) => (
        <div key={c.id} className="mx-5 mb-4 rounded-2xl border border-line bg-cloud px-4 py-3 sm:mx-6">
          <p className="flex flex-wrap items-center justify-between gap-2 text-sm"><span className="font-medium text-ink">Credit request {c.id}, {money(c.amount)}</span><Badge tone={c.status === "sent" ? "pos" : "neutral"}>{c.status === "sent" ? "Sent (logged)" : "Draft"}</Badge></p>
          <pre className="mt-2 whitespace-pre-wrap font-sans text-[13px] text-graphite">{`To: ${c.to}\nSubject: ${c.subject}\n\n${c.body}`}</pre>
          {c.status === "draft" && mayCredit && <div className="mt-2 flex gap-2"><Button size="sm" variant="primary" disabled={busy} onClick={() => run(`/api/purchasing/${r.id}`, { action: "credit_send", creditId: c.id }, "Credit request sent to the supplier. Logged in this demo, not sent.")}>Send to the supplier</Button><Button size="sm" onClick={() => navigator.clipboard?.writeText(`${c.subject}\n\n${c.body}`).then(() => toast.done("Copied."))}>Copy</Button></div>}
        </div>
      ))}
      <div className="flex flex-wrap gap-2 px-5 pb-5 sm:px-6">
        {mayCredit && m.invoices.length > 0 && m.difference > 0 && !(r.credits ?? []).some((c) => c.status === "draft") && <Button variant="primary" disabled={busy} onClick={() => run(`/api/purchasing/${r.id}`, { action: "credit" }, "Credit request drafted. Check it, then send it.")}>Draft credit request</Button>}
        {mayClose && (
          <span className="flex flex-wrap items-center gap-2">
            {!settled && <input aria-label="Why close without an approved invoice" placeholder="Why close it now?" value={note} onChange={(e) => setNote(e.target.value)} className="h-10 w-56 rounded-full border border-line px-3 text-sm" />}
            <Button disabled={busy} onClick={() => run(`/api/purchasing/${r.id}`, { action: "close", note }, "Order closed.")}>Close the order</Button>
          </span>
        )}
      </div>
    </Panel>
  );
}

/** Every delivery against the order: what arrived, what was refused as damaged, batch and use-by date. */
function Receipts({ r }: { r: PurchaseRequest }) {
  if (!r.receipts?.length) return null;
  return (
    <Panel title="Deliveries" description="Partial deliveries add up. Only accepted goods entered stock.">
      <ul className="space-y-3">
        {r.receipts.map((rc) => (
          <li key={rc.id} className="text-sm">
            <p className="flex flex-wrap justify-between gap-2"><span className="num font-medium text-ink">{rc.id}</span><span className="text-xs text-steel">{fmtDate(rc.at.slice(0, 10), true)} {rc.at.slice(11, 16)}, {personName(rc.by)}{rc.final ? ", order closed for delivery" : ""}</span></p>
            <ul className="mt-1 space-y-0.5 text-[13px] text-graphite">
              {rc.lines.map((l) => <li key={l.ingredientId}>{ingredientById[l.ingredientId].name}: {fmtQty(l.delivered, ingredientById[l.ingredientId].unit)} arrived{l.damaged > 0 ? `, ${fmtQty(l.damaged, ingredientById[l.ingredientId].unit)} damaged and refused` : ""}{l.batch ? `, batch ${l.batch}` : ""}{l.expiry ? `, use by ${fmtDate(l.expiry, true)}` : ""}{l.note ? `. ${l.note}` : ""}</li>)}
            </ul>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function RequestView({ id, base }: { id: string; base: string }) {
  const { user } = useView();
  const router = useRouter();
  const { data, error } = useRequest(id);
  const mutate = useMutate();
  const [edits, setEdits] = useState<Record<string, { qty?: number; supplierId?: string; reason?: string }>>({});
  const [comment, setComment] = useState("");
  const [recv, setRecv] = useState<Record<string, { delivered?: number; damaged?: number; batch?: string; expiry?: string }>>({});
  const [final, setFinal] = useState(false);
  const [busy, setBusy] = useState(false);
  // One action at a time: a double click must not post twice before the button disables.
  const inflight = useRef(false);
  const sent = useSearchParams().get("sent") === "1";
  if (data === undefined && !error) return <Panel><EmptyState title="Loading the request" /></Panel>;
  if (!data) return <Panel><EmptyState title="This request is not available" action={<Button onClick={() => router.push(base)}>Back to approvals</Button>}>It does not exist, or it is outside your access.</EmptyState></Panel>;
  const r = data.request;
  const money = (n: number) => fmtMoney(n, propertyById[r.propertyId].currency, { decimals: true });
  const author = r.createdBy === user.id && (r.status === "draft" || r.status === "changes");
  const reviewing = (r.status === "purchasing" && can(user, "purchase.review")) || (r.status === "accounting" && can(user, "purchase.approveFinance")) || (r.status === "fnb" && (can(user, "purchase.approveFnb") || can(user, "purchase.approveManager"))) || (r.status === "manager" && can(user, "purchase.approveManager"));
  const stage = r.status as "purchasing" | "accounting" | "fnb" | "manager";
  const editableBy = author ? "author" : r.status === "purchasing" && can(user, "purchase.review") ? "purchasing" : null;
  const mayReceive = r.status === "approved" && (can(user, "purchase.receive") || (can(user, "stock.count") && r.outletIds.some((o) => allowedOutlets(user).includes(o))));
  const lineQty = (g: string, q: number) => edits[g]?.qty ?? q;
  const lineSupplier = (g: string, s: string) => edits[g]?.supplierId ?? s;
  const priceOf = (g: string, s: string, fallback: number) => data.quotes[g]?.find((x) => x.supplierId === s)?.unitPrice ?? fallback;
  const liveTotal = r.lines.reduce((s, l) => s + lineQty(l.ingredientId, l.qty) * priceOf(l.ingredientId, lineSupplier(l.ingredientId, l.supplierId), l.unitPrice), 0);
  const afterBudget = data.budget.available - liveTotal;
  const showMoney = user.role !== "chef";

  const m = data.match;
  const maySend = data.poStatus === "approved" && !r.sent && !!r.supplierId && !!data.supplier && (can(user, "purchase.review") || r.createdBy === user.id);
  const mayCredit = can(user, "purchase.review") || can(user, "finance.review") || can(user, "purchase.approveFnb");
  const creditDraft = (r.credits ?? []).some((c) => c.status === "draft");
  const step: Step | null = author
    ? { title: r.status === "changes" ? "Update the request and send it again" : "Send this request to Purchasing", text: r.status === "changes" ? "Changes were asked for. Adjust the quantities, then send it back." : "Check the quantities, then send it. Purchasing reviews it next.", target: "order-action", label: "Go to sending" }
    : reviewing
      ? { title: "Your approval is needed", text: `Check the items${showMoney ? " and the total" : ""}, then approve, ask for changes or reject.`, target: "order-action", label: "Go to approval" }
      : maySend
        ? { title: "Approved: email it to the supplier", text: `${data.supplier!.name} receives ${r.poNumber ?? r.id} as a PDF.`, target: "order-send", label: "Go to sending" }
        : mayReceive
          ? { title: "Record the delivery when it arrives", text: `Expected ${r.deliveryDate ? fmtDate(r.deliveryDate, true) : "on the next delivery day"}. Enter what arrived, anything damaged, the batch and the use-by date.`, target: "order-action", label: "Go to receiving" }
          : showMoney && mayCredit && m && m.invoices.length > 0 && m.difference > 0 && (creditDraft || !(r.credits ?? []).length)
            ? { title: creditDraft ? "Send the credit request" : `The invoice is ${money(m.difference)} above what arrived`, text: creditDraft ? "A credit request is drafted. Check it, then send it to the supplier." : "Draft a credit request from the three way match.", target: "order-match", label: "Go to the match" }
            : null;
  const waitingFor = !step && ["purchasing", "accounting", "fnb", "manager"].includes(r.status) ? STATUS[r.status].label : null;

  const run = async (url: string, body: unknown, ok: string) => {
    if (inflight.current) return false;
    inflight.current = true;
    setBusy(true);
    const res = await mutate(url, body).finally(() => { inflight.current = false; });
    setBusy(false);
    if (!res.ok) return toast.error(res.error), false;
    toast.done(ok);
    setEdits({});
    setComment("");
    return true;
  };
  const saveAuthor = (then?: "submit") => run("/api/purchasing", { id: r.id, comment: r.comment, lines: r.lines.map((l) => ({ ...l, qty: lineQty(l.ingredientId, l.qty), supplierId: lineSupplier(l.ingredientId, l.supplierId) })) }, "Draft saved.")
    .then((ok) => ok && then === "submit" && run(`/api/purchasing/${r.id}`, { action: "submit" }, `Request ${r.id} sent to Purchasing.`));
  const decide = (decision: "approve" | "changes" | "reject") => run(`/api/purchasing/${r.id}`, {
    action: stage, decision, comment,
    changes: stage === "purchasing" ? Object.entries(edits).map(([ingredientId, e]) => ({ ingredientId, qty: e.qty, supplierId: e.supplierId, reason: e.reason })) : undefined,
  }, decision === "approve" ? "Approved. The next reviewer can see it now." : decision === "changes" ? "Sent back for changes." : "Request rejected.");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push(base)}><ArrowLeft size={15} /> All requests</Button>
      </div>
      {step ? <NextStep step={step} /> : waitingFor && <p role="status" className="rounded-panel border border-line bg-cloud px-5 py-3 text-sm text-graphite"><span className="font-medium text-ink">{waitingFor}.</span> Nothing is needed from you now; you will be notified of the decision.</p>}
      <Panel
        title={<span className="flex flex-wrap items-center gap-3"><span className="num">{r.id}</span><OrderBadge r={r} />{r.poNumber && <Badge>{r.poNumber}</Badge>}{r.auto && <Badge tone="accent">Automatic</Badge>}</span>}
        description={`${where(r)}, ${propertyById[r.propertyId].name}. ${r.deliveryDate ? `Delivery ${fmtDate(r.deliveryDate, true)}` : `For ${fmtDate(r.period.from, true)}${r.period.to !== r.period.from ? ` to ${fmtDate(r.period.to, true)}` : ""}`}. ${r.auto ? `Created by automatic ordering on ${personName(r.createdBy)}'s rules.` : `Raised by ${personName(r.createdBy)}.`}`}
      >
        {sent && r.status !== "draft" && (
          <div role="status" className="mb-5 rounded-2xl border border-pos/25 bg-pos-soft px-5 py-4">
            <p className="text-sm font-medium text-ink">Request sent to Purchasing</p>
            <p className="mt-1 text-sm text-graphite">{r.id} · {r.lines.map((l) => `${ingredientById[l.ingredientId].name} ${l.qty} ${unitOf(l.ingredientId)}`).slice(0, 4).join(", ")}{r.lines.length > 4 ? ` and ${r.lines.length - 4} more` : ""}. Now with: {STATUS[r.status].label.toLowerCase()}. You will be notified of each decision.</p>
          </div>
        )}
        {r.auto && (
          <div className="mb-5 rounded-2xl border border-line bg-cloud px-5 py-4">
            <p className="text-sm font-medium text-ink">{r.auto.decision === "sent" ? `Ordered automatically at ${r.auto.runAt.slice(11, 16)} and sent without waiting` : `Created automatically at ${r.auto.runAt.slice(11, 16)}, waiting for approval`}</p>
            <p className="mt-1 text-sm text-graphite">{r.auto.decision === "sent" ? "Why it went straight to the supplier: " : "Why it waits: "}{r.auto.why} The quantities are the prediction&rsquo;s, with the reasoning on Predictions. In this demo nothing is sent to a supplier.</p>
          </div>
        )}
        <Progress d={data} />
        {orderStage(r) === "late" && (
          <div role="alert" className="mt-5 rounded-2xl border border-neg/25 bg-neg-soft px-5 py-4">
            <p className="text-sm font-medium text-ink">{suppliersOf(r)} was due {arrival(r)} and has not arrived.</p>
            <p className="mt-1 text-sm text-graphite">Items at risk tonight: {r.lines.map((l) => ingredientById[l.ingredientId].name).join(", ")}. Ask the supplier for a new time. If it cannot arrive in time, order from the backup supplier.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => toast.done(`Call ${suppliersOf(r)} and ask for a new arrival time. In this demo no call is made.`)}>Call supplier</Button>
              <Link prefetch={false} href={`/forecast?tab=buy&focus=${r.lines[0]?.ingredientId ?? ""}`} className="inline-flex h-9 items-center rounded-full border border-line px-4 text-[13px] text-ink hover:bg-cloud">Order from backup supplier</Link>
            </div>
          </div>
        )}
        {r.deliveryId && r.status === "received" && <p className="mt-4 text-sm"><Link prefetch={false} href={`/deliveries?delivery=${r.deliveryId}`} className="text-accent-ink underline-offset-4 hover:underline">See ordered, delivered and invoiced for {r.deliveryId}</Link></p>}
        <section className="mt-5">
          <h3 className="text-[13px] font-medium text-ink">Status history</h3>
          <ol className="mt-2 space-y-1.5 text-[13px]">
            {r.history.map((h, i) => <li key={i} className="flex gap-3"><span className="num w-28 shrink-0 text-steel">{fmtDate(hotelDate(h.at))} {hotelTime(h.at)}</span><span className="text-graphite"><span className="text-ink">{h.action}</span>, {personName(h.by)}{h.comment ? `. ${h.comment}` : ""}</span></li>)}
          </ol>
        </section>
        {r.comment && !r.supplierId && <p className="mt-4 text-sm text-graphite"><span className="text-steel">Comment: </span>{r.comment}</p>}
        {r.prepPlanId && <p className="mt-1 text-[13px] text-steel">Raised from prep plan {r.prepPlanId}.</p>}
      </Panel>

      {r.supplierId && <PoDetails key={`${r.id}-${r.updatedAt}`} d={data} editable={author} />}
      <Panel title="Items" flush>
        <TableWrap>
          <table className="w-full min-w-[900px] text-sm">
            <thead><tr><Th>Item</Th><Th align="right">Tyll suggested</Th><Th align="right">Available</Th><Th align="right">Quantity</Th><Th>Supplier</Th>{showMoney && <Th align="right">Unit price</Th>}{showMoney && <Th align="right">Line total</Th>}</tr></thead>
            <tbody>
              {r.lines.map((l) => {
                const g = l.ingredientId;
                const qty = lineQty(g, l.qty);
                const sup = lineSupplier(g, l.supplierId);
                const changed = qty !== l.qty || sup !== l.supplierId;
                return (
                  <tr key={g} className={rowClass}>
                    <Td className="text-ink">{ingredientById[g].name}{l.received !== undefined && <span className="block text-xs text-steel">received {fmtQty(l.received, ingredientById[g].unit)}</span>}</Td>
                    <Td align="right" className="num text-graphite">{fmtQty(l.suggested, ingredientById[g].unit)}{l.requirement > 0 && <span className="block text-xs text-steel">need {fmtQty(l.requirement, ingredientById[g].unit)}</span>}</Td>
                    <Td align="right" className="num text-graphite">{fmtQty(l.available + l.incoming, ingredientById[g].unit)}</Td>
                    <Td align="right">
                      {editableBy ? (
                        <span className="inline-flex flex-col items-end gap-1">
                          <span className="flex items-center gap-1.5"><input aria-label={`Quantity of ${ingredientById[g].name}`} type="number" min={0} step="any" value={qty} onChange={(e) => setEdits({ ...edits, [g]: { ...edits[g], qty: Math.max(0, Number(e.target.value)) } })} className="num h-9 w-24 rounded-xl border border-line px-2 text-end hover:border-fog" /><span className="w-8 text-start text-xs text-steel">{unitOf(g)}</span></span>
                          {editableBy === "purchasing" && changed && <input aria-label={`Reason for changing ${ingredientById[g].name}`} placeholder="Reason for the change" value={edits[g]?.reason ?? ""} onChange={(e) => setEdits({ ...edits, [g]: { ...edits[g], reason: e.target.value } })} className="h-8 w-48 rounded-lg border border-warn/40 px-2 text-xs" />}
                        </span>
                      ) : <span className="num">{fmtQty(l.qty, ingredientById[g].unit)}</span>}
                      {l.packSize && <span className="block text-xs text-steel">{packsText(qty, l.packSize, l.packLabel, unitLabel(unitOf(g)))}</span>}
                    </Td>
                    <Td>
                      {editableBy && !r.supplierId && (data.quotes[g]?.length ?? 0) > 1 ? (
                        <select aria-label={`Supplier for ${ingredientById[g].name}`} value={sup} onChange={(e) => setEdits({ ...edits, [g]: { ...edits[g], supplierId: e.target.value } })} className="h-9 max-w-[220px] rounded-full border border-line bg-paper px-3 text-[13px]">
                          {data.quotes[g].map((x) => <option key={x.supplierId} value={x.supplierId}>{x.name}{showMoney ? `, ${money(x.unitPrice)}` : ""}</option>)}
                        </select>
                      ) : <span className="text-graphite">{supplierName(sup)}</span>}
                    </Td>
                    {showMoney && <Td align="right" className="num">{money(priceOf(g, sup, l.unitPrice))}</Td>}
                    {showMoney && <Td align="right" className="num text-ink">{money(qty * priceOf(g, sup, l.unitPrice))}</Td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
        {showMoney && (() => {
          const t = orderTotals(r.lines.map((l) => ({ qty: lineQty(l.ingredientId, l.qty), unitPrice: priceOf(l.ingredientId, lineSupplier(l.ingredientId, l.supplierId), l.unitPrice), vatRate: l.vatRate })));
          const withVat = r.lines.some((l) => l.vatRate !== undefined);
          return (
            <dl className="ms-auto max-w-sm space-y-1 px-6 py-4 text-sm">
              <div className="flex justify-between gap-6"><dt className="text-graphite">{withVat ? "Net" : "Expected total"}</dt><dd className="num text-ink">{money(t.net)}</dd></div>
              {withVat && t.rates.map((v) => <div key={v.rate} className="flex justify-between gap-6"><dt className="text-graphite">VAT {Math.round(v.rate * 100)}% on {money(v.net)}</dt><dd className="num text-ink">{money(v.vat)}</dd></div>)}
              {withVat && <div className="flex justify-between gap-6 border-t border-hair pt-1.5"><dt className="font-medium text-ink">Total ({data.currency})</dt><dd className="num text-[20px] text-ink">{money(t.gross)}</dd></div>}
            </dl>
          );
        })()}
      </Panel>

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[1fr_1fr]">
        {(reviewing || author || mayReceive) && (
          <div id="order-action" className="scroll-mt-24"><Panel title={author ? "Your request" : mayReceive ? "Record the delivery" : stage === "purchasing" ? "Purchasing review" : stage === "accounting" ? "Accounting review" : stage === "fnb" ? `${data.policy.fnbLabel} approval` : `${data.policy.managerLabel} approval`}>
            {author && (
              <div className="space-y-3">
                {r.status === "changes" && <Note>{r.history.slice().reverse().find((h) => h.status === "changes")?.comment}</Note>}
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" disabled={busy} onClick={() => saveAuthor("submit")}>{r.status === "changes" ? "Send to Purchasing again" : "Send to Purchasing"}</Button>
                  <Button disabled={busy} onClick={() => saveAuthor()}>Save draft</Button>
                </div>
              </div>
            )}
            {reviewing && (
              <div className="space-y-3">
                {stage === "purchasing" && <p className="text-[13px] text-steel">Change quantities or suppliers in the table above. Each change needs a reason.</p>}
                <TextArea label="Comment" value={comment} onChange={(e) => setComment(e.target.value)} placeholder={stage === "accounting" ? "For example: within budget, approved" : "For example: checked against par levels"} />
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" disabled={busy} onClick={() => decide("approve")}>Approve</Button>
                  <Button disabled={busy} onClick={() => decide("changes")}>Request changes</Button>
                  <Button variant="ghost" disabled={busy} onClick={() => decide("reject")}>Reject</Button>
                </div>
                {r.createdBy === user.id && stage !== "purchasing" && <Note>You raised this request, so another approver must sign it off.</Note>}
              </div>
            )}
            {mayReceive && (
              <div className="space-y-3">
                <p className="text-[13px] text-steel">Enter what arrived. Damaged goods are refused and stay owed by the supplier; only the rest enters stock. Part of an order can arrive now and the rest later.</p>
                {r.lines.filter((l) => outstanding(l) > 0).map((l) => {
                  const g = l.ingredientId;
                  const v = recv[g] ?? {};
                  const set = (patch: Partial<typeof v>) => setRecv({ ...recv, [g]: { ...v, ...patch } });
                  return (
                    <fieldset key={g} className="rounded-2xl border border-line px-3 pb-3 pt-2">
                      <legend className="px-1 text-[13px] font-medium text-ink">{ingredientById[g].name} <span className="font-normal text-steel">still to come {fmtQty(outstanding(l), ingredientById[g].unit)}</span></legend>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <Field label="Arrived" suffix={unitOf(g)} type="number" min="0" step="any" value={v.delivered ?? outstanding(l)} onChange={(e) => set({ delivered: Number(e.target.value) })} />
                        <Field label="Damaged" suffix={unitOf(g)} type="number" min="0" step="any" value={v.damaged ?? 0} onChange={(e) => set({ damaged: Number(e.target.value) })} />
                        <Field label="Batch" value={v.batch ?? ""} onChange={(e) => set({ batch: e.target.value })} placeholder="On the label" />
                        <Field label="Use by" type="date" value={v.expiry ?? ""} onChange={(e) => set({ expiry: e.target.value })} />
                      </div>
                    </fieldset>
                  );
                })}
                <label className="flex items-start gap-2 text-[13px] text-graphite"><input type="checkbox" checked={final} onChange={(e) => setFinal(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]" />Nothing more is coming: close the order as delivered short.</label>
                <Button variant="primary" disabled={busy} onClick={async () => { if (await run(`/api/purchasing/${r.id}`, { action: "receive", final, lines: r.lines.filter((l) => outstanding(l) > 0).map((l) => ({ ingredientId: l.ingredientId, delivered: recv[l.ingredientId]?.delivered ?? outstanding(l), damaged: recv[l.ingredientId]?.damaged ?? 0, batch: recv[l.ingredientId]?.batch, expiry: recv[l.ingredientId]?.expiry })) }, "Delivery recorded. Stock is updated.")) { setRecv({}); setFinal(false); } }}>Record delivery</Button>
              </div>
            )}
          </Panel></div>
        )}

        <div id="order-send" className="scroll-mt-24 empty:hidden"><SendPanel d={data} user={user} run={run} busy={busy} /></div>
        {showMoney && <div id="order-match" className="scroll-mt-24 empty:hidden xl:col-span-2"><MatchPanel d={data} user={user} run={run} busy={busy} /></div>}
        <Receipts r={r} />
        {showMoney && (can(user, "purchase.review") || can(user, "purchase.approveFinance") || can(user, "purchase.approveFnb") || can(user, "purchase.approveManager")) && (
          <Panel title="Budget and approval rules" action={<Badge>Demo estimate</Badge>}>
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-steel">{data.budget.label} budget, {data.budget.month}</dt><dd className="num">{money(data.budget.budget)}</dd></div>
              <div className="flex justify-between"><dt className="text-steel">Recorded or invoiced this month</dt><dd className="num">{money(data.budget.spentBefore)}</dd></div>
              <div className="flex justify-between"><dt className="text-steel">Other approved Tyll orders</dt><dd className="num">{money(data.budget.committed)}</dd></div>
              <div className="flex justify-between border-t border-hair pt-2"><dt className="text-ink">Left after this request</dt><dd className={cn("num", afterBudget < 0 ? "text-neg" : "text-ink")}>{money(afterBudget)}</dd></div>
            </dl>
            <Note className="mt-3">The same figures as Reconciliation. Budgets are demo planning figures, not balances from an accounting system. Approving a request creates a commitment, not a recorded expense.</Note>
            <p className="mt-3 text-[13px] text-graphite">At {propertyById[r.propertyId].name}: purchasing reviews every order; accounting approves orders {data.policy.accountingAbove > 0 ? `over ${money(data.policy.accountingAbove)}` : "of any size"}; the {data.policy.fnbLabel} approves orders over {money(data.policy.fnbAbove)}; the {data.policy.managerLabel.toLowerCase()} also approves orders over {money(data.policy.managerAbove)}. Limits are before VAT. Nobody approves their own order.</p>
          </Panel>
        )}

        <Panel title="History and comments">
          <ul className="space-y-3">
            {r.history.slice().reverse().map((h, i) => (
              <li key={i} className="text-sm">
                <p className="flex flex-wrap justify-between gap-2"><span className="text-ink">{h.action}</span><span className="text-xs text-steel">{personName(h.by)} · {hotelTime(h.at)}</span></p>
                {h.comment && <p className="text-graphite">{h.comment}</p>}
                {h.changes?.map((c, j) => <p key={j} className="text-xs text-steel">{ingredientById[c.ingredientId].name}: {c.from !== c.to ? `${fmtQty(c.from, ingredientById[c.ingredientId].unit)} to ${fmtQty(c.to, ingredientById[c.ingredientId].unit)}. ` : ""}{c.reason}</p>)}
              </li>
            ))}
          </ul>
          <form className="mt-4 flex gap-2 border-t border-hair pt-4" onSubmit={async (e) => { e.preventDefault(); const form = e.currentTarget; const t = new FormData(form).get("c"); if (await run(`/api/purchasing/${r.id}`, { action: "comment", comment: t }, "Comment added.")) form.reset(); }}>
            <input name="c" aria-label="Add a comment" placeholder="Add a comment" className="h-10 flex-1 rounded-full border border-line px-4 text-sm hover:border-fog" />
            <Button type="submit" size="sm" disabled={busy}>Add</Button>
          </form>
        </Panel>
      </div>
    </div>
  );
}

interface Step { title: string; text: string; target: string; label: string }

/** The one thing this person needs to do on this order, at the top, with a button that jumps to it and moves focus there. */
function NextStep({ step }: { step: Step }) {
  const go = () => {
    const el = document.getElementById(step.target);
    if (!el) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Focus first: focusing after a smooth scroll starts cancels the scroll.
    el.querySelector<HTMLElement>("textarea, input, button, a[href]")?.focus({ preventScroll: true });
    el.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
  };
  return (
    <section aria-labelledby="next-step" className="flex flex-col gap-3 rounded-panel border-2 border-ink bg-paper px-5 py-4 shadow-panel sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div className="min-w-0">
        <p className="text-[13px] text-steel">Next step</p>
        <h2 id="next-step" className="text-lg font-semibold leading-snug text-ink">{step.title}</h2>
        <p className="mt-0.5 text-sm text-graphite">{step.text}</p>
      </div>
      <Button variant="primary" onClick={go} className="shrink-0">{step.label}<ArrowDown size={15} aria-hidden /></Button>
    </section>
  );
}
