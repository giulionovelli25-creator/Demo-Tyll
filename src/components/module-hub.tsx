"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { MoreDetail } from "./disclosure";
import { Help } from "./help";

export interface HubChoice<T extends string> {
  value: T;
  title: string;
  detail: string;
  icon: LucideIcon;
  badge?: string;
  /** A short explanation behind a "?" on the card. */
  help?: string;
  /** Less common: listed under "More tools" instead of on the first screen. */
  more?: boolean;
}

/** A few clearly labelled ways into a module. Each opens one workflow. */
export function ModuleHub<T extends string>({ choices, onPick }: { choices: HubChoice<T>[]; onPick: (v: T) => void }) {
  const main = choices.filter((c) => !c.more);
  const more = choices.filter((c) => c.more);
  return (
    <div className="space-y-4">
      <Cards choices={main} onPick={onPick} tour="hub" />
      {more.length > 0 && (
        <MoreDetail tour="hub-more" label={`More tools (${more.length})`} hideLabel="Fewer tools">
          <Cards choices={more} onPick={onPick} />
        </MoreDetail>
      )}
    </div>
  );
}

function Cards<T extends string>({ choices, onPick, tour }: { choices: HubChoice<T>[]; onPick: (v: T) => void; tour?: string }) {
  return (
    <ul data-tour={tour} className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {choices.map(({ value, title, detail, icon: Icon, badge, help }) => (
        <li key={value} className="relative">
          {help && <Help text={help} label={`What is ${title}?`} className="absolute bottom-4 right-4 z-10" />}
          <button type="button" onClick={() => onPick(value)} className="group flex h-full w-full flex-col justify-between rounded-panel border border-line bg-paper p-5 text-left shadow-panel transition-colors duration-300 ease-tyll hover:border-fog">
            <span className="flex items-center justify-between">
              <Icon size={24} strokeWidth={1.5} aria-hidden />
              <span className="flex items-center gap-2">
                {badge && <span className="rounded-full bg-mist px-2.5 py-0.5 text-xs text-graphite">{badge}</span>}
                <ChevronRight size={16} className="text-fog transition-transform duration-300 ease-tyll group-hover:translate-x-0.5 group-hover:text-ink" aria-hidden />
              </span>
            </span>
            <span className="mt-5 block">
              <span className="block text-[17px] tracking-[-0.01em] text-ink">{title}</span>
              <span className="mt-1 block text-[13px] text-steel">{detail}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The open section lives in the address, so Back and the sidebar link both return to the choices. */
export function useSection<T extends string>(base: string, valid: readonly T[], fallback: T | null = null): [T | null, (v: T | null) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const raw = params.get("tab");
  const current = raw && (valid as readonly string[]).includes(raw) ? (raw as T) : fallback;
  return [current, (v) => router.push(v ? `${base}?tab=${v}` : base)];
}
