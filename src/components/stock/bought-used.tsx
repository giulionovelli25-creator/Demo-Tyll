"use client";
// Bought against used, per item: supplier deliveries over 30 days against the recipes of what was sold and the waste
// logged. No stock count is needed, so every gap is an estimate a count confirms. A tab next to Stock takes and
// Missing stock; the flags it raises join the flags list, the Money Back List, Alerts and the Overview.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { BarList, StripTrend } from "@/components/charts";
import { Section } from "@/components/disclosure";
import { Badge, Button, Drawer, EmptyState, Note, Panel, Segmented, Skeleton, SummaryBar, TableWrap, Td, TextArea, Th, WidgetError, cn, rowClass, textLink, toast } from "@/components/ui";
import { api } from "@/lib/api";
import { ingredientById, itemById, propertyById } from "@/lib/data/catalog";
import { replaceDataset } from "@/lib/data/dataset";
import { stockGroupOf, STOCK_GROUPS } from "@/lib/data/locations";
import { can, canOpen } from "@/lib/domain/access";
import { BOUGHT_USED_CAUSES, boughtQty, itemWords } from "@/lib/domain/bought-used";
import { personName, useApi, useInvestigations, useView } from "@/lib/hooks";
import type { BoughtUsedRowOut, BoughtUsedView } from "@/lib/server/bought-used";
import type { Snapshot } from "@/lib/server/snapshot";
import type { BoughtUsedOutcome, Investigation } from "@/lib/types";
import { fmtDate, fmtMoney } from "@/lib/util";

type Kind = "all" | "food" | "beverage";
const TOP = 5;

const groupName = (ingredientId: string) => STOCK_GROUPS.find((g) => g.id === stockGroupOf(ingredientId))?.name ?? "";
const pct = (share: number) => `${Math.round(share * 100)}%`;

type SumFigures = { ingredientId: string; from: string; to: string; bought: number; deliveries: number; lastDelivery: number; lastDeliveryDate?: string | null; movedIn: number; sold: number; waste: number; movedOut: number; gap: number; share: number; unitCost: number };

/**
 * The figures from bought to gap, as a short sum, then the last delivery set aside as stock that may still be on the
 * shelf: what is left is what a flag values. Also shown on the flag's case page.
 */
export function BoughtUsedSum({ r, money }: { r: SumFigures; money: (n: number) => string }) {
  const q = (n: number) => boughtQty(n, r.ingredientId);
  const lines: { label: string; value: string; sub?: string }[] = [
    { label: "Received from suppliers", value: q(r.bought), sub: `${r.deliveries} ${r.deliveries === 1 ? "delivery" : "deliveries"}, ${fmtDate(r.from)} to ${fmtDate(r.to)}` },
    ...(r.movedIn > 0 ? [{ label: "Moved in from outside the hotel", value: q(r.movedIn) }] : []),
    { label: "Used by the recipes of what was sold", value: `− ${q(r.sold)}` },
    { label: "Logged as waste or breakage", value: r.waste > 0 ? `− ${q(r.waste)}` : "None" },
    ...(r.movedOut > 0 ? [{ label: "Moved out for use outside the till, such as staff meals", value: `− ${q(r.movedOut)}` }] : []),
  ];
  const over = r.gap > 0;
  const excess = Math.max(0, r.gap - r.lastDelivery);
  const row = "flex items-baseline justify-between gap-6 px-4 py-3";
  return (
    <ul className="divide-y divide-hair rounded-2xl border border-line text-sm">
      {lines.map((l) => (
        <li key={l.label} className={row}>
          <span className="min-w-0">{l.label}{l.sub && <span className="block text-xs text-steel">{l.sub}</span>}</span>
          <span className="num shrink-0 text-graphite">{l.value}</span>
        </li>
      ))}
      <li className={cn(row, "bg-cloud text-ink", !over && "rounded-b-2xl font-medium")}>
        <span className="min-w-0">{over ? "Not accounted for" : "Used more than bought"}<span className="block text-xs text-steel">{over ? `${pct(r.share)} of what was used` : "Stock on the shelf went down. A count shows by how much."}</span></span>
        <span className="num shrink-0">{q(r.gap)}</span>
      </li>
      {over && (
        <>
          <li className={row}>
            <span className="min-w-0">Last delivery, which may still be on the shelf{r.lastDeliveryDate && <span className="block text-xs text-steel">{fmtDate(r.lastDeliveryDate)}</span>}</span>
            <span className="num shrink-0 text-graphite">− {q(Math.min(r.gap, r.lastDelivery))}</span>
          </li>
          <li className={cn(row, "rounded-b-2xl bg-cloud font-medium text-ink")}>
            <span className="min-w-0">Beyond the last delivery<span className="block text-xs font-normal text-steel">{excess > 0 ? `About ${money(excess * r.unitCost)} at the price paid, an estimate` : "Within what the last delivery could leave on the shelf"}</span></span>
            <span className="num shrink-0">{excess > 0 ? q(excess) : "None"}</span>
          </li>
        </>
      )}
    </ul>
  );
}

/** Why an item with more bought than used is not flagged, in the words of the rules. */
function notFlaggedWhy(r: BoughtUsedRowOut, rules: BoughtUsedView["rules"], money: (n: number) => string): string {
  if (r.gap <= 0) return "Stock went down";
  if (r.excess <= 0) return "Within the last delivery";
  if (r.share < rules.minShare) return `Under ${pct(rules.minShare)} of use`;
  return `Under ${money(rules.minValue)}`;
}

/** The state of a flagged item: checked on the server, or the case's own state. */
function statusOf(r: Pick<BoughtUsedRowOut, "check">, c: Investigation | undefined): { label: string; tone: "neutral" | "warn" | "pos" | "ink" } {
  if (r.check) return r.check.outcome === "not_found" ? { label: "Needs a closer look", tone: "warn" } : { label: "Checked", tone: "pos" };
  if (c && c.status === "closed") return { label: "Closed", tone: "neutral" };
  if (c && c.status !== "new") return { label: "Being looked into", tone: "ink" };
  return { label: "To check", tone: "warn" };
}

export function BoughtUsed({ propertyId, tabs }: { propertyId: string; tabs?: ReactNode }) {
  const router = useRouter();
  const params = useSearchParams();
  const { user } = useView();
  const [version, setVersion] = useState(0);
  const { data, error } = useApi<BoughtUsedView>(`/api/stock/bought-used?propertyId=${propertyId}&v=${version}`);
  const cases = useInvestigations();
  const [kind, setKind] = useState<Kind>("all");
  const [showAll, setShowAll] = useState(false);
  const currency = propertyById[propertyId].currency;
  const money = (n: number) => fmtMoney(n, currency);
  const caseOf = (r: BoughtUsedRowOut) => (r.flagId ? cases.find((c) => c.id === r.flagId) : undefined);
  const open = params.get("item");
  const setOpen = (id: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (id) next.set("item", id);
    else next.delete("item");
    router.replace(`/stock?${next.toString()}`, { scroll: false });
  };

  const rows = useMemo(() => (data?.rows ?? []).filter((r) => kind === "all" || ingredientById[r.ingredientId].dept === kind), [data, kind]);
  if (error) return <div className="space-y-6">{tabs}<WidgetError>Bought against used could not load. {error}</WidgetError></div>;
  if (!data) return <div className="space-y-6"><Skeleton className="h-40 w-full" />{tabs}<Skeleton className="h-64 w-full" /></div>;

  const flagged = data.rows.filter((r) => r.flagged);
  // Still to check: no check yet, or checked and not found.
  const toCheckCount = flagged.filter((r) => !r.check || r.check.outcome === "not_found").length;
  const top = data.rows.find((r) => r.ingredientId === data.topId);
  const q = (r: BoughtUsedRowOut, n = r.gap) => boughtQty(n, r.ingredientId);
  const toCheck = rows.filter((r) => r.flagged);
  // The gaps beyond the last delivery, largest first, on one scale. Items below the rules are drawn grey: not flagged.
  const bars = rows.filter((r) => r.excessValue > 0).sort((a, b) => b.excessValue - a.excessValue).slice(0, TOP);
  const selected = data.rows.find((r) => r.ingredientId === open) ?? null;
  const focus = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" }));
  const saved = async () => {
    setVersion((v) => v + 1);
    // The flag's state follows the check everywhere, so the copy of the data in this browser is fetched again.
    try { replaceDataset(await api<Snapshot>("/api/data")); } catch { /* the next page load brings it */ }
  };

  return (
    <div className="space-y-6">
      <SummaryBar
        items={[
          { label: "More bought than used", value: money(data.summary.flaggedValue), tone: data.summary.flaggedValue > 0 ? "warn" : "pos", compare: { text: !flagged.length ? "No item stands out" : "Beyond the last delivery, an estimate", good: null }, onClick: () => focus("bought-check") },
          { label: "Largest flagged gap", value: top ? itemWords(top.ingredientId) : "None", compare: { text: top ? `${q(top, top.excess)} beyond the last delivery, ${money(top.excessValue)}` : "Nothing flagged", good: null }, onClick: top ? () => setOpen(top.ingredientId) : undefined },
          { label: "Checked", value: `${data.summary.checkedFlagged} of ${flagged.length}`, compare: { text: !flagged.length ? "Nothing to check" : toCheckCount === 0 ? "All checked by a manager" : `${toCheckCount} ${toCheckCount === 1 ? "item" : "items"} to check`, good: flagged.length ? toCheckCount === 0 : null }, onClick: () => focus("bought-check") },
          { label: "Items compared", value: data.summary.checked, compare: { text: `${money(data.summary.boughtValue)} bought in 30 days`, good: null }, onClick: () => focus("bought-all") },
        ]}
        trend={data.trend.length > 0 && flagged.length > 0 ? (
          <StripTrend
            goodWhen="down" title="Gap building up, last 30 days" points={data.trend.map((p) => ({ date: p.date, value: p.value }))} format={money}
            summary={`Bought less used for the flagged items, added up day by day at the price paid, leaving out each item's last delivery. ${money(data.summary.flaggedValue)} by today. An estimate.`}
            note="flagged items, an estimate"
            footer={<><span className="num font-medium text-graphite">{money(data.summary.flaggedValue)}</span> by today, an estimate</>}
            explain="A running total, not a daily figure: bought less used for the flagged items, added up day by day at the price paid. It rises on delivery days and falls a little each day with sales. Each item's last delivery is left out, as it may still be on the shelf, so the line ends on the flags' total."
            series={top ? [{ id: "top", label: itemWords(top.ingredientId), points: data.trend.map((p) => ({ date: p.date, value: p.top })), format: money, axis: "main", explain: `${itemWords(top.ingredientId)} alone, the largest flagged gap.`, goodWhen: "down" }] : []}
          />
        ) : undefined}
      />
      {tabs}
      <p className="px-1 text-[13px] text-steel">What came in from suppliers over the last 30 days against what the till sold, by recipe, and the waste logged. Deliveries arrive for the whole of {propertyById[propertyId].name}, so this covers all its outlets. No count is needed: stock still on the shelf is part of a gap until a count confirms it.</p>

      <div id="bought-check" className="scroll-mt-24" />
      <Panel title="Items to check" description="Largest first. Count the item, then mark what you found. Everyone with access sees it." flush>
        {toCheck.length === 0 ? <div className="px-6 pb-6"><EmptyState title="Nothing to check">{kind === "all" ? "No item was bought well beyond its use in the last 30 days." : "Nothing in this kind. Choose All to see every item."}</EmptyState></div> : (
          <ul className="divide-y divide-hair border-t border-hair">
            {(showAll ? toCheck : toCheck.slice(0, TOP)).map((r) => {
              const c = caseOf(r);
              const st = statusOf(r, c);
              return (
                <li key={r.ingredientId} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:gap-6 sm:px-6">
                  <button type="button" onClick={() => setOpen(r.ingredientId)} className="min-w-0 flex-1 text-start">
                    <span className="block text-[15px] text-ink underline-offset-4 hover:underline">{itemWords(r.ingredientId)}: {q(r)} more bought than used</span>
                    <span className="num mt-0.5 block text-xs text-steel">Bought {q(r, r.bought + r.movedIn)}, used {q(r, r.used)}, {pct(r.share)} of use</span>
                  </button>
                  <div className="flex items-center justify-between gap-4 sm:justify-end">
                    <span className="num text-[15px] font-medium text-ink">{money(r.excessValue)}<span className="block text-xs font-normal text-steel">estimate</span></span>
                    <Badge tone={st.tone}>{st.label}</Badge>
                    <Button size="sm" onClick={() => setOpen(r.ingredientId)}>{r.check ? "View" : "Check"}</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {toCheck.length > TOP && <div className="border-t border-hair px-6 py-3"><button type="button" className={textLink} onClick={() => setShowAll((v) => !v)}>{showAll ? "Show the five largest" : `Show all ${toCheck.length} flagged items`}</button></div>}
      </Panel>

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="Largest gaps beyond the last delivery" description="At the price paid, an estimate. Grey items are below the rules, so not flagged. Choose an item for its figures." action={<Segmented label="Kind" size="sm" value={kind} onChange={setKind} options={[{ value: "all", label: "All" }, { value: "food", label: "Food" }, { value: "beverage", label: "Beverage" }]} />}>
          {bars.length === 0 ? <EmptyState title="Nothing bought beyond use">Every item was used about as fast as it came in.</EmptyState>
            : <BarList format={money} rows={bars.map((r) => ({ key: r.ingredientId, label: itemWords(r.ingredientId), sub: r.flagged ? `${q(r, r.excess)}, ${pct(r.share)} of use` : `Not flagged: ${notFlaggedWhy(r, data.rules, money).toLowerCase()}`, value: r.excessValue, muted: !r.flagged, onClick: () => setOpen(r.ingredientId) }))} />}
        </Panel>
        <Panel title="When Tyll flags a gap" description="Rules agreed with the hotel. A flag is a prompt to count, not proof.">
          <ul className="space-y-3 text-sm text-graphite">
            <li>More came in than sales and logged waste account for, by more than the last delivery could leave on the shelf.</li>
            <li>The gap is at least {pct(data.rules.minShare)} of what was used, and the part beyond the last delivery is worth at least {money(data.rules.minValue)}. That part is the amount at risk.</li>
            <li>Moves between the hotel&rsquo;s own outlets are left out: the check covers the whole hotel.</li>
            <li>Using more than was bought is not flagged here. It means stock went down, and a count shows it.</li>
          </ul>
        </Panel>
      </div>

      <div id="bought-all" className="scroll-mt-24" />
      <Section id="bought.all" flush title={`All ${rows.length} items compared`} summary={`${rows.filter((r) => r.gap > 0).length} with more bought than used, ${rows.filter((r) => r.gap < 0).length} used more than bought. Largest gap first.`}>
        <TableWrap>
          <table className="w-full min-w-[760px] text-table">
            <thead><tr><Th>Item</Th><Th align="right">Bought</Th><Th align="right">Used</Th><Th align="right">Gap</Th><Th align="right">Beyond last delivery</Th><Th>Status</Th></tr></thead>
            <tbody>{rows.map((r) => {
              const st = r.flagged ? statusOf(r, caseOf(r)) : null;
              return (
                <tr key={r.ingredientId} className={cn(rowClass, "cursor-pointer")} onClick={() => setOpen(r.ingredientId)}>
                  <Td><button type="button" className="text-start text-ink underline-offset-4 hover:underline" onClick={(e) => { e.stopPropagation(); setOpen(r.ingredientId); }}>{ingredientById[r.ingredientId].name}</button><span className="block text-xs text-steel">{groupName(r.ingredientId)}</span></Td>
                  <Td align="right"><span className="num">{q(r, r.bought + r.movedIn)}</span><span className="block text-xs text-steel">{r.deliveries} {r.deliveries === 1 ? "delivery" : "deliveries"}</span></Td>
                  <Td align="right"><span className="num">{q(r, r.used)}</span>{r.waste > 0 && <span className="block text-xs text-steel">{q(r, r.waste)} waste</span>}</Td>
                  <Td align="right" className={cn(r.flagged && "font-semibold text-ink")}><span className="num">{r.gap < 0 ? "−" : ""}{q(r)}</span>{r.used > 0 && <span className="block text-xs font-normal text-steel">{pct(r.share)} of use</span>}</Td>
                  <Td align="right">{r.excess > 0 ? <><span className="num">{money(r.excessValue)}</span><span className="block text-xs text-steel">{q(r, r.excess)}</span></> : "None"}</Td>
                  <Td>{st ? <Badge tone={st.tone}>{st.label}</Badge> : <span className="text-xs text-steel">{notFlaggedWhy(r, data.rules, money)}</span>}</Td>
                </tr>
              );
            })}</tbody>
          </table>
        </TableWrap>
        <Note className="px-6 py-4">Bought is what suppliers delivered, including deliveries received in Tyll. Used is units sold, including complimentary ones, times the recipe quantity, plus logged waste and transfers out of the hotel. Beyond last delivery is the gap less the last delivery, which may still be on the shelf, at the price paid. A gap does not show what happened to the stock.</Note>
      </Section>

      <Drawer open={!!selected} onClose={() => setOpen(null)} title={selected ? ingredientById[selected.ingredientId].name : ""} description={selected ? `Last 30 days, ${propertyById[propertyId].name}. An estimate until a count.` : undefined}>
        {selected && <ItemDetail r={selected} c={caseOf(selected)} money={money} why={notFlaggedWhy(selected, data.rules, money)} mayCount={can(user, "stock.count")} mayReview={canOpen(user, "investigations")} outcomes={data.outcomes} onSaved={saved} propertyId={propertyId} />}
      </Drawer>
    </div>
  );
}

function ItemDetail({ r, c, money, why, mayCount, mayReview, outcomes, onSaved, propertyId }: { r: BoughtUsedRowOut; c?: Investigation; money: (n: number) => string; why: string; mayCount: boolean; mayReview: boolean; outcomes: BoughtUsedView["outcomes"]; onSaved: () => void; propertyId: string }) {
  const [outcome, setOutcome] = useState<BoughtUsedOutcome | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const q = (n: number) => boughtQty(n, r.ingredientId);
  const post = async (body: Record<string, unknown>, done: string) => {
    setBusy(true);
    try {
      await api("/api/stock/bought-used", { method: "POST", body });
      toast.done(done);
      setOutcome(null);
      setNote("");
      onSaved();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save."); }
    finally { setBusy(false); }
  };
  const save = () => outcome && post({ action: "check", propertyId, ingredientId: r.ingredientId, outcome, note }, outcome === "not_found" ? "Saved. The flag stays open for a closer look." : "Saved. The flag is closed for everyone.");
  return (
    <div className="space-y-6">
      <p className="text-[15px] leading-relaxed text-ink">
        {r.gap > 0 ? `${q(r.gap)} more came in than the till and the waste log account for.` : `${q(r.gap)} more was used than bought. Stock on the shelf went down.`}
        {r.flagged ? " Tyll flags it because the gap is larger than the last delivery could leave on the shelf." : r.gap > 0 ? ` Not flagged: ${why.toLowerCase()}.` : ""}
      </p>
      <BoughtUsedSum r={r} money={money} />
      <p className="-mt-3 text-xs text-steel">Moves between the hotel&rsquo;s own outlets are left out: the check covers the whole hotel.</p>
      {r.flagged && !r.check && r.earlierCheck && (
        <p className="rounded-2xl border border-line px-4 py-3 text-sm text-graphite">Checked earlier by {personName(r.earlierCheck.by)}, {fmtDate(r.earlierCheck.date, true)}, when the gap was {q(r.earlierCheck.gap)}. It has grown by more than a delivery since, so it is to check again.</p>
      )}
      {r.flagged && (r.check ? (
        <div className="rounded-2xl border border-line p-4">
          <p className="text-sm text-ink">{outcomes.find((o) => o.value === r.check!.outcome)?.label}</p>
          {r.check.note && <p className="mt-1 text-sm text-graphite">{r.check.note}</p>}
          <p className="mt-1 text-xs text-steel">Marked by {personName(r.check.by)}, {fmtDate(r.check.date, true)}, when the gap was {q(r.check.gap)}.</p>
          <button type="button" disabled={busy} className={cn(textLink, "mt-2")} onClick={() => post({ action: "clear", id: r.check!.id }, "Taken back. The item is to check again.")}>Take back</button>
        </div>
      ) : (
        <fieldset className="space-y-3">
          <legend className="text-[15px]">What did you find?</legend>
          <div className="grid gap-2">
            {outcomes.map((o) => (
              <label key={o.value} className={cn("flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-sm transition-colors duration-150", outcome === o.value ? "border-accent bg-accent-soft text-ink" : "border-line text-graphite hover:border-fog")}>
                <input type="radio" name="bought-outcome" className="h-4 w-4 accent-[var(--color-accent)]" checked={outcome === o.value} onChange={() => setOutcome(o.value)} />
                {o.label}
              </label>
            ))}
          </div>
          <TextArea label="Note (optional)" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="For example: 18 cases in the main store, standing order cut" />
          <Button variant="primary" className="w-full" disabled={!outcome || busy} onClick={save}>{busy ? "Saving…" : "Mark checked"}</Button>
          <Note>Saved on the hotel&rsquo;s records with your name. Counted and no recipe close the flag; not found keeps it open.</Note>
        </fieldset>
      ))}
      {r.uses.length > 0 && (
        <div>
          <h3 className="text-[15px]">Sold in</h3>
          <ul className="mt-2 space-y-1 text-sm text-graphite">
            {r.uses.slice(0, 3).map((u) => <li key={u.itemId} className="flex justify-between gap-4"><span>{itemById[u.itemId].name}, {u.units.toLocaleString("en-US")} sold</span><span className="num">{q(u.qty)}</span></li>)}
          </ul>
        </div>
      )}
      {r.gap > 0 && (
        <div>
          <h3 className="text-[15px]">What could explain it</h3>
          <p className="mt-1 text-xs text-steel">Possibilities to check. None of them is established.</p>
          <ul className="mt-2 space-y-3 text-sm">
            {BOUGHT_USED_CAUSES.map((x) => <li key={x.id}><span className="text-ink">{x.title}</span><span className="block text-xs text-steel">{x.check}</span></li>)}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {mayReview && c && <Link prefetch={false} href={`/investigations/${c.id}`} className={textLink}>Review the flag</Link>}
        {mayCount && <Link prefetch={false} href={`/stock?tab=counts&item=${r.ingredientId}`} className={textLink}>Count this item</Link>}
      </div>
    </div>
  );
}
