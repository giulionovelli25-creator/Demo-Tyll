"use client";
// Over pouring, where the bottles come from: empty bottle scans where an outlet scans them, simulated elsewhere.
// Then the scanned shifts where the empties show the most not billed. Who scanned is never shown, not even by job: staff on
// shift scan, and binning a bottle is not pouring it.
import { ChevronDown } from "lucide-react";
import { useState, type CSSProperties, type ReactNode } from "react";
import { Badge, Note, OutletDot, TableWrap, Td, Th, cn, rowClass, textLink } from "@/components/ui";
import { useAlertFeed } from "@/lib/alert-feed";
import { outletById } from "@/lib/data/catalog";
import type { PourEmpties, ScannedShift } from "@/lib/server/pour";
import type { Currency } from "@/lib/types";
import { fmtDate, fmtMoney, fmtNum, fmtTime } from "@/lib/util";

const SHIFT_WORD: Record<string, string> = { day: "day shift", evening: "evening shift", late: "late shift" };
const TOP = 3;

/** One line for the closed row: which outlets scan, since when, and that the rest is simulated. In parts, so each translates. */
export function emptiesSummary(e: PourEmpties | undefined): ReactNode {
  if (!e) return "Loading";
  const scanning = e.outlets.filter((o) => o.from);
  if (!scanning.length) return "No outlet scans its empties yet, so every bottle here is simulated.";
  const week = scanning.reduce((n, o) => n + o.week, 0);
  const rest = e.outlets.length - scanning.length;
  return (
    <>
      <span>{scanning.map((o) => `${outletById[o.outletId].name} since ${fmtDate(o.from!)}`).join(", ")}.</span>{" "}
      <span>{fmtNum(week)} {week === 1 ? "empty" : "empties"} scanned in the last 7 days.</span>
      {rest > 0 && <>{" "}<span>{rest === 1 ? "One other outlet is simulated." : `${rest} other outlets are simulated.`}</span></>}
    </>
  );
}

/** Where an outlet's bottles come from: its scans, or simulated. */
function Source({ o }: { o: PourEmpties["outlets"][number] }) {
  return o.from ? <Badge tone="pos">Scans since {fmtDate(o.from)}</Badge> : <Badge>Simulated</Badge>;
}

/** The scans behind one shift, by time: down the first column, then down the second, so the times read in order. */
function ScanList({ s }: { s: ScannedShift }) {
  return (
    <div className="rounded-[var(--radius-control)] bg-cloud p-4 text-[13px]">
      <ul className="grid max-w-[520px] gap-x-8 gap-y-1 sm:grid-flow-col sm:grid-cols-2 sm:grid-rows-[repeat(var(--rows),auto)]" style={{ "--rows": Math.max(1, Math.ceil(s.scans.length / 2)) } as CSSProperties}>
        {s.scans.map((x, i) => <li key={i} className="flex gap-3"><span className="num w-[72px] shrink-0 text-ink">{fmtTime(x.min)}</span><span className="text-steel">{x.method === "scan" ? "scanned" : "picked from the list"}</span></li>)}
      </ul>
      <p className="mt-2 text-xs text-steel">Scanned by staff on shift. Who scanned a bottle is not who poured it. A prompt to check, not proof.</p>
    </div>
  );
}

/** `openFirst` shows the scans of the largest shift straight away, for a link that asks for them. */
export function EmptyScans({ onHelp, openFirst }: { onHelp: () => void; openFirst?: boolean }) {
  const { pour } = useAlertFeed();
  const [all, setAll] = useState(false);
  const [picked, setOpen] = useState<string | null | undefined>(undefined);
  if (!pour) return null;
  const e = pour.empties;
  const open = picked === undefined ? (openFirst ? e.shifts[0]?.id ?? null : null) : picked;
  const money = (n: number) => fmtMoney(n, pour.currency as Currency);
  const shifts = all ? e.shifts : e.shifts.slice(0, TOP);
  return (
    <>
      <Note className="px-4 pt-4 text-[13px] sm:px-6">Staff scan each empty wine or spirit bottle before it goes in the bin. Where an outlet scans, its bottles here are the empties scanned plus the open bottle counted at close. Elsewhere bottles opened are simulated.</Note>
      <div className="pt-3">
        <TableWrap>
          <table className="w-full min-w-[340px] text-table sm:min-w-[520px]">
            <thead><tr><Th>Outlet</Th><Th className="hidden sm:table-cell">Bottles come from</Th><Th align="right"><span className="sm:hidden">Today</span><span className="hidden sm:inline">Empties today</span></Th><Th align="right" className="pe-5 sm:pe-3"><span className="sm:hidden">7 days</span><span className="hidden sm:inline">Last 7 days</span></Th><Th align="right" className="hidden sm:table-cell">Last 30 days</Th></tr></thead>
            <tbody>
              {e.outlets.map((o) => (
                <tr key={o.outletId} className={rowClass}>
                  <Td><span className="text-ink"><OutletDot id={o.outletId} />{outletById[o.outletId].name}</span><span className="mt-1 block sm:hidden"><Source o={o} /></span></Td>
                  <Td className="hidden sm:table-cell"><Source o={o} /></Td>
                  <Td align="right">{fmtNum(o.today)}</Td>
                  <Td align="right" className="pe-5 sm:pe-3">{fmtNum(o.week)}</Td>
                  <Td align="right" className="hidden sm:table-cell">{fmtNum(o.month)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </div>
      <div className="border-t border-hair px-4 pb-2 pt-4 sm:px-6">
        <p className="text-[13px] font-medium text-ink">Shifts where the empties show the most not billed</p>
        <p className="mt-0.5 text-[13px] text-steel">Last 30 days, scanned shifts only, largest first.</p>
      </div>
      {e.shifts.length === 0 ? <p className="px-4 pb-4 text-sm text-steel sm:px-6">On every scanned shift the empties match the glasses sold.</p> : (
        <ul>
          {shifts.map((s) => {
            const noun = s.family === "wine" ? "glasses" : "measures";
            const isOpen = open === s.id;
            return (
              <li key={s.id} className="border-t border-hair px-4 py-3 sm:px-6">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                  <p className="text-sm text-ink"><span className="font-medium">{fmtDate(s.date, true)}, {SHIFT_WORD[s.shift]}, {outletById[s.outletId].name}:</span> <span>{s.name}</span></p>
                  <p className="num shrink-0 text-sm font-medium text-ink">{money(s.figures.gapValue)} not billed</p>
                </div>
                <p className="mt-1 text-[13px] text-graphite">
                  <span>{fmtNum(s.figures.scanned)} {s.figures.scanned === 1 ? "empty" : "empties"} scanned.</span>{" "}
                  <span>With the open bottle, {fmtNum(s.figures.opened, 1)} bottles used, which should give {fmtNum(s.figures.expected)} {noun}.</span>{" "}
                  <span>{fmtNum(s.figures.sold)} sold.</span>
                </p>
                <div className="mt-1 flex flex-wrap gap-x-4">
                  <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : s.id)} className={textLink}><ChevronDown size={14} className={cn("transition-transform duration-200 ease-tyll", isOpen && "rotate-180")} aria-hidden />{isOpen ? "Hide the scans" : "See the scans"}</button>
                  <button type="button" onClick={onHelp} className={textLink}>How to help</button>
                </div>
                {isOpen && <div className="mt-2"><ScanList s={s} /></div>}
              </li>
            );
          })}
        </ul>
      )}
      {e.shifts.length > TOP && <p className="border-t border-hair px-4 py-3 sm:px-6"><button type="button" onClick={() => setAll(!all)} className={textLink}>{all ? "Show the top three" : `Show all ${e.shifts.length} shifts`}</button></p>}
    </>
  );
}
