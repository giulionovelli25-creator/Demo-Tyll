"use client";
// Log breakage: tap the item, tap the quantity, done. No forms, no required text, no confirm screen. Undo is in the toast.
import { Beer, Coffee, Disc, GlassWater, Milk, Plus, Search, Soup, Wine, Minus, X, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import { cn, toast } from "@/components/ui";
import { api } from "@/lib/api";
import { INGREDIENTS, ingredientById, outletById } from "@/lib/data/catalog";
import { allowedOutlets, can } from "@/lib/domain/access";
import { isBreakage } from "@/lib/domain/inventory";
import { useCtx, useView } from "@/lib/hooks";
import { useShared } from "@/lib/shared-stock";
import type { SharedWaste, SharedWasteCorrection, User, WasteReason } from "@/lib/types";

export const useBreakageSheet = create<{ open: boolean; set(open: boolean): void }>((set) => ({ open: false, set: (open) => set({ open }) }));

const ICONS: Record<string, LucideIcon> = {
  wineglass: Wine, highball: GlassWater, rocks: GlassWater, flute: Wine, beerglass: Beer, waterglass: GlassWater,
  plate: Disc, sideplate: Disc, soupbowl: Soup, coffeecup: Coffee, saucer: Disc, jug: Milk,
};
const REASONS: { id: string; label: string; reason: WasteReason }[] = [
  { id: "dropped", label: "Dropped", reason: "breakage" },
  { id: "guest", label: "Guest", reason: "breakage" },
  { id: "chipped", label: "Chipped", reason: "damaged" },
];
const QUANTITIES = [1, 2, 3, 5];
const LAST_OUTLET = "tyll-breakage-outlet";

/** Who may log breakage, and where a tap will land. */
export const mayLogBreakage = (user: User) => can(user, "stock.logWaste") && allowedOutlets(user).length > 0;

function firstOutlet(user: User, picked: readonly string[]): string {
  if (picked.length === 1) return picked[0];
  let last: string | null = null;
  try { last = localStorage.getItem(LAST_OUTLET); } catch { /* private window */ }
  const mine = allowedOutlets(user);
  return last && mine.includes(last) ? last : mine[0];
}

const save = (outletId: string, ingredientId: string, qty: number, reason: (typeof REASONS)[number] | undefined) => {
  const name = ingredientById[ingredientId].name.toLowerCase();
  const pending = api<{ entry: SharedWaste }>("/api/stock/waste", { method: "POST", body: { outletId, ingredientId, qty, reason: reason?.reason ?? "breakage", note: reason?.label, clientId: `breakage-${Date.now()}` } })
    .then((r) => {
      useShared.setState((s) => ({ waste: [...s.waste.filter((w) => w.id !== r.entry.id), r.entry] }));
      return r.entry.id;
    })
    .catch((e) => {
      toast.error(e instanceof Error ? e.message : "That breakage was not saved. Try again.");
      return null;
    });
  // The toast appears at once. Waiting for the server would only slow a busy person down.
  toast.done(`Logged ${qty} ${name}, ${outletById[outletId].name}.`, {
    label: "Undo",
    run: () => {
      void pending.then((id) => {
        if (!id) return;
        return api<{ correction: SharedWasteCorrection }>(`/api/stock/waste/${id}`, { method: "POST", body: { qty: 0, reason: "Undone by the person who logged it", clientId: `undo-${id}` } })
          .then((c) => {
            useShared.setState((s) => ({ corrections: [...s.corrections.filter((x) => x.id !== c.correction.id), c.correction] }));
            toast.done("Undone. The record stays in the history with its correction.");
          })
          .catch(() => toast.error("That could not be undone. Try again from Waste and Breakage."));
      });
    },
  });
};

/** The flow itself, used in the sheet and in the staff app. */
export function BreakageFlow({ onDone }: { onDone: () => void }) {
  const { user, sel } = useView();
  const ctx = useCtx();
  const outlets = allowedOutlets(user);
  const [outletId, setOutletId] = useState(() => firstOutlet(user, sel.outletIds));
  const [term, setTerm] = useState("");
  const [item, setItem] = useState<string | null>(null);
  const [reason, setReason] = useState<(typeof REASONS)[number] | undefined>();
  const [custom, setCustom] = useState<number | null>(null);

  // The most broken items at this outlet first, then the rest of the glass and china.
  const grid = useMemo(() => {
    const tally = new Map<string, number>();
    for (const w of ctx.waste) if (w.outletId === outletId && w.ingredientId && isBreakage(w)) tally.set(w.ingredientId, (tally.get(w.ingredientId) ?? 0) + w.qty);
    return INGREDIENTS.filter((g) => g.dept === "glassware").sort((a, b) => (tally.get(b.id) ?? 0) - (tally.get(a.id) ?? 0)).slice(0, 12);
  }, [ctx.waste, outletId]);
  const found = useMemo(() => {
    const t = term.trim().toLowerCase();
    return t ? INGREDIENTS.filter((g) => g.dept !== "supplies" && g.name.toLowerCase().includes(t)).slice(0, 12) : null;
  }, [term]);

  const commit = (qty: number) => {
    try { localStorage.setItem(LAST_OUTLET, outletId); } catch { /* private window */ }
    save(outletId, item!, qty, reason);
    setItem(null);
    setReason(undefined);
    setCustom(null);
    setTerm("");
    onDone();
  };

  if (item) {
    const g = ingredientById[item];
    const Icon = ICONS[item] ?? GlassWater;
    return (
      <div>
        <button type="button" onClick={() => { setItem(null); setCustom(null); }} className="flex w-full items-center gap-3 rounded-[var(--radius-control)] bg-cloud p-3 text-left text-[15px] font-medium text-ink">
          <span className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-control)] bg-accent-soft text-accent-ink"><Icon size={20} aria-hidden /></span>
          {g.name}
          <span className="ml-auto text-[13px] font-normal text-steel">Change</span>
        </button>
        <p className="mt-4 text-[13px] text-steel">How many? Tapping a number saves it.</p>
        {custom === null ? (
          <div className="mt-2 grid grid-cols-5 gap-2">
            {QUANTITIES.map((q) => <button key={q} type="button" onClick={() => commit(q)} className="num h-16 rounded-[var(--radius-control)] bg-accent text-[22px] font-medium text-on-accent transition-colors duration-150 hover:bg-accent-hover active:scale-[0.97]">{q}</button>)}
            <button type="button" onClick={() => setCustom(6)} className="h-16 rounded-[var(--radius-control)] border border-line text-[13px] font-medium text-ink transition-colors duration-150 hover:bg-cloud">Other</button>
          </div>
        ) : (
          <div className="mt-2 flex items-center gap-2">
            <button type="button" aria-label="One fewer" onClick={() => setCustom(Math.max(1, custom - 1))} className="flex h-16 w-16 items-center justify-center rounded-[var(--radius-control)] border border-line text-ink hover:bg-cloud"><Minus size={22} aria-hidden /></button>
            <button type="button" onClick={() => commit(custom)} className="num h-16 flex-1 rounded-[var(--radius-control)] bg-accent text-[20px] font-medium text-on-accent hover:bg-accent-hover">Log {custom}</button>
            <button type="button" aria-label="One more" onClick={() => setCustom(Math.min(500, custom + 1))} className="flex h-16 w-16 items-center justify-center rounded-[var(--radius-control)] border border-line text-ink hover:bg-cloud"><Plus size={22} aria-hidden /></button>
          </div>
        )}
        <p className="mt-4 text-[13px] text-steel">What happened? Optional.</p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {REASONS.map((r) => <button key={r.id} type="button" aria-pressed={reason?.id === r.id} onClick={() => setReason(reason?.id === r.id ? undefined : r)} className={cn("h-12 rounded-[var(--radius-control)] border text-sm transition-colors duration-150", reason?.id === r.id ? "border-accent bg-accent-soft font-medium text-accent-ink" : "border-line text-graphite hover:bg-cloud")}>{r.label}</button>)}
        </div>
      </div>
    );
  }

  const tiles = found ?? grid;
  return (
    <div>
      {outlets.length > 1 && (
        <label className="mb-2 flex items-center justify-between gap-2 text-[13px] text-steel">
          Outlet
          <select value={outletId} onChange={(e) => setOutletId(e.target.value)} className="h-9 max-w-[220px] rounded-full border border-line bg-paper px-3 text-[13px] text-ink">
            {outlets.map((o) => <option key={o} value={o}>{outletById[o].name}</option>)}
          </select>
        </label>
      )}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {tiles.map((g) => {
          const Icon = ICONS[g.id] ?? GlassWater;
          return (
            <button key={g.id} type="button" onClick={() => setItem(g.id)} className="flex h-[88px] flex-col items-center justify-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-paper px-1 text-center text-[13px] leading-tight text-ink transition-colors duration-150 hover:bg-cloud active:scale-[0.97]">
              <Icon size={22} className="text-accent-ink" aria-hidden />
              {g.name}
            </button>
          );
        })}
        {found?.length === 0 && <p className="col-span-full py-4 text-center text-sm text-steel">Nothing matches that. Try another word.</p>}
      </div>
      <div className="relative mt-3">
        <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-steel" aria-hidden />
        <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search for something else" aria-label="Search for something else" className="h-11 w-full rounded-full border border-line bg-paper pl-9 pr-3 text-sm text-ink placeholder:text-steel" />
      </div>
    </div>
  );
}

/** The sheet, reachable from every page. */
export function BreakageSheet() {
  const { open, set } = useBreakageSheet();
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") set(false); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open, set]);
  if (!open) return null;
  return (
    <div className="no-print animate-fade fixed inset-0 z-50 flex items-end justify-center bg-scrim sm:items-center sm:p-6" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) set(false); }}>
      <div role="dialog" aria-modal="true" aria-label="Log breakage" className="animate-rise max-h-[92vh] w-full overflow-y-auto rounded-t-[var(--radius-panel)] bg-paper p-4 pb-6 shadow-float sm:max-w-[480px] sm:rounded-[var(--radius-panel)]">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-section font-medium text-ink">Log breakage</h2>
          <button type="button" onClick={() => set(false)} aria-label="Close" className="rounded-full p-2 text-steel transition-colors duration-150 hover:bg-mist hover:text-ink"><X size={18} aria-hidden /></button>
        </div>
        <BreakageFlow onDone={() => set(false)} />
      </div>
    </div>
  );
}

/** Always within reach of a thumb on a phone. */
export function BreakageFab({ raised }: { raised?: boolean }) {
  const set = useBreakageSheet((s) => s.set);
  return (
    <button type="button" onClick={() => set(true)} className={cn("no-print fixed right-4 z-30 flex h-14 items-center gap-2 rounded-full bg-accent pl-4 pr-5 text-[15px] font-medium text-on-accent shadow-float transition-colors duration-150 hover:bg-accent-hover active:scale-[0.97] md:hidden", raised ? "bottom-20" : "bottom-5")}>
      <GlassWater size={20} aria-hidden /> Log breakage
    </button>
  );
}
