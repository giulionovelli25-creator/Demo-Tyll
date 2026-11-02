"use client";
// The revenue and profit chart. Loaded on its own so the five cards appear first. One axis, a legend, and labels only on the points that matter.
import { memo } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface ChartPoint { label: string; revenue: number; profit: number; partial: boolean }

const axis = { tick: { fontSize: 12, fill: "var(--chart-axis)" }, axisLine: false, tickLine: false };

function pointLabel(points: ChartPoint[], key: "revenue" | "profit", format: (n: number) => string) {
  const values = points.map((p) => p[key]);
  const peak = values.indexOf(Math.max(...values));
  // eslint-disable-next-line react/display-name
  return (p: { x?: number | string; y?: number | string; index?: number; value?: unknown }) => {
    if (p.index !== peak) return <g />;
    return <text x={Number(p.x)} y={Number(p.y) - 10} textAnchor="middle" fill="var(--color-graphite)" fontSize={12} style={{ fontVariantNumeric: "tabular-nums" }}>{format(Number(p.value))}</text>;
  };
}

function Tip({ active, payload, label, format }: { active?: boolean; payload?: { name?: string; value?: number; color?: string; payload?: ChartPoint }[]; label?: string; format: (n: number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-[var(--radius-control)] border border-line bg-paper px-3 py-2 text-xs shadow-float">
      <p className="mb-1 text-steel">{label}{payload[0].payload?.partial ? ", so far" : ""}</p>
      {payload.map((p) => <p key={p.name} className="num flex items-center gap-2 text-ink"><span className="h-0.5 w-3" style={{ background: p.color }} aria-hidden />{p.name} {format(p.value ?? 0)}</p>)}
    </div>
  );
}

export const RevenueProfitChart = memo(function RevenueProfitChart({ points, format, axisFormat, profitName, summary }: { points: ChartPoint[]; format: (n: number) => string; axisFormat: (n: number) => string; profitName: string; summary: string }) {
  return (
    <figure>
      <figcaption className="sr-only">{summary}</figcaption>
      <div className="mb-2 flex flex-wrap gap-x-4 text-xs text-graphite" aria-hidden>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-[var(--chart-a)]" />Revenue</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-[var(--chart-b)]" />{profitName}</span>
      </div>
      <div className="h-[240px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 20, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
            <XAxis dataKey="label" {...axis} minTickGap={24} />
            <YAxis {...axis} width={44} tickFormatter={axisFormat} />
            <Tooltip content={(p) => <Tip {...(p as object)} format={format} />} cursor={{ stroke: "var(--color-fog)", strokeDasharray: "3 3" }} />
            <Line type="monotone" dataKey="revenue" name="Revenue" stroke="var(--chart-a)" strokeWidth={2} dot={false} isAnimationActive={false} label={pointLabel(points, "revenue", format)} />
            <Line type="monotone" dataKey="profit" name={profitName} stroke="var(--chart-b)" strokeWidth={2} dot={false} isAnimationActive={false} label={pointLabel(points, "profit", format)} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
});
