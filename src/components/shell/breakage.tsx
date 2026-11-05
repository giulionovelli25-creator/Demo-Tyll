"use client";
// Log waste: tap the item, tap the number, done. Food, drinks and inventory share one flow and one record, with their own lists.
// No forms, no required text, no confirm screen. Undo is in the toast.
import Link from "next/link";
import { Amphora, Bean, Beef, Beer, Candy, Carrot, Cherry, Citrus, Coffee, Cookie, CookingPot, Croissant, CupSoda, Disc, Droplet, Drumstick, Egg, Fish, GlassWater, Ham, IceCreamCone, Leaf, LeafyGreen, Martini, Milk, Minus, Package, Plus, Salad, Search, Shell, Soup, Sprout, Trash2, Wheat, Wine, X, type LucideIcon } from "lucide-react";
import { createElement, useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { useRemembered } from "@/components/disclosure";
import { Segmented, cn, textLink, toast } from "@/components/ui";
import { api } from "@/lib/api";
import { INGREDIENTS, ingredientById, outletById } from "@/lib/data/catalog";
import { STOCK_AREAS, stockAreaOf, type StockArea } from "@/lib/data/locations";
import { allowedOutlets, can } from "@/lib/domain/access";
import { useCtx, useView } from "@/lib/hooks";
import { useShared } from "@/lib/shared-stock";
import type { Ingredient, SharedWaste, SharedWasteCorrection, User, WasteReason } from "@/lib/types";
import { fmtQty } from "@/lib/util";

export const useBreakageSheet = create<{ open: boolean; set(open: boolean): void }>((set) => ({ open: false, set: (open) => set({ open }) }));

const ICONS: Record<string, LucideIcon> = {
  wagyu: Beef, tenderloin: Beef, lamb: Ham, chicken: Drumstick, turkeybacon: Ham, salmon: Fish, hammour: Fish, lobster: Shell,
  saladveg: Salad, romaine: LeafyGreen, potato: Sprout, asparagus: Sprout, eggplant: Sprout, herbs: Leaf, lemon: Citrus, lime: Citrus, orange: Citrus, berries: Cherry,
  brioche: Croissant, bread: Wheat, pita: Wheat, flour: Wheat, arborio: Wheat, linguine: Soup, chickpeas: Bean, sugar: Candy, chocolate: Cookie,
  cheddar: Milk, parmesan: Milk, mozzarella: Milk, creamcheese: Milk, labneh: Milk, butter: Milk, cream: Milk, milk: Milk, eggs: Egg, icecream: IceCreamCone,
  tahini: Amphora, truffle: Amphora, tomatosauce: CookingPot, sauces: CookingPot, stock: CookingPot, oil: Droplet, oliveoil: Droplet,
  coffee: Coffee, coke: CupSoda, soda: CupSoda, rum: Martini, vodka: Martini, liqueur: Martini, wine: Wine,
  wineglass: Wine, highball: GlassWater, rocks: GlassWater, flute: Wine, beerglass: Beer, waterglass: GlassWater,
  plate: Disc, sideplate: Disc, soupbowl: Soup, coffeecup: Coffee, saucer: Disc, jug: Milk,
};
const SUPPLIER_ICONS: Record<string, LucideIcon> = { meat: Beef, sea: Fish, produce: Carrot, bakery: Croissant, dry: Package, bev: CupSoda, ware: GlassWater };
export const ItemIcon = ({ g, size }: { g: Ingredient; size: number }) => createElement(ICONS[g.id] ?? SUPPLIER_ICONS[g.supplierId] ?? Package, { size, "aria-hidden": true });

interface Reason { id: string; label: string; reason: WasteReason }
const REASONS: Record<StockArea, Reason[]> = {
  food: [{ id: "spoiled", label: "Spoiled", reason: "spoilage" }, { id: "overmade", label: "Made too much", reason: "waste" }, { id: "dropped", label: "Dropped", reason: "waste" }],
  drinks: [{ id: "spilled", label: "Spilled", reason: "waste" }, { id: "spoiled", label: "Gone off", reason: "spoilage" }, { id: "dropped", label: "Dropped", reason: "damaged" }],
  inventory: [{ id: "dropped", label: "Dropped", reason: "breakage" }, { id: "guest", label: "Guest", reason: "breakage" }, { id: "chipped", label: "Chipped", reason: "damaged" }],
};
const FALLBACK: Record<StockArea, WasteReason> = { food: "waste", drinks: "waste", inventory: "breakage" };
const QUANTITIES = (unit: string) => (unit === "each" ? [1, 2, 3, 5] : [0.5, 1, 2, 5]);
const UNIT_WORD: Record<string, string> = { kg: "How many kg?", l: "How many litres?" };
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

const save = (outletId: string, ingredientId: string, qty: number, reason: Reason | undefined) => {
  const g = ingredientById[ingredientId];
  const area = stockAreaOf(ingredientId);
  const pending = api<{ entry: SharedWaste }>("/api/stock/waste", { method: "POST", body: { outletId, ingredientId, qty, reason: reason?.reason ?? FALLBACK[area], note: reason?.label, clientId: `breakage-${Date.now()}` } })
    .then((r) => {
      useShared.setState((s) => ({ waste: [...s.waste.filter((w) => w.id !== r.entry.id), r.entry] }));
      return r.entry.id;
    })
    .catch((e) => {
      toast.error(e instanceof Error ? e.message : "That was not saved. Try again.");
      return null;
    });
  // The toast appears at once. Waiting for the server would only slow a busy person down.
  toast.done(`Logged ${fmtQty(qty, g.unit)} ${g.name.toLowerCase()}, ${outletById[outletId].name}.`, {
    label: "Undo",
    run: () => {
      void pending.then((id) => {
        if (!id) return;
        return api<{ correction: SharedWasteCorrection }>(`/api/stock/waste/${id}`, { method: "POST", body: { qty: 0, reason: "Undone by the person who logged it", clientId: `undo-${id}` } })
          .then((c) => {
            useShared.setState((s) => ({ corrections: [...s.corrections.filter((x) => x.id !== c.correction.id), c.correction] }));
            toast.done("Undone. The record stays in the history with its correction.");
          })
          .catch(() => toast.error("That could not be undone. Try again from Log waste."));
      });
    },
  });
};

/** The flow itself, used on the Log waste page, in the sheet and in the staff app. */
export function BreakageFlow({ onDone, only, wide }: { onDone: () => void; only?: StockArea; wide?: boolean }) {
  const { user, sel } = useView();
  const ctx = useCtx();
  const outlets = allowedOutlets(user);
  const [outletId, setOutletId] = useState(() => firstOutlet(user, sel.outletIds));
  const [remembered, setRemembered] = useRemembered<StockArea>("log.area", "food");
  const area = only ?? remembered;
  const [term, setTerm] = useState("");
  const [item, setItem] = useState<string | null>(null);
  const [reason, setReason] = useState<Reason | undefined>();
  const [custom, setCustom] = useState<number | null>(null);

  // The items logged most at this outlet come first.
  const grid = useMemo(() => {
    const tally = new Map<string, number>();
    for (const w of ctx.waste) if (w.outletId === outletId && w.ingredientId) tally.set(w.ingredientId, (tally.get(w.ingredientId) ?? 0) + 1);
    return INGREDIENTS.filter((g) => g.dept !== "supplies" && stockAreaOf(g.id) === area).sort((a, b) => (tally.get(b.id) ?? 0) - (tally.get(a.id) ?? 0)).slice(0, 12);
  }, [ctx.waste, outletId, area]);
  const found = useMemo(() => {
    const t = term.trim().toLowerCase();
    return t ? INGREDIENTS.filter((g) => g.dept !== "supplies" && (!only || stockAreaOf(g.id) === only) && g.name.toLowerCase().includes(t)).slice(0, 12) : null;
  }, [term, only]);

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
    const step = g.unit === "each" ? 1 : 0.5;
    return (
      <div className={cn(wide && "max-w-[560px]")}>
        <button type="button" onClick={() => { setItem(null); setCustom(null); setReason(undefined); }} className="flex w-full items-center gap-3 rounded-[var(--radius-control)] bg-cloud p-3 text-start text-[15px] font-medium text-ink">
          <span className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-control)] bg-accent-soft text-accent-ink"><ItemIcon g={g} size={20} /></span>
          {g.name}
          <span className="ms-auto text-[13px] font-normal text-steel">Change</span>
        </button>
        <p className="mt-4 text-[13px] text-steel">What happened? Optional.</p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {REASONS[stockAreaOf(item)].map((r) => <button key={r.id} type="button" aria-pressed={reason?.id === r.id} onClick={() => setReason(reason?.id === r.id ? undefined : r)} className={cn("h-11 rounded-[var(--radius-control)] border text-sm transition-colors duration-150", reason?.id === r.id ? "border-accent-ink bg-accent-soft font-medium text-accent-ink" : "border-line text-graphite hover:bg-cloud")}>{r.label}</button>)}
        </div>
        <p className="mt-4 text-[13px] text-steel">{UNIT_WORD[g.unit] ?? "How many?"} Tapping a number saves it.</p>
        {custom === null ? (
          <div className="mt-2 grid grid-cols-5 gap-2">
            {QUANTITIES(g.unit).map((q) => <button key={q} type="button" onClick={() => commit(q)} className="num h-16 rounded-[var(--radius-control)] bg-accent text-[22px] font-medium text-on-accent transition-colors duration-150 hover:bg-accent-hover active:scale-[0.98]">{q}</button>)}
            <button type="button" onClick={() => setCustom(g.unit === "each" ? 6 : 3)} className="h-16 rounded-[var(--radius-control)] border border-line text-[13px] font-medium text-ink transition-colors duration-150 hover:bg-cloud">Other</button>
          </div>
        ) : (
          <div className="mt-2 flex items-center gap-2">
            <button type="button" aria-label="Less" onClick={() => setCustom(Math.max(step, custom - step))} className="flex h-16 w-16 items-center justify-center rounded-[var(--radius-control)] border border-line text-ink hover:bg-cloud"><Minus size={22} aria-hidden /></button>
            <button type="button" onClick={() => commit(custom)} className="num h-16 flex-1 rounded-[var(--radius-control)] bg-accent text-[20px] font-medium text-on-accent hover:bg-accent-hover">Log {fmtQty(custom, g.unit)}</button>
            <button type="button" aria-label="More" onClick={() => setCustom(Math.min(500, custom + step))} className="flex h-16 w-16 items-center justify-center rounded-[var(--radius-control)] border border-line text-ink hover:bg-cloud"><Plus size={22} aria-hidden /></button>
          </div>
        )}
      </div>
    );
  }

  const tiles = found ?? grid;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {!only && <Segmented label="What are you logging?" value={area} onChange={setRemembered} options={STOCK_AREAS.map((a) => ({ value: a.id, label: a.name }))} />}
        {outlets.length > 1 && (
          <label className="flex items-center gap-2 text-[13px] text-steel">
            <span className="sr-only sm:not-sr-only">Outlet</span>
            <select value={outletId} onChange={(e) => setOutletId(e.target.value)} aria-label="Outlet" className="h-10 max-w-[180px] rounded-full border border-line bg-paper px-3 text-[13px] text-ink">
              {outlets.map((o) => <option key={o} value={o}>{outletById[o].name}</option>)}
            </select>
          </label>
        )}
      </div>
      <div className={cn("grid grid-cols-3 gap-2 sm:grid-cols-4", wide && "lg:grid-cols-6")}>
        {tiles.map((g) => (
            <button key={g.id} type="button" onClick={() => setItem(g.id)} className="flex h-[84px] flex-col items-center justify-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-paper px-1 text-center text-[13px] leading-tight text-ink transition-colors duration-150 hover:bg-cloud active:scale-[0.98]">
              <span className="text-accent-ink"><ItemIcon g={g} size={22} /></span>
              {g.name}
            </button>
        ))}
        {found?.length === 0 && <p className="col-span-full py-4 text-center text-sm text-steel">Nothing matches that. Try another word.</p>}
      </div>
      <div className="relative mt-3">
        <Search size={15} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-steel" aria-hidden />
        <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search for something else" aria-label="Search for something else" className="h-11 w-full rounded-full border border-line bg-paper ps-9 pe-3 text-sm text-ink placeholder:text-steel" />
      </div>
    </div>
  );
}

/** The sheet, reachable from every page. */
export function BreakageSheet() {
  const { open, set } = useBreakageSheet();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") set(false);
      if (e.key !== "Tab" || !panel.current) return;
      const stops = panel.current.querySelectorAll<HTMLElement>("a,button,input,select");
      if (!stops.length) return;
      const [first, last] = [stops[0], stops[stops.length - 1]];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("keydown", key); before?.focus?.(); };
  }, [open, set]);
  if (!open) return null;
  return (
    <div className="no-print animate-fade fixed inset-0 z-50 flex items-end justify-center bg-scrim sm:items-center sm:p-6" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) set(false); }}>
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Log waste" className="animate-rise max-h-[92vh] w-full overflow-y-auto overscroll-contain outline-none rounded-t-[var(--radius-panel)] bg-paper p-4 pb-6 shadow-float sm:max-w-[480px] sm:rounded-[var(--radius-panel)]">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-section font-medium text-ink">Log waste</h2>
          <button type="button" onClick={() => set(false)} aria-label="Close" className="rounded-full p-2 text-steel transition-colors duration-150 hover:bg-mist hover:text-ink"><X size={18} aria-hidden /></button>
        </div>
        <BreakageFlow onDone={() => set(false)} />
        <p className="mt-4 text-center"><Link href="/waste" onClick={() => set(false)} className={textLink}>See today&apos;s log</Link></p>
      </div>
    </div>
  );
}

/** On every page, bottom right. Phones with the bottom bar use the bar instead. */
export function BreakageFab({ desktopOnly }: { desktopOnly?: boolean }) {
  const set = useBreakageSheet((s) => s.set);
  return (
    <button type="button" onClick={() => set(true)} className={cn("no-print fixed bottom-6 end-6 z-30 h-14 items-center gap-2 rounded-full bg-accent ps-4 pe-5 text-[15px] font-medium text-on-accent shadow-float transition-colors duration-150 hover:bg-accent-hover", desktopOnly ? "hidden md:flex" : "flex")}>
      <Trash2 size={20} aria-hidden /> Log waste
    </button>
  );
}
