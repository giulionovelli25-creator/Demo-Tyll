"use client";
// Till rule check (overnight feature 5): did the till charge what was served? Bills reopened after payment, cheaper items
// rung up, open items and prices set by hand, and items rung twice. The figures come from the server (/api/money/till),
// which lists the same flags the flags page shows; the case states come from the flags, so the open count here is the
// same as on the Money Back List.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { useMemo, useState } from "react";
import { BarList, StripTrend } from "@/components/charts";
import { Section } from "@/components/disclosure";
import { Badge, Button, EmptyState, Note, Panel, Skeleton, SummaryBar, TableWrap, Td, Th, WidgetError, cn, linkButton, rowClass, textLink } from "@/components/ui";
import { itemById, outletLabel } from "@/lib/data/catalog";
import { POLICY, TILL_TYPES, TYPE_LABEL } from "@/lib/domain/detect";
import { exceptionInSel } from "@/lib/domain/metrics";
import { MIX_RULES, cheapName, mixLabelById } from "@/lib/domain/till-rules";
import { useApi, useInvestigations, useView } from "@/lib/hooks";
import { STATUS_LABEL } from "@/lib/labels";
import type { TillCheck, TillRow } from "@/lib/server/till";
import type { ExceptionType } from "@/lib/types";
import { fmtDate, fmtNum, fmtRange, fmtTime, sum } from "@/lib/util";

const TOP = 5;
const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" });

/** What each rule looked at, in words, for "1 of 4 bills reopened". */
const SEEN_WORDS: Partial<Record<ExceptionType, [one: string, many: string]>> = {
  bill_reopened: ["bill reopened", "bills reopened"],
  price_override: ["bill with a price set at the till", "bills with a price set at the till"],
  duplicate_ring: ["bill with a repeat entry", "bills with a repeat entry"],
  cheaper_item_rung: ["bottle week checked", "bottle weeks checked"],
};

export function TillRuleCheck() {
  const router = useRouter();
  // ?open=example opens the worked example and ?open=bottles the premium bottles, for a guided demo or a link from a call.
  const opened = useSearchParams().get("open");
  const openExample = opened === "example";
  const { sel, money } = useView();
  const all = useInvestigations();
  const [everything, setEverything] = useState(false);
  const url = `/api/money/till?from=${sel.range.from}&to=${sel.range.to}&outlets=${sel.outletIds.join(",")}`;
  const { data, error } = useApi<TillCheck>(url);
  const cases = useMemo(() => new Map(all.map((i) => [i.id, i])), [all]);
  // Open flags of every till rule in view, whatever the period: the same list as the Money Back List.
  const open = useMemo(() => all.filter((i) => TILL_TYPES.includes(i.type) && i.status !== "closed" && exceptionInSel(i, sel)), [all, sel]);

  if (error) return <WidgetError>The till rule check could not load.</WidgetError>;
  if (!data) return <Skeleton className="h-72 w-full" />;
  const statusOf = (r: TillRow) => cases.get(r.caseId)?.status ?? r.seedStatus;
  const rows = [...data.rows].sort((a, b) => Number(statusOf(a) === "closed") - Number(statusOf(b) === "closed") || b.atStake - a.atStake);
  const shown = everything ? rows : rows.slice(0, TOP);
  const flaggedValue = sum(data.rows, (r) => r.atStake);
  const openValue = sum(open, (i) => i.exposure);
  const reopen = data.rules.find((r) => r.type === "bill_reopened")!;
  const story = data.story;
  const storyCase = story ? cases.get(story.caseId) : undefined;
  const words = (type: ExceptionType, n: number) => (SEEN_WORDS[type] ?? ["", ""])[n === 1 ? 0 : 1];
  const removedWords = story ? story.removed.map((l) => `${l.qty} × ${itemById[l.itemId].name}`).join(" and ") : "";
  const removedValue = story ? sum(story.removed, (l) => l.value) : 0;

  return (
    <div className="space-y-6">
      <SummaryBar
        items={[
          { label: "Bills checked", value: fmtNum(data.bills), compare: { text: "Every bill in the period, at the outlets in view", good: null }, onClick: () => scrollTo("till-rules") },
          { label: "Rule met", value: fmtNum(data.rows.length), tone: data.rows.length ? "warn" : "pos", compare: { text: data.rows.length ? `${money(flaggedValue)} involved` : "Every bill followed the till rules", good: data.rows.length ? false : true }, onClick: () => scrollTo("till-list") },
          { label: "Open to check", value: money(openValue), tone: "money", compare: { text: `${open.length} open ${open.length === 1 ? "flag" : "flags"}, until checked`, good: null }, href: "/investigations?type=till&status=open" },
          { label: "Reopened after payment", value: fmtNum(reopen.seen), compare: { text: `${reopen.flagged} closed lower with no approval`, good: reopen.flagged ? false : true }, onClick: () => scrollTo("till-rules") },
        ]}
        trend={
          <StripTrend
            goodWhen="down"
            title="Rule met per day, 30 days"
            points={data.days.map((d) => ({ date: d.date, value: d.value }))}
            format={(n) => money(n)}
            note="by the day it happened"
            explain="Money on bills that met a till rule, by the day the bill was rung. The weekly bottle check counts on the morning it runs."
            series={[{ id: "count", label: "Bills flagged", axis: "count", goodWhen: "down", format: (n) => fmtNum(n), points: data.days.map((d) => ({ date: d.date, value: d.flagged })), explain: "How many bills or bottle weeks met a till rule each day." }]}
            summary={`Value of bills that met a till rule, per day for the last 30 days. ${data.rows.length} in the selected period.`}
          />
        }
        action={open.length > 0 ? <Link prefetch={false} href="/investigations?type=till&status=open" className={linkButton("primary")}>Review {open.length} open</Link> : undefined}
      />

      {story && (
        <Section id="till.example" forceOpen={openExample} title="Worked example: a bill reopened after the guests paid" summary={`Last night at ${outletLabel(story.outletId)}. How one flag is found, step by step.`}>
          <Panel title={`Last night at ${outletLabel(story.outletId)}: a bill changed after payment`} description="A worked example of what Tyll looks for. The bill below is in last night's records." action={storyCase && <Badge tone={storyCase.status === "closed" ? "neutral" : "warn"}>{STATUS_LABEL[storyCase.status]}</Badge>}>
            <ol className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                [fmtTime(story.paidMin), `A table of ${story.covers} pays ${money(story.paid)} by ${story.payment}`, story.removed[0]?.readyMin !== undefined ? `The kitchen marked the lamb chops ready at ${fmtTime(story.removed[0].readyMin)}` : ""],
                [fmtTime(story.reopenMin), "The paid bill is reopened", "Under the login that rang it"],
                [fmtTime(story.reopenMin + 1), `${removedWords} taken off`, `${money(removedValue)}, no reason, no approval`],
                [fmtTime(story.closedMin), `Closed again at ${money(story.after)}`, `${money(story.paid - story.after)} less than the guests paid`],
              ].map(([time, title, detail], i) => (
                <li key={i} className={cn("relative rounded-2xl border p-4", i === 2 ? "border-warn/40 bg-warn-soft" : "border-line")}>
                  <p className="num text-[13px] text-steel">{time}</p>
                  <p className="mt-1 text-[15px] leading-snug text-ink">{title}</p>
                  {detail && <p className="mt-1 text-xs text-steel">{detail}</p>}
                </li>
              ))}
            </ol>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-[70ch] text-sm text-graphite">Tyll flags that a paid bill was reopened and closed lower with no manager&rsquo;s approval. It does not conclude why. The case shows the bill before and after, and what to check: whether the dish was sent back, and whether the cash count for the shift matched what the guests paid.</p>
              {storyCase && <Button onClick={() => router.push(`/investigations/${story.caseId}`)}>Open the investigation <ArrowRight size={15} className="rtl:rotate-180" /></Button>}
            </div>
          </Panel>
        </Section>
      )}

      <div id="till-rules" className="grid scroll-mt-24 grid-cols-1 gap-5 lg:grid-cols-2 [&>*]:min-w-0">
        <Panel title="Flagged by rule" description={`${fmtRange(sel.range)}. Value involved. Choose a rule to see its cases.`}>
          <BarList
            format={(n) => money(n)}
            rows={[...data.rules].sort((a, b) => b.value - a.value || b.flagged - a.flagged).map((r) => ({
              key: r.type, label: TYPE_LABEL[r.type], sub: `${r.flagged} of ${fmtNum(r.seen)} ${words(r.type, r.seen)}`, value: r.value,
              onClick: () => router.push(`/investigations?type=${r.type}&status=all`),
            }))}
          />
        </Panel>
        <Panel title="What Tyll checks" description="Rules agreed with the hotel. A flag is a prompt to check the bill, not proof of anyone's mistake.">
          <ul className="space-y-3 text-sm text-graphite">
            <li>A bill reopened after payment and closed lower, with no manager&rsquo;s approval.</li>
            <li>A cheaper item rung up: premium bottles going out faster than they are billed while the cheaper serve is billed, such as house wine for the reserve red or singles for doubles. At least {MIX_RULES.minGapBottles} bottles and {Math.round(MIX_RULES.minShare * 100)}% of what they give, over {MIX_RULES.days} days. An estimate.</li>
            <li>Open items, the misc button and prices changed by hand, more than {Math.round(POLICY.priceBelowShare * 100)}% below the menu price of the item on the ticket, with no approval.</li>
            <li>The same item rung twice within {POLICY.duplicateSeconds} seconds with more of it on the bill than guests at the table, or {POLICY.quantityMin} or more of one item at more than {POLICY.quantityPerGuest} a guest.</li>
          </ul>
        </Panel>
      </div>

      <div id="till-list" className="scroll-mt-24">
        <Panel title="Bills to check" description="Open first, largest amount first. Checked ones follow." action={<Link prefetch={false} href="/investigations?type=till&status=all" className="flex items-center gap-1 text-[13px] text-steel hover:text-ink">Money Back List <ArrowRight size={14} className="rtl:rotate-180" /></Link>} flush>
          {rows.length === 0 ? <div className="px-5 pb-6 sm:px-6"><EmptyState title="Every bill in this period followed the till rules" /></div> : (
            <>
              {/* Phones get one card per bill, so the amount, status and action are never off screen. */}
              <ul className="divide-y divide-hair border-t border-hair sm:hidden">
                {shown.map((r) => {
                  const st = statusOf(r);
                  return (
                    <li key={r.caseId} className="px-5 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <p className="min-w-0 text-sm text-ink">{r.headline}</p>
                        <span className="num shrink-0 text-sm font-medium text-ink">{money(r.atStake)}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-steel">{TYPE_LABEL[r.type]} · {outletLabel(r.outletId)} · {fmtDate(r.date)}, {fmtTime(r.min)}{r.estimate ? " · estimate" : ""}</p>
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <Badge tone={st === "closed" ? "neutral" : st === "new" ? "warn" : "ink"}>{st === "closed" ? "Checked" : STATUS_LABEL[st]}</Badge>
                        <Link prefetch={false} href={`/investigations/${r.caseId}`} className={textLink}>{st === "closed" ? "View" : "Review"} <ArrowRight size={14} className="rtl:rotate-180" /></Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <TableWrap className="hidden sm:block">
                <table className="w-full min-w-[820px] text-sm">
                  <thead><tr><Th>What Tyll found</Th><Th>Outlet</Th><Th>When</Th><Th align="right">Value involved</Th><Th>Status</Th><Th><span className="sr-only">Action</span></Th></tr></thead>
                  <tbody>
                    {shown.map((r) => {
                      const st = statusOf(r);
                      return (
                        <tr key={r.caseId} className={cn(rowClass, "cursor-pointer")} onClick={() => router.push(`/investigations/${r.caseId}`)}>
                          <Td><span className="text-ink">{r.headline}</span><span className="mt-0.5 block text-xs text-steel">{TYPE_LABEL[r.type]}{r.estimate ? ", an estimate" : ""}</span><span className="mt-0.5 line-clamp-2 max-w-[460px] text-xs text-graphite">{r.comparedWith}</span></Td>
                          <Td>{outletLabel(r.outletId)}</Td>
                          <Td className="num whitespace-nowrap text-graphite">{fmtDate(r.date)}, {fmtTime(r.min)}</Td>
                          <Td align="right" className="font-medium text-ink">{money(r.atStake)}</Td>
                          <Td><Badge tone={st === "closed" ? "neutral" : st === "new" ? "warn" : "ink"}>{st === "closed" ? "Checked" : STATUS_LABEL[st]}</Badge></Td>
                          <Td align="right"><Link prefetch={false} href={`/investigations/${r.caseId}`} className={textLink} onClick={(e) => e.stopPropagation()}>{st === "closed" ? "View" : "Review"}</Link></Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableWrap>
              {rows.length > TOP && <div className="border-t border-hair px-6 py-3"><button type="button" onClick={() => setEverything((v) => !v)} className={textLink}>{everything ? "Show the five largest" : `Show all ${rows.length} bills`}</button></div>}
            </>
          )}
        </Panel>
      </div>

      {data.bottles.length > 0 && (
        <Section id="till.bottles" forceOpen={opened === "bottles"} flush title="Premium bottles against what was billed" summary={`The ${MIX_RULES.days} days to ${fmtDate(data.bottles[0].to)}. ${data.bottles.filter((b) => b.flagged).length} of ${data.bottles.length} bottles beyond the rule, an estimate.`}>
          <ul className="divide-y divide-hair">
            {data.bottles.map((b) => {
              const l = mixLabelById[b.labelId];
              return (
                <li key={`${b.outletId}-${b.labelId}`} className="px-5 py-4 sm:px-6">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <p className="text-sm text-ink">{l.name}<span className="ms-2 text-xs text-steel">{outletLabel(b.outletId)}</span></p>
                    {b.flagged ? <Badge tone="warn">{money(b.value)} at risk, an estimate</Badge> : <Badge tone="pos">Within the rule</Badge>}
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
                    <div><dt className="text-xs text-steel">Bottles issued</dt><dd className="num text-ink">{fmtNum(b.bottles)}<span className="block text-xs text-steel">{fmtNum(b.before.bottles, 1)} a week before</span></dd></div>
                    <div><dt className="text-xs text-steel">They give about</dt><dd className="num text-ink">{fmtNum(b.bottles * b.perBottle)} {l.unit}</dd></div>
                    <div><dt className="text-xs text-steel">{b.rule === "premium" ? "Glasses billed as reserve" : "Billed, a double as two"}</dt><dd className="num text-ink">{fmtNum(b.billed)}<span className="block text-xs text-steel">{fmtNum(b.before.billed, 0)} a week before</span></dd></div>
                    <div><dt className="text-xs text-steel">{b.rule === "premium" ? `${cheapName(l)} glasses billed` : "Singles billed"}</dt><dd className="num text-ink">{fmtNum(b.cheapBilled)}<span className="block text-xs text-steel">{fmtNum(b.before.cheapBilled, 0)} a week before</span></dd></div>
                  </dl>
                </li>
              );
            })}
          </ul>
          <div className="space-y-2 px-6 py-4">
            <Note className="max-w-[95ch]">Bottles issued are the full bottles the bar takes from the cellar for each empty it hands back. Simulated, as are the bills. One open bottle can always be part used, so a gap under {MIX_RULES.minGapBottles} bottles is never flagged.</Note>
          </div>
        </Section>
      )}
    </div>
  );
}
