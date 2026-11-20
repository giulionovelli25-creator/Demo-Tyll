"use client";
// Stock takes: start one by location and area, full or partial; see the variance report (system against counted, in
// units and money, by item and group) before anything changes; a manager approves and stock follows. Every stock take
// is kept, and the month-end report adds up the approved ones for accounting.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { Badge, Button, Drawer, EmptyState, Note, Panel, Segmented, Skeleton, SummaryBar, TableWrap, Td, Th, TextArea, WidgetError, cn, linkButton, rowClass, textLink, toast } from "@/components/ui";
import { ingredientById, outletsOfProperty, propertyById } from "@/lib/data/catalog";
import { COUNT_LOCATIONS } from "@/lib/data/locations";
import { can } from "@/lib/domain/access";
import { personName, useView, useSessionEntries } from "@/lib/hooks";
import { useMonthEnd, useProcAction, useStockTake, useStockTakes } from "@/lib/procurement-hooks";
import type { StockTakeView } from "@/lib/server/stocktake";
import { DEMO_TODAY, addDays, downloadCsv, fmtDate, fmtMoney, fmtQty } from "@/lib/util";

const STATUS: Record<StockTakeView["status"], { label: string; tone: "neutral" | "warn" | "pos" | "neg" | "ink" }> = {
  counting: { label: "Counting", tone: "ink" }, submitted: { label: "Waiting for approval", tone: "warn" }, approved: { label: "Approved, stock adjusted", tone: "pos" }, rejected: { label: "Rejected, stock unchanged", tone: "neg" },
};
const signed = (n: number, money: (n: number) => string) => (n > 0 ? `+${money(n)}` : n < 0 ? money(n) : money(0));

function StartDrawer({ propertyId, onClose }: { propertyId: string; onClose: () => void }) {
  const router = useRouter();
  const act = useProcAction();
  const entries = useSessionEntries();
  const [kind, setKind] = useState<"full" | "partial">("partial");
  const [location, setLocation] = useState("main");
  const [areas, setAreas] = useState<string[]>(["walkin"]);
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    try {
      const r = await act<{ take: StockTakeView }>("/api/stock/takes", { action: "start", propertyId, kind, location, areas, ...entries });
      router.push(`/count?take=${r.take.id}`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "The stock take could not start."); setBusy(false); }
  };
  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-[13px] font-medium text-ink">Location</p>
        <select aria-label="Location" value={location} onChange={(e) => setLocation(e.target.value)} className="h-10 w-full rounded-full border border-line bg-paper px-3 text-sm">
          <option value="main">Main store</option>
          {outletsOfProperty(propertyId).map((o) => <option key={o.id} value={o.id} disabled>{o.name} (holds no own store in this hotel)</option>)}
        </select>
      </div>
      <div>
        <p className="mb-2 text-[13px] font-medium text-ink">Count</p>
        <Segmented label="Kind" value={kind} onChange={setKind} options={[{ value: "partial", label: "Some areas" }, { value: "full", label: "Everything" }]} />
        <p className="mt-2 text-xs text-steel">{kind === "full" ? "Every item in every area. Needed for month-end; every item must be counted before it can be sent." : "Only the areas you choose, such as the bar store before a busy weekend."}</p>
      </div>
      {kind === "partial" && (
        <fieldset>
          <legend className="mb-2 text-[13px] font-medium text-ink">Areas</legend>
          <div className="grid grid-cols-2 gap-2">
            {COUNT_LOCATIONS.map((l) => <label key={l.id} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm"><input type="checkbox" checked={areas.includes(l.id)} onChange={(e) => setAreas(e.target.checked ? [...areas, l.id] : areas.filter((a) => a !== l.id))} className="h-4 w-4 accent-[var(--color-accent)]" />{l.name}</label>)}
          </div>
        </fieldset>
      )}
      <Button variant="primary" className="w-full" disabled={busy || (kind === "partial" && !areas.length)} onClick={start}>{busy ? "Starting…" : "Start counting"}</Button>
      <Note>The system quantity of each item is taken now. Stock changes only when a manager approves the stock take.</Note>
      <button type="button" className="sr-only" onClick={onClose}>Close</button>
    </div>
  );
}

function Detail({ id }: { id: string }) {
  const { data, error } = useStockTake(id);
  const { user } = useView();
  const act = useProcAction();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [only, setOnly] = useState<"diff" | "all">("diff");
  if (error) return <WidgetError>This stock take could not load.</WidgetError>;
  if (!data) return <Skeleton className="h-64 w-full" />;
  const t = data.take;
  const money = (n: number) => fmtMoney(n, t.currency as "EUR");
  const decide = async (decision: "approve" | "reject") => {
    setBusy(true);
    try { await act("/api/stock/takes", { action: "decide", id: t.id, decision, note }); toast.done(decision === "approve" ? "Approved. Stock now follows the counts." : "Rejected. Stock is unchanged."); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not save the decision."); }
    finally { setBusy(false); }
  };
  const lines = t.report.lines.filter((l) => l.counted !== null && (only === "all" || Math.abs(l.diff) > 1e-9)).sort((a, b) => a.value - b.value);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3"><Link prefetch={false} href="/stock?tab=takes" className={textLink}>All stock takes</Link></div>
      <SummaryBar
        header={<div className="flex flex-wrap items-center gap-3"><span className="num text-[17px] font-medium text-ink">{t.id}</span><Badge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge><span className="text-sm text-graphite">{t.locationName}, {t.kind === "full" ? "full count" : t.areaNames.join(", ")}, {fmtDate(t.date, true)}</span></div>}
        items={[
          { label: "Items counted", value: `${t.report.totals.counted} of ${t.report.totals.items}`, compare: { text: t.report.totals.notCounted ? `${t.report.totals.notCounted} not counted keep their system figure` : "Every item counted", good: null } },
          { label: "With a difference", value: t.report.totals.withDifference, tone: t.report.totals.withDifference ? "warn" : "pos", compare: { text: `System ${money(t.report.totals.systemValue)}, counted ${money(t.report.totals.countedValue)}`, good: null } },
          { label: "Missing", value: money(-t.report.totals.missing), tone: t.report.totals.missing < 0 ? "warn" : undefined, compare: { text: `Surplus ${money(t.report.totals.surplus)}`, good: null } },
          { label: "Net difference", value: signed(t.report.totals.net, money), tone: t.report.totals.net < 0 ? "neg" : undefined, compare: { text: "At the hotel's valuation method", good: null } },
        ]}
      />
      {t.status === "counting" && <Panel><p className="text-sm text-ink">Still being counted.</p><Link prefetch={false} href={`/count?take=${t.id}`} className={cn(linkButton("primary"), "mt-3")}>Continue counting</Link></Panel>}
      <Panel title="Variance by group" flush>
        <TableWrap>
          <table className="w-full min-w-[640px] text-table">
            <thead><tr><Th>Group</Th><Th align="right">Counted</Th><Th align="right">Missing</Th><Th align="right">Surplus</Th><Th align="right">Net</Th></tr></thead>
            <tbody>{t.report.groups.filter((g) => g.counted).sort((a, b) => a.net - b.net).map((g) => <tr key={g.group} className={rowClass}><Td className="text-ink">{g.group}</Td><Td align="right">{g.counted} of {g.items}</Td><Td align="right">{g.missing ? money(-g.missing) : "None"}</Td><Td align="right">{g.surplus ? money(g.surplus) : "None"}</Td><Td align="right" className={cn("font-medium", g.net < 0 ? "text-neg" : "text-ink")}>{signed(g.net, money)}</Td></tr>)}</tbody>
          </table>
        </TableWrap>
      </Panel>
      <Panel title="Variance by item" action={<Segmented label="Show" size="sm" value={only} onChange={setOnly} options={[{ value: "diff", label: "Differences" }, { value: "all", label: "Every counted item" }]} />} flush>
        {lines.length === 0 ? <div className="p-6"><EmptyState title="No differences">Every counted item matches the system figure.</EmptyState></div> : (
          <TableWrap>
            <table className="w-full min-w-[1000px] text-table">
              <thead><tr><Th>Item</Th><Th align="right">Expected</Th><Th align="right">Counted</Th><Th align="right">Difference</Th><Th align="right">Value</Th><Th>Likely reason, to check</Th><Th>Counted by</Th></tr></thead>
              <tbody>{lines.map((l) => { const g = ingredientById[l.ingredientId]; const ln = t.lines.find((x) => x.ingredientId === l.ingredientId)!; const rv = t.review[l.ingredientId]; return <tr key={l.ingredientId} className={cn(rowClass, rv?.large && "bg-warn-soft/50")}><Td><span className="text-ink">{g.name}</span>{rv?.large && <Badge tone="warn" className="ms-2 !py-0">Large</Badge>}<span className="block text-xs text-steel">{l.group}</span></Td><Td align="right">{fmtQty(l.system, g.unit)}</Td><Td align="right">{fmtQty(l.counted ?? 0, g.unit)}</Td><Td align="right" className={l.diff < 0 ? "text-neg" : undefined}>{l.diff > 0 ? "+" : l.diff < 0 ? "−" : ""}{fmtQty(Math.abs(l.diff), g.unit)}</Td><Td align="right" className={cn("font-medium", l.value < 0 ? "text-neg" : "text-ink")}>{signed(l.value, money)}</Td><Td className="max-w-[300px] text-[13px] text-graphite">{rv?.reason}</Td><Td className="text-xs text-steel">{ln.by ? personName(ln.by) : ""}{ln.method === "scan" ? ", scanned" : ""}</Td></tr>; })}</tbody>
            </table>
          </TableWrap>
        )}
        <Note className="px-6 py-4">A difference is something to check: a delivery not recorded, waste not logged, a recipe that does not match, or stock that left the store. It is not proof of how it happened.</Note>
      </Panel>
      {t.status === "submitted" && (
        <Panel title="Review, then approve" description={`${t.large ? `${t.large} large ${t.large === 1 ? "difference" : "differences"} to check first, highlighted below. ` : ""}Approving sets stock to what was counted for every counted item. Rejecting changes nothing; the counts stay on record.`}>
          {data.mayDecide ? (
            <div className="space-y-3">
              <TextArea label="Note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: checked the cellar difference with the bar manager" />
              <div className="flex flex-wrap gap-2"><Button variant="primary" disabled={busy} onClick={() => decide("approve")}>Approve and adjust stock</Button><Button disabled={busy} onClick={() => decide("reject")}>Reject</Button></div>
            </div>
          ) : <Note>{t.startedBy === user.id || t.lines.some((l) => l.by === user.id) ? "You counted this stock take, so another manager approves it." : "A manager approves it."}</Note>}
        </Panel>
      )}
      <Panel title="History"><ul className="space-y-2 text-sm">{t.history.map((h, i) => <li key={i}><span className="text-ink">{h.action}</span> <span className="text-xs text-steel">{personName(h.by)}, {fmtDate(h.at.slice(0, 10), true)} {h.at.slice(11, 16)}</span>{h.note && <p className="text-graphite">{h.note}</p>}</li>)}</ul></Panel>
    </div>
  );
}

function MonthEnd({ propertyId }: { propertyId: string }) {
  const months = [0, 1, 2].map((i) => addDays(`${DEMO_TODAY.slice(0, 7)}-01`, -i * 28).slice(0, 7)).filter((m, i, a) => a.indexOf(m) === i);
  const [month, setMonth] = useState(months[0]);
  const { data } = useMonthEnd(propertyId, month);
  const money = (n: number) => fmtMoney(n, propertyById[propertyId].currency);
  const csv = () => data && downloadCsv(`tyll-stock-takes-${propertyId}-${month}.csv`, [["Stock take", "Date", "Location", "Kind", "Items counted", "System value", "Counted value", "Missing", "Surplus", "Net", "Approved by"], ...data.takes.map((t) => [t.id, t.date, t.location, t.kind, t.counted, t.systemValue, t.countedValue, t.missing, t.surplus, t.net, t.approvedBy ? personName(t.approvedBy) : ""])]);
  return (
    <Panel title="Month-end report" description="Approved stock takes in the month and the variance accounting books. Every stock take is kept, whatever its outcome." action={<span className="flex items-center gap-3"><select aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-9 rounded-full border border-line bg-paper px-3 text-sm">{months.map((m) => <option key={m} value={m}>{new Date(`${m}-01T00:00:00Z`).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}</option>)}</select>{data && data.takes.length > 0 && <button type="button" className={textLink} onClick={csv}>Download CSV</button>}</span>} flush>
      {!data ? <div className="p-6"><Skeleton className="h-24 w-full" /></div> : data.takes.length === 0 ? <div className="p-6"><EmptyState title="No approved stock take this month">Approved stock takes appear here with their variance.</EmptyState></div> : (
        <>
          <TableWrap>
            <table className="w-full min-w-[760px] text-table">
              <thead><tr><Th>Stock take</Th><Th>Location</Th><Th align="right">Counted value</Th><Th align="right">Missing</Th><Th align="right">Surplus</Th><Th align="right">Net</Th></tr></thead>
              <tbody>{data.takes.map((t) => <tr key={t.id} className={rowClass}><Td><Link prefetch={false} href={`/stock?tab=takes&take=${t.id}`} className="num text-ink underline-offset-4 hover:underline">{t.id}</Link><span className="block text-xs text-steel">{fmtDate(t.date, true)}, {t.kind === "full" ? "full" : "partial"}</span></Td><Td>{t.location}</Td><Td align="right">{money(t.countedValue)}</Td><Td align="right">{money(-t.missing)}</Td><Td align="right">{money(t.surplus)}</Td><Td align="right" className={cn("font-medium", t.net < 0 ? "text-neg" : "text-ink")}>{signed(t.net, money)}</Td></tr>)}</tbody>
            </table>
          </TableWrap>
          <p className="flex flex-wrap justify-end gap-x-6 px-6 py-4 text-sm text-graphite"><span>Missing {money(-data.totals.missing)}</span><span>Surplus {money(data.totals.surplus)}</span><span className="text-ink">Net <span className={cn("num ms-1 font-medium", data.totals.net < 0 ? "text-neg" : "text-ink")}>{signed(data.totals.net, money)}</span></span></p>
        </>
      )}
    </Panel>
  );
}

export function StockTakes({ propertyId, tabs }: { propertyId: string; tabs?: ReactNode }) {
  const take = useSearchParams().get("take");
  const { user } = useView();
  const { data, error } = useStockTakes(take ? null : propertyId);
  const [starting, setStarting] = useState(false);
  const money = (n: number) => fmtMoney(n, propertyById[propertyId].currency);
  const month = DEMO_TODAY.slice(0, 7);
  const takes = useMemo(() => data?.takes ?? [], [data]);
  if (take) return <div className="space-y-6">{tabs}<Detail id={take} /></div>;
  const approved = takes.filter((t) => t.status === "approved" && t.date.startsWith(month));
  return (
    <div className="space-y-6">
      {error ? <WidgetError>Stock takes could not load.</WidgetError> : !data ? <Skeleton className="h-64 w-full" /> : (
        <>
          <SummaryBar
            items={[
              { label: "Approved this month", value: approved.length, compare: { text: `Net ${signed(approved.reduce((s, t) => s + t.report.totals.net, 0), money)}`, good: null } },
              { label: "Waiting for approval", value: takes.filter((t) => t.status === "submitted").length, tone: takes.some((t) => t.status === "submitted") ? "warn" : undefined, compare: { text: "Stock changes only once approved", good: null } },
              { label: "Being counted", value: takes.filter((t) => t.status === "counting").length, compare: { text: "On phones and tablets", good: null } },
            ]}
            action={data.mayCount && can(user, "stock.count") ? <Button variant="primary" onClick={() => setStarting(true)}>Start a stock take</Button> : undefined}
          />
          {tabs}
          <Panel title="Stock takes" flush>
            {takes.length === 0 ? <div className="p-6"><EmptyState title="No stock take yet">Start one by area: count on a phone or tablet, by scanning the pack barcode or typing the quantity.</EmptyState></div> : (
              <TableWrap>
                <table className="w-full min-w-[820px] text-table">
                  <thead><tr><Th>Stock take</Th><Th>What</Th><Th>Status</Th><Th align="right">Counted</Th><Th align="right">Net difference</Th><Th>Started by</Th></tr></thead>
                  <tbody>{takes.map((t) => (
                    <tr key={t.id} className={rowClass}>
                      <Td><Link prefetch={false} href={t.status === "counting" && t.startedBy === user.id ? `/count?take=${t.id}` : `/stock?tab=takes&take=${t.id}`} className="num text-ink underline-offset-4 hover:underline">{t.id}</Link><span className="block text-xs text-steel">{fmtDate(t.date, true)}</span></Td>
                      <Td>{t.locationName}<span className="block text-xs text-steel">{t.kind === "full" ? "Full count" : t.areaNames.join(", ")}</span></Td>
                      <Td><Badge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge></Td>
                      <Td align="right">{t.report.totals.counted} of {t.report.totals.items}</Td>
                      <Td align="right" className={cn("font-medium", t.report.totals.net < 0 ? "text-neg" : "text-ink")}>{t.report.totals.counted ? signed(t.report.totals.net, money) : "None yet"}</Td>
                      <Td>{personName(t.startedBy)}</Td>
                    </tr>
                  ))}</tbody>
                </table>
              </TableWrap>
            )}
          </Panel>
          <MonthEnd propertyId={propertyId} />
        </>
      )}
      <Drawer open={starting} onClose={() => setStarting(false)} title="Start a stock take" description="Choose where and what to count.">
        {starting && <StartDrawer propertyId={propertyId} onClose={() => setStarting(false)} />}
      </Drawer>
    </div>
  );
}
