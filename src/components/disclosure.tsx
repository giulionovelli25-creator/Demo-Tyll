"use client";
// Show less first: secondary detail sits behind one clearly labelled button and opens in place.
import { ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { cn } from "@/components/ui";

export function MoreDetail({ label, hideLabel, children, defaultOpen = false, className, tour }: { label: string; hideLabel?: string; children: ReactNode; defaultOpen?: boolean; className?: string; tour?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className={cn("space-y-5", className)}>
      <button type="button" data-tour={tour} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={id}
        className="flex w-full items-center justify-center gap-2 rounded-full border border-line bg-paper px-4 py-2.5 text-sm text-graphite transition-colors duration-300 ease-tyll hover:border-fog hover:text-ink">
        {open ? hideLabel ?? "Show less" : label}
        <ChevronDown size={16} className={cn("transition-transform duration-300 ease-tyll", open && "rotate-180")} aria-hidden />
      </button>
      {open && <div id={id} className="animate-rise space-y-5">{children}</div>}
    </div>
  );
}
