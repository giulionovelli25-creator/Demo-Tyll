"use client";
// Tyll Finance: invoices checked three ways, spending by stage, budgets and a few clear reports.
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { useMemo, useState } from "react";
import { Timeline } from "@/components/timeline";
import { Badge, Button, EmptyState, Field, Note, Panel, Segmented, Select, Stat, TableWrap, Td, Th, cn, rowClass, toast, type Tone } from "@/components/ui";
import { CATEGORY_LABEL, FIN_DEPTS, FIN_DEPT_LABEL } from "@/lib/data/finance-rules";
import { ingredientById, propertyById } from "@/lib/data/catalog";
import { allowedOutlets, allowedProperties, can } from "@/lib/domain/access";
import { compare } from "@/lib/domain/metrics";
import { useLiveGet } from "@/lib/guest-hooks";
import { personName, useCtx, useInvestigations, useView } from "@/lib/hooks";
import { useMutate } from "@/lib/plan-hooks";
import type { BudgetRow, InvoiceView, SpendEntry } from "@/lib/server/finance";
import type { Currency, InvoiceStatus } from "@/lib/types";
import { DEMO_TODAY, downloadCsv, fmtMoney, fmtPct } from "@/lib/util";

export const INV_STATUS: Record<InvoiceStatus, { label: string; tone: Tone }> = {
  to_check: { label: "Difference to check", tone: "warn" }, matched: { label: "Matches order and delivery", tone: "ink" }, flagged: { label: "Difference flagged", tone: "neg" },
  correction_requested: { label: "Correction requested", tone: "warn" }, approved: { label: "Approved", tone: "pos" }, posted: { label: "Recorded expense", tone: "neutral" },
};
const ISSUE: Record<string, string> = { short_delivery: "Less delivered than ordered", over_delivery: "More delivered than ordered", invoiced_not_delivered: "Invoiced for more than was received", price_above_po: "Invoice price above the order price" };
const STAGE: Record<SpendEntry["stage"], string> = { requested: "Requested", committed: "Approved order", received: "Delivered, not invoiced", invoice: "Invoice, not yet an expense", recorded: "Recorded expense" };

/** The hotel Finance is looking at. Figures are never added across currencies. */
export function useFinanceProperty() {
  const { user, propertyId } = useView();
  const params = useSearchParams();
  const props = allowedProperties(user);
  const fromUrl = params.get("propertyId");
  const [picked, setPicked] = useState<string>(fromUrl && props.includes(fromUrl) ? fromUrl : propertyId ?? props[0]);
  return { propertyId: picked, setPropertyId: setPicked, props, currency: propertyById[picked].currency as Currency };
}

export function PropertyPicker({ value, onChange, props }: { value: string; onChange: (v: string) => void; props: string[] }) {
  if (props.length < 2) return null;
  return <Segmented label="Hotel" value={value} onChange={onChange} options={props.map((p) => ({ value: p, label: `${propertyById[p].name.replace("Grand Resort ", "")} (${propertyById[p].currency})` }))} />;
}

export const useFinanceHome = (propertyId: string) => useLiveGet<{ approvals: number; invoices: number; overBudget: string[] }>(`/api/finance/home?propertyId=${propertyId}`);

// ---- Invoices ------------------------------------------------------------------------------------------------------

type InvoiceList = { invoices: InvoiceView[]; toInvoice: { requestId: string; poNumber: string; propertyId: string; supplierId: string; supplierName: string; receivedValue: number; currency: Currency }[] };

export function Invoices() {
  const params = useSearchParams();
  const id = params.get("invoice");
  const record = params.get("record");
  if (id) return <InvoiceDetail id={id} />;
  if (record) return <RecordInvoice requestId={record} supplierId={params.get("supplier") ?? ""} />;
  return <InvoiceHome />;
}

function InvoiceHome() {
  const router = useRouter();
  const { user } = useView();
  const { propertyId, setPropertyId, props, currency } = useFinanceProperty();
  const [show, setShow] = useState<"check" | "all">("check");
  const { data, error } = useLiveGet<InvoiceList>(`/api/finance/invoices?propertyId=${propertyId}`);
  const money = (n: number) => fmtMoney(n, currency, { decimals: true });
  if (!data) return <Panel><EmptyState title={error ?? "Loading invoices"} /></Panel>;
  const check = data.invoices.filter((i) => ["to_check", "flagged", "correction_requested", "matched", "approved"].includes(i.status));
  const list = show === "check" ? check : data.invoices.slice(0, 60);
  return (
    <div className="space-y-5">
      <PropertyPicker value={propertyId} onChange={setPropertyId} props={props} />
      {data.toInvoice.length > 0 && can(user, "finance.review") && (
        <Panel title={`Delivered, waiting for the supplier's invoice (${data.toInvoice.length})`} description="Tyll orders that have been received. Enter the invoice when it arrives." flush>
          <ul className="divide-y divide-hair border-t border-hair">
            {data.toInvoice.map((t) => (
              <li key={`${t.requestId}-${t.supplierId}`} className="flex flex-wrap items-center gap-3 px-5 py-3 sm:px-6">
                <span className="flex-1 text-sm"><span className="text-ink">{t.poNumber} · {t.supplierName}</span><span className="block text-xs text-steel">Received value {money(t.receivedValue)}</span></span>
                <Button size="sm" variant="primary" onClick={() => router.push(`/finance?tab=invoices&record=${t.requestId}&supplier=${t.supplierId}`)}>Record invoice</Button>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <Panel title="Supplier invoices" description="Each invoice is compared with the purchase order and what was received." action={<Segmented size="sm" label="Show" value={show} onChange={setShow} options={[{ value: "check", label: `To review (${check.length})` }, { value: "all", label: "All" }]} />} flush>
        {list.length === 0 ? <p className="px-6 pb-6 text-sm text-steel">Nothing to review.</p> : (
          <TableWrap>
            <table className="w-full text-sm">
              <thead><tr><Th>Invoice</Th><Th>Supplier</Th><Th>Date</Th><Th align="right">Invoice total</Th><Th align="right">Difference</Th><Th>Status</Th></tr></thead>
              <tbody>
                {list.map((i) => (
                  <tr key={i.id} className={cn(rowClass, "cursor-pointer")} onClick={() => router.push(`/finance?tab=invoices&invoice=${i.id}&propertyId=${propertyId}`)}>
                    <Td><span className="num text-ink">{i.supplierRef}</span><span className="block text-xs text-steel">{i.poNumber}</span></Td>
                    <Td>{i.supplierName}</Td>
                    <Td>{i.date}</Td>
                    <Td align="right"><span className="num">{money(i.total)}</span></Td>
                    <Td align="right"><span className={cn("num", i.overcharge > 0 && "text-warn")}>{i.overcharge > 0 ? money(i.overcharge) : "None"}</span></Td>
                    <Td><Badge tone={INV_STATUS[i.status].tone} className="!py-0">{INV_STATUS[i.status].label}</Badge></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>
      <Note>Invoices for earlier orders come from the demo dataset; matching ones were recorded before Tyll. A difference is a fact to check with the supplier, not proof of wrongdoing. Tyll does not record payments.</Note>
    </div>
  );
}

function InvoiceDetail({ id }: { id: string }) {
  const router = useRouter();
  const { user } = useView();
  const mutate = useMutate();
  const params = useSearchParams();
  const { data, error } = useLiveGet<{ invoice: InvoiceView }>(`/api/finance/invoices/${id}`);
  const [note, setNote] = useState("");
  const [fix, setFix] = useState<Record<string, { qty: string; unitPrice: string }> | null>(null);
  const back = `/finance?tab=invoices${params.get("propertyId") ? `&propertyId=${params.get("propertyId")}` : ""}`;
  if (!data) return <Panel><EmptyState title={error ?? "Loading the invoice"} action={error ? <Button onClick={() => router.push(back)}>All invoices</Button> : undefined} /></Panel>;
  const i = data.invoice;
  const money = (n: number) => fmtMoney(n, i.currency, { decimals: true });
  const act = async (body: Record<string, unknown>, done: string) => {
    const r = await mutate(`/api/finance/invoices/${i.id}`, { expect: i.status, note, ...body });
    if (!r.ok) return toast.error(r.error);
    setNote(""); setFix(null);
    toast.done(done);
  };
  const reviewer = can(user, "finance.review");
  const open = i.status !== "posted";
  const differs = i.overcharge > 0 || i.lines.some((l) => l.issues.includes("price_above_po"));
  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" onClick={() => router.push(back)}><ArrowLeft size={15} /> All invoices</Button>
      <Panel title={<span className="flex flex-wrap items-center gap-3"><span>{i.supplierName} · invoice {i.supplierRef}</span><Badge tone={INV_STATUS[i.status].tone}>{INV_STATUS[i.status].label}</Badge>{i.corrected && <Badge>corrected</Badge>}</span>}
        description={`${i.id} · purchase order ${i.poNumber} · ${i.date} · ${FIN_DEPT_LABEL[i.dept]} · ${propertyById[i.propertyId].name}`}>
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="Ordered (PO)" value={money(i.poValue)} />
          <Stat label="Received" value={money(i.receivedValue)} />
          <Stat label="Invoiced" value={money(i.total)} />
          <Stat label="Invoiced beyond received" value={i.overcharge > 0 ? money(i.overcharge) : "None"} tone={i.overcharge > 0 ? "warn" : undefined} />
        </div>
        <TableWrap className="mt-4">
          <table className="w-full text-sm">
            <thead><tr><Th>Item</Th><Th align="right">Ordered</Th><Th align="right">Received</Th><Th align="right">Invoiced</Th><Th align="right">PO price</Th><Th align="right">Invoice price</Th><Th>Difference</Th></tr></thead>
            <tbody>
              {i.lines.map((l) => (
                <tr key={l.ingredientId} className={rowClass}>
                  <Td>{l.name}</Td>
                  <Td align="right"><span className="num">{l.ordered} {l.unit}</span></Td>
                  <Td align="right"><span className={cn("num", l.received !== l.ordered && "text-warn")}>{l.received} {l.unit}</span></Td>
                  <Td align="right">{fix ? <input aria-label={`Corrected quantity, ${l.name}`} className="w-20 rounded-lg border border-line px-2 py-1 text-right" value={fix[l.ingredientId].qty} onChange={(e) => setFix({ ...fix, [l.ingredientId]: { ...fix[l.ingredientId], qty: e.target.value } })} /> : <span className={cn("num", l.invoiced > l.received && "text-warn")}>{l.invoiced} {l.unit}</span>}</Td>
                  <Td align="right"><span className="num">{money(l.poPrice)}</span></Td>
                  <Td align="right">{fix ? <input aria-label={`Corrected price, ${l.name}`} className="w-24 rounded-lg border border-line px-2 py-1 text-right" value={fix[l.ingredientId].unitPrice} onChange={(e) => setFix({ ...fix, [l.ingredientId]: { ...fix[l.ingredientId], unitPrice: e.target.value } })} /> : <span className={cn("num", l.invoicePrice > l.poPrice && "text-warn")}>{money(l.invoicePrice)}</span>}</Td>
                  <Td>{l.issues.length ? <span className="text-xs text-graphite">{l.issues.map((x) => ISSUE[x]).join("; ")}{l.issues.includes("invoiced_not_delivered") ? `: ${Math.round((l.invoiced - l.received) * 1000) / 1000} ${l.unit} more invoiced than received` : ""}</span> : <span className="text-xs text-steel">None</span>}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        {reviewer && open && (
          <div className="mt-5 space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => router.push(i.requestId ? `/finance?tab=approvals&request=${i.requestId}` : "/stock?tab=suppliers")}>Review delivery</Button>
              {fix ? <Button variant="primary" onClick={() => act({ action: "record_correction", lines: i.lines.map((l) => ({ ingredientId: l.ingredientId, qty: Number(fix[l.ingredientId].qty), unitPrice: Number(fix[l.ingredientId].unitPrice) })) }, "Corrected invoice recorded and checked again.")}>Save corrected invoice</Button>
                : ["correction_requested", "flagged", "to_check"].includes(i.status) && <Button onClick={() => setFix(Object.fromEntries(i.lines.map((l) => [l.ingredientId, { qty: String(l.invoiced), unitPrice: String(l.invoicePrice) }])))}>Enter corrected invoice</Button>}
              {fix && <Button variant="ghost" onClick={() => setFix(null)}>Cancel</Button>}
            </div>
            <Field label="Note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={differs ? "For example: 2 kg short on delivery note DN-4471; credit note requested" : "Optional"} />
            <div className="flex flex-wrap gap-2">
              {differs && ["to_check", "matched"].includes(i.status) && <Button onClick={() => act({ action: "flag" }, "Difference flagged.")}>Flag difference</Button>}
              {differs && ["to_check", "flagged", "matched"].includes(i.status) && <Button onClick={() => act({ action: "request_correction" }, "Correction requested. The supplier is not contacted by Tyll.")}>Request correction</Button>}
              {i.status !== "approved" && <Button variant="primary" onClick={() => act({ action: "approve" }, "Invoice approved.")}>{differs ? "Approve with the difference accepted" : "Approve invoice"}</Button>}
              {i.status === "approved" && <Button variant="primary" onClick={() => act({ action: "post" }, "Recorded as an expense.")}>Record as expense</Button>}
            </div>
            {differs && <Note>Differences remain. Approving needs a note of at least 10 characters saying why the difference is accepted.</Note>}
          </div>
        )}
        {!reviewer && <Note className="mt-4">Read only. Accounting reviews invoices.</Note>}
      </Panel>
      <Panel title="What happened">
        <Timeline items={i.history.map((h, k) => ({ key: String(k), when: h.at.slice(0, 16).replace("T", " "), title: h.action, detail: `${h.by === "system" ? "Tyll" : personName(h.by)}${h.note ? ` · ${h.note}` : ""}` }))} />
      </Panel>
    </div>
  );
}

function RecordInvoice({ requestId, supplierId }: { requestId: string; supplierId: string }) {
  const router = useRouter();
  const mutate = useMutate();
  const { data } = useLiveGet<{ request: { id: string; poNumber?: string; propertyId: string; lines: { ingredientId: string; qty: number; received?: number; unitPrice: number; supplierId: string }[] } }>(`/api/purchasing/${requestId}`);
  const [ref, setRef] = useState("");
  const [lines, setLines] = useState<Record<string, { qty: string; unitPrice: string }> | null>(null);
  if (!data) return <Panel><EmptyState title="Loading the order" /></Panel>;
  const mine = data.request.lines.filter((l) => l.supplierId === supplierId);
  // Suppliers usually invoice what was ordered; the form starts there and can be changed to match the document.
  const vals = lines ?? Object.fromEntries(mine.map((l) => [l.ingredientId, { qty: String(l.qty), unitPrice: String(l.unitPrice) }]));
  const currency = propertyById[data.request.propertyId].currency;
  return (
    <Panel title={`Record supplier invoice for ${data.request.poNumber ?? data.request.id}`} description="Enter the figures from the supplier's invoice. Simulated in this demo: no invoice arrives electronically.">
      <form className="space-y-4" onSubmit={async (e) => {
        e.preventDefault();
        const r = await mutate<{ invoice: { id: string } }>("/api/finance/invoices", { requestId, supplierId, supplierRef: ref, lines: mine.map((l) => ({ ingredientId: l.ingredientId, qty: Number(vals[l.ingredientId].qty), unitPrice: Number(vals[l.ingredientId].unitPrice) })) });
        if (!r.ok) return toast.error(r.error);
        toast.done("Invoice recorded and compared with the order and delivery.");
        router.push(`/finance?tab=invoices&invoice=${r.data.invoice.id}`);
      }}>
        <Field label="Supplier invoice number" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="For example: GPM-48213" />
        <TableWrap>
          <table className="w-full text-sm">
            <thead><tr><Th>Item</Th><Th align="right">Ordered</Th><Th align="right">Received</Th><Th align="right">Invoiced quantity</Th><Th align="right">Invoice price ({currency})</Th></tr></thead>
            <tbody>
              {mine.map((l) => (
                <tr key={l.ingredientId} className={rowClass}>
                  <Td>{ingredientById[l.ingredientId]?.name ?? l.ingredientId}</Td>
                  <Td align="right">{l.qty}</Td>
                  <Td align="right">{l.received ?? 0}</Td>
                  <Td align="right"><input aria-label="Invoiced quantity" className="w-20 rounded-lg border border-line px-2 py-1 text-right" value={vals[l.ingredientId].qty} onChange={(e) => setLines({ ...vals, [l.ingredientId]: { ...vals[l.ingredientId], qty: e.target.value } })} /></Td>
                  <Td align="right"><input aria-label="Invoice price" className="w-24 rounded-lg border border-line px-2 py-1 text-right" value={vals[l.ingredientId].unitPrice} onChange={(e) => setLines({ ...vals, [l.ingredientId]: { ...vals[l.ingredientId], unitPrice: e.target.value } })} /></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        <div className="flex gap-2"><Button type="submit" variant="primary">Record invoice</Button><Button variant="ghost" onClick={() => router.push("/finance?tab=invoices")}>Cancel</Button></div>
      </form>
    </Panel>
  );
}

// ---- Budgets & reports ---------------------------------------------------------------------------------------------

type Report = "budget" | "spending" | "commitments" | "summary" | "exceptions";
const REPORTS: { id: Report; title: string; detail: string }[] = [
  { id: "budget", title: "Budget vs. actual", detail: "Which departments are over or under their budget." },
  { id: "spending", title: "Department spending", detail: "Where the money went, by department and category." },
  { id: "commitments", title: "Purchasing commitments", detail: "Approved or delivered, not yet a recorded expense." },
  { id: "summary", title: "Sales & operational summary", detail: "Revenue, direct costs and estimated contribution." },
  { id: "exceptions", title: "Cost exceptions", detail: "Invoice differences and unresolved stock variances." },
];

type ReportData = { propertyId: string; currency: Currency; period: string; month: string; budgets: BudgetRow[]; entries: SpendEntry[]; exceptions: { id: string; date: string; supplier: string; poNumber: string; amount: number; status: InvoiceStatus; issues: string[] }[]; events: { id: string; name: string; date: string; guests: number; food: number; drink: number; labour: number; total: number; revenue: number | null }[] };

export function Reports() {
  const router = useRouter();
  const params = useSearchParams();
  const { propertyId, setPropertyId, props, currency } = useFinanceProperty();
  const report = (params.get("report") as Report | null) ?? null;
  const [period, setPeriod] = useState<"month" | "week">("month");
  const [dept, setDept] = useState("");
  const [category, setCategory] = useState("");
  const [filters, setFilters] = useState(false);
  const { data, error } = useLiveGet<ReportData>(`/api/finance/report?propertyId=${propertyId}&period=${period}&dept=${dept}&category=${category}`);
  const money = (n: number) => fmtMoney(n, currency);
  if (!report) {
    return (
      <div className="space-y-5">
        <ul className="grid gap-3 sm:grid-cols-2">
          {REPORTS.map((r) => (
            <li key={r.id}><button type="button" onClick={() => router.push(`/finance?tab=reports&report=${r.id}&propertyId=${propertyId}`)} className="w-full rounded-panel border border-line bg-paper p-5 text-left shadow-panel transition-colors duration-300 ease-tyll hover:border-fog"><span className="block text-[17px] text-ink">{r.title}</span><span className="mt-1 block text-[13px] text-steel">{r.detail}</span></button></li>
          ))}
        </ul>
        <Note>Budgets and the non-F&amp;B spending history are simulated planning figures. F&amp;B spending comes from the dataset&rsquo;s supplier invoices and Tyll&rsquo;s own orders. Each hotel is shown in its own currency.</Note>
      </div>
    );
  }
  const meta = REPORTS.find((r) => r.id === report)!;
  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" onClick={() => router.push(`/finance?tab=reports&propertyId=${propertyId}`)}><ArrowLeft size={15} /> All reports</Button>
      <div className="flex flex-wrap items-end gap-3">
        <PropertyPicker value={propertyId} onChange={setPropertyId} props={props} />
        {report !== "summary" && <Segmented label="Period" value={period} onChange={setPeriod} options={[{ value: "month", label: "October to date" }, { value: "week", label: "Last 7 days" }]} />}
        {["budget", "spending", "commitments"].includes(report) && !filters && (
          <Button size="sm" variant="ghost" onClick={() => setFilters(true)}>{dept || category ? "Change filter" : "Filter by department or category"}</Button>
        )}
        {["budget", "spending", "commitments"].includes(report) && filters && (
          <>
            <Select label="Department" value={dept} onChange={(e) => setDept(e.target.value)} className="w-56"><option value="">All departments</option>{FIN_DEPTS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}</Select>
            <Select label="Category" value={category} onChange={(e) => setCategory(e.target.value)} className="w-56"><option value="">All categories</option>{Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          </>
        )}
      </div>
      {!data ? <Panel><EmptyState title={error ?? "Loading"} /></Panel> : (
        <>
          {report === "budget" && <BudgetReport data={data} money={money} title={meta.title} />}
          {report === "spending" && <SpendingReport data={data} money={money} />}
          {report === "commitments" && <CommitmentReport data={data} money={money} />}
          {report === "summary" && <SummaryReport propertyId={propertyId} events={data.events} money={money} />}
          {report === "exceptions" && <ExceptionReport data={data} money={money} propertyId={propertyId} />}
        </>
      )}
    </div>
  );
}

const csvName = (what: string, p: string) => `tyll-${what}-${p}-${DEMO_TODAY}.csv`;

function BudgetReport({ data, money, title }: { data: ReportData; money: (n: number) => string; title: string }) {
  const month = data.period === "month";
  return (
    <Panel title={`${title}, ${month ? data.month : "last 7 days"}`} description={month ? "Recorded expenses are counted against the budget. Invoices awaiting review and open orders are shown separately, never added to recorded spending." : "Spending only: budgets are monthly."}
      action={<Button size="sm" onClick={() => downloadCsv(csvName("budget", data.propertyId), [["Department", "Budget", "Recorded", "Invoices awaiting review", "Open orders", "Requested", "Remaining", "Remaining if all open items are spent", "Currency"], ...data.budgets.map((b) => [b.label, b.budget, b.recorded, b.invoices, b.committed, b.requested, b.remaining, b.remainingIfSpent, data.currency])])}><Download size={14} /> CSV</Button>} flush>
      <TableWrap>
        <table className="w-full text-sm">
          <thead><tr><Th>Department</Th>{month && <Th align="right">Budget</Th>}<Th align="right">Recorded</Th><Th align="right">Invoices awaiting review</Th><Th align="right">Open orders</Th>{month && <Th align="right">Remaining</Th>}{month && <Th align="right">If all open items are spent</Th>}</tr></thead>
          <tbody>
            {data.budgets.map((b) => (
              <tr key={b.dept} className={rowClass}>
                <Td>{b.label}</Td>
                {month && <Td align="right"><span className="num">{money(b.budget)}</span></Td>}
                <Td align="right"><span className="num">{money(b.recorded)}</span>{month && b.budget > 0 && <span className="block text-xs text-steel">{fmtPct(b.recorded / b.budget)} used</span>}</Td>
                <Td align="right"><span className="num">{money(b.invoices)}</span></Td>
                <Td align="right"><span className="num">{money(b.committed)}</span></Td>
                {month && <Td align="right"><span className={cn("num", b.remaining < 0 && "text-neg")}>{money(b.remaining)}</span></Td>}
                {month && <Td align="right"><span className={cn("num", b.remainingIfSpent < 0 ? "text-neg" : b.remainingIfSpent < b.budget * 0.05 ? "text-warn" : "")}>{money(b.remainingIfSpent)}</span></Td>}
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </Panel>
  );
}

function SpendingReport({ data, money }: { data: ReportData; money: (n: number) => string }) {
  const rec = data.entries.filter((e) => e.stage === "recorded");
  const byDept = FIN_DEPTS.map((d) => ({ ...d, total: rec.filter((e) => e.dept === d.id).reduce((t, e) => t + e.amount, 0) })).filter((d) => d.total > 0);
  const total = byDept.reduce((t, d) => t + d.total, 0);
  return (
    <div className="space-y-5">
      <Panel title="Recorded expenses by department" description={`${data.period === "month" ? data.month : "Last 7 days"}. Recorded expenses only.`}
        action={<Button size="sm" onClick={() => downloadCsv(csvName("spending", data.propertyId), [["Date", "Department", "Category", "Supplier", "Description", "Amount", "Currency", "Source"], ...rec.map((e) => [e.date, FIN_DEPT_LABEL[e.dept], CATEGORY_LABEL[e.category], e.supplier, e.description, e.amount, data.currency, e.source])])}><Download size={14} /> CSV</Button>}>
        <ul className="space-y-3">
          {byDept.map((d) => (
            <li key={d.id}>
              <div className="flex justify-between text-sm"><span>{d.label}</span><span className="num">{money(d.total)}</span></div>
              <div className="mt-1 h-2 rounded-full bg-mist"><div className="h-2 rounded-full bg-ink" style={{ width: `${total ? (d.total / total) * 100 : 0}%` }} /></div>
            </li>
          ))}
          {byDept.length === 0 && <li className="text-sm text-steel">No recorded expenses for this selection.</li>}
        </ul>
        <p className="mt-4 text-sm text-ink">Total recorded: <span className="num">{money(total)}</span></p>
      </Panel>
      <Panel title={`Entries (${rec.length})`} flush>
        <TableWrap>
          <table className="w-full text-sm">
            <thead><tr><Th>Date</Th><Th>Department</Th><Th>Supplier</Th><Th>Description</Th><Th align="right">Amount</Th></tr></thead>
            <tbody>{rec.slice(0, 80).map((e) => <tr key={e.id} className={rowClass}><Td>{e.date}</Td><Td>{FIN_DEPT_LABEL[e.dept]}</Td><Td>{e.supplier}</Td><Td>{e.description}</Td><Td align="right"><span className="num">{money(e.amount)}</span></Td></tr>)}</tbody>
          </table>
        </TableWrap>
      </Panel>
    </div>
  );
}

function CommitmentReport({ data, money }: { data: ReportData; money: (n: number) => string }) {
  const router = useRouter();
  const open = data.entries.filter((e) => e.stage !== "recorded");
  const order: SpendEntry["stage"][] = ["requested", "committed", "received", "invoice"];
  return (
    <Panel title="Purchasing commitments" description="Requested, approved, delivered or invoiced, but not yet a recorded expense. Each order is counted once, at its current stage."
      action={<Button size="sm" onClick={() => downloadCsv(csvName("commitments", data.propertyId), [["Reference", "Stage", "Department", "Supplier", "Amount", "Currency"], ...open.map((e) => [e.ref, STAGE[e.stage], FIN_DEPT_LABEL[e.dept], e.supplier, e.amount, data.currency])])}><Download size={14} /> CSV</Button>} flush>
      {order.map((st) => {
        const rows = open.filter((e) => e.stage === st);
        if (!rows.length) return null;
        return (
          <div key={st} className="border-t border-hair">
            <p className="flex justify-between px-6 pt-4 text-sm text-ink"><span>{STAGE[st]} ({rows.length})</span><span className="num">{money(rows.reduce((t, e) => t + e.amount, 0))}</span></p>
            <ul className="divide-y divide-hair pb-2">
              {rows.slice(0, 25).map((e) => (
                <li key={e.id}><button type="button" disabled={!e.href} onClick={() => e.href && router.push(e.href)} className="flex w-full flex-wrap justify-between gap-2 px-6 py-2 text-left text-sm hover:bg-cloud"><span>{e.ref} · {e.supplier}<span className="block text-xs text-steel">{FIN_DEPT_LABEL[e.dept]} · {e.description}</span></span><span className="num">{money(e.amount)}</span></button></li>
              ))}
            </ul>
          </div>
        );
      })}
      {open.length === 0 && <p className="px-6 pb-6 text-sm text-steel">No open commitments.</p>}
    </Panel>
  );
}

function SummaryReport({ propertyId, events, money }: { propertyId: string; events: ReportData["events"]; money: (n: number) => string }) {
  const ctx = useCtx();
  const { user } = useView();
  const currency = propertyById[propertyId].currency;
  const outletIds = allowedOutlets(user).filter((o) => o.startsWith(`${propertyId}-`));
  const t = useMemo(() => compare(ctx, { outletIds, wholeProperties: [propertyId], dept: "all", range: { from: "2026-10-01", to: DEMO_TODAY }, currency }).now, [ctx, outletIds, propertyId, currency]);
  const opex = t.operatingExpenses === null ? null : t.operatingExpenses - t.fnbCost;
  return (
    <div className="space-y-5">
      <Panel title="Sales & operational summary, October to date" description="From the same sales and cost records as the Overview.">
        <dl className="max-w-xl space-y-2 text-sm">
          <div className="flex justify-between"><dt>Net revenue (F&amp;B outlets)</dt><dd className="num">{money(t.net)}</dd></div>
          <div className="flex justify-between"><dt>Direct costs: food and drink used</dt><dd className="num">{money(t.fnbCost)}</dd></div>
          <div className="flex justify-between border-t border-hair pt-2"><dt className="text-ink">Gross margin</dt><dd className="num text-ink">{money(t.grossProfit)} · {fmtPct(t.gpMargin)}</dd></div>
          <div className="flex justify-between"><dt>Selected operating expenses (labour and allocated overheads, estimates)</dt><dd className="num">{opex === null ? "Not available" : money(opex)}</dd></div>
          <div className="flex justify-between border-t border-hair pt-2"><dt className="text-ink">Estimated operating contribution</dt><dd className="num text-ink">{t.operatingProfit === null ? "Not available" : money(t.operatingProfit)}</dd></div>
        </dl>
        <Note className="mt-4">This is not net profit. Tyll does not hold the hotel&rsquo;s full accounts: rooms revenue, depreciation, rent, financing and taxes are not included.</Note>
      </Panel>
      <Panel title="Upcoming events: operational cost estimates" description="From each event plan. Estimates, not recorded spending; actual costs are recorded only when invoiced.">
        {events.length === 0 ? <p className="text-sm text-steel">No confirmed events ahead.</p> : (
          <TableWrap>
            <table className="w-full text-sm">
              <thead><tr><Th>Event</Th><Th align="right">Food</Th><Th align="right">Drinks</Th><Th align="right">Labour</Th><Th align="right">Estimated total</Th><Th align="right">Agreed price</Th></tr></thead>
              <tbody>{events.map((e) => <tr key={e.id} className={rowClass}><Td>{e.name}<span className="block text-xs text-steel">{e.date} · {e.guests} guests</span></Td><Td align="right">{money(e.food)}</Td><Td align="right">{money(e.drink)}</Td><Td align="right">{money(e.labour)}</Td><Td align="right">{money(e.total)}</Td><Td align="right">{e.revenue === null ? "Not set" : money(e.revenue)}</Td></tr>)}</tbody>
            </table>
          </TableWrap>
        )}
      </Panel>
    </div>
  );
}

function ExceptionReport({ data, money, propertyId }: { data: ReportData; money: (n: number) => string; propertyId: string }) {
  const router = useRouter();
  const investigations = useInvestigations();
  const stock = investigations.filter((i) => i.propertyId === propertyId && i.status !== "closed" && (i.type === "stock_shortfall" || i.type === "usage_variance"));
  return (
    <div className="space-y-5">
      <Panel title={`Invoice differences (${data.exceptions.length})`} description="Invoiced beyond what was received at the agreed price, not yet resolved." flush>
        {data.exceptions.length === 0 ? <p className="px-6 pb-6 text-sm text-steel">None open.</p> : (
          <ul className="divide-y divide-hair border-t border-hair">
            {data.exceptions.map((x) => (
              <li key={x.id}><button type="button" onClick={() => router.push(`/finance?tab=invoices&invoice=${x.id}&propertyId=${propertyId}`)} className="flex w-full flex-wrap items-center justify-between gap-2 px-6 py-3 text-left text-sm hover:bg-cloud"><span>{x.supplier} · {x.poNumber}<span className="block text-xs text-steel">{x.date} · {x.issues.map((k) => ISSUE[k]).join("; ")}</span></span><span className="flex items-center gap-3"><Badge tone={INV_STATUS[x.status].tone} className="!py-0">{INV_STATUS[x.status].label}</Badge><span className="num text-warn">{money(x.amount)}</span></span></button></li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title={`Unresolved stock variances (${stock.length})`} description="Potential impact from open stock investigations. Estimates until verified; not recorded as losses or expenses." flush>
        {stock.length === 0 ? <p className="px-6 pb-6 text-sm text-steel">None open.</p> : (
          <ul className="divide-y divide-hair border-t border-hair">
            {stock.map((i) => <li key={i.id}><button type="button" onClick={() => router.push(`/investigations/${i.id}`)} className="flex w-full justify-between gap-2 px-6 py-3 text-left text-sm hover:bg-cloud"><span>{i.headline}<span className="block text-xs text-steel">{i.id} · {i.status}</span></span><span className="num">{money(i.exposure)} potential</span></button></li>)}
          </ul>
        )}
      </Panel>
    </div>
  );
}
