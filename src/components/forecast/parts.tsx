"use client";
import { useId, type ReactNode } from "react";
import { Badge, cn } from "@/components/ui";
import { outletById, propertyById } from "@/lib/data/catalog";
import { allowedOutlets, allowedProperties } from "@/lib/domain/access";
import type { Assumptions, Baseline, PeriodKind, Risk, Source } from "@/lib/domain/planning";
import type { User } from "@/lib/types";
import { DEMO_TODAY, addDays, fmtDate } from "@/lib/util";

/** A row of large, clearly labelled buttons. One is chosen at a time. */
export function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: ReactNode; sub?: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <fieldset>
      <legend className="mb-2 text-[13px] font-medium text-graphite">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}
            className={cn("min-h-11 rounded-full border px-5 py-2 text-left text-sm transition-colors duration-200", value === o.value ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink hover:border-fog")}>
            {o.label}
            {o.sub && <span className={cn("block text-xs", value === o.value ? "text-paper/70" : "text-steel")}>{o.sub}</span>}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** Numbered steps across the top of a workflow. Earlier steps can be revisited. */
export function Steps({ steps, current, onGo }: { steps: string[]; current: number; onGo: (n: number) => void }) {
  return (
    <ol className="flex flex-wrap items-center gap-2 text-sm" aria-label="Steps">
      {steps.map((s, i) => {
        const n = i + 1;
        const done = n < current;
        return (
          <li key={s} className="flex items-center gap-2">
            {i > 0 && <span className="h-px w-5 bg-line" aria-hidden />}
            <button type="button" disabled={n > current} onClick={() => onGo(n)} aria-current={n === current ? "step" : undefined}
              className={cn("flex items-center gap-2 rounded-full px-3 py-1.5", n === current ? "bg-ink text-paper" : done ? "text-ink hover:bg-cloud" : "text-fog")}>
              <span className={cn("num flex h-5 w-5 items-center justify-center rounded-full text-xs", n === current ? "bg-paper text-ink" : done ? "bg-mist" : "border border-line")}>{n}</span>
              {s}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export const SOURCE_LABEL: Record<Source, string> = { records: "From booking records", tyll: "Estimated by Tyll", manual: "Entered by you" };

export function SourceBadge({ source }: { source: Source }) {
  return <Badge tone={source === "manual" ? "ink" : "neutral"} className="!py-0">{SOURCE_LABEL[source]}</Badge>;
}

export const RISK: Record<Risk, { label: string; tone: "neg" | "warn" | "neutral" | "pos" }> = {
  high: { label: "Runs short before a delivery", tone: "neg" },
  medium: { label: "Runs short in this period", tone: "warn" },
  low: { label: "Safety stock only", tone: "neutral" },
  none: { label: "Covered", tone: "pos" },
};

/** A number input with its unit beside it, where it came from, and a way back to Tyll's figure. */
export function AssumptionField({ label, unit, value, source, original, onChange, onReset, step = 1, max, hint }: {
  label: string; unit: string; value: number; source: Source; original: number; onChange: (n: number) => void; onReset: () => void; step?: number; max?: number; hint?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="rounded-2xl border border-line bg-paper p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm text-ink">{label}</label>
        <SourceBadge source={source} />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <input id={id} type="number" inputMode="decimal" min={0} max={max} step={step} value={Number.isFinite(value) ? value : ""} onChange={(e) => onChange(Number(e.target.value))}
          className="num h-11 w-32 rounded-xl border border-line px-3 text-right text-base hover:border-fog" />
        <span className="text-sm text-steel">{unit}</span>
        {source === "manual" && <button type="button" onClick={onReset} className="ml-auto text-[13px] text-steel underline underline-offset-4 hover:text-ink">Use Tyll&rsquo;s figure ({original}{unit === "%" ? "%" : ""})</button>}
      </div>
      {hint && <p className="mt-2 text-xs text-steel">{hint}</p>}
    </div>
  );
}

export const PERIOD_OPTIONS: { value: PeriodKind; label: string; sub: string }[] = [
  { value: "tomorrow", label: "Tomorrow", sub: fmtDate(addDays(DEMO_TODAY, 1), true) },
  { value: "3", label: "Next 3 days", sub: `${fmtDate(addDays(DEMO_TODAY, 1))} to ${fmtDate(addDays(DEMO_TODAY, 3))}` },
  { value: "7", label: "Next 7 days", sub: `${fmtDate(addDays(DEMO_TODAY, 1))} to ${fmtDate(addDays(DEMO_TODAY, 7))}` },
  { value: "custom", label: "Custom", sub: "choose dates" },
];

export const propertyOptions = (user: User) => allowedProperties(user).map((p) => ({ value: p, label: propertyById[p].name }));
export const outletOptions = (user: User, propertyId: string) => allowedOutlets(user).filter((o) => outletById[o].propertyId === propertyId);

/** The assumption inputs for a forecast, shared by What to buy and What to prep. */
export function DemandInputs({ baseline, values, sources, onChange }: { baseline: Baseline; values: Assumptions; sources: Record<keyof Assumptions, Source>; onChange: (patch: Partial<Assumptions>) => void }) {
  const reset = (k: keyof Assumptions) => onChange({ [k]: undefined } as Partial<Assumptions>);
  const event = baseline.events[0];
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {baseline.reservable && (
        <AssumptionField label="Restaurant reservations" unit="guests" value={values.reservations} source={sources.reservations} original={baseline.values.reservations}
          onChange={(n) => onChange({ reservations: n })} onReset={() => reset("reservations")} hint="Covers booked so far for the period." />
      )}
      <AssumptionField label="Walk-in guests" unit="guests" value={values.walkIns} source={sources.walkIns} original={baseline.values.walkIns}
        onChange={(n) => onChange({ walkIns: n })} onReset={() => reset("walkIns")}
        hint={`Guests without a booking. The same weekdays brought ${baseline.historyGuests} guests in total over the last four weeks, on average.`} />
      <AssumptionField label="Hotel occupancy" unit="%" value={Math.round(values.occupancy * 100)} source={sources.occupancy} original={Math.round(baseline.values.occupancy * 100)} max={100}
        onChange={(n) => onChange({ occupancy: Math.max(0, Math.min(100, n)) / 100 })} onReset={() => reset("occupancy")} hint="Moves walk-ins only. Booked guests are not counted again." />
      <AssumptionField label="Confirmed event guests" unit="guests" value={values.eventGuests} source={sources.eventGuests} original={baseline.values.eventGuests}
        onChange={(n) => onChange({ eventGuests: n })} onReset={() => reset("eventGuests")}
        hint={event ? `${event.name}, ${fmtDate(event.date, true)}. About 3 in 10 attendees also visit the outlets; the event itself is catered separately.` : "No event is booked in this period."} />
    </div>
  );
}
