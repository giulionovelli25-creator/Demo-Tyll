"use client";
// Charts share one restrained style: ink for the current period, silver for the comparison.
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useState, type CSSProperties, type ReactNode } from "react";
import { Maximize2 } from "lucide-react";
import { OUTLET_TONE } from "./theme";
import { Drawer, OutletDot, cn } from "./ui";

const INK = "var(--color-accent-ink)";
const FOG = "var(--color-fog)";
const LINE = "var(--chart-grid)";
const STEEL = "var(--chart-axis)";

const axis = { stroke: LINE, tick: { fill: STEEL, fontSize: 11 }, tickLine: false as const };
const axis_ = axis;

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
          {typeof p.value === "number" ? format(p.value) : "None"}
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
            {data.some((d) => d.before != null) && <Line type="linear" dataKey="before" name={beforeLabel} stroke={FOG} strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} />}
            <Line type="linear" dataKey="now" name={nowLabel} stroke={INK} strokeWidth={2} dot={data.length <= 14 ? { r: 2.5, fill: INK, strokeWidth: 0 } : false} activeDot={{ r: 4 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex items-center gap-4 text-xs text-steel" aria-hidden>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-accent" />{nowLabel}</span>
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
            <CartesianGrid stroke={LINE} strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="label" {...axis} minTickGap={24} />
            <YAxis {...axis} axisLine={false} width={52} tickFormatter={axisFormat ?? format} />
            <Tooltip content={(p) => <Tip {...(p as object)} format={format} />} cursor={{ stroke: FOG, strokeDasharray: "3 3" }} />
            <Area type="linear" dataKey="value" name={name} stroke={INK} strokeWidth={2} fill={INK} fillOpacity={0.12} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

export function ColumnChart({ data, format, axisFormat, height = 220, summary, name, highlight, reference, tickGap, whole }: { data: { label: string; value: number }[]; format: (n: number) => string; axisFormat?: (n: number) => string; height?: number; summary: string; name: string; highlight?: (i: number) => boolean; reference?: number; /** For many columns, such as one a day: the space kept between axis labels, so they never crowd. Every label shows by default. */ tickGap?: number; /** Counts: whole numbers only on the axis. */ whole?: boolean }) {
  return (
    <figure>
      <figcaption className="sr-only">{summary}</figcaption>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={LINE} strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="label" {...axis} interval={tickGap === undefined ? 0 : "preserveStartEnd"} minTickGap={tickGap} />
            <YAxis {...axis} axisLine={false} width={52} tickFormatter={axisFormat ?? format} allowDecimals={!whole} />
            <Tooltip content={(p) => <Tip {...(p as object)} format={format} />} cursor={{ fill: "var(--color-hair)" }} />
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
export function BarList({ rows, format, tone = "ink" }: { rows: { key: string; label: string; sub?: string; value: number; onClick?: () => void; outletId?: string; /** Drawn in the comparison grey: shown for scale, not part of the finding. */ muted?: boolean }[]; format: (n: number) => string; tone?: "ink" | "warn" }) {
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1e-9);
  return (
    <ul className="space-y-1">
      {rows.map((r) => {
        const body = (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-sm text-ink"><OutletDot id={r.outletId} />{r.label}{r.sub && <span className="ms-2 text-xs text-steel">{r.sub}</span>}</span>
              <span className="num shrink-0 text-sm text-ink">{format(r.value)}</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-hair">
              <div className={cn("h-full rounded-full", r.muted ? "bg-[var(--chart-b)]" : tone === "warn" ? "bg-warn" : "bg-accent", r.outletId && "outlet-bar")} style={{ width: `${(Math.abs(r.value) / max) * 100}%`, ...(r.outletId && OUTLET_TONE[r.outletId] ? ({ "--outlet": `var(--color-outlet-${OUTLET_TONE[r.outletId].mark})` } as CSSProperties) : {}) }} />
            </div>
          </>
        );
        return (
          <li key={r.key}>
            {r.onClick ? <button type="button" onClick={r.onClick} className="-mx-2 block w-[calc(100%+1rem)] rounded-xl px-2 py-2 text-start transition-colors duration-200 hover:bg-mist">{body}</button> : <div className="py-2">{body}</div>}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Bars against one reference line, such as each waiter's drinks per guest against the team average on that shift. Rows can
 * be clicked to drill in. The line is drawn dashed in the comparison grey; a row's tone marks what the rule found.
 */
export function BarsAgainstLine({ rows, line, lineLabel, format, summary }: { rows: { key: string; label: string; sub?: string; value: number | null; tone?: "ink" | "warn" | "muted"; badge?: ReactNode; onClick?: () => void }[]; line: number | null; lineLabel: string; format: (n: number) => string; summary: string }) {
  const max = Math.max(...rows.map((r) => r.value ?? 0), line ?? 0, 1e-9) * 1.12;
  const at = (n: number) => `${Math.min(100, (n / max) * 100)}%`;
  return (
    <figure>
      <figcaption className="sr-only">{summary}</figcaption>
      <ul className="space-y-1">
        {rows.map((r) => {
          const body = (
            <>
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-sm text-ink">{r.label}</span>
                <span className="num shrink-0 text-sm font-medium text-ink">{r.value === null ? "None" : format(r.value)}</span>
              </div>
              <div className="relative mt-1.5 h-2.5 rounded-full bg-hair">
                {r.value !== null && <div className={cn("absolute inset-y-0 start-0 rounded-full", r.tone === "warn" ? "bg-warn" : r.tone === "muted" ? "bg-[var(--chart-b)]" : "bg-accent")} style={{ width: at(r.value) }} />}
                {line !== null && <div className="absolute -inset-y-1 w-0 border-s-2 border-dashed border-[var(--chart-axis)]" style={{ insetInlineStart: at(line) }} aria-hidden />}
              </div>
              {(r.sub || r.badge) && <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">{r.badge}{r.sub && <span className="text-xs text-steel">{r.sub}</span>}</div>}
            </>
          );
          return (
            <li key={r.key}>
              {r.onClick ? <button type="button" onClick={r.onClick} className="-mx-2 block w-[calc(100%+1rem)] rounded-xl px-2 py-2.5 text-start transition-colors duration-200 hover:bg-mist">{body}</button> : <div className="py-2.5">{body}</div>}
            </li>
          );
        })}
      </ul>
      {line !== null && <p className="mt-3 flex items-center gap-2 text-xs text-steel"><span className="inline-block h-3 w-0 border-s-2 border-dashed border-[var(--chart-axis)]" aria-hidden />{lineLabel}</p>}
    </figure>
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
      <circle cx={lx} cy={ly} r={2.4} fill={good ? "var(--color-pos)" : "var(--color-neg)"} />
    </svg>
  );
}

export interface StripPoint { date: string; value: number | null; predicted?: number | null }

/** Another line that can be switched on beside a trend. Series that share an axis key share one chart; others get their own, never a second axis. */
export interface TrendSeries {
  id: string;
  label: string;
  points: { date: string; value: number | null }[];
  format: (n: number) => string;
  /** Series with the same key are drawn on the same chart. */
  axis: string;
  /** One line on what this series is. */
  explain: string;
  on?: boolean;
  /** Which way is good news: losses should fall, revenue should rise. Leaves the verdict out when neither. */
  goodWhen?: "up" | "down" | "none";
}

/** Series colours, checked for colour blindness in this order. Fixed order, never cycled. */
// Few, clearly different lines: the section colour, then warm sand, dark slate and steel. Quiet, never a rainbow.
const SERIES = ["var(--color-accent-ink)", "#3d4250", "#6f8fa6", "#a07e93", "#8a9099"];
/** A second cue beside colour, so crossing lines stay apart: solid, solid, dashed, dotted. */
const DASH = [undefined, undefined, "7 4", "2 4", "7 4"];

const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** Plain words on what one series is doing: its level, its peak, and the last week against the one before. */
/** Round axis steps (1, 2, 2.5 or 5 times a power of ten), so a zoomed axis reads 200, 300, 400 and never 168, 318, 468. */
function niceAxis(lo: number, hi: number) {
  const raw = (hi - lo) / 4 || 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= raw) ?? 10 * p;
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let t = min; t <= max + step / 2; t += step) ticks.push(Math.round(t * 100) / 100);
  return { min, max, ticks };
}

/** A straight line through the points (least squares): its slope per day and its value on each day. */
export function fitLine(points: { value: number | null }[]) {
  const xs: number[] = [];
  const ys: number[] = [];
  points.forEach((p, i) => { if (p.value !== null) { xs.push(i); ys.push(p.value); } });
  if (xs.length < 3) return null;
  const mx = xs.reduce((n, x) => n + x, 0) / xs.length;
  const my = ys.reduce((n, y) => n + y, 0) / ys.length;
  const sxx = xs.reduce((n, x) => n + (x - mx) ** 2, 0);
  const slope = sxx ? xs.reduce((n, x, k) => n + (x - mx) * (ys[k] - my), 0) / sxx : 0;
  const intercept = my - slope * mx;
  return { slope, mean: my, values: points.map((_, i) => Math.round((intercept + slope * i) * 100) / 100) };
}

/** Which way the trend runs, and whether that is good news, in words. Flat when it moves less than 5% across the period. */
export function trendVerdict(points: { value: number | null }[], goodWhen: "up" | "down" | "none" = "none") {
  const fit = fitLine(points);
  if (!fit || fit.mean === 0) return null;
  const across = fit.slope * (points.length - 1);
  const share = across / Math.abs(fit.mean);
  const direction: "up" | "down" | "flat" = Math.abs(share) < 0.05 ? "flat" : across > 0 ? "up" : "down";
  const good = direction === "flat" || goodWhen === "none" ? null : direction === goodWhen;
  return { direction, good, perWeek: fit.slope * 7, share };
}

function describe(s: TrendSeries): string {
  const vals = s.points.filter((p): p is { date: string; value: number } => p.value !== null);
  if (vals.length === 0) return `${s.label}: no figures in this period.`;
  const avg = vals.reduce((n, p) => n + p.value, 0) / vals.length;
  const peak = vals.reduce((m, p) => (p.value > m.value ? p : m), vals[0]);
  const v = trendVerdict(s.points, s.goodWhen);
  const trend = !v ? "" : v.direction === "flat" ? " Over the period the trend is flat." : ` Over the period the trend is ${v.direction === "up" ? "rising" : "falling"}, about ${s.format(Math.abs(v.perWeek))} a week${v.good === null ? "" : v.good ? ", which is better" : ", which is worse"}.`;
  return `${s.label}: ${s.format(avg)} on an average day, highest on ${dayLabel(peak.date)} at ${s.format(peak.value)}.${trend}`;
}

/** The trend made large: switch lines on and off, fit the axis to the data, compare lines apart, add a trend line, and read what it says. */
function TrendExplorer({ open, onClose, title, explain, series, predicted }: { open: boolean; onClose: () => void; title: string; explain?: string; series: TrendSeries[]; predicted?: StripPoint[] }) {
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(series.map((s, i) => [s.id, s.on ?? i === 0])));
  const [dots, setDots] = useState(false);
  const [average, setAverage] = useState(false);
  const [trend, setTrend] = useState(true);
  const [smooth, setSmooth] = useState(false);
  // Fitting the axis to the data zooms in on the changes; from zero shows their size against the whole.
  const [fit, setFit] = useState(true);
  const [apart, setApart] = useState(false);
  const [more, setMore] = useState(false);
  const smoothed = (pts: TrendSeries["points"]) => pts.map((p, i) => {
    const win = pts.slice(Math.max(0, i - 6), i + 1).map((x) => x.value).filter((v): v is number => v !== null);
    const avg = win.reduce((n, v) => n + v, 0) / Math.max(win.length, 1);
    // Small figures, such as drinks per guest, keep two decimals; everything else rounds to whole numbers as before.
    return { date: p.date, value: p.value === null || win.length < 4 ? null : Math.abs(avg) < 10 ? Math.round(avg * 100) / 100 : Math.round(avg) };
  });
  const shown = series.filter((s) => on[s.id]);
  // Together: lines in the same unit share a chart. Apart: every line gets its own chart, so each shape is easy to read.
  const groupKey = (s: TrendSeries) => (apart ? s.id : s.axis);
  const groups = [...new Set(shown.map(groupKey))];
  const place = (s: TrendSeries) => Math.min(series.filter((x) => x.axis === s.axis).indexOf(s), SERIES.length - 1);
  const colour = (s: TrendSeries) => SERIES[place(s)];
  const dash = (s: TrendSeries) => DASH[place(s)];
  const dates = series[0]?.points.map((p) => p.date) ?? [];
  const toggle = "inline-flex h-9 items-center gap-2 rounded-full border px-3 text-[13px] transition-colors duration-150 ease-tyll";
  const opt = (on: boolean) => cn(toggle, on ? "border-ink/20 bg-cloud text-ink" : "border-line text-steel hover:text-ink");
  return (
    <Drawer open={open} onClose={onClose} title={title} description={explain} wide>
      <div className="space-y-5">
        <div>
          <p className="mb-2 text-[13px] font-medium text-ink">Lines</p>
          <div className="flex flex-wrap gap-2">
            {series.map((s) => (
              <button key={s.id} type="button" aria-pressed={!!on[s.id]} onClick={() => setOn((m) => ({ ...m, [s.id]: !m[s.id] }))} className={opt(!!on[s.id])} title={s.explain}>
                <svg width="18" height="8" viewBox="0 0 18 8" aria-hidden className="shrink-0"><line x1="1" y1="4" x2="17" y2="4" stroke={colour(s)} strokeWidth={on[s.id] ? 3 : 1.5} strokeDasharray={dash(s)} strokeLinecap="round" opacity={on[s.id] ? 1 : 0.5} /></svg>
                {s.label}
              </button>
            ))}
          </div>
          <p className="mb-2 mt-4 text-[13px] font-medium text-ink">View</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={trend} onClick={() => setTrend((v) => !v)} className={opt(trend)}>Trend line</button>
            <button type="button" aria-pressed={smooth} onClick={() => setSmooth((v) => !v)} className={opt(smooth)}>Smooth to 7 day average</button>
            <button type="button" aria-expanded={more} onClick={() => setMore((v) => !v)} className="inline-flex h-9 items-center gap-1 px-2 text-[13px] font-medium text-accent-ink">{more ? "Fewer options" : "More options"}</button>
            {more && <>
              <button type="button" aria-pressed={fit} onClick={() => setFit((v) => !v)} className={opt(fit)}>Zoom to the data</button>
              <button type="button" aria-pressed={apart} onClick={() => setApart((v) => !v)} className={opt(apart)}>Each line on its own chart</button>
              <button type="button" aria-pressed={average} onClick={() => setAverage((v) => !v)} className={opt(average)}>Average line</button>
              <button type="button" aria-pressed={dots} onClick={() => setDots((v) => !v)} className={opt(dots)}>Points on each day</button>
            </>}
          </div>
        </div>

        {shown.length === 0 ? <p className="rounded-[var(--radius-control)] bg-cloud p-4 text-sm text-steel">Switch on at least one line above.</p> : groups.map((key) => {
          const group = shown.filter((s) => groupKey(s) === key);
          const bars = group.every((s) => s.axis === "count");
          const pointsOf = (s: TrendSeries) => (smooth && !bars ? smoothed(s.points) : s.points);
          const fits = Object.fromEntries(group.map((s) => [s.id, fitLine(pointsOf(s))]));
          const withPrediction = predicted && group[0] === series[0];
          const data = dates.map((date, i) => ({
            date, label: dayLabel(date),
            ...Object.fromEntries(group.flatMap((s) => [[s.id, pointsOf(s)[i]?.value ?? null], [`${s.id}__trend`, fits[s.id]?.values[i] ?? null]])),
            ...(withPrediction ? { predicted: predicted!.find((p) => p.date === date)?.predicted ?? null } : {}),
          }));
          const extra = withPrediction ? predicted!.filter((p) => !dates.includes(p.date)).map((p) => ({ date: p.date, label: dayLabel(p.date), predicted: p.predicted ?? null })) : [];
          const fmt = group[0].format;
          // Zoomed: the axis runs from just below the lowest value to just above the highest, so day to day changes are easy to see. Bars always start at zero.
          const values = [...data, ...extra].flatMap((d) => group.map((s) => (d as Record<string, unknown>)[s.id]).concat(withPrediction ? [(d as Record<string, unknown>).predicted] : [])).filter((v): v is number => typeof v === "number");
          const lo = Math.min(...values);
          const hi = Math.max(...values);
          const pad = (hi - lo) * 0.12 || Math.abs(hi) * 0.1 || 1;
          const nice = fit && !bars && values.length ? niceAxis(Math.max(0, lo - pad), hi + pad) : null;
          const domain: [number, number] | [number, string] = nice ? [nice.min, nice.max] : [0, "auto"];
          return (
            <figure key={key} className="rounded-[var(--radius-control)] border border-line p-3">
              <figcaption className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-[13px] text-steel">
                <span>{group.map((s) => s.label).join(", ")}</span>
                {trend && group.map((s) => {
                  const v = trendVerdict(pointsOf(s), s.goodWhen);
                  return v ? <span key={s.id} className={cn("text-xs", v.good === null ? "text-graphite" : v.good ? "text-pos" : "text-warn")}>{group.length > 1 ? `${s.label}: ` : ""}{v.direction === "flat" ? "Flat" : v.direction === "up" ? "Trending up" : "Trending down"}{v.good === null ? "" : v.good ? ", better" : ", worse"}</span> : null;
                })}
              </figcaption>
              <div className={groups.length > 1 ? "h-[260px]" : "h-[380px]"}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={[...data, ...extra]} margin={{ top: 16, right: 20, bottom: 4, left: 4 }} barGap={2} barCategoryGap="24%">
                    <CartesianGrid stroke={LINE} strokeDasharray="2 4" vertical={false} />
                    <XAxis dataKey="label" {...axis_} minTickGap={48} tickMargin={8} />
                    <YAxis {...axis_} axisLine={false} width={72} domain={domain} allowDataOverflow={false} ticks={nice?.ticks} tickCount={5} tickFormatter={(n: number) => (Math.abs(n) >= 10000 ? fmt(n).replace(/[\d,.]+/, `${Math.round(n / 1000)}k`) : fmt(Math.abs(n) < 10 ? n : Math.round(n)))} />
                    <Tooltip content={(p) => <Tip {...(p as object)} format={fmt} />} cursor={{ stroke: FOG, strokeDasharray: "3 3" }} />
                    {/* Counts are whole things, so they are bars; amounts are lines. */}
                    {group.map((s) => s.axis === "count"
                      ? <Bar key={s.id} dataKey={s.id} name={s.label} fill={colour(s)} fillOpacity={trend ? 0.75 : 1} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                      : <Line key={s.id} type="linear" dataKey={s.id} name={s.label} stroke={colour(s)} strokeWidth={place(s) === 0 ? 3 : 2.25} strokeDasharray={dash(s)} strokeOpacity={trend ? 0.85 : 1} dot={dots ? { r: 3.5, fill: colour(s), strokeWidth: 0 } : false} activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--color-paper)" }} isAnimationActive={false} connectNulls={false} />)}
                    {/* The trend line: a straight line through each series, the clearest answer to "is it getting better?" */}
                    {trend && group.map((s) => <Line key={`${s.id}-trend`} type="linear" dataKey={`${s.id}__trend`} name={`${s.label}, trend`} stroke={colour(s)} strokeWidth={2} strokeDasharray="1 5" strokeLinecap="round" dot={false} activeDot={false} isAnimationActive={false} legendType="none" />)}
                    {withPrediction && <Line type="linear" dataKey="predicted" name="Predicted" stroke={colour(series[0])} strokeWidth={2} strokeDasharray="4 4" dot={false} isAnimationActive={false} />}
                    {average && group.map((s) => {
                      const vals = pointsOf(s).map((p) => p.value).filter((v): v is number => v !== null);
                      return vals.length ? <ReferenceLine key={`avg-${s.id}`} y={vals.reduce((n, v) => n + v, 0) / vals.length} stroke={colour(s)} strokeDasharray="2 3" strokeOpacity={0.7} /> : null;
                    })}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              {nice && nice.min > 0 && <p className="mt-1 text-xs text-steel">The axis starts at {fmt(nice.min)}, not zero, so changes are easier to see.</p>}
            </figure>
          );
        })}

        {shown.length > 0 && (
          <div className="rounded-[var(--radius-control)] bg-cloud p-4 text-[13px] text-graphite">
            <p className="mb-2 font-medium text-ink">What this tells you</p>
            <ul className="space-y-1.5">{shown.map((s) => <li key={s.id}><span className="me-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: colour(s) }} aria-hidden />{describe(s)} <span className="text-steel">{s.explain}</span></li>)}</ul>
            <p className="mt-2 text-xs text-steel">The trend line is a straight line fitted through every day shown. Rising or falling by less than 5% across the period counts as flat.</p>
          </div>
        )}
      </div>
    </Drawer>
  );
}

/** The trend at the top of a page: one line in the section colour, with the period and unit said in words. Predicted days are dashed. Open makes it large, with more lines to switch on. */
export function StripTrend({ title, points, format, summary, note, series = [], explain, goodWhen = "none", height = 76, footer }: { title: string; points: StripPoint[]; format: (n: number) => string; summary: string; note?: string; series?: TrendSeries[]; explain?: string; goodWhen?: "up" | "down" | "none"; height?: number; /** For a running total, where a daily average means nothing: what the line ends on, in words. */ footer?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const main: TrendSeries = { id: "main", label: title.replace(/, last \d+ days$/, ""), points: points.map((p) => ({ date: p.date, value: p.value })), format, axis: "main", explain: explain ?? summary, on: true, goodWhen };
  const verdict = trendVerdict(main.points, goodWhen);
  const label = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const data = points.map((p) => ({ ...p, label: label(p.date) }));
  const hasPrediction = points.some((p) => p.predicted != null);
  const actual = points.map((p) => p.value).filter((v): v is number => v !== null);
  const average = actual.length ? Math.round(actual.reduce((n, v) => n + v, 0) / actual.length) : null;
  const first = data[0]?.label;
  const last = data[data.length - 1]?.label;
  return (
    <figure className="min-w-0">
      <figcaption className="flex items-center justify-between gap-2 text-[13px] text-steel">
        <span className="min-w-0 truncate">{title}</span>
        {hasPrediction && <span className="flex shrink-0 items-center gap-1 text-xs" aria-hidden><span className="w-3 border-t-2 border-dashed border-accent-ink" />Predicted</span>}
        <button type="button" onClick={() => setOpen(true)} className="-me-1 inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-soft" aria-label={`Open ${title} larger, with more lines to compare`}><Maximize2 size={13} aria-hidden />Open</button>
      </figcaption>
      <p className="sr-only">{summary}</p>
      <div className="mt-1" style={{ height }} aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 4 }}>
            <XAxis dataKey="label" hide />
            <YAxis hide domain={[0, "auto"]} />
            <Tooltip content={(p) => <Tip {...(p as object)} format={format} />} cursor={{ stroke: FOG, strokeDasharray: "3 3" }} />
            <Line type="linear" dataKey="value" name="Actual" stroke="var(--color-accent-ink)" strokeWidth={2} dot={false} activeDot={{ r: 3.5 }} isAnimationActive={false} connectNulls={false} />
            {hasPrediction && <Line type="linear" dataKey="predicted" name="Predicted" stroke="var(--color-accent-ink)" strokeWidth={2} strokeDasharray="4 4" dot={false} activeDot={{ r: 3.5 }} isAnimationActive={false} />}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {/* The small line has no scale, so the footer says what it means in words: a typical day. */}
      <div className="mt-0.5 flex justify-between whitespace-nowrap text-xs text-steel" aria-hidden><span>{first}</span><span>{last}</span></div>
      <p className="mt-1 text-xs text-steel">{footer !== undefined ? footer : average !== null ? <>Average <span className="num font-medium text-graphite">{format(average)}</span> a day{verdict && <>, <span className={verdict.good === null ? "text-graphite" : verdict.good ? "text-pos" : "text-warn"}>{verdict.direction === "flat" ? "flat" : verdict.direction === "up" ? "trending up" : "trending down"}</span></>}</> : note}</p>
      {open && <TrendExplorer open={open} onClose={() => setOpen(false)} title={title} explain={explain ?? summary} series={[main, ...series]} predicted={hasPrediction ? points : undefined} />}
    </figure>
  );
}
