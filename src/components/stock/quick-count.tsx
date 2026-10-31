"use client";
import { Minus, Undo2 } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Panel, toast } from "@/components/ui";
import { api } from "@/lib/api";
import { ingredientById, outletById } from "@/lib/data/catalog";
import { allowedOutlets } from "@/lib/domain/access";
import { useServerStock } from "@/lib/hooks";
import type { User } from "@/lib/types";
import { fmtQty } from "@/lib/util";

const one = (unit: string) => (unit === "each" ? "1" : `1 ${unit}`);

/**
 * The kitchen's stock at a glance: estimated on hand for the outlet's own items, with one tap to log a unit of waste.
 * Each tap is a shared waste record; Undo adds a correction to zero and keeps the original.
 */
export function QuickCount({ user, propertyId, onFullCount }: { user: User; propertyId: string; onFullCount: () => void }) {
  const outletId = allowedOutlets(user).find((id) => outletById[id].propertyId === propertyId);
  const { data, loading } = useServerStock(propertyId);
  const [logged, setLogged] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  if (!outletId) return null;

  const rows = (data?.rows ?? []).filter((r) => r.store === outletId || (r.store === null && (r.allocation[outletId] ?? 0) > 0)).sort((a, b) => (a.daysCover ?? 99) - (b.daysCover ?? 99));
  const shown = all ? rows : rows.slice(0, 8);

  const minus = async (ingredientId: string) => {
    setBusy(ingredientId);
    try {
      const r = await api<{ entry: { id: string } }>("/api/stock/waste", { method: "POST", body: { outletId, ingredientId, qty: 1, reason: "waste", clientId: `quick-${Date.now()}` } });
      setLogged((m) => ({ ...m, [ingredientId]: [...(m[ingredientId] ?? []), r.entry.id] }));
      toast.done(`Logged ${one(ingredientById[ingredientId].unit)} of ${ingredientById[ingredientId].name} as waste.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That waste entry was not saved.");
    } finally {
      setBusy(null);
    }
  };
  const undo = async (ingredientId: string) => {
    const id = logged[ingredientId]?.at(-1);
    if (!id) return;
    setBusy(ingredientId);
    try {
      await api(`/api/stock/waste/${id}`, { method: "POST", body: { qty: 0, reason: "Tapped by mistake", clientId: `undo-${id}` } });
      setLogged((m) => ({ ...m, [ingredientId]: m[ingredientId].slice(0, -1) }));
      toast.done("Entry cancelled. The original stays in the history with its correction.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The entry could not be cancelled.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel
      title={`Stock at ${outletById[outletId].name}`}
      description="Items this kitchen uses. Estimated on hand: last count plus deliveries, minus sales and waste. Tap −1 when something is wasted."
      action={<Button size="sm" onClick={onFullCount}>Start a full count</Button>}
      flush
    >
      {!data ? (
        <p className="px-5 pb-5 text-sm text-steel">{loading ? "Loading stock…" : "Stock is not available."}</p>
      ) : (
        <>
          <ul>
            {shown.map((r) => {
              const g = ingredientById[r.ingredientId];
              const mine = logged[r.ingredientId]?.length ?? 0;
              const left = r.estimated - mine;
              const low = r.daysCover !== null && r.daysCover < 2;
              return (
                <li key={r.ingredientId} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-hair px-4 py-3 sm:px-5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">{g.name}</span>
                    <span className="block text-xs text-steel">
                      <span className="num">{fmtQty(Math.max(0, left), g.unit)}</span> estimated{r.store === null ? " in the hotel store" : ""}{mine > 0 && `, ${mine} logged now`}
                    </span>
                  </span>
                  {low && <Badge tone="warn">Low</Badge>}
                  <span className="flex items-center gap-1.5">
                    {mine > 0 && (
                      <button type="button" onClick={() => undo(r.ingredientId)} disabled={busy === r.ingredientId} className="flex h-10 items-center gap-1 rounded-full px-3 text-[13px] text-graphite hover:bg-mist disabled:opacity-50">
                        <Undo2 size={14} aria-hidden /> Undo
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => minus(r.ingredientId)}
                      disabled={busy === r.ingredientId || left < 1}
                      aria-label={`Log ${one(g.unit)} of ${g.name} as waste`}
                      className="flex h-10 min-w-[64px] items-center justify-center gap-1 rounded-full border border-line px-3 text-sm text-ink transition-colors duration-300 ease-tyll hover:bg-mist disabled:opacity-40"
                    >
                      <Minus size={14} aria-hidden /> 1
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
          {rows.length > 8 && (
            <div className="border-t border-hair px-5 py-3">
              <button type="button" onClick={() => setAll((v) => !v)} className="text-sm text-ink underline-offset-4 hover:underline">{all ? "Show fewer" : `Show all ${rows.length} items`}</button>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
