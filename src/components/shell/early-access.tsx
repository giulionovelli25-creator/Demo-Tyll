"use client";
import { ArrowLeft, ArrowRight, Compass, X } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { Button, Drawer, cn } from "@/components/ui";
import whatsNew from "../../../config/whats-new.json";
import { api, reloadTo } from "@/lib/api";
import { clearDataset } from "@/lib/data/dataset";
import { useDemo } from "@/lib/store";
import { fmtDate } from "@/lib/util";

/** Small marker beside the logo: this is an early version that keeps growing. */
export function EarlyAccessBadge() {
  return <span className="whitespace-nowrap rounded-full border border-line bg-paper px-2 text-[11px] leading-[20px] text-graphite">Early access</span>;
}

/** The changelog, read from config/whats-new.json so it can be edited without touching code. */
export function WhatsNew({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Drawer open={open} onClose={onClose} title="What's new" description="Tyll is in early access. New features are added regularly.">
      <ol className="space-y-5">
        {whatsNew.entries.map((e) => (
          <li key={e.date + e.title} className="border-l border-line pl-4">
            <p className="text-xs text-steel">{fmtDate(e.date)}</p>
            <p className="mt-0.5 text-[15px] text-ink">{e.title}</p>
            <p className="mt-1 text-sm leading-relaxed text-graphite">{e.text}</p>
          </li>
        ))}
      </ol>
    </Drawer>
  );
}

/** The four stops of the public demo, each seen as the role it is built for. */
export const GUIDED_PATH = [
  { href: "/stock", userId: "u-buy", title: "Stock prediction", text: "What you have, when it runs out, and what to order to reach month end. Try Build order." },
  { href: "/waste", userId: "u-chef", title: "Waste and breakage", text: "Tap Log breakage, tap the item, tap the number. Done in three taps, with Undo." },
  { href: "/money?tab=pour", userId: "u-fnb", title: "Pour Control", text: "How many glasses each bottle really gave, by outlet and shift, and what the gap is worth." },
  { href: "/more", userId: "u-fnb", title: "Coming soon", text: "Events, rooms and sales are in development. Have a look at where Tyll is heading." },
] as const;

const KEY = "tyll-guided-path";
type PathState = { step: number } | "off" | null;
const listeners = new Set<() => void>();
const read = (): string | null => { try { return localStorage.getItem(KEY); } catch { return "off"; } };
const write = (s: PathState) => { try { if (s === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private window */ } listeners.forEach((l) => l()); };
const parse = (raw: string | null): PathState => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } };

/** Starts (or restarts) the guided path from its first stop. */
export function startGuidedPath() {
  return openStep(0);
}

/** Switches to the stop's role (a public demo session switch), then opens its page. */
async function openStep(step: number) {
  write({ step });
  const s = GUIDED_PATH[step];
  await api("/api/auth/demo", { method: "POST", body: { userId: s.userId } }).catch(() => undefined);
  useDemo.getState().signOut();
  clearDataset();
  reloadTo(s.href);
}

/**
 * An optional guided path, shown as a strip in the page flow (never on top of content). Before it starts it is a
 * one-line offer; while running it shows the step, Back, Next and Close. Closing remembers the choice in this browser.
 */
export function GuidedPath({ offer = false }: { offer?: boolean }) {
  const raw = useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, read, () => "off");
  const [, force] = useState(0);
  const state = parse(raw);
  if (state === "off") return null;
  const go = (step: number) => void openStep(step);
  const close = () => { write("off"); force((n) => n + 1); };

  if (state === null) {
    // The offer lives on the More page, so it never pushes the priority cards down.
    if (!offer) return null;
    return (
      <div className="no-print mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-line bg-paper px-4 py-3">
        <Compass size={18} strokeWidth={1.6} className="shrink-0 text-graphite" aria-hidden />
        <p className="min-w-[200px] flex-1 text-sm text-graphite"><span className="text-ink">New here?</span> Follow a 4 step guided path through what Tyll does today.</p>
        <span className="flex items-center gap-1">
          <Button size="sm" variant="primary" onClick={() => go(0)}>Start guided path</Button>
          <button type="button" onClick={close} aria-label="Close the guided path offer" className="rounded-full p-2 text-steel hover:bg-mist hover:text-ink"><X size={16} /></button>
        </span>
      </div>
    );
  }
  const at = Math.min(Math.max(state.step, 0), GUIDED_PATH.length - 1);
  const step = GUIDED_PATH[at];
  const last = at === GUIDED_PATH.length - 1;
  return (
    <div role="region" aria-label="Guided path" className="no-print mb-5 rounded-2xl border border-ink/15 bg-paper px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-steel">Guided path, step {at + 1} of {GUIDED_PATH.length}</p>
          <p className="mt-0.5 text-[15px] text-ink">{step.title}</p>
          <p className="mt-0.5 text-sm text-graphite">{step.text}</p>
        </div>
        <button type="button" onClick={close} aria-label="Close the guided path" className="-mr-1 shrink-0 rounded-full p-2 text-steel hover:bg-mist hover:text-ink"><X size={16} /></button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ol className="mr-auto flex gap-1.5" aria-hidden>
          {GUIDED_PATH.map((s, i) => <li key={s.href} className={cn("h-1.5 w-6 rounded-full", i <= at ? "bg-accent" : "bg-line")} />)}
        </ol>
        {at > 0 && <Button size="sm" variant="ghost" onClick={() => go(at - 1)}><ArrowLeft size={14} aria-hidden /> Back</Button>}
        {last ? <Button size="sm" variant="primary" onClick={close}>Finish</Button> : <Button size="sm" variant="primary" onClick={() => go(at + 1)}>Next: {GUIDED_PATH[at + 1].title} <ArrowRight size={14} aria-hidden /></Button>}
      </div>
    </div>
  );
}
