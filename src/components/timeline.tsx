"use client";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Badge, cn } from "@/components/ui";

export interface TimelineItem {
  key: string;
  /** Time, or date and time, as shown. */
  when: string;
  title: string;
  /** One line under the title, always visible. */
  detail?: string;
  tone?: "warn" | "pos" | "neutral";
  flag?: string;
  /** The record behind the event, shown when the event is opened. */
  body?: ReactNode;
  href?: string;
  hrefLabel?: string;
}

/** A vertical sequence of events. Events with a record behind them open on click. */
export function Timeline({ items, initiallyOpen }: { items: TimelineItem[]; initiallyOpen?: string }) {
  const [open, setOpen] = useState<string | null>(initiallyOpen ?? null);
  return (
    <ol className="relative ml-2 border-l border-line">
      {items.map((e) => {
        const expandable = !!(e.body || e.href);
        const isOpen = open === e.key;
        const head = (
          <>
            <span className="num w-[86px] shrink-0 text-left text-steel">{e.when}</span>
            <span className={cn("text-left text-ink", e.tone === "warn" && "font-medium")}>{e.title}</span>
            {e.flag && <Badge tone="warn" className="!py-0">{e.flag}</Badge>}
            {expandable && <ChevronDown size={14} className={cn("ml-auto shrink-0 text-steel transition-transform duration-200", isOpen && "rotate-180")} aria-hidden />}
          </>
        );
        return (
          <li key={e.key} className="relative pb-4 pl-6 last:pb-0">
            <span className={cn("absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-paper", e.tone === "warn" ? "bg-warn" : e.tone === "pos" ? "bg-pos" : "bg-fog")} aria-hidden />
            {expandable ? (
              <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : e.key)} className="flex w-full flex-wrap items-baseline gap-x-3 rounded-lg text-sm hover:bg-cloud">
                {head}
              </button>
            ) : (
              <p className="flex flex-wrap items-baseline gap-x-3 text-sm">{head}</p>
            )}
            {e.detail && <p className="ml-[98px] text-xs text-steel">{e.detail}</p>}
            {isOpen && (
              <div className="ml-[98px] mt-2 rounded-xl border border-line bg-paper px-4 py-3 text-[13px] text-graphite">
                {e.body}
                {e.href && <Link href={e.href} className="mt-2 inline-block underline underline-offset-4">{e.hrefLabel ?? "Open the record"}</Link>}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** A small table of a record's fields, for a timeline event or an evidence row. */
export function RecordFields({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-steel">{k}</dt>
          <dd className="num">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
