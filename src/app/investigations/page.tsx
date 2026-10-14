"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Download } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Button, EmptyState, PageHeader, Panel, Segmented, Select, Stat, TableWrap, Td, Th, cn, rowClass, toast, useSort } from "@/components/ui";
import { outletById, outletLabel, propertyById } from "@/lib/data/catalog";
import { can } from "@/lib/domain/access";
import { ROOM_TYPES, TYPE_LABEL } from "@/lib/domain/detect";
import { exceptionInSel } from "@/lib/domain/metrics";
import { personName, useInvestigations, useView } from "@/lib/hooks";
import { OUTCOME_LABEL, STATUS_LABEL } from "@/lib/labels";
import type { ExceptionType, Investigation, Outcome } from "@/lib/types";
import { DEMO_TODAY, downloadCsv, fmtDate, fmtRange, fmtTime, fxRate, sum } from "@/lib/util";

type Key = "when" | "outlet" | "type" | "assignee" | "deadline" | "impact" | "status";
type StatusFilter = "open" | "closed" | "all";
const PAGE = 25;

export default function MoneyBackListPage() {
  const params = useSearchParams();
  const router = useRouter();
  const { sel, money, currency, user } = useView();
  const all = useInvestigations();
  const [status, setStatus] = useState<StatusFilter>((params.get("status") as StatusFilter) ?? "open");
  const [type, setType] = useState(params.get("type") ?? "all");
  const [outcome, setOutcome] = useState(params.get("outcome") ?? "all");
  const [assignee, setAssignee] = useState("all");
  const [inPeriod, setInPeriod] = useState<"any" | "period">(params.get("status") === "closed" ? "period" : "any");
  const [shown, setShown] = useState(PAGE);
  const { sort, toggle } = useSort<Key>({ key: "when", dir: "desc" });

  const toDisplay = (i: Investigation, n: number) => n * fxRate(propertyById[i.propertyId].currency, currency);
  const inScope = useMemo(() => all.filter((i) => exceptionInSel(i, sel)), [all, sel]);
  const rows = useMemo(() => {
    let list = inScope;
    if (inPeriod === "period") list = list.filter((i) => i.date >= sel.range.from && i.date <= sel.range.to);
    if (status === "open") list = list.filter((i) => i.status !== "closed");
    if (status === "closed") list = list.filter((i) => i.status === "closed");
    if (type !== "all") list = list.filter((i) => (type === "room" ? ROOM_TYPES.includes(i.type) : i.type === type));
    if (outcome !== "all") list = list.filter((i) => i.outcome === outcome);
    if (assignee !== "all") list = list.filter((i) => (assignee === "none" ? !i.assigneeId : i.assigneeId === assignee));
    const value = (i: Investigation): number | string =>
      ({
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
  const overdue = open.filter((i) => i.deadline && i.deadline < DEMO_TODAY).length;
  const assignees = [...new Set(inScope.map((i) => i.assigneeId).filter(Boolean))] as string[];

  const exportCsv = () => {
    if (!can(user, "reports.export")) return toast.error("Your role cannot export.");
    downloadCsv(`tyll-money-back-list-${DEMO_TODAY}.csv`, [
      ["Case", "Date", "Time", "Hotel", "Outlet", "Type", "Issue", "Responsible", "Deadline", "Status", "Outcome", "Currency", "Value involved", "Confirmed loss", "Recovered"],
      ...rows.map((i) => [i.id, i.date, fmtTime(i.min), propertyById[i.propertyId].name, i.outletId ? outletById[i.outletId].name : "Property-wide", TYPE_LABEL[i.type], i.headline, personName(i.assigneeId), i.deadline ?? "", STATUS_LABEL[i.status], i.outcome ? OUTCOME_LABEL[i.outcome] : "", propertyById[i.propertyId].currency, i.exposure.toFixed(2), i.confirmedLoss.toFixed(2), i.recovered.toFixed(2)]),
    ]);
    toast.done(`Exported ${rows.length} cases.`);
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Money Back List" lead="Every transaction Tyll has flagged, who is responsible for it, and what came of it. Shared by owners, finance and outlet managers.">
        <Button onClick={exportCsv}><Download size={15} /> Export CSV</Button>
      </PageHeader>

      <Panel>
        <div className="grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-5">
          <Stat label="Open cases" value={open.length} sub={overdue ? `${overdue} past deadline` : "none past deadline"} onClick={() => { setStatus("open"); setInPeriod("any"); }} />
          <Stat label="Potential losses, open" tone={open.length ? "warn" : undefined} value={money(sum(open, (i) => toDisplay(i, i.exposure)))} />
          <Stat label="Confirmed losses, all time" tone="neg" value={money(sum(closed, (i) => toDisplay(i, i.confirmedLoss)))} onClick={() => { setStatus("closed"); setOutcome("confirmed_loss"); setInPeriod("any"); }} />
          <Stat label="Recovered, all time" tone="pos" value={money(sum(closed, (i) => toDisplay(i, i.recovered)))} onClick={() => { setStatus("closed"); setOutcome("recovered"); setInPeriod("any"); }} />
          <Stat label="Closed as legitimate" value={closed.filter((i) => i.outcome === "legitimate").length} sub={`of ${closed.length} closed`} onClick={() => { setStatus("closed"); setOutcome("legitimate"); setInPeriod("any"); }} />
        </div>
      </Panel>

      <Panel flush>
        <div className="flex flex-wrap items-end gap-2 px-5 pb-4 sm:px-6">
          <Segmented label="Status" value={status} onChange={(v) => { setStatus(v); setShown(PAGE); if (v === "open") setOutcome("all"); }} options={[{ value: "open", label: "Open" }, { value: "closed", label: "Closed" }, { value: "all", label: "All" }]} />
          <Segmented label="Dates" value={inPeriod} onChange={setInPeriod} options={[{ value: "any", label: "Any date" }, { value: "period", label: fmtRange(sel.range) }]} />
          <Select label="Type" hideLabel className="w-[210px]" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="all">All types</option>
            <option value="room">All room charges</option>
            {(Object.keys(TYPE_LABEL) as ExceptionType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </Select>
          <Select label="Outcome" hideLabel className="w-[190px]" value={outcome} onChange={(e) => { setOutcome(e.target.value); if (e.target.value !== "all") setStatus("closed"); }}>
            <option value="all">All outcomes</option>
            {(Object.keys(OUTCOME_LABEL) as Outcome[]).map((o) => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}
          </Select>
          <Select label="Responsible" hideLabel className="w-[190px]" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="all">Anyone</option>
            <option value="none">Unassigned</option>
            {assignees.map((a) => <option key={a} value={a}>{personName(a)}</option>)}
          </Select>
          <p className="num ml-auto pb-2 text-[13px] text-steel">{rows.length} case{rows.length === 1 ? "" : "s"}</p>
        </div>
        {rows.length === 0 ? (
          <div className="px-5 pb-6 sm:px-6"><EmptyState title="No cases match these filters">Widen the status or date filter, or choose another outlet in the top bar.</EmptyState></div>
        ) : (
          <>
            <TableWrap>
              <table className="w-full min-w-[1080px] text-sm">
                <thead>
                  <tr>
                    <Th>Issue</Th>
                    <Th sortKey="outlet" sort={sort} onSort={toggle}>Outlet</Th>
                    <Th sortKey="when" sort={sort} onSort={toggle}>When</Th>
                    <Th sortKey="assignee" sort={sort} onSort={toggle}>Responsible</Th>
                    <Th sortKey="deadline" sort={sort} onSort={toggle}>Deadline</Th>
                    <Th sortKey="impact" sort={sort} onSort={toggle} align="right">Financial impact</Th>
                    <Th sortKey="status" sort={sort} onSort={toggle}>Status</Th>
                    <Th>Outcome</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, shown).map((i) => {
                    const late = i.status !== "closed" && i.deadline && i.deadline < DEMO_TODAY;
                    return (
                      <tr key={i.id} className={cn(rowClass, "cursor-pointer")} onClick={() => router.push(`/investigations/${i.id}`)}>
                        <Td className="max-w-[360px]">
                          <button type="button" className="text-left text-ink underline-offset-4 hover:underline" onClick={(e) => { e.stopPropagation(); router.push(`/investigations/${i.id}`); }}>{i.headline}</button>
                          <span className="mt-0.5 block text-xs text-steel">{TYPE_LABEL[i.type]} · {i.id.replace("EX-", "")}</span>
                        </Td>
                        <Td>{i.outletId ? outletLabel(i.outletId) : <span className="text-steel">{propertyById[i.propertyId].name}</span>}</Td>
                        <Td className="num whitespace-nowrap text-graphite">{fmtDate(i.date)}, {fmtTime(i.min)}</Td>
                        <Td className={cn(!i.assigneeId && "text-steel")}>{personName(i.assigneeId)}</Td>
                        <Td className={cn("num whitespace-nowrap", late ? "text-neg" : "text-graphite")}>{i.deadline ? fmtDate(i.deadline) : <span className="text-fog">not set</span>}{late && <span className="block text-xs">overdue</span>}</Td>
                        <Td align="right">{money(toDisplay(i, i.exposure), { decimals: true })}</Td>
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
              <div className="flex justify-center border-t border-hair py-4"><Button variant="ghost" onClick={() => setShown((n) => n + PAGE)}>Show 25 more of {rows.length - shown}</Button></div>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}
