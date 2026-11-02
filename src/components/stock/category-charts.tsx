"use client";
// Monthly view: one small chart per category. Stock plus confirmed deliveries against predicted use, in money, on one axis.
// Where the use line passes the stock line, the shelf is empty. The dashed line marks the date to order by.
import { memo } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { PlanCategory } from "@/lib/server/purchasing";
import { fmtDate, fmtShort } from "@/lib/util";

const axis = { tick: { fontSize: 11, fill: "var(--chart-axis)" }, axisLine: false, tickLine: false };

function Tip({ active, payload, label, money }: { active?: boolean; payload?: { name?: string; value?: number; color?: string }[]; label?: string; money: (n: number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-[var(--radius-control)] border border-line bg-paper px-3 py-2 text-xs shadow-float">
      <p className="mb-1 text-steel">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="num flex items-center gap-2 text-ink"><span className="h-0.5 w-3" style={{ background: p.color }} aria-hidden />{p.name} {money(p.value ?? 0)}</p>
      ))}
    </div>
  );
}

export const CategoryChart = memo(function CategoryChart({ category, money }: { category: PlanCategory; money: (n: number) => string }) {
  const data = category.points.map((p) => ({ ...p, label: fmtDate(p.date) }));
  const reorder = category.reorderDate ? fmtDate(category.reorderDate) : null;
  return (
    <figure className="min-w-0 rounded-[var(--radius-control)] border border-hair p-3">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-2 text-[13px]">
        <span className="font-medium text-ink">{category.name}</span>
        <span className="text-xs text-steel">{reorder ? `Reorder by ${reorder}` : "Nothing to reorder"}</span>
      </figcaption>
      <div className="mt-2 h-[160px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
            <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={32} />
            <YAxis {...axis} width={36} tickFormatter={fmtShort} />
            <Tooltip content={(p) => <Tip {...(p as object)} money={money} />} cursor={{ stroke: "var(--color-fog)", strokeDasharray: "3 3" }} />
            {reorder && <ReferenceLine x={reorder} stroke="var(--color-neg)" strokeDasharray="4 3" />}
            <Line type="stepAfter" dataKey="stock" name="Stock and deliveries" stroke="var(--chart-a)" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="used" name="Predicted use" stroke="var(--chart-b)" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
});
