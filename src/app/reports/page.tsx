"use client";
import { Download, Printer } from "lucide-react";
import { useMemo } from "react";
import { TyllLogo } from "@/components/brand";
import { RowLink, Section, useRemembered } from "@/components/disclosure";
import { Button, Delta, Note, PageHeader, Panel, Segmented, SummaryBar, TableWrap, Td, Th, cn, rowClass, toast } from "@/components/ui";
import { GROUP_NAME, ingredientById, itemById, outletById, outletLabel, propertyById } from "@/lib/data/catalog";
import { can, canOpen, type ModuleId } from "@/lib/domain/access";
import { wasteCost } from "@/lib/domain/inventory";
import { adjustmentRate, compare, itemPerformance, totalsByOutlet } from "@/lib/domain/metrics";
import { useCtx, useView } from "@/lib/hooks";
import { REASON_LABEL } from "@/lib/labels";
import { useDemo } from "@/lib/store";
import { DEMO_TODAY, downloadCsv, fmtNum, fmtPct, fmtRange, pctChange, type RangePreset } from "@/lib/util";

interface Line {
  label: string;
  now: number | null;
  before: number | null;
  kind?: "total" | "sub";
  goodWhen?: "up" | "down";
  note?: string;
}

export default function ReportsPage() {
  const { sel, money, currency, user, propertyId } = useView();
  const ctx = useCtx();
  const preset = useDemo((s) => s.preset);
  const setPreset = useDemo((s) => s.setPreset);
  const c = useMemo(() => compare(ctx, sel), [ctx, sel]);
  const rows = useMemo(() => totalsByOutlet(ctx, sel), [ctx, sel]);
  const items = useMemo(() => itemPerformance(ctx, sel).filter((r) => r.units > 0), [ctx, sel]);
  const t = c.now;
  const b = c.before;
  const scopeName = sel.outletIds.length === 1 ? outletLabel(sel.outletIds[0]) : propertyId ? propertyById[propertyId].name : GROUP_NAME;
  const mayExport = can(user, "reports.export");
  const stamp = `${sel.range.from}_${sel.range.to}`;

  const statement: Line[] = [
    { label: "Total revenue", now: t.gross, before: b.gross, kind: "total", goodWhen: "up" },
    { label: "Complimentary items", now: -t.comps, before: -b.comps, kind: "sub", goodWhen: "up" },
    { label: "Discounts", now: -t.discounts, before: -b.discounts, kind: "sub", goodWhen: "up" },
    { label: "Refunds", now: -t.refunds, before: -b.refunds, kind: "sub", goodWhen: "up" },
    { label: "Net sales", now: t.net, before: b.net, kind: "total", goodWhen: "up" },
    { label: "Recipe cost of items sold", now: -t.theoCost, before: -b.theoCost, kind: "sub", goodWhen: "up" },
    { label: "Recorded waste", now: -t.waste, before: -b.waste, kind: "sub", goodWhen: "up" },
    { label: "Stock missing at count", now: -t.variance, before: -b.variance, kind: "sub", goodWhen: "up" },
    { label: "Gross profit", now: t.grossProfit, before: b.grossProfit, kind: "total", goodWhen: "up" },
    { label: "Labor", now: t.labor === null ? null : -t.labor, before: b.labor === null ? null : -b.labor, kind: "sub", goodWhen: "up", note: "estimate" },
    { label: "Other operating costs", now: t.opex === null ? null : -t.opex, before: b.opex === null ? null : -b.opex, kind: "sub", goodWhen: "up", note: "estimate" },
    { label: "Estimated operating contribution", now: t.operatingProfit, before: b.operatingProfit, kind: "total", goodWhen: "up", note: "estimate" },
  ];
  const risk: Line[] = [
    { label: "Potential losses, open cases", now: t.potentialLoss, before: null },
    { label: "Confirmed losses", now: t.confirmedLoss, before: b.confirmedLoss, goodWhen: "down" },
    { label: "Money recovered", now: t.recovered, before: b.recovered, goodWhen: "up" },
    { label: "Breakage, glass and plates", now: t.breakage, before: b.breakage, goodWhen: "down" },
  ];
  const top = [...items].sort((a, x) => x.grossProfit - a.grossProfit);

  const guard = (run: () => void, what: string) => () => {
    if (!mayExport) return toast.error("Your role cannot export.");
    run();
    toast.done(`${what} exported.`);
  };
  const exportStatement = guard(() => downloadCsv(`tyll-statement-${stamp}.csv`, [
    ["Tyll management report", scopeName, fmtRange(sel.range), `Currency ${currency}`, "Simulated data"],
    ["Line", "This period", "Previous period", "Change %"],
    ...[...statement, ...risk].map((l) => [l.label + (l.note ? ` (${l.note})` : ""), l.now === null ? "" : l.now.toFixed(2), l.before === null ? "" : l.before.toFixed(2), l.now === null || l.before === null || l.before === 0 ? "" : (((l.now - l.before) / Math.abs(l.before)) * 100).toFixed(1)]),
    ["Gross profit margin %", (t.gpMargin * 100).toFixed(2), (b.gpMargin * 100).toFixed(2), ""],
  ]), "Statement");
  const exportOutlets = guard(() => downloadCsv(`tyll-outlets-${stamp}.csv`, [
    ["Outlet", "Hotel", "Net sales", "F&B cost", "Gross profit", "Gross margin %", "Labor (est.)", "Other operating (est.)", "Operating contribution (est.)", "Orders", "Guests", "Adjustments", "Adjustments per 1000 orders", "Open cases", "Waste", "Stock variance", `Currency ${currency}`],
    ...rows.map((r) => [outletById[r.outletId].name, propertyById[outletById[r.outletId].propertyId].name, r.now.net.toFixed(2), r.now.fnbCost.toFixed(2), r.now.grossProfit.toFixed(2), (r.now.gpMargin * 100).toFixed(2), (r.now.labor ?? 0).toFixed(2), (r.now.opex ?? 0).toFixed(2), (r.now.operatingProfit ?? 0).toFixed(2), r.now.orders, r.now.covers, r.now.adjustments, adjustmentRate(r.now).toFixed(1), r.now.openCases, r.now.waste.toFixed(2), r.now.variance.toFixed(2), ""]),
  ]), "Outlet comparison");
  const exportMenu = guard(() => downloadCsv(`tyll-menu-${stamp}.csv`, [
    ["Item", "Category", "Units sold", "Revenue", "Net sales", "Ingredient cost", "Gross profit", "Margin %", "Current price", "Current portion cost", `Currency ${currency}`],
    ...top.map((r) => [itemById[r.itemId].name, itemById[r.itemId].category, r.units, r.revenue.toFixed(2), r.net.toFixed(2), r.cost.toFixed(2), r.grossProfit.toFixed(2), (r.margin * 100).toFixed(2), r.price.toFixed(2), r.unitCost.toFixed(2), ""]),
  ]), "Menu performance");
  const exportWaste = guard(() => downloadCsv(`tyll-waste-${stamp}.csv`, [
    ["Date", "Outlet", "Item", "Quantity", "Reason", "Cost in outlet currency", "Currency"],
    ...ctx.waste.filter((w) => w.synced && w.date >= sel.range.from && w.date <= sel.range.to && sel.outletIds.includes(w.outletId)).map((w) => [w.date, outletById[w.outletId].name, w.ingredientId ? ingredientById[w.ingredientId].name : `${itemById[w.itemId!].name} (prepared)`, w.qty, REASON_LABEL[w.reason].en, wasteCost(w, ctx.overrides).toFixed(2), propertyById[outletById[w.outletId].propertyId].currency]),
  ]), "Waste log");

  const Row = ({ l }: { l: Line }) => (
    <tr className={cn(rowClass, l.kind === "total" && "border-t-line")}>
      <Td className={cn(l.kind === "total" ? "text-ink" : "!ps-10 text-graphite")}>{l.label}{l.note && <span className="ms-2 text-xs text-steel">{l.note}</span>}</Td>
      <Td align="right" className={cn(l.kind === "total" && "text-ink")}>{l.now === null ? "not split by department" : money(l.now)}</Td>
      <Td align="right">{l.before === null ? "None" : money(l.before)}</Td>
      <Td align="right">{l.now === null || l.before === null ? "None" : <Delta value={pctChange(l.now, l.before)} goodWhen={l.goodWhen ?? "none"} />}</Td>
      <Td align="right">{l.now === null || t.net <= 0 ? "None" : fmtPct(Math.abs(l.now) / t.net)}</Td>
    </tr>
  );

  const [, setReportOpen] = useRemembered<"open" | "closed">("section.reports.statement", "closed");
  // The printed page is the management report, so it opens first.
  const print = () => { setReportOpen("open"); setTimeout(() => window.print(), 80); };
  const groups: { title: string; links: { m: ModuleId; href: string; title: string; summary: string }[] }[] = [
    { title: "Stock records", links: [
      { m: "stock", href: "/stock?tab=suppliers", title: "Suppliers", summary: "Prices and delivery differences" },
      { m: "stock", href: "/stock?tab=recipes", title: "Recipes and costs", summary: "What each dish costs to make" },
      { m: "stock", href: "/stock?tab=inventory", title: "Item history", summary: "Deliveries, counts and use" },
      { m: "stock", href: "/stock?tab=counts", title: "Count records", summary: "Every count and its review" },
    ] },
    { title: "Money records", links: [
      { m: "investigations", href: "/investigations", title: "Money Back List", summary: "Every case, open and closed" },
      { m: "finance", href: "/finance?tab=invoices", title: "Reconciliation", summary: "Invoices against deliveries" },
      { m: "money", href: "/money?tab=rooms", title: "Room charges", summary: "Charges posted to rooms" },
      { m: "money", href: "/money?tab=tips", title: "Tips", summary: "By outlet. Preview" },
    ] },
    { title: "Performance", links: [
      { m: "overview", href: "/menu", title: "Menu", summary: "What each dish sells and earns" },
      { m: "overview", href: "/performance", title: "Sales and performance", summary: "Outlets and trends. Preview" },
    ] },
    { title: "Settings and tools", links: [
      { m: "settings", href: "/settings", title: "Settings", summary: "Connections, access and change log" },
      { m: "more", href: "/more", title: "More tools", summary: "Events, rooms and what is coming" },
    ] },
  ];

  return (
    <div className="space-y-4">
      <div className="no-print space-y-4">
        <PageHeader title="Reports and settings" question="Where is the full detail?" lead={`${scopeName}, ${fmtRange(sel.range)}. Simulated data.`} />
        <SummaryBar
          items={[{ label: "Net sales, this period", value: money(t.net, { compact: true }) }, { label: "Gross margin", value: fmtPct(t.gpMargin) }, { label: "Orders", value: fmtNum(t.orders) }]}
          action={<Button variant="primary" onClick={print}><Printer size={15} /> Print or save as PDF</Button>}
        />
        {mayExport && (
          <Section id="reports.csv" title="Download as CSV" summary="Statement, outlet comparison, menu performance and waste log">
            <div className="flex flex-wrap gap-2">
              <Button onClick={exportStatement}><Download size={15} /> Statement</Button>
              <Button onClick={exportOutlets}><Download size={15} /> Outlet comparison</Button>
              <Button onClick={exportMenu}><Download size={15} /> Menu performance</Button>
              <Button onClick={exportWaste}><Download size={15} /> Waste log</Button>
            </div>
          </Section>
        )}
      </div>

      <Section id="reports.statement" title="Management report" summary={`Sales to profit, money at risk, outlets and menu. ${money(t.gross, { compact: true })} total revenue, ${t.orders ? fmtNum(t.covers) : 0} guests.`} flush>
      <div className="space-y-5 p-4 print:p-0 sm:p-6">
      <div className="no-print"><Segmented label="Report period" value={preset} onChange={(v: RangePreset) => setPreset(v)} options={[{ value: "today", label: "Daily" }, { value: "week", label: "Weekly" }, { value: "month", label: "Monthly" }]} /></div>

      <Panel flush>
        <div className="flex flex-wrap items-end justify-between gap-4 px-6 pb-5">
          <div>
            <TyllLogo height={22} />
            <h2 className="mt-4 text-[26px] tracking-[-0.03em]">{scopeName}</h2>
            <p className="text-sm text-steel">Management report, {fmtRange(sel.range)}{sel.range.to === DEMO_TODAY ? ", today to 8:55 PM" : ""}. Compared with the previous {sel.range.from === sel.range.to ? "day at the same time" : "period of the same length"}. Amounts in {currency}.</p>
          </div>
          <dl className="num grid grid-cols-3 gap-x-8 text-end text-sm">
            <div><dt className="text-xs text-steel">Gross margin</dt><dd className="text-lg">{fmtPct(t.gpMargin)}</dd></div>
            <div><dt className="text-xs text-steel">Orders</dt><dd className="text-lg">{fmtNum(t.orders)}</dd></div>
            <div><dt className="text-xs text-steel">Guests</dt><dd className="text-lg">{fmtNum(t.covers)}</dd></div>
          </dl>
        </div>
        <TableWrap>
          <table className="w-full min-w-[700px] text-sm">
            <thead><tr><Th>Sales to profit</Th><Th align="right">This period</Th><Th align="right">Previous</Th><Th align="right">Change</Th><Th align="right">Share of net sales</Th></tr></thead>
            <tbody>{statement.map((l) => <Row key={l.label} l={l} />)}</tbody>
            <thead><tr><Th className="pt-6">Money at risk</Th><Th> </Th><Th> </Th><Th> </Th><Th> </Th></tr></thead>
            <tbody>{risk.map((l) => <Row key={l.label} l={l} />)}</tbody>
          </table>
        </TableWrap>
        <Note className="px-6 py-4">Simulated data. Labor is estimated from rostered hours and other operating costs are allocated. Estimated operating contribution is not accounting profit: no ledger is connected, and rent, depreciation, management fees and tax are left out. Amounts recovered are reported separately and are not added to net sales.</Note>
      </Panel>

      {rows.length > 1 && (
        <Panel title="Outlets" flush>
          <TableWrap>
            <table className="w-full min-w-[820px] text-sm">
              <thead><tr><Th>Outlet</Th><Th align="right">Net sales</Th><Th align="right">Gross margin</Th><Th align="right">Operating contribution (est.)</Th><Th align="right">Adjustments</Th><Th align="right">Open cases</Th><Th align="right">Waste</Th></tr></thead>
              <tbody>
                {[...rows].sort((a, x) => x.now.net - a.now.net).map((r) => (
                  <tr key={r.outletId} className={rowClass}>
                    <Td className="text-ink">{outletLabel(r.outletId)}</Td>
                    <Td align="right">{money(r.now.net)}</Td>
                    <Td align="right">{fmtPct(r.now.gpMargin)} <Delta value={(r.now.gpMargin - r.before.gpMargin) * 100} kind="pts" className="ms-1" /></Td>
                    <Td align="right">{r.now.operatingProfit === null ? "None" : money(r.now.operatingProfit)}</Td>
                    <Td align="right">{r.now.adjustments}</Td>
                    <Td align="right">{r.now.openCases}</Td>
                    <Td align="right">{money(r.now.waste)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Panel>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {([["Most profitable items", top.slice(0, 5)], ["Least profitable items", top.slice(-5).reverse()]] as const).map(([title, list]) => (
          <Panel key={title} title={title} flush>
            <TableWrap>
              <table className="w-full text-sm">
                <thead><tr><Th>Item</Th><Th align="right">Units</Th><Th align="right">Gross profit</Th><Th align="right">Margin</Th></tr></thead>
                <tbody>
                  {list.map((r) => (
                    <tr key={r.itemId} className={rowClass}><Td className="text-ink">{itemById[r.itemId].name}</Td><Td align="right">{fmtNum(r.units)}</Td><Td align="right">{money(r.grossProfit)}</Td><Td align="right">{fmtPct(r.margin)}</Td></tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Panel>
        ))}
      </div>
      </div>
      </Section>

      <div className="no-print grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        {groups.map((g) => {
          const links = g.links.filter((l) => canOpen(user, l.m));
          return links.length === 0 ? null : (
            <Panel key={g.title} title={g.title} flush>
              <ul>{links.map((l) => <li key={l.href} className="border-t border-hair"><RowLink href={l.href} title={l.title} summary={l.summary} /></li>)}</ul>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
