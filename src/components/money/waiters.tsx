"use client";
// Drinks per guest by waiter: who needs coaching, and where drinks may be going missing. Each waiter is set against the
// colleagues who worked the same outlet on the same days and shift. The figures come from the server
// (/api/money/waiters), which strips names for roles that do not coach the team. Coaching notes are saved there too.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { BarsAgainstLine, StripTrend } from "@/components/charts";
import { Section } from "@/components/disclosure";
import { Badge, Button, Drawer, EmptyState, Note, Panel, Segmented, Skeleton, SummaryBar, TableWrap, Td, TextArea, Th, WidgetError, cn, rowClass, textLink, toast } from "@/components/ui";
import { api } from "@/lib/api";
import { itemById, outletLabel } from "@/lib/data/catalog";
import { canOpen } from "@/lib/domain/access";
import type { Shift } from "@/lib/domain/pour";
import type { WaiterStatus } from "@/lib/domain/waiters";
import { personName, useApi, useView } from "@/lib/hooks";
import type { OutletOut, WaiterOut, WaitersView } from "@/lib/server/waiters";
import type { CoachingOutcome } from "@/lib/types";
import { fmtDate, fmtNum, fmtTime, sum } from "@/lib/util";

const TOP = 5;
const SHIFT_LABEL: Record<Shift, string> = { day: "Day", evening: "Evening", late: "Late night" };
/** The shift in a sentence: "On evening shifts". */
const SHIFT_WORDS: Record<Shift, string> = { day: "day shifts", evening: "evening shifts", late: "late night shifts" };
const ROLE_WORD: Record<string, string> = { server: "Server", bartender: "Bartender", supervisor: "Supervisor", manager: "Manager" };
const STATUS: Record<WaiterStatus, { label: string; tone: "warn" | "pos" | "neutral" }> = {
  coach: { label: "To coach", tone: "warn" },
  above: { label: "Above the team", tone: "pos" },
  in_line: { label: "In line", tone: "neutral" },
  too_few: { label: "Too few guests to tell", tone: "neutral" },
};
/** Drinks per guest, always two decimals, so 0.70 and 0.74 read as the small difference they are. */
const per = (n: number | null | undefined) => (n === null || n === undefined ? "None" : n.toFixed(2));
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "None");
const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" });

/** The waiter's shift with the most at stake: the one marked to coach, else the busiest. */
const focusShift = (w: WaiterOut) => [...w.shifts].sort((a, b) => Number(b.status === "coach") - Number(a.status === "coach") || b.shortfallValue - a.shortfallValue || b.guests - a.guests)[0];

export function DrinksByWaiter() {
  const router = useRouter();
  const params = useSearchParams();
  const { sel, user, money } = useView();
  const [version, setVersion] = useState(0);
  const days = params.get("days") === "7" ? 7 : 30;
  const { data, error } = useApi<WaitersView>(`/api/money/waiters?days=${days}&outlets=${sel.outletIds.join(",")}&v=${version}`);
  const [allTables, setAllTables] = useState(false);
  const setParam = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) if (v === null) next.delete(k); else next.set(k, v);
    router.replace(`/money?${next.toString()}`, { scroll: false });
  };

  const outlets = data?.outlets ?? [];
  // The outlet and shift shown first are the ones with the most to coach, so the story is on screen without a click.
  const defaultOutlet = [...outlets].sort((a, b) => sum(b.waiters, (w) => w.shortfallValue) - sum(a.waiters, (w) => w.shortfallValue) || b.guests - a.guests)[0];
  const outlet = outlets.find((o) => o.outletId === params.get("outlet")) ?? defaultOutlet;
  const coachShifts = outlet ? outlet.waiters.flatMap((w) => w.shifts.filter((s) => s.status === "coach")).sort((a, b) => b.shortfallValue - a.shortfallValue) : [];
  const busiest = outlet ? [...outlet.shifts].sort((a, b) => b.guests - a.guests)[0]?.shift : undefined;
  const shift: Shift | undefined = outlet?.shifts.find((s) => s.shift === params.get("shift"))?.shift ?? coachShifts[0]?.shift ?? busiest;
  const everyone = useMemo(() => (data?.outlets ?? []).flatMap((o) => o.waiters.map((w) => ({ o, w }))), [data]);
  const opened = everyone.find((x) => x.w.key === params.get("waiter")) ?? null;

  if (error) return <WidgetError>Drinks per guest by waiter could not load. {error}</WidgetError>;
  if (!data) return <div className="space-y-6"><Skeleton className="h-40 w-full" /><Skeleton className="h-72 w-full" /></div>;
  if (!outlet || !shift) {
    return <EmptyState title="No table service in your selection">{data.left.length ? "Banquets and Events is left out: drinks there are sold as packages per event, not by a waiter at the table." : "Choose an outlet with table service in the outlet selector."}</EmptyState>;
  }

  const toCoach = everyone.filter((x) => x.w.status === "coach");
  const guests = sum(outlets, (o) => o.guests);
  const drinks = sum(outlets, (o) => o.drinks);
  const before = { guests: sum(outlets, (o) => o.before.guests), drinks: sum(outlets, (o) => o.before.drinks) };
  const rate = guests ? drinks / guests : 0;
  const rateBefore = before.guests ? before.drinks / before.guests : 0;
  const foodTables = sum(outlets, (o) => o.foodTables);
  const noDrink = sum(outlets, (o) => o.noDrink);
  const notSold = sum(toCoach, (x) => x.w.shortfallValue);
  const first = toCoach.sort((a, b) => b.w.shortfallValue - a.w.shortfallValue)[0];
  const firstShift = first ? focusShift(first.w) : undefined;
  const team = outlet.shifts.find((s) => s.shift === shift)!;
  const onShift = outlet.waiters.map((w) => ({ w, s: w.shifts.find((x) => x.shift === shift) })).filter((x): x is { w: WaiterOut; s: NonNullable<typeof x.s> } => !!x.s)
    // Whoever is to coach first, then lowest to highest, so the bars read from the question to the answer.
    .sort((a, b) => Number(b.s.status === "coach") - Number(a.s.status === "coach") || Number(a.s.status === "too_few") - Number(b.s.status === "too_few") || (a.s.rate ?? 99) - (b.s.rate ?? 99));
  // Tables with food and no drink on this shift, most above what colleagues' share would give first.
  const byTables = [...onShift].sort((a, b) => (b.s.noDrink - b.s.expectedNoDrink) - (a.s.noDrink - a.s.expectedNoDrink));
  const shownTables = allTables ? byTables : byTables.slice(0, TOP);
  const open = (w: WaiterOut, o: OutletOut) => setParam({ waiter: w.key, outlet: o.outletId });
  const period = days === 7 ? "the 7 days before" : "the 30 days before";

  return (
    <div className="space-y-6">
      <SummaryBar
        items={[
          { label: "Waiters to coach", value: fmtNum(toCoach.length), tone: toCoach.length ? "warn" : "pos", compare: first && firstShift ? { text: `${SHIFT_LABEL[firstShift.shift]} shifts at ${outletLabel(first.o.outletId)}`, good: false } : { text: "Every waiter in line with colleagues", good: true }, onClick: () => scrollTo("waiters-chart") },
          { label: "Drinks per guest", value: per(rate), compare: versusRate(rate, rateBefore, period), onClick: () => scrollTo("waiters-chart") },
          { label: "Tables with food, no drink", value: pct(noDrink, foodTables), compare: { text: `${fmtNum(noDrink)} of ${fmtNum(foodTables)} tables with food`, good: null }, onClick: () => scrollTo("waiters-tables") },
          { label: "Drinks not sold, to coach", value: money(notSold), tone: "money", compare: { text: "An estimate, at the average drink price", good: null }, onClick: first ? () => open(first.w, first.o) : undefined },
        ]}
        trend={
          <StripTrend
            title="Drinks per guest, last 30 days"
            points={data.trend.map((d) => ({ date: d.date, value: d.rate }))}
            format={(n) => per(n)}
            goodWhen="up"
            explain="Drinks billed per guest each day, every waiter at the outlets in view."
            summary={`Drinks billed per guest each day for the last 30 days. ${per(rate)} over the period shown.`}
            footer={<>Average <span className="num font-medium text-graphite">{per(sum(data.trend, (d) => d.drinks) / Math.max(1, sum(data.trend, (d) => d.guests)))}</span> drinks per guest</>}
            series={[
              { id: "nodrink", label: "Tables with food and no drink", axis: "pct", goodWhen: "down", format: (n) => `${Math.round(n)}%`, points: data.trend.map((d) => ({ date: d.date, value: d.noDrinkShare === null ? null : Math.round(d.noDrinkShare * 100) })), explain: "Of the tables with food on the bill, the share with no drink. The breakfast buffet includes coffee and juice, so it is left out." },
              { id: "guests", label: "Guests", axis: "count", goodWhen: "none", format: (n) => fmtNum(n), points: data.trend.map((d) => ({ date: d.date, value: d.guests })), explain: "Guests on the bills compared." },
            ]}
          />
        }
        action={first ? <Button variant="primary" onClick={() => open(first.w, first.o)}>{data.mayCoach ? `Coach ${first.w.name}` : `Open ${first.w.name}`}</Button> : undefined}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Segmented size="sm" label="Period" value={String(days) as "7" | "30"} onChange={(v) => setParam({ days: v === "30" ? null : v, waiter: null })} options={[{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }]} />
        {outlets.length > 1 && <Segmented size="sm" label="Outlet" value={outlet.outletId} onChange={(v) => setParam({ outlet: v, shift: null })} options={outlets.map((o) => ({ value: o.outletId, label: outletLabel(o.outletId) }))} />}
        <Segmented size="sm" label="Shift" value={shift} onChange={(v) => setParam({ shift: v })} options={outlet.shifts.map((s) => ({ value: s.shift, label: SHIFT_LABEL[s.shift] }))} />
      </div>

      <div id="waiters-chart" className="grid scroll-mt-24 grid-cols-1 gap-5 lg:grid-cols-[1.6fr_1fr] [&>*]:min-w-0">
        <Panel title={`${outletLabel(outlet.outletId)}, ${SHIFT_LABEL[shift].toLowerCase()} shift`} description={data.mayCoach ? `Drinks per guest by waiter, last ${days} days. Choose a waiter to see the tables and to coach.` : `Drinks per guest by waiter, last ${days} days. Choose a waiter to see the tables.`}>
          <BarsAgainstLine
            format={per}
            line={team.rate}
            lineLabel={`Team average on this shift, ${per(team.rate)} drinks per guest`}
            summary={`Drinks per guest for each waiter on the ${SHIFT_LABEL[shift].toLowerCase()} shift at ${outletLabel(outlet.outletId)}, against the team average of ${per(team.rate)}.`}
            rows={onShift.map(({ w, s }) => ({
              key: w.key,
              label: data.mayName ? `${w.name}, ${(ROLE_WORD[w.role] ?? w.role).toLowerCase()}` : w.name,
              value: s.rate,
              tone: s.status === "coach" ? "warn" : s.status === "too_few" ? "muted" : "ink",
              sub: s.peerRate === null ? `${fmtNum(s.guests)} guests` : `Colleagues on the same shifts ${per(s.peerRate)} · ${fmtNum(s.comparedGuests)} guests`,
              badge: s.status === "in_line" && !w.coaching ? undefined : <>
                {s.status !== "in_line" && <Badge tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Badge>}
                {w.coaching && <Badge tone="ink">{`Coached ${fmtDate(w.coaching.date)}`}</Badge>}
              </>,
              onClick: () => open(w, outlet),
            }))}
          />
          {!data.mayName && <Note className="mt-4">Names are shown only to the managers who coach the team.</Note>}
        </Panel>
        <Panel title="How Tyll compares" description="A low figure is a prompt to coach, not proof of anything else.">
          <ul className="space-y-3 text-sm text-graphite">
            <li>Each bill counts for the waiter whose till login rang it. Drinks are the drinks billed; complimentary and removed ones are not sold.</li>
            <li>Each waiter is compared with the colleagues who worked the same outlet on the same days and shift, so a busy Saturday night or a quiet breakfast counts for no one.</li>
            <li>{`Marked to coach when drinks per guest on a shift is ${Math.round(data.rules.below * 100)}% or more below those colleagues, the gap is beyond what chance alone produces, and there are at least ${data.rules.minGuests} guests to compare.`}</li>
            <li>The breakfast buffet includes coffee and juice, so a breakfast bill is never a table without drinks. Banquets and Events is left out: drinks there are sold as packages per event.</li>
          </ul>
        </Panel>
      </div>

      <div id="waiters-tables" className="scroll-mt-24">
        <Panel title="Tables with food and no drink" description={`${SHIFT_LABEL[shift]} shift, last ${days} days. Most are guests who did not want a drink. Many more than colleagues on the same shifts is worth a word with the waiter, and with the bar.`} flush>
          <ul className="divide-y divide-hair border-t border-hair">
            {shownTables.map(({ w, s }) => {
              const extra = Math.round(s.noDrink - s.expectedNoDrink);
              return (
                <li key={w.key}>
                  <button type="button" onClick={() => open(w, outlet)} className="flex w-full flex-col gap-1 px-5 py-3.5 text-start transition-colors duration-150 hover:bg-cloud sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-6">
                    <span className="min-w-0">
                      <span className="block text-sm text-ink">{w.name}</span>
                      <span className="block text-xs text-steel">{`${fmtNum(s.noDrink)} of ${fmtNum(s.foodTables)} tables with food had no drink (${pct(s.noDrink, s.foodTables)}). Colleagues' share on the same shifts would give about ${fmtNum(Math.round(s.expectedNoDrink))}.`}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      {extra > 0 && s.status === "coach" ? <Badge tone="warn">{`${fmtNum(extra)} more than colleagues`}</Badge> : extra > 0 ? <span className="num text-xs text-graphite">{`${fmtNum(extra)} more`}</span> : <span className="text-xs text-graphite">In line</span>}
                      <span className={textLink}>See tables</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {byTables.length > TOP && <div className="border-t border-hair px-6 py-3"><button type="button" onClick={() => setAllTables((v) => !v)} className={textLink}>{allTables ? "Show the five with most" : `Show all ${byTables.length} waiters`}</button></div>}
        </Panel>
      </div>

      <Section id="waiters.all" flush title="Every waiter, every shift" summary={`${fmtNum(everyone.length)} waiters at ${fmtNum(outlets.length)} ${outlets.length === 1 ? "outlet" : "outlets"}, ${fmtNum(guests)} guests in the last ${days} days.${data.left.length ? " Banquets and Events is left out." : ""}`}>
        <TableWrap>
          <table className="w-full min-w-[860px] text-sm">
            <thead><tr><Th>Waiter</Th><Th>Outlet</Th><Th>Shift</Th><Th align="right">Guests</Th><Th align="right">Drinks per guest</Th><Th align="right">Colleagues</Th><Th align="right">No drink, of tables with food</Th><Th>What Tyll found</Th></tr></thead>
            <tbody>
              {outlets.flatMap((o) => o.waiters.flatMap((w) => w.shifts.map((s) => (
                <tr key={`${w.key}-${s.shift}`} className={cn(rowClass, "cursor-pointer")} onClick={() => open(w, o)}>
                  <Td className="text-ink">{w.name}</Td>
                  <Td>{outletLabel(o.outletId)}</Td>
                  <Td>{SHIFT_LABEL[s.shift]}</Td>
                  <Td align="right">{fmtNum(s.guests)}</Td>
                  <Td align="right" className="font-medium text-ink">{per(s.rate)}</Td>
                  <Td align="right">{per(s.peerRate)}</Td>
                  <Td align="right">{`${fmtNum(s.noDrink)} of ${fmtNum(s.foodTables)}`}</Td>
                  <Td>{s.status === "in_line" ? <span className="text-graphite">In line</span> : <Badge tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Badge>}</Td>
                </tr>
              ))))}
            </tbody>
          </table>
        </TableWrap>
        <Note className="px-6 py-4">Bills, till logins and shifts are simulated. Drinks per guest is drinks billed divided by the guests on the bill. Voided bills are left out. Drinks not sold is what colleagues&rsquo; pace on the same shifts would have sold, at the outlet&rsquo;s average drink price: an estimate, not money lost.</Note>
      </Section>

      <WaiterDrawer
        x={opened}
        days={days}
        view={data}
        onClose={() => setParam({ waiter: null })}
        onSaved={() => setVersion((v) => v + 1)}
        mayDrinks={canOpen(user, "drinks")}
        money={money}
      />
    </div>
  );
}

/** The team's drinks per guest against the period before, in words. Up is good. */
function versusRate(now: number, before: number, period: string): { text: string; good: boolean | null } {
  if (!before) return { text: `None in ${period}`, good: null };
  const change = (now - before) / before;
  if (Math.abs(change) < 0.01) return { text: `Same as ${period}`, good: null };
  return { text: `${Math.round(Math.abs(change) * 100)}% ${change > 0 ? "more" : "fewer"} than ${period}`, good: change > 0 };
}

function WaiterDrawer({ x, days, view, onClose, onSaved, mayDrinks, money }: { x: { o: OutletOut; w: WaiterOut } | null; days: number; view: WaitersView; onClose: () => void; onSaved: () => void; mayDrinks: boolean; money: (n: number) => string }) {
  return (
    <Drawer open={!!x} onClose={onClose} title={x?.w.name ?? ""} description={x ? `${(ROLE_WORD[x.w.role] ?? x.w.role)}, ${outletLabel(x.o.outletId)}. Last ${days} days.` : undefined}>
      {x && <WaiterDetail key={x.w.key} o={x.o} w={x.w} days={days} view={view} onSaved={onSaved} mayDrinks={mayDrinks} money={money} />}
    </Drawer>
  );
}

function WaiterDetail({ o, w, days, view, onSaved, mayDrinks, money }: { o: OutletOut; w: WaiterOut; days: number; view: WaitersView; onSaved: () => void; mayDrinks: boolean; money: (n: number) => string }) {
  const [outcome, setOutcome] = useState<CoachingOutcome>("coached");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [everyTable, setEveryTable] = useState(false);
  const focus = focusShift(w);
  // For a waiter to coach, the tables of the shift that stands out; for anyone else, every shift.
  const only = w.status === "coach" && focus ? focus : null;
  const list = only ? w.tables.filter((t) => t.shift === only.shift) : w.tables;
  const tables = everyTable ? list : list.slice(0, TOP);
  const post = async (body: Record<string, unknown>, done: string) => {
    setBusy(true);
    try {
      await api("/api/money/waiters", { method: "POST", body });
      toast.done(done);
      setNote("");
      onSaved();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save."); }
    finally { setBusy(false); }
  };
  // No name in these lines: the drawer's title says who it is, and the same words serve every role.
  const lead = w.status === "coach" && focus
    ? `${SHIFT_LABEL[focus.shift]} shifts: ${per(focus.rate)} drinks per guest, against ${per(focus.peerRate)} for colleagues on the same shifts. About ${fmtNum(Math.round(focus.shortfall))} drinks fewer, ${money(focus.shortfallValue)} at the average drink price, an estimate.`
    : w.status === "too_few" ? `Too few guests in the last ${days} days to compare with colleagues.`
    : w.status === "above" ? "More drinks per guest than colleagues on the same shifts. Worth asking what works."
    : "About as many drinks per guest as colleagues on the same shifts.";

  return (
    <div className="space-y-6">
      <p className="text-[15px] leading-relaxed text-ink">{lead}</p>

      <div>
        <h3 className="text-[15px]">By shift</h3>
        {/* Phones get one line per shift, so every figure and the finding stay on screen. */}
        <ul className="mt-2 divide-y divide-hair border-t border-hair sm:hidden">
          {w.shifts.map((s) => (
            <li key={s.shift} className="flex items-center justify-between gap-3 py-3">
              <span className="min-w-0">
                <span className="block text-sm text-ink">{`${SHIFT_LABEL[s.shift]} · ${fmtNum(s.guests)} guests`}</span>
                <span className="num block text-xs text-steel">{`${per(s.rate)} drinks per guest, colleagues ${per(s.peerRate)}`}</span>
              </span>
              {s.status === "in_line" ? <span className="shrink-0 text-xs text-graphite">In line</span> : <span className="shrink-0"><Badge tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Badge></span>}
            </li>
          ))}
        </ul>
        <div className="mt-2 hidden overflow-x-auto sm:block">
          <table className="w-full min-w-[420px] text-sm">
            <thead><tr><Th>Shift</Th><Th align="right">Guests</Th><Th align="right">Drinks per guest</Th><Th align="right">Colleagues</Th><Th>What Tyll found</Th></tr></thead>
            <tbody>
              {w.shifts.map((s) => (
                <tr key={s.shift} className="border-t border-hair">
                  <Td>{SHIFT_LABEL[s.shift]}</Td>
                  <Td align="right">{fmtNum(s.guests)}</Td>
                  <Td align="right" className="font-medium text-ink">{per(s.rate)}</Td>
                  <Td align="right">{per(s.peerRate)}</Td>
                  <Td>{s.status === "in_line" ? <span className="text-graphite">In line</span> : <Badge tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Badge>}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {view.mayCoach ? (w.coaching ? (
        <div className="rounded-2xl border border-line p-4">
          <p className="text-sm text-ink">{view.outcomes.find((x) => x.value === w.coaching!.outcome)?.label}</p>
          {w.coaching.note && <p className="mt-1 text-sm text-graphite">{w.coaching.note}</p>}
          <p className="mt-1 text-xs text-steel">{`Recorded by ${personName(w.coaching.by)}, ${fmtDate(w.coaching.date, true)}, when ${SHIFT_WORDS[w.coaching.shift]} were at ${per(w.coaching.rate)} drinks per guest against ${per(w.coaching.peerRate)}.`}</p>
          <button type="button" disabled={busy} className={cn(textLink, "mt-2 block")} onClick={() => post({ action: "clear", id: w.coaching!.id }, "Taken back.")}>Take back</button>
        </div>
      ) : (
        <fieldset className="space-y-3">
          <legend className="text-[15px]">What did you do?</legend>
          <div className="grid gap-2">
            {view.outcomes.map((x) => (
              <label key={x.value} className={cn("flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-sm transition-colors duration-150", outcome === x.value ? "border-accent bg-accent-soft text-ink" : "border-line text-graphite hover:border-fog")}>
                <input type="radio" name="coaching-outcome" className="h-4 w-4 accent-[var(--color-accent)]" checked={outcome === x.value} onChange={() => setOutcome(x.value)} />
                {x.label}
              </label>
            ))}
          </div>
          <TextArea label="Note (optional)" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="For example: suggest a drink when taking the food order" />
          <Button variant="primary" className="w-full" disabled={busy} onClick={() => post({ action: "coach", outletId: o.outletId, staffId: w.key, outcome, note, days }, "Saved on the hotel's records.")}>{busy ? "Saving…" : "Record coaching"}</Button>
          <Note>Saved on the hotel&rsquo;s records with your name. Only the managers who coach the team see names on this page.</Note>
        </fieldset>
      )) : (
        <Note>{w.coaching ? `Coaching recorded on ${fmtDate(w.coaching.date, true)}. ` : ""}Coaching is recorded by the outlet&rsquo;s managers, who are the only ones to see names here.</Note>
      )}

      <div>
        <h3 className="text-[15px]">Tables with food and no drink</h3>
        <p className="mt-1 text-xs text-steel">{only
          ? `${fmtNum(only.noDrink)} of ${fmtNum(only.foodTables)} tables with food on ${SHIFT_WORDS[only.shift]}, last ${days} days. Colleagues' share on the same shifts would give about ${fmtNum(Math.round(only.expectedNoDrink))}. Largest estimate first.`
          : `${fmtNum(w.noDrink)} of ${fmtNum(w.foodTables)} tables with food, every shift, last ${days} days. Colleagues' share on the same shifts would give about ${fmtNum(Math.round(w.expectedNoDrink))}. Largest estimate first.`}</p>
        {list.length === 0 ? <p className="mt-3 text-sm text-graphite">None in this period.</p> : (
          <ul className="mt-2 divide-y divide-hair">
            {tables.map((t) => (
              <li key={t.orderId} className="flex items-start justify-between gap-4 py-3">
                <span className="min-w-0">
                  <span className="num block text-sm text-ink">{`${fmtDate(t.date, true)}, ${fmtTime(t.openMin)} · ${t.table} · ${t.guests} ${t.guests === 1 ? "guest" : "guests"}`}</span>
                  <span className="block text-xs text-steel">{t.foodItems.map((id) => itemById[id]?.name ?? id).join(", ")}</span>
                  <span className="block text-xs text-steel">{`${money(t.foodValue)} food`}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className="num text-sm text-ink">{money(t.estValue)}</span>
                  <Link prefetch={false} href={`/money/orders/${t.orderId}`} className={textLink}>Open bill</Link>
                </span>
              </li>
            ))}
          </ul>
        )}
        {list.length > TOP && <button type="button" onClick={() => setEveryTable((v) => !v)} className={cn(textLink, "mt-2")}>{everyTable ? "Show the five largest" : `Show all ${list.length} tables`}</button>}
        <Note className="mt-3">The amount is what colleagues on the same shift sold in drinks per guest, at the average drink price: an estimate. A table with no drink is most often a guest who did not want one. If drinks were served at these tables, ask the bar whether they were rung.</Note>
        {mayDrinks && <Link prefetch={false} href="/drinks" className={cn(textLink, "mt-2")}>Drinks poured and not billed are on Over pouring</Link>}
      </div>
    </div>
  );
}
