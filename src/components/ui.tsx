"use client";
// Shared interface primitives. One set of controls for every module.
import clsx from "clsx";
import { ArrowDownRight, ArrowUpRight, ChevronDown, ChevronUp, ChevronsUpDown, Minus, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { usePathname } from "next/navigation";
import { create } from "zustand";
import { MODULE_ICON, OUTLET_TONE } from "@/components/theme";
import { moduleOfPath } from "@/lib/domain/access";

export const cn = clsx;

// ---- Buttons ----------------------------------------------------------------
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { ref?: React.Ref<HTMLButtonElement>; variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" | "lg" };

export function Button({ variant = "secondary", size = "md", className, type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium tracking-[-0.01em] transition-[background,color,border-color,transform] duration-200 ease-tyll active:scale-[0.98] disabled:pointer-events-none disabled:opacity-60",
        size === "sm" && "h-8 px-3 text-[13px]",
        size === "md" && "h-10 px-4 text-sm",
        size === "lg" && "h-12 px-6 text-[15px]",
        variant === "primary" && "bg-accent text-on-accent hover:bg-accent-hover",
        variant === "secondary" && "border border-line bg-paper text-ink hover:border-fog hover:bg-cloud",
        variant === "ghost" && "text-graphite hover:bg-mist",
        variant === "danger" && "border border-neg/30 bg-paper text-neg hover:bg-neg-soft",
        className,
      )}
      {...props}
    />
  );
}

// ---- Status -----------------------------------------------------------------
export type Tone = "neutral" | "pos" | "warn" | "neg" | "ink" | "accent";

const TONE: Record<Tone, string> = {
  neutral: "bg-mist text-graphite",
  pos: "bg-pos-soft text-pos",
  warn: "bg-warn-soft text-warn",
  neg: "bg-neg-soft text-neg",
  ink: "bg-accent text-on-accent",
  accent: "bg-accent-soft text-accent-ink",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  // Status badges carry a small dot so the colour is never the only signal.
  const dot = tone === "pos" || tone === "warn" || tone === "neg";
  return <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium", TONE[tone], className)}>{dot && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden />}{children}</span>;
}

/** Marks figures that are estimates or come from simulated records. */
export function Note({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-xs leading-relaxed text-steel", className)}>{children}</p>;
}

/**
 * Change against the previous period. `goodWhen` decides the color: a falling cost is good,
 * a falling margin is not. Pass a ratio for `kind="pct"` or percentage points for `kind="pts"`.
 */
export function Delta({ value, kind = "pct", goodWhen = "up", className, versus = "than the previous period" }: { value: number | null; kind?: "pct" | "pts"; goodWhen?: "up" | "down" | "none"; className?: string; versus?: string }) {
  if (value === null || !Number.isFinite(value)) return <span className={cn("text-xs text-fog", className)}>no earlier data</span>;
  const shown = kind === "pct" ? value * 100 : value;
  const flat = Math.abs(shown) < 0.05;
  const good = goodWhen === "none" || flat ? null : (shown > 0) === (goodWhen === "up");
  const Icon = flat ? Minus : shown > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("num inline-flex items-center gap-0.5 text-xs font-medium", good === null ? "text-steel" : good ? "text-pos" : "text-neg", className)}>
      <Icon size={13} aria-hidden />
      {Math.abs(shown).toFixed(1)}
      {kind === "pct" ? "%" : " pts"}
      <span className="sr-only">{flat ? " unchanged" : `${shown > 0 ? " higher" : " lower"} ${versus}`}</span>
    </span>
  );
}

// ---- Layout -----------------------------------------------------------------
export function Panel({ title, description, action, children, className, flush }: { title?: ReactNode; description?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={cn("min-w-0 rounded-panel border border-line bg-paper shadow-panel transition-shadow duration-200 ease-tyll", className)}>
      {(title || action) && (
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-5 sm:px-6">
          <div className="min-w-0">
            {title && <h2 className="text-[17px] font-semibold leading-snug text-ink">{title}</h2>}
            {description && <p className="mt-1 max-w-[70ch] text-[13px] text-steel">{description}</p>}
          </div>
          {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
        </header>
      )}
      <div className={cn(flush ? "pt-4" : "p-5 sm:p-6", (title || action) && !flush && "pt-4 sm:pt-4")}>{children}</div>
    </section>
  );
}

/**
 * Every page starts the same way: title, the one question the page answers, a one line summary, the primary action top right.
 * Key numbers and detail follow.
 */
export function PageHeader({ title, question, lead, children, crumbs }: { title: ReactNode; question?: ReactNode; lead?: ReactNode; children?: ReactNode; crumbs?: ReactNode }) {
  const Icon = MODULE_ICON[moduleOfPath(usePathname() ?? "/")];
  return (
    <header data-tour="page" className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 pb-1">
      <div className="min-w-0 max-w-[72ch] flex-1 basis-[280px]">
        {crumbs && <div className="mb-2">{crumbs}</div>}
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-accent-soft text-accent-ink"><Icon size={18} aria-hidden /></span>
          <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.025em] text-ink">{title}</h1>
        </div>
        {question && <p className="mt-2 text-[15px] font-medium text-accent-ink">{question}</p>}
        {lead && <p className="mt-0.5 text-[13px] leading-relaxed text-steel">{lead}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2 sm:pt-1">{children}</div>}
    </header>
  );
}

/** An outlet's colour, beside its name. Only shows in the By outlet look. */
export function OutletDot({ id, className }: { id?: string; className?: string }) {
  if (!id || !OUTLET_TONE[id]) return null;
  return <span aria-hidden className={cn("outlet-dot me-1.5 h-2.5 w-2.5 shrink-0 rounded-full align-[0.05em]", className)} style={{ background: `var(--color-outlet-${OUTLET_TONE[id].mark})` }} />;
}

/** The key numbers under a page header. Always a row of the same quiet cards. */
export function KeyNumbers({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4", className)}>{children}</div>;
}

export function KeyNumber({ label, value, tone, note, delta }: { label: string; value: ReactNode; tone?: "pos" | "warn" | "neg" | "money"; note?: ReactNode; delta?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-panel border border-line bg-paper p-4 shadow-panel">
      <p className="text-[13px] text-steel">{label}</p>
      <p className={cn("num mt-1 text-[22px] font-medium leading-tight tracking-[-0.02em]", tone === "pos" ? "text-pos" : tone === "warn" ? "text-warn" : tone === "neg" ? "text-neg" : tone === "money" ? "text-money" : "text-ink")}>{value}</p>
      {(note || delta) && <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-steel">{delta}{note}</p>}
    </div>
  );
}

/** The top of a main page: a short row of numbers, then the one thing to do. */
export function SummaryBar({ items, action }: { items: { label: string; value: ReactNode; tone?: "pos" | "warn" | "neg" | "money"; note?: ReactNode }[]; action?: ReactNode }) {
  const tones = { pos: "text-pos", warn: "text-warn", neg: "text-neg", money: "text-money" };
  return (
    <div className="flex flex-col gap-4 rounded-panel border border-line bg-paper p-4 shadow-panel sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <dl className={cn("grid min-w-0 flex-1 gap-3 sm:gap-6", items.length >= 3 ? "grid-cols-3" : items.length === 2 ? "grid-cols-2" : "grid-cols-1")}>
        {items.map((i) => (
          <div key={i.label} className="min-w-0">
            <dt className="text-[13px] text-steel">{i.label}</dt>
            <dd className={cn("num mt-0.5 whitespace-nowrap text-[17px] font-medium leading-tight tracking-[-0.02em] sm:text-[26px]", i.tone ? tones[i.tone] : "text-ink")}>{i.value}</dd>
            {i.note && <dd className="mt-0.5 text-xs text-steel">{i.note}</dd>}
          </div>
        ))}
      </dl>
      {action && <div className="flex shrink-0 flex-col sm:items-end [&>*]:w-full sm:[&>*]:w-auto">{action}</div>}
    </div>
  );
}

/** Secondary actions are text links, so each screen keeps one primary button. */
export const textLink = "-my-2.5 inline-flex items-center gap-1 py-2.5 text-[13px] font-medium text-accent-ink underline-offset-4 hover:underline";

/** A link styled as a button, so a page's primary action looks the same everywhere. */
export const linkButton = (variant: "primary" | "secondary" | "quiet" = "secondary") => cn(
  "inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-full px-4 text-sm font-medium transition-colors duration-200 ease-tyll",
  variant === "primary" ? "bg-accent text-on-accent hover:bg-accent-hover" : variant === "quiet" ? "bg-accent-soft text-accent-ink hover:bg-line" : "border border-line bg-paper text-ink hover:bg-cloud",
);

/** A friendly empty state: a small illustration in the module's colour, what this space is for, and what to do. */
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  const Icon = MODULE_ICON[moduleOfPath(usePathname() ?? "/")];
  return (
    <div className="flex flex-col items-center justify-center overflow-hidden rounded-panel border border-dashed border-line bg-paper px-6 py-12 text-center">
      <span className="relative mb-4 flex h-16 w-16 items-center justify-center" aria-hidden>
        <span className="absolute inset-0 rounded-full bg-accent-soft" />
        <span className="absolute inset-2 rounded-full bg-paper shadow-panel" />
        <span className="relative text-accent-ink"><Icon size={24} aria-hidden /></span>
      </span>
      <p className="text-base font-medium text-ink">{title}</p>
      {children && <p className="mt-1 max-w-[52ch] text-[13px] text-steel">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ---- Widget states and status ---------------------------------------------------
/** A loading placeholder, the same size as what replaces it. */
export function Skeleton({ className }: { className?: string }) {
  return <span className={cn("skeleton block", className)} aria-hidden />;
}

/** Says a widget's data did not load and offers the way back. Never a blank space. */
export function WidgetError({ children, onRetry }: { children?: ReactNode; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-[var(--radius-control)] bg-neg-soft px-4 py-3 text-sm text-neg">
      {children ?? "This could not load."} {onRetry ? <button type="button" onClick={onRetry} className="font-medium underline underline-offset-2">Try again</button> : "Reload the page to try again."}
    </div>
  );
}

export type Rag = "red" | "amber" | "green";
const RAG: Record<Rag, { tone: Tone; label: string }> = { red: { tone: "neg", label: "Act today" }, amber: { tone: "warn", label: "Watch" }, green: { tone: "pos", label: "On track" } };

/** Red means act today. The words go with the colour, so colour is never the only signal. */
export function StatusPill({ rag, children, className }: { rag: Rag; children?: ReactNode; className?: string }) {
  return <Badge tone={RAG[rag].tone} className={className}>{children ?? RAG[rag].label}</Badge>;
}

// ---- Form controls ----------------------------------------------------------
export function Select({ label, className, children, hideLabel, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; hideLabel?: boolean }) {
  const id = useId();
  return (
    <div className={cn("relative min-w-0", className)}>
      <label htmlFor={id} className={hideLabel ? "sr-only" : "mb-1.5 block text-[13px] font-medium text-graphite"}>{label}</label>
      <div className="relative">
        <select id={id} className="h-10 w-full appearance-none truncate rounded-full border border-line bg-paper ps-4 pe-9 text-sm text-ink transition-colors duration-200 ease-tyll hover:border-fog" {...props}>
          {children}
        </select>
        <ChevronDown size={15} className="pointer-events-none absolute end-3.5 top-1/2 -translate-y-1/2 text-steel" aria-hidden />
      </div>
    </div>
  );
}

export function Field({ label, hint, error, className, suffix, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string; suffix?: string }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-graphite">{label}</label>
      <div className="relative">
        <input
          id={id}
          aria-invalid={!!error}
          aria-describedby={error || hint ? `${id}-help` : undefined}
          className={cn("num h-10 w-full rounded-xl border bg-paper px-3 text-sm text-ink transition-colors duration-200 ease-tyll placeholder:text-fog", error ? "border-neg" : "border-line hover:border-fog", suffix && "pe-12")}
          {...props}
        />
        {suffix && <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-xs text-steel">{suffix}</span>}
      </div>
      {(error || hint) && <p id={`${id}-help`} className={cn("mt-1 text-xs", error ? "text-neg" : "text-steel")}>{error ?? hint}</p>}
    </div>
  );
}

export function TextArea({ label, error, className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; error?: string }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-graphite">{label}</label>
      <textarea id={id} aria-invalid={!!error} className={cn("min-h-20 w-full rounded-xl border bg-paper px-3 py-2 text-sm text-ink placeholder:text-fog", error ? "border-neg" : "border-line hover:border-fog")} {...props} />
      {error && <p className="mt-1 text-xs text-neg">{error}</p>}
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label, size = "md" }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; label: string; size?: "sm" | "md" }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full border border-line bg-paper p-0.5 [scrollbar-width:none]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn("whitespace-nowrap rounded-full font-medium transition-colors duration-200 ease-tyll", size === "sm" ? "h-9 px-2 text-xs sm:h-7 sm:px-3" : "h-10 px-4 text-[13px]", value === o.value ? "bg-accent text-on-accent" : "text-steel hover:text-ink")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: string; count?: number }[] }) {
  return (
    <div role="tablist" className="flex gap-6 overflow-x-auto overflow-y-hidden border-b border-line [scrollbar-width:none]">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          type="button"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cn("-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 pb-3.5 pt-2 text-sm transition-colors duration-200 ease-tyll", value === t.value ? "border-accent text-accent-ink" : "border-transparent text-steel hover:text-ink")}
        >
          {t.label}
          {t.count !== undefined && <span className="num rounded-full bg-mist px-1.5 text-xs text-graphite">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ---- Tables -----------------------------------------------------------------
export interface SortState<K extends string> {
  key: K;
  dir: "asc" | "desc";
}

export function useSort<K extends string>(initial: SortState<K>) {
  const [sort, setSort] = useState(initial);
  // Names and other "smallest first" columns can ask to start ascending.
  const toggle = (key: K, firstDir: "asc" | "desc" = "desc") => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: firstDir }));
  return { sort, toggle };
}

export function Th<K extends string>({ children, sortKey, sort, onSort, align = "left", className }: { children: ReactNode; sortKey?: K; sort?: SortState<K>; onSort?: (k: K) => void; align?: "left" | "right"; className?: string }) {
  const active = sortKey && sort?.key === sortKey;
  const Icon = !active ? ChevronsUpDown : sort!.dir === "asc" ? ChevronUp : ChevronDown;
  return (
    <th scope="col" aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined} className={cn("whitespace-nowrap px-3 py-2.5 text-xs font-semibold text-graphite first:ps-5 last:pe-5 sm:first:ps-6 sm:last:pe-6", align === "right" ? "text-end" : "text-start", className)}>
      {sortKey && onSort ? (
        <button type="button" onClick={() => onSort(sortKey)} className={cn("inline-flex items-center gap-1 hover:text-ink", active && "text-ink", align === "right" && "flex-row-reverse")}>
          {children}
          <Icon size={12} aria-hidden />
        </button>
      ) : (
        children
      )}
    </th>
  );
}

export function Td({ children, align = "left", className }: { children: ReactNode; align?: "left" | "right"; className?: string }) {
  return <td className={cn("px-3 py-3 align-middle first:ps-5 last:pe-5 sm:first:ps-6 sm:last:pe-6", align === "right" && "num whitespace-nowrap text-end", className)}>{children}</td>;
}

export function TableWrap({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("scroll-thin scroll-hint relative overflow-x-auto", className)}>{children}</div>;
}

export const rowClass = "border-t border-hair transition-colors duration-200 hover:bg-cloud";

// ---- Drawer -----------------------------------------------------------------
export function Drawer({ open, onClose, title, description, children, wide }: { open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      previous?.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="no-print fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Close panel" className="animate-fade absolute inset-0 bg-scrim backdrop-blur-[2px]" onClick={onClose} />
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined} className={cn("animate-slide-in relative flex h-full w-full flex-col bg-paper shadow-float outline-none", wide ? "max-w-3xl" : "max-w-xl")}>
        <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
          <div className="min-w-0">
            <h2 className="text-xl leading-snug">{title}</h2>
            {description && <p className="mt-1 text-[13px] text-steel">{description}</p>}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close" className="!px-2"><X size={18} /></Button>
        </header>
        <div className="scroll-thin flex-1 overflow-y-auto overscroll-contain px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

// ---- Toasts -----------------------------------------------------------------
interface Toast {
  id: number;
  text: string;
  tone: "pos" | "neg";
  action?: { label: string; run: () => void };
}

const useToasts = create<{ toasts: Toast[]; push: (text: string, tone: Toast["tone"], action?: Toast["action"]) => void; drop: (id: number) => void }>((set) => ({
  toasts: [],
  push: (text, tone, action) => {
    const id = Date.now() + Math.random();
    set((s) => ({ toasts: [...s.toasts, { id, text, tone, action }] }));
    // Longer when there is something to undo.
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), action ? 7000 : 4500);
  },
  drop: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  done: (text: string, action?: { label: string; run: () => void }) => useToasts.getState().push(text, "pos", action),
  error: (text: string) => useToasts.getState().push(text, "neg"),
};

/** Reports the result of a store action. Returns true when it succeeded. */
export function report(result: { ok: true } | { ok: false; error: string }, success: string): boolean {
  if (result.ok) toast.done(success);
  else toast.error(result.error);
  return result.ok;
}

export function Toaster() {
  const { toasts, drop } = useToasts();
  return (
    <div className="no-print pointer-events-none fixed bottom-20 start-1/2 z-[70] md:bottom-5 flex w-[min(92vw,26rem)] -translate-x-1/2 flex-col gap-2" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={cn("animate-rise pointer-events-auto flex items-start justify-between gap-3 rounded-2xl border bg-paper px-4 py-3 text-sm shadow-float", t.tone === "pos" ? "border-pos/25" : "border-neg/30")}>
          <span className="flex items-start gap-2.5">
            <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", t.tone === "pos" ? "bg-pos" : "bg-neg")} aria-hidden />
            {t.text}
          </span>
          {t.action && <button type="button" onClick={() => { t.action!.run(); drop(t.id); }} className="shrink-0 font-medium text-accent-ink underline underline-offset-2">{t.action.label}</button>}
          <button type="button" onClick={() => drop(t.id)} aria-label="Dismiss" className="text-steel hover:text-ink"><X size={15} /></button>
        </div>
      ))}
    </div>
  );
}

// ---- Small pieces -----------------------------------------------------------
export function Stat({ label, value, delta, sub, onClick, tone }: { label: string; value: ReactNode; delta?: ReactNode; sub?: ReactNode; onClick?: () => void; tone?: "pos" | "warn" | "neg" }) {
  const body = (
    <>
      <span className="text-[13px] text-steel">{label}</span>
      <span className={cn("num mt-1 block text-[22px] leading-tight tracking-[-0.02em]", tone === "pos" && "text-pos", tone === "neg" && "text-neg", tone === "warn" && "text-warn")}>{value}</span>
      <span className="mt-1 flex min-h-[18px] flex-wrap items-center gap-x-2 text-xs text-steel">{delta}{sub}</span>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="group -m-2 block rounded-xl p-2 text-start transition-colors duration-200 ease-tyll hover:bg-mist">{body}</button>
  ) : (
    <div>{body}</div>
  );
}

export function Meter({ value, max, tone = "ink", label }: { value: number; max: number; tone?: "ink" | "pos" | "warn" | "neg" | "fog"; label?: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-hair" role="img" aria-label={label ?? `${Math.round(pct)}%`}>
      <div className={cn("h-full rounded-full transition-[width] duration-200 ease-tyll", { ink: "bg-ink", pos: "bg-pos", warn: "bg-warn", neg: "bg-neg", fog: "bg-fog" }[tone])} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Crumbs({ items }: { items: { label: string; onClick?: () => void }[] }) {
  return (
    <nav aria-label="Where you are" className="flex flex-wrap items-center gap-1.5 text-[13px] text-steel">
      {items.map((c, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span aria-hidden className="text-fog">/</span>}
          {c.onClick ? <button type="button" onClick={c.onClick} className="rounded underline-offset-4 hover:text-ink hover:underline">{c.label}</button> : <span className="text-ink">{c.label}</span>}
        </span>
      ))}
    </nav>
  );
}
