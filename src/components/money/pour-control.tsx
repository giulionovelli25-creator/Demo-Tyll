"use client";
// Over pouring: how many glasses each bottle really gave. By wine, then where and when. Never by person. Each part opens on its own in Drinks control.
import { useRemembered } from "@/components/disclosure";
import { EmptyState, Note, Segmented, StatusPill, TableWrap, Td, Th, cn, rowClass, OutletDot } from "@/components/ui";
import { useAlertFeed } from "@/lib/alert-feed";
import { outletById } from "@/lib/data/catalog";
import { SHIFTS, type PourFigures } from "@/lib/domain/pour";
import type { PourPeriod } from "@/lib/server/pour";
import type { Currency } from "@/lib/types";
import { fmtMoney, fmtNum } from "@/lib/util";

type Family = "wine" | "spirits";

const PERIODS: { value: PourPeriod; label: string }[] = [{ value: "today", label: "Today" }, { value: "week", label: "This week" }, { value: "month", label: "This month" }];
const fmtBottles = (n: number) => fmtNum(n, n % 1 === 0 ? 0 : 1);

function YieldCell({ f }: { f: PourFigures }) {
  if (f.yieldPer === null) return <span className="text-steel">None</span>;
  return <span className={cn("num", f.flagged ? "font-medium text-neg" : "text-ink")}>{fmtNum(f.yieldPer, 1)}</span>;
}

function PeriodSwitch() {
  const [period, setPeriod] = useRemembered<PourPeriod>("drinks.period", "week");
  return <Segmented size="sm" label="Period" value={period} onChange={setPeriod} options={PERIODS} />;
}

function FamilySwitch() {
  const [family, setFamily] = useRemembered<Family>("drinks.family", "wine");
  return <Segmented size="sm" label="Wine or spirits" value={family} onChange={setFamily} options={[{ value: "wine", label: "Wine" }, { value: "spirits", label: "Spirits" }]} />;
}

/** One line of what is not billed, today, this week and this month. */
function Gaps({ family }: { family: Family }) {
  const { pour } = useAlertFeed();
  if (!pour) return null;
  const noun = family === "wine" ? "glasses" : "measures";
  const money = (n: number) => fmtMoney(n, pour.currency as Currency);
  return <p className="text-[13px] text-graphite">Not billed: {PERIODS.map((p) => `${p.label.toLowerCase()} ${money(pour[family].totals[p.value].gapValue)} (${fmtNum(pour[family].totals[p.value].gap)} ${noun})`).join(", ")}.</p>;
}

export function PourByItem({ family }: { family: Family }) {
  const { pour } = useAlertFeed();
  const [period] = useRemembered<PourPeriod>("drinks.period", "week");
  if (!pour) return null;
  const data = pour[family];
  const money = (n: number) => fmtMoney(n, pour.currency as Currency);
  const Noun = family === "wine" ? "Glasses" : "Measures";
  if (!data.rows.some((r) => r.periods.month.sold > 0)) return <EmptyState title={`No ${family} sold here this month`}>Pick another outlet in the top bar.</EmptyState>;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 sm:px-6"><Gaps family={family} /><PeriodSwitch /></div>
      <div className="pt-3">
            <TableWrap>
              <table className="w-full min-w-[560px] text-table">
                <thead><tr>
                  <Th>{family === "wine" ? "Wine" : "Spirit"}</Th><Th align="right">Bottles opened</Th><Th align="right">{Noun} sold</Th><Th align="right">Expected per bottle</Th><Th align="right">Actual yield</Th>
                  <Th align="right">Gap</Th>
                </tr></thead>
                <tbody>
                  {data.rows.map((r) => {
                    const f = r.periods[period];
                    return (
                      <tr key={r.skuId} className={rowClass}>
                        <Td><span className="text-ink">{r.name}</span>{f.flagged && <StatusPill rag="amber" className="ms-2 !py-0">Over pouring</StatusPill>}</Td>
                        <Td align="right">{fmtBottles(f.opened)}</Td>
                        <Td align="right">{fmtNum(f.sold)}</Td>
                        <Td align="right">{r.perBottle}</Td>
                        <Td align="right"><YieldCell f={f} /></Td>
                        <Td align="right"><span className={f.gapValue > 0 ? "text-money" : "text-steel"}>{f.gapValue > 0 ? money(f.gapValue) : "None"}</span></Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
      </div>
      <div className="px-4 py-3 sm:px-6">
        <p className="mb-2 text-xs text-steel">Flagged when a bottle gives under {Math.round(pour.threshold * 100)}% of what it should.</p>
        <Note>
            Glasses sold come from the POS. Bottles opened are simulated in this demo, because the POS does not record them, and the one house wine on the menu is shared across labels here. A low yield usually means generous pours, unrecorded free glasses or breakage. Check pour size and measures first. It says nothing about any one person.
          </Note>
      </div>
    </>
  );
}

export function PourWhere() {
  const { pour } = useAlertFeed();
  const [period] = useRemembered<PourPeriod>("drinks.period", "week");
  const [family] = useRemembered<Family>("drinks.family", "wine");
  if (!pour) return null;
  const data = pour[family];
  const money = (n: number) => fmtMoney(n, pour.currency as Currency);
  const per = (r: { perBottle: number }) => `${r.perBottle} per bottle`;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-4 sm:px-6"><FamilySwitch /><PeriodSwitch /></div>
              <TableWrap>
                <table className="w-full min-w-[420px] text-table">
                  <thead><tr><Th>Outlet</Th>{SHIFTS.map((s) => <Th key={s.id} align="right">{s.name}</Th>)}<Th align="right">Gap</Th></tr></thead>
                  <tbody>
                    {data.outlets.map((o) => (
                      <tr key={o.outletId} className={rowClass}>
                        <Td><span className="text-ink"><OutletDot id={o.outletId} />{outletById[o.outletId].name}</span></Td>
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
    </>
  );
}

export function PourPatterns() {
  const { pour } = useAlertFeed();
  const [family] = useRemembered<Family>("drinks.family", "wine");
  if (!pour) return null;
  const flags = pour[family].flags;
  return (
    <>
      <div className="px-4 py-4 sm:px-6"><FamilySwitch /></div>
      {flags.length === 0 ? <div className="px-4 pb-6 sm:px-6"><EmptyState title="Nothing below the threshold">Every outlet and shift is pouring close to standard.</EmptyState></div> : (
        <ul>{flags.map((f) => <li key={f.id} className="border-t border-hair px-4 py-3 text-sm text-graphite sm:px-6">{f.text}</li>)}</ul>
      )}
    </>
  );
}
