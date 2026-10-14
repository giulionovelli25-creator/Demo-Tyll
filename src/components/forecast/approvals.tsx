"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Check } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Button, EmptyState, Field, Note, Panel, TableWrap, Td, Th, TextArea, cn, rowClass, toast } from "@/components/ui";
import { ingredientById, outletById, propertyById } from "@/lib/data/catalog";
import { supplierName } from "@/lib/data/purchasing-rules";
import { deptById } from "@/lib/data/workforce";
import { allowedOutlets, can } from "@/lib/domain/access";
import { personName, useView } from "@/lib/hooks";
import { type RequestDetail, useMutate, useRequest, useRequests } from "@/lib/plan-hooks";
import type { PurchaseRequest, RequestStatus, User } from "@/lib/types";
import { fmtDate, fmtMoney, fmtQty } from "@/lib/util";
import { Choice } from "./parts";

export const STATUS: Record<RequestStatus, { label: string; tone: "neutral" | "warn" | "pos" | "neg" | "ink" }> = {
  draft: { label: "Draft", tone: "neutral" },
  purchasing: { label: "Waiting for purchasing", tone: "warn" },
  accounting: { label: "Waiting for accounting", tone: "warn" },
  manager: { label: "Waiting for manager approval", tone: "warn" },
  approved: { label: "Approved, order placed", tone: "pos" },
  received: { label: "Received", tone: "pos" },
  rejected: { label: "Rejected", tone: "neg" },
  changes: { label: "Changes requested", tone: "ink" },
};

type Queue = "purchasing" | "accounting" | "manager" | "approved" | "returned" | "drafts" | "all";
const inQueue = (r: PurchaseRequest, q: Queue, user: User) =>
  q === "all" ? r.status !== "draft" || r.createdBy === user.id
    : q === "approved" ? r.status === "approved" || r.status === "received"
      : q === "returned" ? r.status === "rejected" || r.status === "changes"
        : q === "drafts" ? r.status === "draft" && r.createdBy === user.id
          : r.status === q;

const total = (r: PurchaseRequest) => r.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
const unitOf = (g: string) => (ingredientById[g].unit === "each" ? "units" : ingredientById[g].unit);
const where = (r: PurchaseRequest) => (r.deptId ? deptById[r.deptId]?.name ?? r.deptId : r.eventId ? "Event" : r.outletIds.length === 1 ? outletById[r.outletIds[0]].name : `${r.outletIds.length} outlets`);

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
  const preferred: Queue = (params.get("queue") as Queue) ?? (can(user, "purchase.review") ? "purchasing" : can(user, "purchase.approveFinance") ? "accounting" : "all");
  const [queue, setQueue] = useState<Queue>(preferred);
  const count = (q: Queue) => requests.filter((r) => inQueue(r, q, user)).length;
  const queues: { value: Queue; label: string }[] = [
    { value: "all", label: `All (${count("all")})` },
    { value: "purchasing", label: `Waiting for purchasing (${count("purchasing")})` },
    { value: "accounting", label: `Waiting for accounting (${count("accounting")})` },
    ...(count("manager") || can(user, "purchase.approveManager") ? [{ value: "manager" as Queue, label: `Waiting for manager (${count("manager")})` }] : []),
    { value: "approved", label: `Approved (${count("approved")})` },
    { value: "returned", label: `Rejected or changes requested (${count("returned")})` },
    ...(can(user, "purchase.create") ? [{ value: "drafts" as Queue, label: `My drafts (${count("drafts")})` }] : []),
  ];
  const shown = requests.filter((r) => inQueue(r, queue, user));
  return (
    <div className="space-y-5">
      <Choice label="Show" value={queue} options={queues} onChange={setQueue} />
      <Panel flush>
        {error ? <div className="p-6"><EmptyState title="Requests could not be loaded">{error}</EmptyState></div>
          : !data ? <div className="p-6"><EmptyState title="Loading requests" /></div>
            : shown.length === 0 ? <div className="p-6"><EmptyState title="Nothing here" action={can(user, "purchase.create") ? <Button onClick={() => router.push("/forecast?tab=buy")}>Plan what to buy</Button> : undefined}>No requests in this list.</EmptyState></div> : (
              <TableWrap>
                <table className="w-full min-w-[760px] text-sm">
                  <thead><tr><Th>Request</Th><Th>For</Th><Th>Raised by</Th><Th align="right">Expected total</Th><Th>Status</Th><Th>Updated</Th></tr></thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr key={r.id} className={cn(rowClass, "cursor-pointer")} onClick={() => router.push(`${base}&request=${r.id}`)}>
                        <Td><button type="button" className="num text-ink underline-offset-4 hover:underline" onClick={(e) => { e.stopPropagation(); router.push(`${base}&request=${r.id}`); }}>{r.id}</button><span className="block text-xs text-steel">{r.lines.length} item{r.lines.length === 1 ? "" : "s"}</span></Td>
                        <Td>{where(r)}<span className="block text-xs text-steel">{fmtDate(r.period.from)}{r.period.to !== r.period.from ? ` to ${fmtDate(r.period.to)}` : ""}</span></Td>
                        <Td>{personName(r.createdBy)}</Td>
                        <Td align="right">{fmtMoney(total(r), propertyById[r.propertyId].currency, { decimals: true })}</Td>
                        <Td><Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge></Td>
                        <Td className="text-graphite">{new Date(r.updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
        <Note className="px-6 py-4">Requests are stored on the Tyll server, so every department sees the same record. No order is sent to a real supplier.</Note>
      </Panel>
    </div>
  );
}

/** The path a request takes at its hotel, with when each step happened. */
function Progress({ d }: { d: RequestDetail }) {
  const r = d.request;
  const names: Record<string, string> = { purchasing: "Purchasing review", accounting: "Accounting review", manager: d.policy.managerLabel };
  const stepsDone = (s: string) => r.history.find((h) => h.action.toLowerCase().startsWith(names[s]?.toLowerCase() ?? s) && h.action.endsWith("approved"));
  const submitted = r.history.find((h) => h.action.startsWith("Submitted") || h.action.startsWith("Resubmitted"));
  const items = [
    { key: "draft", label: "Draft", at: r.history[0]?.at, done: true },
    { key: "submitted", label: "Submitted", at: submitted?.at, done: !!submitted },
    ...d.steps.map((s) => ({ key: s, label: names[s], at: stepsDone(s)?.at, done: !!stepsDone(s) })),
    { key: "approved", label: "Approved", at: r.history.find((h) => h.status === "approved")?.at, done: r.status === "approved" || r.status === "received" },
  ];
  const time = (at?: string) => (at ? new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "");
  return (
    <ol className="flex flex-wrap items-start gap-x-2 gap-y-3 text-[13px]">
      {items.map((s, i) => (
        <li key={s.key} className="flex items-center gap-2">
          {i > 0 && <span className={cn("h-px w-6", s.done ? "bg-ink" : "bg-line")} aria-hidden />}
          <span className={cn("flex h-6 w-6 items-center justify-center rounded-full border", s.done ? "border-ink bg-ink text-paper" : "border-line text-fog")}>{s.done ? <Check size={13} /> : i + 1}</span>
          <span><span className={s.done ? "text-ink" : "text-steel"}>{s.label}</span>{s.at && <span className="block text-xs text-steel">{time(s.at)}</span>}</span>
        </li>
      ))}
      {(r.status === "rejected" || r.status === "changes") && <li><Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge></li>}
    </ol>
  );
}

function RequestView({ id, base }: { id: string; base: string }) {
  const { user } = useView();
  const router = useRouter();
  const { data, error } = useRequest(id);
  const mutate = useMutate();
  const [edits, setEdits] = useState<Record<string, { qty?: number; supplierId?: string; reason?: string }>>({});
  const [comment, setComment] = useState("");
  const [received, setReceived] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  if (data === undefined && !error) return <Panel><EmptyState title="Loading the request" /></Panel>;
  if (!data) return <Panel><EmptyState title="This request is not available" action={<Button onClick={() => router.push(base)}>Back to approvals</Button>}>It does not exist, or it is outside your access.</EmptyState></Panel>;
  const r = data.request;
  const money = (n: number) => fmtMoney(n, propertyById[r.propertyId].currency, { decimals: true });
  const author = r.createdBy === user.id && (r.status === "draft" || r.status === "changes");
  const reviewing = (r.status === "purchasing" && can(user, "purchase.review")) || (r.status === "accounting" && can(user, "purchase.approveFinance")) || (r.status === "manager" && can(user, "purchase.approveManager"));
  const stage = r.status as "purchasing" | "accounting" | "manager";
  const editableBy = author ? "author" : r.status === "purchasing" && can(user, "purchase.review") ? "purchasing" : null;
  const mayReceive = r.status === "approved" && (can(user, "purchase.receive") || (can(user, "stock.count") && r.outletIds.some((o) => allowedOutlets(user).includes(o))));
  const lineQty = (g: string, q: number) => edits[g]?.qty ?? q;
  const lineSupplier = (g: string, s: string) => edits[g]?.supplierId ?? s;
  const priceOf = (g: string, s: string, fallback: number) => data.quotes[g]?.find((x) => x.supplierId === s)?.unitPrice ?? fallback;
  const liveTotal = r.lines.reduce((s, l) => s + lineQty(l.ingredientId, l.qty) * priceOf(l.ingredientId, lineSupplier(l.ingredientId, l.supplierId), l.unitPrice), 0);
  const afterBudget = data.budget.available - liveTotal;
  const showMoney = user.role !== "chef";

  const run = async (url: string, body: unknown, ok: string) => {
    setBusy(true);
    const res = await mutate(url, body);
    setBusy(false);
    if (!res.ok) return toast.error(res.error), false;
    toast.done(ok);
    setEdits({});
    setComment("");
    return true;
  };
  const saveAuthor = (then?: "submit") => run("/api/purchasing", { id: r.id, comment: r.comment, lines: r.lines.map((l) => ({ ...l, qty: lineQty(l.ingredientId, l.qty), supplierId: lineSupplier(l.ingredientId, l.supplierId) })) }, "Changes saved.")
    .then((ok) => ok && then === "submit" && run(`/api/purchasing/${r.id}`, { action: "submit" }, `${r.id} sent to purchasing.`));
  const decide = (decision: "approve" | "changes" | "reject") => run(`/api/purchasing/${r.id}`, {
    action: stage, decision, comment,
    changes: stage === "purchasing" ? Object.entries(edits).map(([ingredientId, e]) => ({ ingredientId, qty: e.qty, supplierId: e.supplierId, reason: e.reason })) : undefined,
  }, decision === "approve" ? "Approved. The next reviewer can see it now." : decision === "changes" ? "Sent back for changes." : "Request rejected.");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push(base)}><ArrowLeft size={15} /> All requests</Button>
      </div>
      <Panel
        title={<span className="flex flex-wrap items-center gap-3"><span className="num">{r.id}</span><Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>{r.poNumber && <Badge>{r.poNumber}</Badge>}</span>}
        description={`${where(r)}, ${propertyById[r.propertyId].name}. For ${fmtDate(r.period.from, true)}${r.period.to !== r.period.from ? ` to ${fmtDate(r.period.to, true)}` : ""}. Raised by ${personName(r.createdBy)}.`}
      >
        <Progress d={data} />
        {r.comment && <p className="mt-4 text-sm text-graphite"><span className="text-steel">Comment: </span>{r.comment}</p>}
        {r.prepPlanId && <p className="mt-1 text-[13px] text-steel">Raised from prep plan {r.prepPlanId}.</p>}
      </Panel>

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
                    <Td align="right" className="num text-graphite">{fmtQty(l.suggested, ingredientById[g].unit)}<span className="block text-xs text-steel">need {fmtQty(l.requirement, ingredientById[g].unit)}</span></Td>
                    <Td align="right" className="num text-graphite">{fmtQty(l.available + l.incoming, ingredientById[g].unit)}</Td>
                    <Td align="right">
                      {editableBy ? (
                        <span className="inline-flex flex-col items-end gap-1">
                          <span className="flex items-center gap-1.5"><input aria-label={`Quantity of ${ingredientById[g].name}`} type="number" min={0} step="any" value={qty} onChange={(e) => setEdits({ ...edits, [g]: { ...edits[g], qty: Math.max(0, Number(e.target.value)) } })} className="num h-9 w-24 rounded-xl border border-line px-2 text-right hover:border-fog" /><span className="w-8 text-left text-xs text-steel">{unitOf(g)}</span></span>
                          {editableBy === "purchasing" && changed && <input aria-label={`Reason for changing ${ingredientById[g].name}`} placeholder="Reason for the change" value={edits[g]?.reason ?? ""} onChange={(e) => setEdits({ ...edits, [g]: { ...edits[g], reason: e.target.value } })} className="h-8 w-48 rounded-lg border border-warn/40 px-2 text-xs" />}
                        </span>
                      ) : <span className="num">{fmtQty(l.qty, ingredientById[g].unit)}</span>}
                    </Td>
                    <Td>
                      {editableBy && (data.quotes[g]?.length ?? 0) > 1 ? (
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
        {showMoney && <p className="px-6 py-4 text-right text-sm text-graphite">Expected total <span className="num ml-2 text-[20px] text-ink">{money(liveTotal)}</span></p>}
      </Panel>

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[1fr_1fr]">
        {(reviewing || author || mayReceive) && (
          <Panel title={author ? "Your request" : mayReceive ? "Record the delivery" : stage === "purchasing" ? "Purchasing review" : stage === "accounting" ? "Accounting review" : `${data.policy.managerLabel} approval`}>
            {author && (
              <div className="space-y-3">
                {r.status === "changes" && <Note>{r.history.slice().reverse().find((h) => h.status === "changes")?.comment}</Note>}
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" disabled={busy} onClick={() => saveAuthor("submit")}>{r.status === "changes" ? "Resubmit to purchasing" : "Submit to purchasing"}</Button>
                  <Button disabled={busy} onClick={() => saveAuthor()}>Save changes</Button>
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
                <p className="text-[13px] text-steel">Enter what actually arrived. Stock rises by these quantities.</p>
                {r.lines.map((l) => <Field key={l.ingredientId} label={ingredientById[l.ingredientId].name} suffix={unitOf(l.ingredientId)} type="number" min="0" step="any" value={received[l.ingredientId] ?? l.qty} onChange={(e) => setReceived({ ...received, [l.ingredientId]: Number(e.target.value) })} />)}
                <Button variant="primary" disabled={busy} onClick={() => run(`/api/purchasing/${r.id}`, { action: "receive", received: r.lines.map((l) => ({ ingredientId: l.ingredientId, qty: received[l.ingredientId] ?? l.qty })) }, "Delivery recorded. Stock is updated.")}>Record delivery received</Button>
              </div>
            )}
          </Panel>
        )}

        {showMoney && (can(user, "purchase.review") || can(user, "purchase.approveFinance") || can(user, "purchase.approveManager")) && (
          <Panel title="Budget and approval rules" action={<Badge>Demo estimate</Badge>}>
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-steel">{data.budget.label} budget, {data.budget.month}</dt><dd className="num">{money(data.budget.budget)}</dd></div>
              <div className="flex justify-between"><dt className="text-steel">Recorded or invoiced this month</dt><dd className="num">{money(data.budget.spentBefore)}</dd></div>
              <div className="flex justify-between"><dt className="text-steel">Other approved Tyll orders</dt><dd className="num">{money(data.budget.committed)}</dd></div>
              <div className="flex justify-between border-t border-hair pt-2"><dt className="text-ink">Left after this request</dt><dd className={cn("num", afterBudget < 0 ? "text-neg" : "text-ink")}>{money(afterBudget)}</dd></div>
            </dl>
            <Note className="mt-3">The same figures as Tyll Finance. Budgets are demo planning figures, not balances from an accounting system. Approving a request creates a commitment, not a recorded expense.</Note>
            <p className="mt-3 text-[13px] text-graphite">At {propertyById[r.propertyId].name}: purchasing reviews every request; accounting approves requests {data.policy.accountingAbove > 0 ? `over ${money(data.policy.accountingAbove)}` : "of any size"}; the {data.policy.managerLabel.toLowerCase()} also approves requests over {money(data.policy.managerAbove)}.</p>
          </Panel>
        )}

        <Panel title="History and comments">
          <ul className="space-y-3">
            {r.history.slice().reverse().map((h, i) => (
              <li key={i} className="text-sm">
                <p className="flex flex-wrap justify-between gap-2"><span className="text-ink">{h.action}</span><span className="text-xs text-steel">{personName(h.by)} · {new Date(h.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span></p>
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
