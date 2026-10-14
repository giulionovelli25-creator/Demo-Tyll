"use client";
// Shared interface primitives. One set of controls for every module.
import clsx from "clsx";
import { ArrowDownRight, ArrowUpRight, ChevronDown, ChevronUp, ChevronsUpDown, Minus, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { create } from "zustand";

export const cn = clsx;

// ---- Buttons ----------------------------------------------------------------
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" | "lg" };

export function Button({ variant = "secondary", size = "md", className, type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium tracking-[-0.01em] transition-[background,color,border-color,transform] duration-300 ease-tyll active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45",
        size === "sm" && "h-8 px-3 text-[13px]",
        size === "md" && "h-10 px-4 text-sm",
        size === "lg" && "h-12 px-6 text-[15px]",
        variant === "primary" && "bg-ink text-paper hover:bg-graphite",
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
export type Tone = "neutral" | "pos" | "warn" | "neg" | "ink";

const TONE: Record<Tone, string> = {
  neutral: "bg-mist text-graphite",
  pos: "bg-pos-soft text-pos",
  warn: "bg-warn-soft text-warn",
  neg: "bg-neg-soft text-neg",
  ink: "bg-ink text-paper",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium", TONE[tone], className)}>{children}</span>;
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
    <section className={cn("min-w-0 rounded-panel border border-line bg-paper shadow-panel", className)}>
      {(title || action) && (
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-5 sm:px-6">
          <div className="min-w-0">
            {title && <h2 className="text-[17px] leading-snug text-ink">{title}</h2>}
            {description && <p className="mt-1 max-w-[70ch] text-[13px] text-steel">{description}</p>}
          </div>
          {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
        </header>
      )}
      <div className={cn(flush ? "pt-4" : "p-5 sm:p-6", (title || action) && !flush && "pt-4 sm:pt-4")}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, lead, children, crumbs }: { title: ReactNode; lead?: ReactNode; children?: ReactNode; crumbs?: ReactNode }) {
  return (
    <header className="waves animate-rise overflow-hidden rounded-panel border border-line bg-paper px-6 py-7 shadow-panel sm:px-8 sm:py-9">
      {crumbs && <div className="mb-3">{crumbs}</div>}
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0 max-w-[64ch]">
          <h1 className="text-[30px] leading-[1.1] tracking-[-0.03em] text-ink sm:text-[38px]">{title}</h1>
          {lead && <p className="mt-3 text-[15px] leading-relaxed text-graphite">{lead}</p>}
        </div>
        {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
      </div>
    </header>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="waves waves-full flex flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed border-line px-6 py-12 text-center">
      <p className="text-base text-ink">{title}</p>
      {children && <p className="mt-1 max-w-[52ch] text-[13px] text-steel">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ---- Form controls ----------------------------------------------------------
export function Select({ label, className, children, hideLabel, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; hideLabel?: boolean }) {
  const id = useId();
  return (
    <div className={cn("relative min-w-0", className)}>
      <label htmlFor={id} className={hideLabel ? "sr-only" : "mb-1.5 block text-[13px] font-medium text-graphite"}>{label}</label>
      <div className="relative">
        <select id={id} className="h-10 w-full appearance-none truncate rounded-full border border-line bg-paper pl-4 pr-9 text-sm text-ink transition-colors duration-300 ease-tyll hover:border-fog" {...props}>
          {children}
        </select>
        <ChevronDown size={15} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-steel" aria-hidden />
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
          className={cn("num h-10 w-full rounded-xl border bg-paper px-3 text-sm text-ink transition-colors duration-300 ease-tyll placeholder:text-fog", error ? "border-neg" : "border-line hover:border-fog", suffix && "pr-12")}
          {...props}
        />
        {suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-steel">{suffix}</span>}
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
    <div role="radiogroup" aria-label={label} className="inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full border border-line bg-paper p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn("whitespace-nowrap rounded-full font-medium transition-colors duration-300 ease-tyll", size === "sm" ? "h-7 px-3 text-xs" : "h-9 px-4 text-[13px]", value === o.value ? "bg-ink text-paper" : "text-steel hover:text-ink")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: string; count?: number }[] }) {
  return (
    <div role="tablist" className="scroll-thin flex gap-6 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          type="button"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cn("-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 pb-3 pt-1 text-sm transition-colors duration-300 ease-tyll", value === t.value ? "border-ink text-ink" : "border-transparent text-steel hover:text-ink")}
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
  const toggle = (key: K) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));
  return { sort, toggle };
}

export function Th<K extends string>({ children, sortKey, sort, onSort, align = "left", className }: { children: ReactNode; sortKey?: K; sort?: SortState<K>; onSort?: (k: K) => void; align?: "left" | "right"; className?: string }) {
  const active = sortKey && sort?.key === sortKey;
  const Icon = !active ? ChevronsUpDown : sort!.dir === "asc" ? ChevronUp : ChevronDown;
  return (
    <th scope="col" aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined} className={cn("whitespace-nowrap px-3 py-2.5 text-xs font-medium text-steel first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6", align === "right" ? "text-right" : "text-left", className)}>
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
  return <td className={cn("px-3 py-3 align-middle first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6", align === "right" && "num whitespace-nowrap text-right", className)}>{children}</td>;
}

export function TableWrap({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("scroll-thin relative overflow-x-auto", className)}>{children}</div>;
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
      <button type="button" aria-label="Close panel" className="animate-fade absolute inset-0 bg-ink/25 backdrop-blur-[2px]" onClick={onClose} />
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined} className={cn("animate-slide-in relative flex h-full w-full flex-col bg-paper shadow-float outline-none", wide ? "max-w-3xl" : "max-w-xl")}>
        <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
          <div className="min-w-0">
            <h2 className="text-xl leading-snug">{title}</h2>
            {description && <p className="mt-1 text-[13px] text-steel">{description}</p>}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close" className="!px-2"><X size={18} /></Button>
        </header>
        <div className="scroll-thin flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

// ---- Toasts -----------------------------------------------------------------
interface Toast {
  id: number;
  text: string;
  tone: "pos" | "neg";
}

const useToasts = create<{ toasts: Toast[]; push: (text: string, tone: Toast["tone"]) => void; drop: (id: number) => void }>((set) => ({
  toasts: [],
  push: (text, tone) => {
    const id = Date.now() + Math.random();
    set((s) => ({ toasts: [...s.toasts, { id, text, tone }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4500);
  },
  drop: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  done: (text: string) => useToasts.getState().push(text, "pos"),
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
    <div className="no-print pointer-events-none fixed bottom-5 left-1/2 z-[70] flex w-[min(92vw,26rem)] -translate-x-1/2 flex-col gap-2" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={cn("animate-rise pointer-events-auto flex items-start justify-between gap-3 rounded-2xl border bg-paper px-4 py-3 text-sm shadow-float", t.tone === "pos" ? "border-pos/25" : "border-neg/30")}>
          <span className="flex items-start gap-2.5">
            <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", t.tone === "pos" ? "bg-pos" : "bg-neg")} aria-hidden />
            {t.text}
          </span>
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
    <button type="button" onClick={onClick} className="group -m-2 block rounded-xl p-2 text-left transition-colors duration-300 ease-tyll hover:bg-mist">{body}</button>
  ) : (
    <div>{body}</div>
  );
}

export function Meter({ value, max, tone = "ink", label }: { value: number; max: number; tone?: "ink" | "pos" | "warn" | "neg" | "fog"; label?: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-hair" role="img" aria-label={label ?? `${Math.round(pct)}%`}>
      <div className={cn("h-full rounded-full transition-[width] duration-500 ease-tyll", { ink: "bg-ink", pos: "bg-pos", warn: "bg-warn", neg: "bg-neg", fog: "bg-fog" }[tone])} style={{ width: `${pct}%` }} />
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
