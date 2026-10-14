"use client";
// Charts share one restrained style: ink for the current period, silver for the comparison.
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "./ui";

const INK = "#14161a";
const FOG = "#b4bac3";
const LINE = "#e2e5e9";
const STEEL = "#666c75";

const axis = { stroke: LINE, tick: { fill: STEEL, fontSize: 11 }, tickLine: false as const };

interface TipRow {
  name?: string | number;
  value?: number | string | (number | string)[];
  color?: string;
}

function Tip({ active, payload, label, format }: { active?: boolean; payload?: readonly TipRow[]; label?: string | number; format: (n: number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-line bg-paper px-3 py-2 text-xs shadow-float">
      <p className="mb-1 text-steel">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="num flex items-center justify-between gap-4 text-ink">
          <span className="flex items-center gap-1.5 text-graphite"><span className="h-2 w-2 rounded-full" style={{ background: p.color }} aria-hidden />{p.name}</span>
          {typeof p.value === "number" ? format(p.value) : "–"}
        </p>
      ))}
    </div>
  );
}

export interface TrendPoint {
  label: string;
  now: number | null;
  before?: number | null;
}

export function TrendChart({ data, format, axisFormat, nowLabel = "This period", beforeLabel = "Previous period", height = 260, onPointClick, summary }: { data: TrendPoint[]; format: (n: number) => string; axisFormat?: (n: number) => string; nowLabel?: string; beforeLabel?: string; height?: number; onPointClick?: (index: number) => void; summary: string }) {
  return (
    <figure>
      <figcaption className="sr-only">{summary}</figcaption>
      <div style={{ height }} className={cn(onPointClick && "[&_.recharts-wrapper]:cursor-pointer")}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} onClick={(s) => onPointClick && typeof s?.activeTooltipIndex === "number" && onPointClick(s.activeTooltipIndex)}>
            <CartesianGrid stroke={LINE} strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="label" {...axis} minTickGap={24} />
            <YAxis {...axis} axisLine={false} width={52} tickFormatter={axisFormat ?? format} domain={["auto", "auto"]} />
            <Tooltip content={(p) => <Tip {...(p as object)} format={format} />} cursor={{ stroke: FOG, strokeDasharray: "3 3" }} />
            {data.some((d) => d.before != null) && <Line type="monotone" dataKey="before" name={beforeLabel} stroke={FOG} strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} />}
            <Line type="monotone" dataKey="now" name={nowLabel} stroke={INK} strokeWidth={2} dot={data.length <= 14 ? { r: 2.5, fill: INK, strokeWidth: 0 } : false} activeDot={{ r: 4 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex items-center gap-4 text-xs text-steel" aria-hidden>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-ink" />{nowLabel}</span>
        {data.some((d) => d.before != null) && <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 border-t-2 border-dashed border-fog" />{beforeLabel}</span>}
      </div>
    </figure>
  );
}

export function AreaTrend({ data, format, axisFormat, height = 200, summary, name }: { data: { label: string; value: number }[]; format: (n: number) => string; axisFormat?: (n: number) => string; height?: number; summary: string; name: string }) {
  return (
    <figure>
      <figcaption className="sr-only">{summary}</figcaption>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="ink-fade" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={INK} stopOpacity={0.14} />
                <stop offset="100%" stopColor={INK} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={LINE} strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="label" {...axis} minTickGap={24} />
            <YAxis {...axis} axisLine={false} width={52} tickFormatter={axisFormat ?? format} />
            <Tooltip content={(p) => <Tip {...(p as object)} format={format} />} cursor={{ stroke: FOG, strokeDasharray: "3 3" }} />
            <Area type="monotone" dataKey="value" name={name} stroke={INK} strokeWidth={2} fill="url(#ink-fade)" isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

export function ColumnChart({ data, format, axisFormat, height = 220, summary, name, highlight, reference }: { data: { label: string; value: number }[]; format: (n: number) => string; axisFormat?: (n: number) => string; height?: number; summary: string; name: string; highlight?: (i: number) => boolean; reference?: number }) {
  return (
    <figure>
      <figcaption className="sr-only">{summary}</figcaption>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={LINE} strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="label" {...axis} interval={0} />
            <YAxis {...axis} axisLine={false} width={52} tickFormatter={axisFormat ?? format} />
            <Tooltip content={(p) => <Tip {...(p as object)} format={format} />} cursor={{ fill: "#f4f5f7" }} />
            {reference !== undefined && <ReferenceLine y={reference} stroke={FOG} strokeDasharray="4 4" />}
            <Bar dataKey="value" name={name} radius={[5, 5, 0, 0]} maxBarSize={38} isAnimationActive={false}>
              {data.map((_, i) => <Cell key={i} fill={highlight?.(i) ? INK : FOG} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

/** A ranked list with proportional bars. Rows can be clicked to drill in. */
export function BarList({ rows, format, tone = "ink" }: { rows: { key: string; label: string; sub?: string; value: number; onClick?: () => void }[]; format: (n: number) => string; tone?: "ink" | "warn" }) {
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1e-9);
  return (
    <ul className="space-y-1">
      {rows.map((r) => {
        const body = (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-sm text-ink">{r.label}{r.sub && <span className="ml-2 text-xs text-steel">{r.sub}</span>}</span>
              <span className="num shrink-0 text-sm text-ink">{format(r.value)}</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-hair">
              <div className={cn("h-full rounded-full", tone === "warn" ? "bg-warn" : "bg-ink")} style={{ width: `${(Math.abs(r.value) / max) * 100}%` }} />
            </div>
          </>
        );
        return (
          <li key={r.key}>
            {r.onClick ? <button type="button" onClick={r.onClick} className="-mx-2 block w-[calc(100%+1rem)] rounded-xl px-2 py-2 text-left transition-colors duration-200 hover:bg-mist">{body}</button> : <div className="py-2">{body}</div>}
          </li>
        );
      })}
    </ul>
  );
}

export function Spark({ values, width = 84, height = 26, goodWhen = "up" }: { values: number[]; width?: number; height?: number; goodWhen?: "up" | "down" }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * (width - 4) + 2).toFixed(1)},${(height - 3 - ((v - min) / span) * (height - 6)).toFixed(1)}`);
  const rising = values[values.length - 1] >= values[0];
  const good = rising === (goodWhen === "up");
  const [lx, ly] = pts[pts.length - 1].split(",");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Trend ${rising ? "rising" : "falling"}`}>
      <polyline points={pts.join(" ")} fill="none" stroke={INK} strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r={2.4} fill={good ? "#1b7a50" : "#b0352b"} />
    </svg>
  );
}
