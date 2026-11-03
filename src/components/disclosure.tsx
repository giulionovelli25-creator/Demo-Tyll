"use client";
// Show less first: long lists and extra charts sit behind one clearly labelled row, which says what is inside before it opens.
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { cn } from "@/components/ui";
import { useSession } from "@/lib/api";
import { userById } from "@/lib/data/catalog";
import { demoRoleFits, moduleOfPath } from "@/lib/domain/access";

interface Memory {
  byUser: Record<string, Record<string, string>>;
  set(userId: string, key: string, value: string): void;
}

const useMemory = create<Memory>()(
  persist(
    (set) => ({
      byUser: {},
      set: (userId, key, value) => set((s) => ({ byUser: { ...s.byUser, [userId]: { ...s.byUser[userId], [key]: value } } })),
    }),
    { name: "tyll-open-v1" },
  ),
);

/** A choice remembered per person in this browser, such as an open section or the last tab. */
export function useRemembered<T extends string>(key: string, fallback: T): [T, (value: T) => void] {
  const userId = useSession((s) => s.userId) ?? "guest";
  const value = useMemory((s) => s.byUser[userId]?.[key]);
  const set = useMemory((s) => s.set);
  return [(value as T | undefined) ?? fallback, (next) => set(userId, key, next)];
}

/** A full load lets the public demo change role on the server first. Only needed when this role cannot open the page. */
function useNeedsFullLoad(href: string) {
  const inDemo = useSession((s) => !!s.demoRoles);
  const userId = useSession((s) => s.userId);
  const user = userId ? userById[userId] : undefined;
  return inDemo && !(user && demoRoleFits(user, moduleOfPath(href.split("?")[0])));
}

const ROW = "flex w-full items-center gap-3 rounded-panel px-4 py-3.5 text-left transition-colors duration-150 ease-tyll hover:bg-cloud sm:px-6";

function RowText({ title, summary }: { title: ReactNode; summary: ReactNode }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block text-[15px] font-semibold text-ink">{title}</span>
      <span className="mt-0.5 block text-[13px] text-steel">{summary}</span>
    </span>
  );
}

/** One collapsed section. Opens in place, and stays as the person left it. Use it for short context under a summary. */
export function Section({ id, title, summary, children, forceOpen, defaultOpen, flush, className }: { id: string; title: ReactNode; summary: ReactNode; children: ReactNode; forceOpen?: boolean; defaultOpen?: boolean; flush?: boolean; className?: string }) {
  const [state, setState] = useRemembered<"open" | "closed">(`section.${id}`, defaultOpen ? "open" : "closed");
  const bodyId = useId();
  const open = state === "open";
  // A link can ask for a section by name, such as Pour Control from an alert.
  useEffect(() => {
    if (forceOpen) setState("open");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceOpen]);
  return (
    <section className={cn("min-w-0 rounded-panel border border-line bg-paper shadow-panel", className)}>
      <button type="button" onClick={() => setState(open ? "closed" : "open")} aria-expanded={open} aria-controls={bodyId} className={cn(ROW, "no-print")}>
        <RowText title={title} summary={summary} />
        <ChevronDown size={18} className={cn("shrink-0 text-steel transition-transform duration-200 ease-tyll", open && "rotate-180")} aria-hidden />
      </button>
      {open && <div id={bodyId} className={cn("animate-rise border-t border-hair print:border-0", !flush && "space-y-4 p-4 sm:p-6")}>{children}</div>}
    </section>
  );
}

/** The same row, leading to a page of its own. Use it when a list needs its own filters and search. */
export function SectionLink({ href, title, summary, className }: { href: string; title: ReactNode; summary: ReactNode; className?: string }) {
  const publicDemo = useNeedsFullLoad(href);
  const body = (
    <>
      <RowText title={title} summary={summary} />
      <ChevronRight size={18} className="shrink-0 text-steel" aria-hidden />
    </>
  );
  const style = cn("block min-w-0 rounded-panel border border-line bg-paper shadow-panel", className);
  return <div className={style}>{publicDemo ? <a href={href} className={ROW}>{body}</a> : <Link href={href} className={ROW}>{body}</Link>}</div>;
}

/** A short link row for lists of places. */
export function RowLink({ href, title, summary }: { href: string; title: ReactNode; summary: ReactNode }) {
  const publicDemo = useNeedsFullLoad(href);
  const style = "flex min-h-11 items-center justify-between gap-3 px-4 py-2.5 transition-colors duration-150 ease-tyll hover:bg-cloud sm:px-6";
  const body = <><span className="text-sm font-medium text-ink">{title}</span><span className="flex min-w-0 items-center gap-2 text-right text-[13px] text-steel"><span className="hidden sm:inline">{summary}</span><ChevronRight size={16} className="shrink-0" aria-hidden /></span></>;
  return publicDemo ? <a href={href} className={style}>{body}</a> : <Link href={href} className={style}>{body}</Link>;
}

export function MoreDetail({ label, hideLabel, children, defaultOpen = false, className, tour }: { label: string; hideLabel?: string; children: ReactNode; defaultOpen?: boolean; className?: string; tour?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className={cn("space-y-5", className)}>
      <button type="button" data-tour={tour} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={id}
        className="flex w-full items-center justify-center gap-2 rounded-full border border-line bg-paper px-4 py-2.5 text-sm text-graphite transition-colors duration-200 ease-tyll hover:border-fog hover:text-ink">
        {open ? hideLabel ?? "Show less" : label}
        <ChevronDown size={16} className={cn("transition-transform duration-200 ease-tyll", open && "rotate-180")} aria-hidden />
      </button>
      {open && <div id={id} className="animate-rise space-y-5">{children}</div>}
    </div>
  );
}
