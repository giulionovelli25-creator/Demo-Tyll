"use client";
// Pour Control: how many glasses each bottle really gave. By wine, then where and when. Never by person.
import { useState } from "react";
import { EmptyState, KeyNumber, KeyNumbers, Note, Panel, Segmented, Skeleton, StatusPill, TableWrap, Td, Th, WidgetError, cn, rowClass } from "@/components/ui";
import { useAlertFeed } from "@/lib/alert-feed";
import { outletById } from "@/lib/data/catalog";
import { SHIFTS, type PourFigures } from "@/lib/domain/pour";
import type { PourPeriod } from "@/lib/server/pour";
import type { Currency } from "@/lib/types";
import { fmtMoney, fmtNum } from "@/lib/util";

const PERIODS: { value: PourPeriod; label: string }[] = [{ value: "today", label: "Today" }, { value: "week", label: "This week" }, { value: "month", label: "This month" }];
const fmtBottles = (n: number) => fmtNum(n, n % 1 === 0 ? 0 : 1);

function YieldCell({ f }: { f: PourFigures }) {
  if (f.yieldPer === null) return <span className="text-steel">None</span>;
  return <span className={cn("num", f.flagged ? "font-medium text-neg" : "text-ink")}>{fmtNum(f.yieldPer, 1)}</span>;
}

export function PourControl() {
  const { pour } = useAlertFeed();
  const [family, setFamily] = useState<"wine" | "spirits">("wine");
  const [period, setPeriod] = useState<PourPeriod>("week");
  const [allFlags, setAllFlags] = useState(false);

  if (!pour) return <div className="space-y-4" aria-busy><KeyNumbers>{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}</KeyNumbers><Skeleton className="h-72 w-full" /></div>;

  const data = pour[family];
  const money = (n: number) => fmtMoney(n, pour.currency as Currency);
  const noun = family === "wine" ? "glasses" : "measures";
  const Noun = family === "wine" ? "Glasses" : "Measures";
  const per = (r: { perBottle: number }) => `${r.perBottle} per bottle`;
  const flagged = data.outlets.reduce((n, o) => n + SHIFTS.filter((s) => o.shifts[s.id][period].flagged).length, 0);
  const flags = allFlags ? data.flags : data.flags.slice(0, 6);
  const hasData = data.rows.some((r) => r.periods.month.sold > 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented label="Wine or spirits" value={family} onChange={setFamily} options={[{ value: "wine", label: "Wine by the glass" }, { value: "spirits", label: "Spirits" }]} />
        <Segmented size="sm" label="Period" value={period} onChange={setPeriod} options={PERIODS} />
      </div>

      {!hasData ? <EmptyState title={`No ${family} sold here this month`}>Pick another outlet in the top bar.</EmptyState> : (
        <>
          <KeyNumbers>
            {PERIODS.map((p) => {
              const f = data.totals[p.value];
              return <KeyNumber key={p.value} label={`Gap, ${p.label.toLowerCase()}`} value={money(f.gapValue)} tone={f.gapValue > 0 ? "money" : undefined} note={`${fmtNum(f.gap)} ${noun} not billed`} />;
            })}
            <KeyNumber label="Below the threshold" value={flagged} tone={flagged ? "warn" : "pos"} note={`Outlet shifts, ${PERIODS.find((p) => p.value === period)!.label.toLowerCase()}`} />
          </KeyNumbers>

          <Panel title={family === "wine" ? "Per wine by the glass" : "Per spirit"} description={`Flagged in red when a bottle gives under ${Math.round(pour.threshold * 100)}% of what it should. The gap columns are always today, this week and this month.`} flush>
            <TableWrap>
              <table className="w-full min-w-[760px] text-table">
                <thead><tr>
                  <Th>{family === "wine" ? "Wine" : "Spirit"}</Th><Th align="right">Bottles opened</Th><Th align="right">{Noun} sold</Th><Th align="right">Expected per bottle</Th><Th align="right">Actual yield</Th>
                  <Th align="right">Gap today</Th><Th align="right">Gap this week</Th><Th align="right">Gap this month</Th>
                </tr></thead>
                <tbody>
                  {data.rows.map((r) => {
                    const f = r.periods[period];
                    return (
                      <tr key={r.skuId} className={rowClass}>
                        <Td><span className="text-ink">{r.name}</span>{f.flagged && <StatusPill rag="amber" className="ml-2 !py-0">Over pouring</StatusPill>}</Td>
                        <Td align="right">{fmtBottles(f.opened)}</Td>
                        <Td align="right">{fmtNum(f.sold)}</Td>
                        <Td align="right">{r.perBottle}</Td>
                        <Td align="right"><YieldCell f={f} /></Td>
                        {PERIODS.map((p) => <Td key={p.value} align="right"><span className={r.periods[p.value].gapValue > 0 ? "text-money" : "text-steel"}>{r.periods[p.value].gapValue > 0 ? money(r.periods[p.value].gapValue) : "None"}</span><span className="block text-xs text-steel">{fmtNum(r.periods[p.value].gap)} {noun}</span></Td>)}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          </Panel>

          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
            <Panel title="Where and when" description={`${Noun} each bottle gave, by outlet and shift. Red is below the threshold. No names here: this is about the shift, not a person.`} flush>
              <TableWrap>
                <table className="w-full min-w-[420px] text-table">
                  <thead><tr><Th>Outlet</Th>{SHIFTS.map((s) => <Th key={s.id} align="right">{s.name}</Th>)}<Th align="right">Gap</Th></tr></thead>
                  <tbody>
                    {data.outlets.map((o) => (
                      <tr key={o.outletId} className={rowClass}>
                        <Td><span className="text-ink">{outletById[o.outletId].name}</span></Td>
                        {SHIFTS.map((s) => {
                          const f = o.shifts[s.id][period];
                          return <Td key={s.id} align="right"><span className={cn("inline-block min-w-10 rounded-md px-1.5 py-0.5", f.flagged && "bg-neg-soft")}><YieldCell f={f} /></span>{f.opened > 0 && <span className="block text-xs text-steel">{fmtBottles(f.opened)} bottles</span>}</Td>;
                        })}
                        <Td align="right"><span className={o.periods[period].gapValue > 0 ? "text-money" : "text-steel"}>{o.periods[period].gapValue > 0 ? money(o.periods[period].gapValue) : "None"}</span></Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
              <p className="px-4 py-3 text-xs text-steel sm:px-6">Should give {per(data.rows[0])}{family === "spirits" ? " for rum, more for spirits in smaller measures" : ""}. Day is until 5 PM, evening until 10 PM, late after that.</p>
            </Panel>

            <Panel title="Flags to check" description="Patterns over the last 4 weeks, largest first. Each one covers every matching shift in that time." flush>
              {flags.length === 0 ? <div className="px-4 pb-6 sm:px-6"><EmptyState title="Nothing below the threshold">Every outlet and shift is pouring close to standard.</EmptyState></div> : (
                <ul>
                  {flags.map((f) => <li key={f.id} className="border-t border-hair px-4 py-3 text-sm text-graphite sm:px-6">{f.text}</li>)}
                </ul>
              )}
              {data.flags.length > 6 && <div className="border-t border-hair px-4 py-3 sm:px-6"><button type="button" onClick={() => setAllFlags((v) => !v)} className="text-[13px] font-medium text-accent-ink underline-offset-4 hover:underline">{allFlags ? "Show fewer" : `Show all ${data.flags.length} flags`}</button></div>}
            </Panel>
          </div>

          <Note>
            Glasses sold come from the POS. Bottles opened are simulated in this demo, because the POS does not record them, and the one house wine on the menu is shared across labels here. A low yield usually means generous pours, unrecorded free glasses or breakage. Check pour size and measures first. It says nothing about any one person.
          </Note>
        </>
      )}
      {!pour && <WidgetError>Pour Control could not load.</WidgetError>}
    </div>
  );
}
