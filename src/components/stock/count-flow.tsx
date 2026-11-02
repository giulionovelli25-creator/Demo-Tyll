"use client";
// Stock count, built for one hand on a phone. By location, in the order someone walks the storeroom. The expected quantity is
// filled in, so staff only touch what differs. It can be paused and picked up later. Blind mode hides the expected figure for audits.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowLeft, ArrowUp, Check, Delete, Minus, Pause, Play, Plus } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Skeleton, WidgetError, cn, toast } from "@/components/ui";
import { api } from "@/lib/api";
import { ingredientById, propertyById } from "@/lib/data/catalog";
import { COUNT_LOCATIONS, DEFAULT_ROUTE, locationOf, type LocationId } from "@/lib/data/locations";
import { allowedProperties } from "@/lib/domain/access";
import { useApi, useServerStock, useView } from "@/lib/hooks";
import { useDemo } from "@/lib/store";
import { fmtDate, fmtMoney, fmtQty, sum } from "@/lib/util";

interface Draft {
  propertyId: string;
  scope: "full" | "key";
  blind: boolean;
  order: string[];
  index: number;
  values: Record<string, number>;
  skipped: Record<string, true>;
}

const useCountDraft = create<{ byUser: Record<string, Draft | undefined>; set(userId: string, d: Draft | undefined): void }>()(
  persist((set) => ({ byUser: {}, set: (userId, d) => set((s) => ({ byUser: { ...s.byUser, [userId]: d } })) }), { name: "tyll-count-v1" }),
);

const locationName = (id: LocationId) => COUNT_LOCATIONS.find((l) => l.id === id)!.name;
const stepFor = (unit: string) => (unit === "each" ? 1 : 0.5);
const tidy = (n: number) => Math.round(n * 100) / 100;

export function CountFlow() {
  const { user, propertyId } = useView();
  const router = useRouter();
  const pid = propertyId ?? allowedProperties(user)[0];
  const draft = useCountDraft((s) => s.byUser[user.id]);
  const setDraft = useCountDraft((s) => s.set);
  const save = (d: Draft | undefined) => setDraft(user.id, d);
  const { data, error } = useServerStock(pid);
  const routeRes = useApi<{ route: LocationId[]; mayEdit: boolean }>(`/api/stock/count-route?propertyId=${pid}`);
  const [route, setRoute] = useState<LocationId[] | null>(null);
  const liveRoute = route ?? routeRes.data?.route ?? DEFAULT_ROUTE;
  const [editing, setEditing] = useState(false);
  const [blind, setBlind] = useState(false);
  const [pad, setPad] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const touch = useRef<number | null>(null);
  const recordCount = useDemo((s) => s.recordCount);

  const rows = useMemo(() => new Map((data?.rows ?? []).filter((r) => ingredientById[r.ingredientId].dept !== "supplies").map((r) => [r.ingredientId, r])), [data]);
  const ordered = (scope: "full" | "key") => liveRoute.flatMap((loc) =>
    [...rows.keys()].filter((id) => locationOf(id) === loc && (scope === "full" || ingredientById[id].priority)).sort((a, b) => ingredientById[a].name.localeCompare(ingredientById[b].name)));

  const start = (scope: "full" | "key") => save({ propertyId: pid, scope, blind, order: ordered(scope), index: 0, values: {}, skipped: {} });
  const expectedOf = (id: string) => Math.max(0, rows.get(id)?.estimated ?? 0);

  // ---- Starting point ------------------------------------------------------------------------------------------------
  if (!draft) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-mist px-4 pb-8 pt-4">
        <Link href="/stock" className="inline-flex h-11 w-fit items-center gap-2 text-sm text-graphite"><ArrowLeft size={18} aria-hidden /> Stock</Link>
        <h1 className="mt-2 text-title font-medium text-ink">Stock count</h1>
        <p className="mt-1 text-[15px] text-graphite">{propertyById[pid].name}. Walk the storeroom, and only touch what differs.</p>
        {error && <div className="mt-4"><WidgetError>Stock could not load.</WidgetError></div>}
        {!data ? <Skeleton className="mt-6 h-40 w-full" /> : editing ? (
          <section className="mt-6" aria-label="Walking order">
            <h2 className="text-section font-medium text-ink">Walking order</h2>
            <p className="mt-1 text-[13px] text-steel">Set it once, in the order you walk. Everyone counting here uses it.</p>
            <ol className="mt-3 space-y-2">
              {liveRoute.map((id, i) => (
                <li key={id} className="flex items-center gap-2 rounded-[var(--radius-control)] border border-line bg-paper p-2 pl-3 text-sm text-ink shadow-panel">
                  <span className="num w-5 text-steel">{i + 1}</span>
                  <span className="min-w-0 flex-1">{locationName(id)}</span>
                  <button type="button" aria-label={`Move ${locationName(id)} earlier`} disabled={i === 0} onClick={() => setRoute(swap(liveRoute, i, i - 1))} className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-control)] text-graphite hover:bg-mist disabled:opacity-40"><ArrowUp size={18} aria-hidden /></button>
                  <button type="button" aria-label={`Move ${locationName(id)} later`} disabled={i === liveRoute.length - 1} onClick={() => setRoute(swap(liveRoute, i, i + 1))} className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-control)] text-graphite hover:bg-mist disabled:opacity-40"><ArrowDown size={18} aria-hidden /></button>
                </li>
              ))}
            </ol>
            <button
              type="button"
              onClick={async () => {
                try {
                  await api("/api/stock/count-route", { method: "POST", body: { propertyId: pid, route: liveRoute } });
                  toast.done("Walking order saved for everyone.");
                  setEditing(false);
                } catch (e) { toast.error(e instanceof Error ? e.message : "That could not be saved."); }
              }}
              className="mt-4 h-14 w-full rounded-full bg-accent text-[15px] font-medium text-on-accent hover:bg-accent-hover"
            >Save walking order</button>
          </section>
        ) : (
          <>
            <div className="mt-6 space-y-3">
              <button type="button" onClick={() => start("full")} className="flex w-full items-center justify-between gap-3 rounded-[var(--radius-panel)] bg-accent p-4 text-left text-on-accent shadow-panel hover:bg-accent-hover">
                <span><span className="block text-[17px] font-medium">Full count</span><span className="block text-[13px]">{ordered("full").length} items, in walking order</span></span>
                <Play size={22} aria-hidden />
              </button>
              <button type="button" onClick={() => start("key")} className="flex w-full items-center justify-between gap-3 rounded-[var(--radius-panel)] border border-line bg-paper p-4 text-left shadow-panel hover:bg-cloud">
                <span><span className="block text-[17px] font-medium text-ink">Key items only</span><span className="block text-[13px] text-steel">{ordered("key").length} items that matter most</span></span>
                <Play size={22} className="text-accent-ink" aria-hidden />
              </button>
            </div>
            <label className="mt-4 flex min-h-14 items-center justify-between gap-3 rounded-[var(--radius-panel)] border border-line bg-paper p-4 shadow-panel">
              <span><span className="block text-[15px] font-medium text-ink">Blind count</span><span className="block text-[13px] text-steel">For audits: hides what is expected</span></span>
              <input type="checkbox" checked={blind} onChange={(e) => setBlind(e.target.checked)} className="h-6 w-6 accent-[var(--color-accent)]" />
            </label>
            {routeRes.data?.mayEdit && <button type="button" onClick={() => setEditing(true)} className="mt-4 h-11 text-sm font-medium text-accent-ink underline-offset-4 hover:underline">Change the walking order</button>}
          </>
        )}
      </div>
    );
  }

  // ---- Finish ----------------------------------------------------------------------------------------------------------
  const total = draft.order.length;
  const counted = draft.order.filter((id) => draft.values[id] !== undefined);
  const local = (n: number) => fmtMoney(n, propertyById[draft.propertyId].currency);
  const diffs = counted.map((id) => {
    const row = rows.get(id);
    const diff = draft.values[id] - expectedOf(id);
    return { id, diff, value: diff * (row?.unitCost ?? 0) };
  }).filter((d) => Math.abs(d.diff) >= 0.05).sort((a, b) => a.value - b.value);
  const skipped = draft.order.filter((id) => draft.skipped[id]);
  const totalValue = sum(diffs, (d) => d.value);

  if (draft.index >= total || finishing) {
    const confirm = () => {
      let failed = 0;
      for (const id of counted) {
        const row = rows.get(id);
        if (!row) continue;
        const r = recordCount({ propertyId: draft.propertyId, ingredientId: id, counted: tidy(draft.values[id]), expected: row.estimated, allocation: row.allocation });
        if (!r.ok) failed += 1;
      }
      if (failed === counted.length && counted.length > 0) { toast.error("Your role cannot record counts."); return; }
      toast.done(`Count saved: ${counted.length} items.`);
      save(undefined);
      router.push("/stock");
    };
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-mist px-4 pb-6 pt-4">
        <button type="button" onClick={() => { setFinishing(false); save({ ...draft, index: Math.max(0, total - 1) }); }} className="inline-flex h-11 w-fit items-center gap-2 text-sm text-graphite"><ArrowLeft size={18} aria-hidden /> Back to the count</button>
        <h1 className="mt-2 text-title font-medium text-ink">Check and confirm</h1>
        <p className="mt-1 text-[15px] text-graphite">{counted.length} counted{skipped.length ? `, ${skipped.length} skipped` : ""}. {diffs.length} {diffs.length === 1 ? "item differs" : "items differ"} from what was expected.</p>
        <div className="mt-4 rounded-[var(--radius-panel)] border border-line bg-paper p-4 shadow-panel">
          <p className="text-[13px] text-steel">Total difference</p>
          <p className={cn("num mt-1 text-display font-medium", totalValue < -0.5 ? "text-money" : "text-ink")}>{totalValue < -0.5 ? "−" : ""}{local(Math.abs(totalValue))}</p>
        </div>
        <ul className="mt-3 flex-1 overflow-hidden rounded-[var(--radius-panel)] border border-line bg-paper shadow-panel">
          {diffs.length === 0 && <li className="p-4 text-sm text-graphite">Everything matched. Nothing to look at.</li>}
          {diffs.map((d) => {
            const g = ingredientById[d.id];
            return (
              <li key={d.id} className="border-t border-hair first:border-t-0">
                <button type="button" onClick={() => save({ ...draft, index: draft.order.indexOf(d.id) })} className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-2 text-left">
                  <span className="min-w-0"><span className="block text-sm text-ink">{g.name}</span><span className="block text-xs text-steel">Counted {fmtQty(draft.values[d.id], g.unit)}, expected {fmtQty(expectedOf(d.id), g.unit)}</span></span>
                  <span className={cn("num shrink-0 text-sm", d.value < 0 ? "text-money" : "text-ink")}>{d.value < 0 ? "−" : "+"}{local(Math.abs(d.value))}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <button type="button" onClick={confirm} className="sticky bottom-4 mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-full bg-accent text-[17px] font-medium text-on-accent shadow-float hover:bg-accent-hover"><Check size={20} aria-hidden /> Confirm count</button>
      </div>
    );
  }

  // ---- Counting --------------------------------------------------------------------------------------------------------
  const id = draft.order[draft.index];
  const g = ingredientById[id];
  const row = rows.get(id);
  if (!row) return <div className="mx-auto max-w-md p-4"><Skeleton className="h-96 w-full" /></div>;
  const expected = expectedOf(id);
  const shown = draft.values[id] ?? (draft.blind ? null : expected);
  const location = locationOf(id);
  const step = stepFor(g.unit);
  const go = (patch: Partial<Draft>) => { setPad(null); save({ ...draft, ...patch }); };
  const next = () => {
    if (shown === null) return;
    const { [id]: _, ...skippedRest } = draft.skipped;
    void _;
    go({ values: { ...draft.values, [id]: shown }, skipped: skippedRest, index: draft.index + 1 });
  };
  const skip = () => go({ skipped: { ...draft.skipped, [id]: true }, index: draft.index + 1 });
  const change = (delta: number) => go({ values: { ...draft.values, [id]: Math.max(0, tidy(Math.round(((shown ?? 0) + delta) / step) * step)) } });
  const rest = draft.order.slice(draft.index).filter((x) => locationOf(x) === location);
  const restRight = () => {
    const values = { ...draft.values };
    for (const x of rest) if (values[x] === undefined) values[x] = expectedOf(x);
    go({ values, index: draft.index + rest.length });
  };
  const padPress = (k: string) => {
    const cur = pad ?? "";
    const nextPad = k === "del" ? cur.slice(0, -1) : k === "." && (cur.includes(".") || g.unit === "each") ? cur : (cur + k).slice(0, 6);
    setPad(nextPad);
    const n = Number(nextPad);
    if (nextPad !== "" && Number.isFinite(n)) save({ ...draft, values: { ...draft.values, [id]: n } });
  };
  const padOpen = pad !== null || (draft.blind && draft.values[id] === undefined);
  const changed = shown !== null && Math.abs(shown - expected) >= 0.05;

  return (
    <div
      className="mx-auto flex h-dvh w-full max-w-md flex-col bg-mist px-4 pb-4 pt-2"
      onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        if (touch.current === null) return;
        const moved = e.changedTouches[0].clientX - touch.current;
        touch.current = null;
        if (moved < -70) skip();
        else if (moved > 70 && draft.index > 0) go({ index: draft.index - 1 });
      }}
    >
      <div className="flex h-11 items-center justify-between gap-2">
        <button type="button" onClick={() => router.push("/stock")} className="inline-flex h-11 items-center gap-2 pr-2 text-sm text-graphite"><Pause size={16} aria-hidden /> Pause</button>
        <p className="num text-sm font-medium text-ink" aria-live="polite">{draft.index + 1} of {total}</p>
        <button type="button" disabled={draft.index === 0} onClick={() => go({ index: draft.index - 1 })} className="inline-flex h-11 items-center gap-1 pl-2 text-sm text-graphite disabled:opacity-40"><ArrowLeft size={16} aria-hidden /> Back</button>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={draft.index}><div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${(draft.index / total) * 100}%` }} /></div>

      <div className="mt-4">
        <p className="text-[13px] text-steel">{locationName(location)}{draft.blind ? ", blind count" : ""}</p>
        <h1 className="mt-1 text-[28px] font-medium leading-tight tracking-[-0.02em] text-ink">{g.name}</h1>
        {/* A blind count hides anything that gives away the expected figure. */}
        {!draft.blind && <p className="mt-1 text-sm text-graphite">Par {fmtQty(row.par, g.unit)}. Last count {fmtQty(row.baselineQty, g.unit)} on {fmtDate(row.baselineDate)}.</p>}
      </div>

      {/* Everything to tap sits at the bottom, within reach of a thumb. */}
      <div className="mt-auto pt-4">
        <p className="mb-2 text-center text-[13px] text-steel">{draft.blind ? (shown === null ? "Enter what you count" : "Your count") : changed ? `Changed, expected ${fmtNum2(expected)}` : "Expected, change it only if it differs"}</p>
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Less" onClick={() => change(-step)} className="flex h-20 w-20 shrink-0 items-center justify-center rounded-[var(--radius-panel)] border border-line bg-paper text-ink shadow-panel active:scale-[0.97]"><Minus size={28} aria-hidden /></button>
          <button type="button" onClick={() => setPad(pad === null ? "" : null)} aria-label="Type the quantity" className={cn("num h-20 min-w-0 flex-1 rounded-[var(--radius-panel)] border bg-paper text-center shadow-panel", changed ? "border-accent" : "border-line")}>
            <span className="block text-[32px] font-medium leading-none text-ink">{shown === null ? "?" : fmtNum2(shown)}</span>
            <span className="mt-1 block text-xs text-steel">{g.unit === "each" ? "units" : g.unit}</span>
          </button>
          <button type="button" aria-label="More" onClick={() => change(step)} className="flex h-20 w-20 shrink-0 items-center justify-center rounded-[var(--radius-panel)] border border-line bg-paper text-ink shadow-panel active:scale-[0.97]"><Plus size={28} aria-hidden /></button>
        </div>
        {padOpen && (
          <div className="mt-3 grid grid-cols-3 gap-2">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "del"].map((k) => (
              <button key={k} type="button" aria-label={k === "del" ? "Delete" : k} onClick={() => padPress(k)} className="flex h-12 items-center justify-center rounded-[var(--radius-control)] border border-line bg-paper text-[20px] text-ink active:scale-[0.97]">{k === "del" ? <Delete size={20} aria-hidden /> : k}</button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-3 space-y-2">
        <button type="button" onClick={next} disabled={shown === null} className="flex h-14 w-full items-center justify-center gap-2 rounded-full bg-accent text-[17px] font-medium text-on-accent transition-colors duration-150 hover:bg-accent-hover disabled:opacity-60">
          <Check size={20} aria-hidden /> {draft.blind || changed ? "Save, next" : "Looks right, next"}
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={skip} className="h-11 rounded-full border border-line bg-paper text-sm text-graphite">Skip (or swipe)</button>
          {draft.blind ? <button type="button" onClick={() => go({ index: total })} className="h-11 rounded-full border border-line bg-paper text-sm text-graphite">Finish now</button>
            : <button type="button" onClick={restRight} className="h-11 rounded-full border border-line bg-paper text-sm text-graphite">Rest of here is right</button>}
        </div>
      </div>
    </div>
  );
}

const fmtNum2 = (n: number) => String(Math.round(n * 10) / 10);
function swap<T>(list: readonly T[], a: number, b: number): T[] {
  const out = [...list];
  [out[a], out[b]] = [out[b], out[a]];
  return out;
}
