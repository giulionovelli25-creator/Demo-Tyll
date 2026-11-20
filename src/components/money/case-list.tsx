"use client";
// Flagged cases and their follow up: who is on each, the deadline, the outcome and the money recovered. Shown inside
// Flagged transactions (/money?tab=flags) since the simplify pass; /investigations leads there (lib/redirects.ts).
import { caseIsPastDeadline } from "@/lib/domain/deadline";
import { useRouter, useSearchParams } from "next/navigation";
import { Download } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Button, EmptyState, Field, PageHeader, Panel, Segmented, Select, SummaryBar, TableWrap, Td, Th, cn, rowClass, toast, useSort } from "@/components/ui";
import { StripTrend } from "@/components/charts";
import { byDay, versus, weekSums } from "@/lib/domain/trends";
import { outletById, outletLabel, propertyById } from "@/lib/data/catalog";
import { can } from "@/lib/domain/access";
import { ROOM_TYPES, TILL_TYPES, TYPE_LABEL, datedFlags, isEstimateFlag } from "@/lib/domain/detect";
import { exceptionInSel } from "@/lib/domain/metrics";
import { assignablePeople, personName, useInvestigations, useView } from "@/lib/hooks";
import { useDemo } from "@/lib/store";
import { OUTCOME_LABEL, STATUS_LABEL } from "@/lib/labels";
import type { ExceptionType, Investigation, Outcome } from "@/lib/types";
import { DEMO_TODAY, addDays, downloadCsv, fmtDate, fmtRange, fmtTime, fxRate, sum } from "@/lib/util";

type Key = "priority" | "when" | "outlet" | "type" | "assignee" | "deadline" | "impact" | "status";
type StatusFilter = "open" | "closed" | "all";
const PAGE = 25;
/** Inside Flagged transactions the list opens on the first few, largest and most overdue first; the rest are one click away. */
const FIRST = 8;

export function CaseList({ embedded = false }: { embedded?: boolean } = {}) {
  const params = useSearchParams();
  const router = useRouter();
  const { sel, money, currency, user } = useView();
  const all = useInvestigations();
  const [status, setStatus] = useState<StatusFilter>((params.get("status") as StatusFilter) ?? "open");
  const [type, setType] = useState(params.get("type") ?? "all");
  const [outcome, setOutcome] = useState(params.get("outcome") ?? "all");
  const [assignee, setAssignee] = useState("all");
  const [inPeriod, setInPeriod] = useState<"any" | "period">(params.get("status") === "closed" ? "period" : "any");
  const [shown, setShown] = useState(embedded ? FIRST : PAGE);
  // Overdue first, then the most money: what needs a manager first.
  const { sort, toggle } = useSort<Key>({ key: "priority", dir: "asc" });
  const assign = useDemo((s) => s.assignInvestigation);
  const mayAssign = can(user, "investigation.assign");
  const [picked, setPicked] = useState<string[]>([]);
  const [bulkTo, setBulkTo] = useState("");
  const [bulkDue, setBulkDue] = useState(addDays(DEMO_TODAY, 2));

  const toDisplay = (i: Investigation, n: number) => n * fxRate(propertyById[i.propertyId].currency, currency);
  const inScope = useMemo(() => all.filter((i) => exceptionInSel(i, sel)), [all, sel]);
  const rows = useMemo(() => {
    let list = inScope;
    if (inPeriod === "period") list = list.filter((i) => i.date >= sel.range.from && i.date <= sel.range.to);
    if (status === "open") list = list.filter((i) => i.status !== "closed");
    if (status === "closed") list = list.filter((i) => i.status === "closed");
    if (type !== "all") list = list.filter((i) => (type === "room" ? ROOM_TYPES.includes(i.type) : type === "till" ? TILL_TYPES.includes(i.type) : i.type === type));
    if (outcome !== "all") list = list.filter((i) => i.outcome === outcome);
    if (assignee !== "all") list = list.filter((i) => (assignee === "none" ? !i.assigneeId : i.assigneeId === assignee));
    const value = (i: Investigation): number | string =>
      ({
        priority: (i.status !== "closed" && i.deadline && i.deadline < DEMO_TODAY ? 0 : 1e9) - toDisplay(i, i.exposure),
        when: `${i.date} ${String(i.min).padStart(4, "0")}`, outlet: i.outletId ? outletById[i.outletId].name : "", type: TYPE_LABEL[i.type], assignee: personName(i.assigneeId),
        deadline: i.deadline ?? "9999", impact: toDisplay(i, i.exposure), status: i.status,
      })[sort.key];
    return [...list].sort((a, b) => {
      const [x, y] = [value(a), value(b)];
      const d = typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number);
      return sort.dir === "asc" ? d : -d;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inScope, inPeriod, status, type, outcome, assignee, sort, sel.range, currency]);

  const open = inScope.filter((i) => i.status !== "closed");
  const closed = inScope.filter((i) => i.status === "closed");
  const overdue = open.filter((i) => caseIsPastDeadline(i)).length;
  const potential = sum(open, (i) => toDisplay(i, i.exposure));
  // The part of the potential losses that is an estimate, from the same rule as the flags page.
  const estimated = sum(open.filter(isEstimateFlag), (i) => toDisplay(i, i.exposure));
  // Cases with a day of their own, the same set as the flags page's chart and New this week, so the two agree.
  const dated = datedFlags(inScope);
  const perDay = byDay(dated, (i) => i.date, () => 1);
  const opened = weekSums(dated, (i) => i.date, () => 1);
  const focus = (apply: () => void) => { apply(); setShown(PAGE); requestAnimationFrame(() => document.getElementById("case-list")?.scrollIntoView({ block: "start", behavior: "smooth" })); };
  const toggleDeadline = () => { if (sort.key !== "deadline" || sort.dir !== "asc") toggle("deadline", "asc"); };
  const assignees = [...new Set(inScope.map((i) => i.assigneeId).filter(Boolean))] as string[];

  // Bulk assignment: only open cases can be picked, and only people who may work on every picked case are offered.
  const pickedCases = all.filter((i) => picked.includes(i.id) && i.status !== "closed");
  const lists = pickedCases.map((i) => assignablePeople(i.outletId, i.propertyId));
  const bulkPeople = lists.length ? lists[0].filter((p) => lists.every((l) => l.some((x) => x.id === p.id))) : [];
  const pageRows = rows.slice(0, shown).filter((i) => i.status !== "closed");
  const allPicked = pageRows.length > 0 && pageRows.every((i) => picked.includes(i.id));
  const togglePick = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const assignPicked = () => {
    if (!bulkTo) return toast.error("Choose who is responsible.");
    const failed = pickedCases.map((i) => assign(i.id, bulkTo, bulkDue)).filter((r) => !r.ok);
    const done = pickedCases.length - failed.length;
    if (failed.length) toast.error(`${done} assigned. ${failed.length} could not be: ${failed[0].ok ? "" : failed[0].error}`);
    else toast.done(`${done} case${done === 1 ? "" : "s"} assigned to ${personName(bulkTo)}, due ${fmtDate(bulkDue)}.`);
    if (done) { setPicked([]); setBulkTo(""); }
  };

  const exportCsv = () => {
    if (!can(user, "reports.export")) return toast.error("Your role cannot export.");
    downloadCsv(`tyll-money-back-list-${DEMO_TODAY}.csv`, [
      ["Case", "Date", "Time", "Hotel", "Outlet", "Type", "Issue", "Following up", "Deadline", "Status", "Outcome", "Currency", "Value involved", "Confirmed loss", "Recovered"],
      ...rows.map((i) => [i.id, i.date, fmtTime(i.min), propertyById[i.propertyId].name, i.outletId ? outletById[i.outletId].name : "Property-wide", TYPE_LABEL[i.type], i.headline, personName(i.assigneeId), i.deadline ?? "", STATUS_LABEL[i.status], i.outcome ? OUTCOME_LABEL[i.outcome] : "", propertyById[i.propertyId].currency, i.exposure.toFixed(2), i.confirmedLoss.toFixed(2), i.recovered.toFixed(2)]),
    ]);
    toast.done(`Exported ${rows.length} cases.`);
  };

  const exportButton = can(user, "reports.export") ? <Button size={embedded ? "sm" : "md"} onClick={exportCsv}><Download size={15} /> Export CSV</Button> : null;
  return (
    <div className="space-y-6">
      {!embedded && (
      <PageHeader title="Money Back List" question="Which flagged transactions are still open?" lead="Every flagged transaction, who is following it up, and what came of it. Simulated data.">
        {exportButton}
      </PageHeader>
      )}

      {!embedded && <SummaryBar
        items={[
          { label: "Open cases", value: open.length, tone: open.length ? "warn" : "pos", compare: versus(opened.now, opened.before, "down", "last week"), onClick: () => focus(() => { setStatus("open"); setOutcome("all"); setInPeriod("any"); }) },
          { label: "Past deadline", value: overdue, tone: overdue ? "warn" : "pos", compare: { text: estimated > 0 ? `Potential losses ${money(potential)}, until checked. ${money(estimated)} of it estimates` : `Potential losses ${money(potential)}, until checked`, good: null }, onClick: () => focus(() => { setStatus("open"); setInPeriod("any"); toggleDeadline(); }) },
          { label: "Confirmed losses", value: money(sum(closed, (i) => toDisplay(i, i.confirmedLoss))), tone: "money", compare: { text: `All time. ${closed.filter((i) => i.outcome === "legitimate").length} of ${closed.length} closed were legitimate`, good: null }, onClick: () => focus(() => { setStatus("closed"); setOutcome("confirmed_loss"); setInPeriod("any"); }) },
          { label: "Recovered", value: money(sum(closed, (i) => toDisplay(i, i.recovered))), tone: "pos", compare: { text: "All time", good: null }, onClick: () => focus(() => { setStatus("closed"); setOutcome("recovered"); setInPeriod("any"); }) },
        ]}
        trend={<StripTrend goodWhen="down" explain="Flagged transactions by the day they happened. The 30 day bought against used check has no day of its own, so it is left out here, as on the flags page. It is in the list below." series={[{ id: "value", label: "Value involved", axis: "money", format: (n) => money(n), points: byDay(dated, (i) => i.date, (i) => toDisplay(i, i.exposure)), goodWhen: "down" as const, explain: "Money at stake in those cases." }]} title="Cases opened per day, last 30 days" points={perDay} format={(n) => `${n} ${n === 1 ? "case" : "cases"}`} summary={`Flagged transactions per day by the day they happened. ${opened.now} this week.`} note="by the day it happened" />}
      />}

      <div id="case-list" className="scroll-mt-24" />
      <Panel flush title={embedded ? "Cases" : undefined} description={embedded ? "Each flagged transaction, who is following it up, the deadline and what came of it. Overdue first, then the most money." : undefined} action={embedded ? exportButton : undefined}>
        <div className="flex flex-wrap items-end gap-2 px-5 pb-4 sm:px-6">
          <Segmented label="Status" value={status} onChange={(v) => { setStatus(v); setShown(PAGE); if (v === "open") setOutcome("all"); }} options={[{ value: "open", label: "Open" }, { value: "closed", label: "Closed" }, { value: "all", label: "All" }]} />
          <Segmented label="Dates" value={inPeriod} onChange={setInPeriod} options={[{ value: "any", label: "Any date" }, { value: "period", label: fmtRange(sel.range) }]} />
          <Select label="Type" hideLabel className="w-[210px]" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="all">All types</option>
            <option value="room">All room charges</option>
            <option value="till">All till rules</option>
            {(Object.keys(TYPE_LABEL) as ExceptionType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </Select>
          <Select label="Outcome" hideLabel className="w-[190px]" value={outcome} onChange={(e) => { setOutcome(e.target.value); if (e.target.value !== "all") setStatus("closed"); }}>
            <option value="all">All outcomes</option>
            {(Object.keys(OUTCOME_LABEL) as Outcome[]).map((o) => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}
          </Select>
          <Select label="Following up" hideLabel className="w-[190px]" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="all">Anyone</option>
            <option value="none">Unassigned</option>
            {assignees.map((a) => <option key={a} value={a}>{personName(a)}</option>)}
          </Select>
          <p className="num ms-auto pb-2 text-[13px] text-steel">{rows.length} case{rows.length === 1 ? "" : "s"}</p>
        </div>
        {mayAssign && pickedCases.length > 0 && (
          <form className="mx-5 mb-4 flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-cloud px-4 py-3 sm:mx-6" onSubmit={(e) => { e.preventDefault(); assignPicked(); }}>
            <p className="pb-2.5 text-sm text-ink">{pickedCases.length} selected</p>
            <Select label="Assign to" className="w-[230px]" value={bulkTo} onChange={(e) => setBulkTo(e.target.value)}>
              <option value="">Choose a person</option>
              {bulkPeople.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </Select>
            <Field label="Deadline" type="date" className="w-[170px]" min={DEMO_TODAY} value={bulkDue} onChange={(e) => setBulkDue(e.target.value)} />
            <Button type="submit" variant="primary">Assign {pickedCases.length}</Button>
            <Button variant="ghost" onClick={() => setPicked([])}>Clear</Button>
            {bulkPeople.length === 0 && <p className="w-full text-xs text-steel">No one can take all of these cases. Pick cases from one outlet.</p>}
          </form>
        )}
        {rows.length === 0 ? (
          <div className="px-5 pb-6 sm:px-6"><EmptyState title="No cases match these filters">Widen the status or date filter, or choose another outlet in the top bar.</EmptyState></div>
        ) : (
          <>
            <TableWrap>
              <table className="w-full min-w-[1080px] text-sm">
                <thead>
                  <tr>
                    {mayAssign && <Th><input type="checkbox" aria-label="Select all open cases shown" className="accent-[var(--color-accent)]" checked={allPicked} onChange={() => setPicked(allPicked ? picked.filter((id) => !pageRows.some((i) => i.id === id)) : [...new Set([...picked, ...pageRows.map((i) => i.id)])])} /></Th>}
                    <Th>Issue</Th>
                    <Th sortKey="outlet" sort={sort} onSort={toggle}>Outlet</Th>
                    <Th sortKey="when" sort={sort} onSort={toggle}>When</Th>
                    <Th sortKey="assignee" sort={sort} onSort={toggle}>Following up</Th>
                    <Th sortKey="deadline" sort={sort} onSort={toggle}>Deadline</Th>
                    <Th sortKey="impact" sort={sort} onSort={toggle} align="right">Financial impact</Th>
                    <Th sortKey="status" sort={sort} onSort={toggle}>Status</Th>
                    <Th>Outcome</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, shown).map((i) => {
                    const late = caseIsPastDeadline(i);
                    return (
                      <tr key={i.id} className={cn(rowClass, "cursor-pointer", picked.includes(i.id) && "bg-cloud")} onClick={() => router.push(`/investigations/${i.id}`)}>
                        {mayAssign && <Td className="w-10">{i.status !== "closed" && <input type="checkbox" aria-labelledby={`case-${i.id}`} className="accent-[var(--color-accent)]" checked={picked.includes(i.id)} onClick={(e) => e.stopPropagation()} onChange={() => togglePick(i.id)} />}</Td>}
                        <Td className="max-w-[360px]">
                          <button type="button" id={`case-${i.id}`} className="text-start text-ink underline-offset-4 hover:underline" onClick={(e) => { e.stopPropagation(); router.push(`/investigations/${i.id}`); }}>{i.headline}</button>
                          <span className="mt-0.5 block text-xs text-steel">{TYPE_LABEL[i.type]}</span>
                        </Td>
                        <Td>{i.outletId ? outletLabel(i.outletId) : <span className="text-steel">{propertyById[i.propertyId].name}</span>}</Td>
                        <Td className="num whitespace-nowrap text-graphite">{fmtDate(i.date)}{i.type === "stock_shortfall" ? ", count" : i.type === "bought_not_used" ? ", 30 day check" : i.type === "cheaper_item_rung" ? ", weekly check" : `, ${fmtTime(i.min)}`}</Td>
                        <Td className={cn(!i.assigneeId && "text-steel")}>{personName(i.assigneeId)}</Td>
                        <Td className={cn("num whitespace-nowrap", late ? "text-neg" : "text-graphite")}>{i.deadline ? fmtDate(i.deadline) : <span className="text-fog">not set</span>}{late && <span className="block text-xs">overdue</span>}</Td>
                        <Td align="right">{money(toDisplay(i, i.exposure))}{isEstimateFlag(i) && <span className="block text-xs text-steel">estimate</span>}</Td>
                        <Td><Badge tone={i.status === "closed" ? "neutral" : i.status === "new" ? "warn" : "ink"}>{STATUS_LABEL[i.status]}</Badge></Td>
                        <Td>
                          {i.outcome ? (
                            <span className="text-[13px]">
                              <span className={cn(i.outcome === "confirmed_loss" && "text-neg", i.outcome === "recovered" && "text-pos")}>{OUTCOME_LABEL[i.outcome]}</span>
                              {i.confirmedLoss + i.recovered > 0 && <span className="num block text-xs text-steel">{i.confirmedLoss > 0 && `lost ${money(toDisplay(i, i.confirmedLoss), { decimals: true })}`}{i.confirmedLoss > 0 && i.recovered > 0 && ", "}{i.recovered > 0 && `recovered ${money(toDisplay(i, i.recovered), { decimals: true })}`}</span>}
                            </span>
                          ) : <span className="text-xs text-fog">pending</span>}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
            {rows.length > shown && (
              <div className="flex justify-center border-t border-hair py-4">{embedded ? <Button variant="ghost" onClick={() => setShown(rows.length)}>Show all {rows.length} cases</Button> : <Button variant="ghost" onClick={() => setShown((n) => n + PAGE)}>Show 25 more of {rows.length - shown}</Button>}</div>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}
