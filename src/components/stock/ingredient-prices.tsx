"use client";
// Ingredient prices on Recipes and costs: the weighted average of approved supplier invoices, the last invoice price and
// the contract price, per ingredient. A manager who sets prices can override one, with the reason; the override shows
// who set it, when and why, and can be taken back so the invoice price applies again.
import { useState } from "react";
import { Badge, Button, Note, Panel, cn, report } from "@/components/ui";
import { ingredientById } from "@/lib/data/catalog";
import { can } from "@/lib/domain/access";
import { useApi, useCtx, useUser, personName } from "@/lib/hooks";
import { usePlanDrafts } from "@/lib/plan-hooks";
import type { IngredientPrice } from "@/lib/server/ingredient-prices";
import { useDemo } from "@/lib/store";
import { fmtDate, fmtMoney } from "@/lib/util";

const eur = (n: number) => fmtMoney(n, "EUR", { decimals: true });
type Out = { prices: IngredientPrice[]; basis: string; windowDays: number; mayEdit: boolean };

export function useIngredientPrices() {
  const version = usePlanDrafts((s) => s.version);
  return useApi<Out>(`/api/ingredient-prices?propertyId=lis&v=${version}`).data ?? undefined;
}

export function IngredientPrices() {
  const data = useIngredientPrices();
  const ctx = useCtx();
  const user = useUser()!;
  const log = useDemo((s) => s.priceLog);
  const mayEdit = can(user, "stock.editPrices");
  const [editing, setEditing] = useState<string | null>(null);
  const [price, setPrice] = useState("");
  const [reason, setReason] = useState("");
  const override = useDemo((s) => s.overrideIngredientPrice);
  const clear = useDemo((s) => s.clearIngredientPrice);
  const unit = (g: string) => (ingredientById[g].unit === "each" ? "unit" : ingredientById[g].unit === "l" ? "L" : ingredientById[g].unit);
  return (
    <Panel title="Ingredient prices" description={`${data?.basis ?? "Valued at weighted average cost from supplier invoices"}: approved invoices of the last ${data?.windowDays ?? 90} days. ${mayEdit ? "A different price can be set by hand, with the reason." : "Your role can view prices but not change them."}`} flush>
      <div className="scroll-thin max-h-[760px] overflow-y-auto">
        <ul className="divide-y divide-hair">
          {(data?.prices ?? []).map((p) => {
            const g = ingredientById[p.ingredientId];
            const ov = ctx.overrides.find((o) => o.id === p.ingredientId);
            const entry = ov ? log.find((e) => e.ingredientId === p.ingredientId && !e.cleared) : undefined;
            const open = editing === p.ingredientId;
            return (
              <li key={p.ingredientId} className="px-5 py-3 text-sm sm:px-6">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className="text-ink">{g.name}</span> <span className="text-xs text-steel">per {unit(p.ingredientId)}</span>
                    <dl className="mt-1 grid grid-cols-3 gap-2 text-[12.5px]">
                      <div><dt className="text-steel">Average, invoices</dt><dd className="num text-ink">{p.wac !== null ? eur(p.wac) : "No invoice"}</dd></div>
                      <div><dt className="text-steel">Last invoice</dt><dd className="num text-ink">{p.last ? eur(p.last.price) : "None"}</dd>{p.last && <dd className="text-[11px] text-steel">{fmtDate(p.last.date)}</dd>}</div>
                      <div><dt className="text-steel">Contract</dt><dd className={cn("num", p.last && p.contract && p.last.price > p.contract.price + 0.005 ? "font-medium text-ink" : "text-ink")}>{p.contract ? eur(p.contract.price) : "None"}</dd></div>
                    </dl>
                  </div>
                  <div className="shrink-0 text-end">
                    <p className="num text-[15px] font-medium text-ink">{eur(ov?.value ?? p.wac ?? p.effective)}</p>
                    <p className="text-[11px] text-steel">{ov ? "Override" : p.wac !== null ? "Used in costs" : "List price, no invoice"}</p>
                  </div>
                </div>
                {ov && (
                  <p className="mt-2 rounded-xl bg-cloud px-3 py-2 text-[12.5px] text-graphite">
                    <Badge tone="ink" className="me-2 !py-0">Override</Badge>
                    {entry ? `${personName(entry.by)}, ${fmtDate(entry.at.slice(0, 10))}: ${entry.reason ?? "no reason given"}` : "Set by hand."}
                    {mayEdit && <button type="button" className="ms-2 font-medium text-accent-ink underline-offset-4 hover:underline" onClick={() => report(clear(p.ingredientId), `${g.name}: the supplier invoice price applies again.`)}>Use the invoice price</button>}
                  </p>
                )}
                {mayEdit && !open && <button type="button" className="mt-1 text-[12.5px] font-medium text-accent-ink underline-offset-4 hover:underline" onClick={() => { setEditing(p.ingredientId); setPrice(String(ov?.value ?? p.wac ?? p.effective)); setReason(""); }}>Set a different price</button>}
                {open && (
                  <div className="mt-2 space-y-2 rounded-xl border border-line p-3">
                    <label className="block text-[12.5px] text-graphite">Price per {unit(p.ingredientId)} (€)
                      <input type="number" min="0.01" step="0.01" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className="num mt-1 block h-9 w-32 rounded-lg border border-line px-2 text-end" />
                    </label>
                    <label className="block text-[12.5px] text-graphite">Why does it differ from the invoices?
                      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: new price from Monday, invoice not in yet" className="mt-1 block h-9 w-full rounded-lg border border-line px-3" />
                    </label>
                    <div className="flex gap-2">
                      <Button size="sm" variant="primary" disabled={!(Number(price) > 0) || reason.trim().length < 3} onClick={() => { if (report(override(p.ingredientId, Number(price), reason), `${g.name} is now ${eur(Number(price))}, an override. Recipe costs and margins are updated.`)) setEditing(null); }}>Save the override</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <Note className="px-6 py-4">Only invoices approved or recorded as an expense count; one still to check does not. Every override is kept with the person, the time and the reason.</Note>
    </Panel>
  );
}
