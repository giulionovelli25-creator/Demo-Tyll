"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ListChecks } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Button, EmptyState, Note, Panel, Segmented, TableWrap, Td, Th, cn, report, rowClass, useSort } from "@/components/ui";
import { ingredientById, outletById, propertyById } from "@/lib/data/catalog";
import { can } from "@/lib/domain/access";
import { bottles, periodVariance, qtyWords, stepsFor, summaryFor, type Variance } from "@/lib/domain/variance";
import { useCtx, useInvestigations, useVariancePeriods, useView } from "@/lib/hooks";
import { STATUS_LABEL } from "@/lib/labels";
import { useDemo } from "@/lib/store";
import type { Investigation, UsagePeriod } from "@/lib/types";
import { fmtMoney } from "@/lib/util";
import { UsageCauses, UsageFigures, UsageRecords, UsageTimeline, UsageTools, periodPlace, useUsage } from "./usage";

type Key = "item" | "expected" | "actual" | "unexplained" | "value";

/** The case for a period, opened automatically or by a manager. */
const caseOf = (cases: readonly Investigation[], p: UsagePeriod) => cases.find((c) => c.period?.id === p.id);

export function WhereDidItGo({ propertyId }: { propertyId: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const { sel } = useView();
  const ctx = useCtx();
  const cases = useInvestigations();
  const { data, error } = useVariancePeriods(propertyId);
  const [show, setShow] = useState<"flagged" | "all">("flagged");
  const [kind, setKind] = useState<"all" | "beverage" | "food">("all");
  const { sort, toggle } = useSort<Key>({ key: "value", dir: "desc" });
  const selectedId = params.get("period");
  const money = (n: number) => fmtMoney(n, propertyById[propertyId].currency, { decimals: true });

  const rows = useMemo(() => {
    const outlets = new Set(sel.outletIds);
    return (data?.periods ?? [])
      .filter((p) => outlets.has(p.outletId))
      .map((p) => ({ p, v: periodVariance(p, ctx.adjust), c: caseOf(cases, p) }));
  }, [data, sel.outletIds, ctx.adjust, cases]);

  const open = (id: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (id) next.set("period", id);
    else next.delete("period");
    router.push(`/stock?${next.toString()}`, { scroll: true });
  };

  const selected = rows.find((r) => r.p.id === selectedId);
  if (selectedId) {
    if (!data) return <EmptyState title="Loading the stock records" />;
    if (!selected) return <EmptyState title="This item is not available" action={<Button onClick={() => open(null)}>Back to the list</Button>}>It is outside your outlets, or outside the outlet chosen in the top bar.</EmptyState>;
    return <PeriodDetail p={selected.p} existing={selected.c} onBack={() => open(null)} />;
  }

  const visible = rows
    .filter((r) => (show === "all" || (r.v.significant && r.v.unexplained > 0) || (r.c && r.c.status !== "closed")) && (kind === "all" || ingredientById[r.p.ingredientId].dept === kind))
    .sort((a, b) => {
      const val = (r: (typeof rows)[number]) => ({ item: ingredientById[r.p.ingredientId].name, expected: r.v.expected * r.p.unitCost, actual: r.v.actual * r.p.unitCost, unexplained: r.v.share, value: r.v.value })[sort.key];
      const [x, y] = [val(a), val(b)];
      const d = typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number);
      return sort.dir === "asc" ? d : -d;
    });
  const flagged = rows.filter((r) => r.v.significant && r.v.unexplained > 0);

  return (
    <div className="space-y-5">
      <Panel
        title="Stock that left without a sale to explain it"
        description="Each outlet counts its own bar and kitchen stock. Tyll compares what left between two counts with what the POS sold and what was logged as waste."
      >
        <p className="text-sm text-graphite">
          {!data ? "Loading the latest counts." : flagged.length === 0 ? "Every counted item is within normal counting and portioning." : (
            <>{flagged.length} item{flagged.length === 1 ? "" : "s"} used more than sales and waste explain, about <span className="num text-ink">{money(flagged.reduce((s, r) => s + r.v.value, 0))}</span> at cost.</>
          )}
        </p>
      </Panel>

      <Panel flush>
        <div className="flex flex-wrap items-end gap-2 px-5 pb-4 sm:px-6">
          <Segmented label="Show" value={show} onChange={setShow} options={[{ value: "flagged", label: "Needs a look" }, { value: "all", label: "All counted items" }]} />
          <Segmented label="Kind" value={kind} onChange={setKind} options={[{ value: "all", label: "All" }, { value: "beverage", label: "Drinks" }, { value: "food", label: "Food" }]} />
          <p className="num ml-auto pb-2 text-[13px] text-steel">{visible.length} item{visible.length === 1 ? "" : "s"}</p>
        </div>
        {error ? <div className="px-6 pb-6"><EmptyState title="The stock records could not be loaded">{error}</EmptyState></div>
          : !data ? <div className="px-6 pb-6"><EmptyState title="Loading the stock records" /></div>
            : visible.length === 0 ? <div className="px-6 pb-6"><EmptyState title="Nothing needs a look" action={<Button onClick={() => setShow("all")}>Show all counted items</Button>}>Choose another outlet in the top bar, or show every counted item.</EmptyState></div> : (
              <TableWrap>
                <table className="w-full min-w-[860px] text-sm">
                  <thead>
                    <tr>
                      <Th sortKey="item" sort={sort} onSort={toggle}>Item</Th>
                      <Th sortKey="expected" sort={sort} onSort={toggle} align="right">Expected use</Th>
                      <Th sortKey="actual" sort={sort} onSort={toggle} align="right">Counted use</Th>
                      <Th sortKey="unexplained" sort={sort} onSort={toggle} align="right">Unexplained</Th>
                      <Th sortKey="value" sort={sort} onSort={toggle} align="right">Estimated cost</Th>
                      <Th>Investigation</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map(({ p, v, c }) => (
                      <tr key={p.id} className={cn(rowClass, "cursor-pointer")} onClick={() => open(p.id)}>
                        <Td>
                          <button type="button" className="text-left text-ink underline-offset-4 hover:underline" onClick={(e) => { e.stopPropagation(); open(p.id); }}>{ingredientById[p.ingredientId].name}</button>
                          <span className="block text-xs text-steel">{outletById[p.outletId].name}</span>
                        </Td>
                        <Td align="right"><Amount p={p} n={v.expected} /></Td>
                        <Td align="right"><Amount p={p} n={v.actual} /></Td>
                        <Td align="right" className={cn(v.significant && v.unexplained > 0 && "text-warn")}>
                          {Math.abs(v.unexplained) < 1e-6 ? "–" : <>{v.unexplained < 0 ? "−" : ""}{qtyWords(v.unexplained, p.ingredientId)}</>}
                          {v.expected > 0 && Math.abs(v.unexplained) > 1e-6 && <span className="block text-xs text-steel">{Math.round(v.share * 100)}% of expected</span>}
                        </Td>
                        <Td align="right">{v.unexplained > 0 ? money(v.value) : "–"}</Td>
                        <Td>{c ? <Badge tone={c.status === "closed" ? "neutral" : c.status === "new" ? "warn" : "ink"}>{STATUS_LABEL[c.status]}</Badge> : <span className="text-xs text-steel">{v.significant && v.unexplained > 0 ? "Not investigated" : "Within normal range"}</span>}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
        <Note className="px-6 py-4">Expected use is units sold, including complimentary ones, times the recipe quantity. Counted use is the opening count, plus stock received, less the closing count. A difference does not show what happened to the stock.</Note>
      </Panel>
    </div>
  );
}

function Amount({ p, n }: { p: UsagePeriod; n: number }) {
  return <span className="num">{qtyWords(n, p.ingredientId)}{p.ingredientId === "wine" && <span className="block text-xs text-steel">{bottles(n)} bottles</span>}</span>;
}

/** One item at one outlet: what happened, why it might have, the records, and the case. */
function PeriodDetail({ p, existing, onBack }: { p: UsagePeriod; existing?: Investigation; onBack: () => void }) {
  const { v, causes } = useUsage(p);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft size={15} /> All items</Button>
        <p className="text-sm text-steel">{periodPlace(p)}</p>
      </div>
      <Panel title={`${ingredientById[p.ingredientId].name}, ${outletById[p.outletId].name}`} action={<CaseAction p={p} v={v} existing={existing} />}>
        <p className="max-w-[80ch] text-[15px] leading-relaxed text-ink">{summaryFor(p, v)}</p>
        <p className="mt-1 text-xs text-steel">Written by Tyll&rsquo;s rules from the records below. No language model is used.</p>
        <div className="mt-6"><UsageFigures p={p} v={v} /></div>
      </Panel>
      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[1.3fr_1fr]">
        <Panel title="What might explain it?"><UsageCauses p={p} causes={causes} /></Panel>
        <Panel title={<span className="flex items-center gap-2"><ListChecks size={18} aria-hidden /> What to do next</span>}>
          <ol className="space-y-3 text-sm">
            {stepsFor(p, v).map((s, i) => <li key={i} className="flex gap-3"><span className="num flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-mist text-xs text-graphite">{i + 1}</span><span className="pt-0.5 text-graphite">{s}</span></li>)}
          </ol>
        </Panel>
      </div>
      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
        <Panel title="What happened, in order"><UsageTimeline p={p} v={v} /></Panel>
        <Panel title="What the records show"><UsageRecords p={p} v={v} /></Panel>
      </div>
      <Panel title="Check and correct" description="Corrections are added to the records and never replace them. The figures above update straight away."><UsageTools p={p} /></Panel>
    </div>
  );
}

/** Open the case for a period, or go to the one that exists. */
function CaseAction({ p, v, existing }: { p: UsagePeriod; v: Variance; existing?: Investigation }) {
  const router = useRouter();
  const { user } = useView();
  const openCase = useDemo((s) => s.openVarianceCase);
  if (existing) {
    return <Button variant="primary" onClick={() => router.push(`/investigations/${existing.id}`)}>{existing.status === "closed" ? "Open the closed case" : "Open the investigation"}</Button>;
  }
  if (!can(user, "investigation.assign") || v.unexplained <= 0) return null;
  return (
    <Button variant="primary" onClick={() => {
      const r = openCase(p);
      if (report(r, "Investigation opened. It is on the Money Back List and the overview.") && r.ok && r.id) router.push(`/investigations/${r.id}`);
    }}>
      Investigate
    </Button>
  );
}
