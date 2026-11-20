"use client";
// Over pouring: how many glasses each bottle really gave. By wine, then where and when. Never by person. Each part opens on its own in Drinks control.
import { ChevronDown, Lightbulb, ListChecks, Users } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useRemembered } from "@/components/disclosure";
import { EmptyState, Segmented, StatusPill, TableWrap, Td, Th, cn, rowClass, OutletDot, textLink } from "@/components/ui";
import { useAlertFeed } from "@/lib/alert-feed";
import { outletById } from "@/lib/data/catalog";
import { SHIFTS, type PourFigures, type PourFlag } from "@/lib/domain/pour";
import type { PourPeriod } from "@/lib/server/pour";
import type { Currency } from "@/lib/types";
import { fmtMoney, fmtNum } from "@/lib/util";

type Family = "wine" | "spirits";

const PERIODS: { value: PourPeriod; label: string }[] = [{ value: "today", label: "Today" }, { value: "week", label: "Last 7 days" }, { value: "month", label: "Last 30 days" }];
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

/** One line of what is not billed, today, the last 7 days and the last 30 days. */
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
                  <Th>{family === "wine" ? "Wine" : "Spirit"}</Th><Th align="right">Bottles opened</Th><Th align="right">{Noun} sold</Th><Th align="right">Should give</Th><Th align="right">{Noun} per bottle</Th>
                  <Th align="right">Gap</Th>
                </tr></thead>
                <tbody>
                  {data.rows.map((r) => {
                    const f = r.periods[period];
                    return (
                      <tr key={r.skuId} className={rowClass}>
                        <Td><span className="text-ink">{r.name}</span>{f.flagged && <StatusPill rag="amber" className="ms-2 !py-0">Over pouring</StatusPill>}</Td>
                        <Td align="right">{fmtBottles(f.opened)}{f.scanned > 0 && <span className="block text-xs text-steel">includes scans</span>}</Td>
                        <Td align="right">{fmtNum(f.sold)}</Td>
                        <Td align="right">{r.perBottle}</Td>
                        <Td align="right"><YieldCell f={f} /></Td>
                        <Td align="right"><span className={f.gapValue > 0 ? "font-medium text-ink" : "text-steel"}>{f.gapValue > 0 ? money(f.gapValue) : "None"}</span></Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
      </div>
      <p className="px-4 py-3 text-xs text-steel sm:px-6">Flagged when a bottle gives under {Math.round(pour.threshold * 100)}% of what it should.</p>
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
                        <Td align="right"><span className={o.periods[period].gapValue > 0 ? "font-medium text-ink" : "text-steel"}>{o.periods[period].gapValue > 0 ? money(o.periods[period].gapValue) : "None"}</span></Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
              <p className="px-4 py-3 text-xs text-steel sm:px-6">Should give {per(data.rows[0])}{family === "spirits" ? " for rum, more for spirits in smaller measures" : ""}. Day is until 5 PM, evening until 10 PM, late after that.</p>
    </>
  );
}

const DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SHIFT_WORD: Record<string, string> = { day: "day shift", evening: "evening shift", late: "late shift" };
const ROLE_WORD: Record<string, string> = { server: "Server", bartender: "Bartender", supervisor: "Supervisor", manager: "Manager", chef: "Chef", steward: "Steward" };

/** Who was on these shifts, why the gap is likely there, and how to help. Team first; names only when a manager opens them. */
export function PatternDetail({ flag }: { flag: PourFlag }) {
  const [names, setNames] = useState(false);
  const team = flag.team;
  const named = team?.people.some((p) => p.name);
  const roles = team ? Object.entries(team.people.reduce<Record<string, number>>((m, p) => ({ ...m, [p.role]: (m[p.role] ?? 0) + 1 }), {})) : [];
  const regulars = team ? team.people.filter((p) => p.shifts >= Math.max(2, team.shifts - 1)).length : 0;
  return (
    <div className="grid gap-4 rounded-[var(--radius-control)] bg-cloud p-4 text-[13px] lg:grid-cols-3">
      {team && (
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-medium text-ink"><Users size={15} aria-hidden /> Team on this shift</p>
          <p className="mt-1 text-graphite">{fmtNum(team.perShift, team.perShift % 1 ? 1 : 0)} {team.perShift === 1 ? "person" : "people"} on a typical {DAY[flag.weekday]} {SHIFT_WORD[flag.shift]}, {team.people.length} different people over the last {team.shifts} weeks. {regulars ? `${regulars} on most of them.` : "Nobody on most of them."}</p>
          <p className="mt-1 text-steel">{roles.map(([r, n]) => `${n} ${ROLE_WORD[r]?.toLowerCase() ?? r}${n === 1 ? "" : "s"}`).join(", ")}</p>
          {named && (
            names ? (
              <>
                <ul className="mt-2 space-y-0.5">{team.people.map((p) => <li key={p.staffId} className="flex justify-between gap-3"><span className="text-ink">{p.name}<span className="text-steel">, {ROLE_WORD[p.role]?.toLowerCase() ?? p.role}</span></span><span className="num text-steel">{p.shifts} of {team.shifts}</span></li>)}</ul>
                <p className="mt-2 text-xs text-steel">From till logins. Being on shift is not proof of who poured. Use this to plan training, not to blame.</p>
              </>
            ) : <button type="button" onClick={() => setNames(true)} className={cn(textLink, "mt-1")}>Show who was on</button>
          )}
        </div>
      )}
      {flag.reasons && (
        <>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 font-medium text-ink"><Lightbulb size={15} aria-hidden /> Possible reasons</p>
            <ul className="mt-1 list-disc space-y-1 ps-4 text-graphite">{flag.reasons.likely.map((r) => <li key={r}>{r}</li>)}</ul>
            <p className="mt-1 text-xs text-steel">Worked out from the figures by fixed rules. To check, not proven.</p>
          </div>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 font-medium text-ink"><ListChecks size={15} aria-hidden /> How to help</p>
            <ol className="mt-1 list-decimal space-y-1 ps-4 text-graphite">{flag.reasons.help.map((r) => <li key={r}>{r}</li>)}</ol>
          </div>
        </>
      )}
    </div>
  );
}

/** Every pattern, grouped by outlet with what each outlet loses, largest first. A row opens its team, reasons and next steps. */
export function PourPatterns() {
  const { pour } = useAlertFeed();
  const [family] = useRemembered<Family>("drinks.family", "wine");
  const [open, setOpen] = useState<string | null>(null);
  if (!pour) return null;
  const flags = pour[family].flags;
  const money = (n: number) => fmtMoney(n, pour.currency as Currency);
  const noun = family === "wine" ? "glasses" : "measures";
  const outlets = [...new Set(flags.map((f) => f.outletId))].map((outletId) => ({ outletId, list: flags.filter((f) => f.outletId === outletId) })).map((g) => ({ ...g, value: g.list.reduce((n, f) => n + f.figures.gapValue, 0) })).sort((a, b) => b.value - a.value);
  return (
    <>
      <div className="px-4 py-4 sm:px-6"><FamilySwitch /></div>
      {flags.length === 0 ? <div className="px-4 pb-6 sm:px-6"><EmptyState title="Nothing below the threshold">Every outlet and shift is pouring close to standard.</EmptyState></div> : (
        <TableWrap>
          <table className="w-full min-w-[560px] text-table">
            <thead><tr><Th>When</Th><Th align="right">{family === "wine" ? "Glasses" : "Measures"} per bottle</Th><Th align="right">Not billed</Th><Th align="right">Value</Th></tr></thead>
            <tbody>
              {outlets.map((g) => (
                <Fragment key={g.outletId}>
                  <tr className="border-t border-hair bg-cloud"><td colSpan={3} className="px-5 py-2 text-[13px] font-semibold text-ink sm:px-6"><OutletDot id={g.outletId} />{outletById[g.outletId].name}<span className="ms-2 font-normal text-steel">{g.list.length} {g.list.length === 1 ? "pattern" : "patterns"}</span></td><td className="num px-5 py-2 text-end text-[13px] font-semibold text-ink sm:px-6">{money(g.value)}</td></tr>
                  {g.list.map((f) => {
                    const isOpen = open === f.id;
                    return (
                      <Fragment key={f.id}>
                        <tr className={cn(rowClass, "cursor-pointer")} onClick={() => setOpen(isOpen ? null : f.id)}>
                          <Td><button type="button" aria-expanded={isOpen} className="flex items-center gap-2 text-ink" onClick={(e) => { e.stopPropagation(); setOpen(isOpen ? null : f.id); }}><ChevronDown size={15} className={cn("text-steel transition-transform duration-200 ease-tyll", isOpen && "rotate-180")} aria-hidden />{DAY[f.weekday]} {SHIFT_WORD[f.shift]}</button></Td>
                          <Td align="right"><span className="text-neg">{fmtNum(f.figures.yieldPer ?? 0, 1)}</span><span className="text-steel"> of {f.figures.perBottle}</span></Td>
                          <Td align="right">{fmtNum(f.figures.gap)} {noun}</Td>
                          <Td align="right"><span className="font-medium text-ink">{money(f.figures.gapValue)}</span></Td>
                        </tr>
                        {isOpen && <tr><td colSpan={4} className="px-4 pb-4 pt-1 sm:px-6"><PatternDetail flag={f} /></td></tr>}
                      </Fragment>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </>
  );
}

/** Gaps this far beyond chance mark a person. Lower ones are what random rotas produce on their own. */
const STANDS_OUT = 3;

/**
 * The trend of what was not billed, day by day at one outlet, set against who was rostered.
 * Choose a person to see their shifts on the line. Managers only; names come from the rota, never from the figures.
 */
export function WhoWasOn() {
  const { pour } = useAlertFeed();
  const views = useMemo(() => [...(pour?.staff ?? [])].sort((a, b) => b.days.reduce((n, d) => n + d.value, 0) - a.days.reduce((n, d) => n + d.value, 0)), [pour]);
  const [outlet, setOutlet] = useState<string | null>(null);
  const [person, setPerson] = useState<string | null>(null);
  if (!pour || views.length === 0) return null;
  const view = views.find((v) => v.outletId === outlet) ?? views[0];
  const money = (n: number) => fmtMoney(n, pour.currency as Currency);
  const picked = view.people.find((p) => p.staffId === person) ?? null;
  const marked = picked ? new Set(view.days.filter((d) => d.people.includes(picked.staffId)).map((d) => d.date)) : new Set(view.top);
  const nameOf = (id: string) => view.people.find((p) => p.staffId === id)?.name ?? id;
  const data = view.days.map((d) => ({ ...d, label: new Date(`${d.date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }) }));
  const leader = view.people[0] && view.people[0].z >= STANDS_OUT ? view.people[0] : null;
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 sm:px-6">
        <Segmented size="sm" label="Outlet" value={view.outletId} onChange={(v) => { setOutlet(v); setPerson(null); }} options={views.map((v) => ({ value: v.outletId, label: outletById[v.outletId].name }))} />
        {picked && <button type="button" onClick={() => setPerson(null)} className={textLink}>Show the costliest days again</button>}
      </div>
      <p className="px-4 pt-3 text-[13px] text-graphite sm:px-6">
        {leader ? <><span className="font-medium text-ink">{leader.name}</span> stands out: {money(leader.avgOn)} not billed on an average shift they work, against {money(leader.avgOff)} when they are off. On {leader.inTop} of the 5 costliest days.</> : "Nobody stands out here: the differences between people are within what a changing rota produces by chance."}
      </p>
      <figure className="px-2 pt-2 sm:px-4">
        <p className="px-2 text-xs text-steel">{pour.currency} not billed per day</p>
        <figcaption className="sr-only">Not billed per day at {outletById[view.outletId].name} over the last 4 weeks. Dots mark {picked ? `the days ${picked.name} was on` : "the 5 costliest days"}.</figcaption>
        <div className="h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--chart-axis)" }} axisLine={false} tickLine={false} minTickGap={28} />
              <YAxis tick={{ fontSize: 11, fill: "var(--chart-axis)" }} axisLine={false} tickLine={false} width={40} tickFormatter={(n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : `${n}`)} />
              <Tooltip content={(p) => {
                const row = (p as unknown as { payload?: readonly { payload: (typeof data)[number] }[] }).payload?.[0]?.payload;
                if (!(p as unknown as { active?: boolean }).active || !row) return null;
                return (
                  <div className="max-w-[260px] rounded-[var(--radius-control)] border border-line bg-paper px-3 py-2 text-xs shadow-float">
                    <p className="text-steel">{row.label}</p>
                    <p className="num font-medium text-ink">{money(row.value)} not billed</p>
                    <p className="mt-1 text-graphite">On: {row.people.map(nameOf).join(", ") || "Nobody rostered"}</p>
                  </div>
                );
              }} cursor={{ stroke: "var(--color-fog)", strokeDasharray: "3 3" }} />
              <Line type="linear" dataKey="value" stroke="var(--color-accent-ink)" strokeWidth={2} isAnimationActive={false} activeDot={{ r: 4 }}
                dot={(d: { cx?: number; cy?: number; payload?: { date: string } }) => marked.has(d.payload?.date ?? "") ? <circle key={d.payload?.date} cx={d.cx} cy={d.cy} r={4.5} fill={picked ? "var(--color-accent)" : "var(--color-warn)"} stroke="var(--color-paper)" strokeWidth={2} /> : <g key={d.payload?.date} />} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="px-2 pb-1 text-xs text-steel">{picked ? <>Dots: the days <span className="font-medium text-ink">{picked.name}</span> was on.</> : "Dots: the 5 costliest days. Choose a person below to see their days instead."}</p>
      </figure>
      <TableWrap>
        <table className="w-full min-w-[640px] text-table">
          <thead><tr><Th>Who</Th><Th align="right">Shifts on</Th><Th align="right">On the 5 costliest days</Th><Th align="right">Not billed per shift, on</Th><Th align="right">Off</Th><Th>Reading</Th></tr></thead>
          <tbody>
            {view.people.map((p) => {
              const stands = p.z >= STANDS_OUT;
              return (
                <tr key={p.staffId} className={cn(rowClass, "cursor-pointer", person === p.staffId && "bg-accent-soft")} onClick={() => setPerson(person === p.staffId ? null : p.staffId)}>
                  <Td><button type="button" aria-pressed={person === p.staffId} className="text-start text-ink underline-offset-4 hover:underline" onClick={(e) => { e.stopPropagation(); setPerson(person === p.staffId ? null : p.staffId); }}>{p.name}</button><span className="block text-xs text-steel">{ROLE_WORD[p.role] ?? p.role}</span></Td>
                  <Td align="right">{p.days}</Td>
                  <Td align="right">{p.inTop} of 5</Td>
                  <Td align="right"><span className={stands ? "font-medium text-warn" : "text-ink"}>{money(p.avgOn)}</span></Td>
                  <Td align="right">{money(p.avgOff)}</Td>
                  <Td>{stands ? <StatusPill rag="amber">Stands out</StatusPill> : <span className="text-xs text-steel">Within normal variation</span>}</Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableWrap>
      <p className="px-4 py-3 text-xs text-steel sm:px-6">Rota simulated in this demo; a live version reads it from your scheduling system. Being on shift is not proof of who poured: someone who always works the busiest shifts can stand out for that alone. Use it to decide who to coach first, then confirm with a count on their next shift.</p>
    </div>
  );
}
