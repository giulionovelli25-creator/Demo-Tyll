"use client";
// The morning menu sync from Simphony on Recipes and costs: what changed on the till, new dishes waiting for a recipe
// (costed at a labelled standard cost until the chef confirms one, starting from a suggestion), and the modifier rules.
import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { Badge, Button, Note, Panel, Select, cn, toast } from "@/components/ui";
import { INGREDIENTS, ingredientById } from "@/lib/data/catalog";
import { STANDARD_COST_SHARE } from "@/lib/domain/menu-sync";
import { ingredientCostAt } from "@/lib/domain/pricing";
import { api, readShared } from "@/lib/api";
import { usePlanDrafts } from "@/lib/plan-hooks";
import type { MenuOut } from "@/lib/server/menu-sync";
import type { RecipeLine } from "@/lib/types";
import { DEMO_TODAY, fmtMoney, fmtPct, fmtQty } from "@/lib/util";

const eur = (n: number) => fmtMoney(n, "EUR", { decimals: true });

/** The synced menu, read again after any change. */
export function useMenu() {
  const version = usePlanDrafts((s) => s.version);
  const [state, setState] = useState<{ v: number; menu?: MenuOut; error?: string } | null>(null);
  useEffect(() => {
    let live = true;
    readShared<{ menu: MenuOut }>(`/api/menu?v=${version}`).then((r) => live && setState({ v: version, menu: r.menu })).catch((e: unknown) => live && setState({ v: version, error: e instanceof Error ? e.message : "Could not load." }));
    return () => { live = false; };
  }, [version]);
  return { menu: state?.menu, error: state?.error };
}

/** "Menu synced from Simphony at 06:00: 2 new dishes, 1 price change, 1 dish removed", with what each change was. */
export function MenuSyncLine({ menu }: { menu: MenuOut }) {
  if (!menu.sync) return null;
  const c = menu.changes;
  const waiting = menu.newDishes.filter((d) => d.status === "needs_recipe").length;
  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-medium text-ink">{menu.sync.label}</p>
          <ul className="mt-1 space-y-0.5 text-[13px] text-graphite">
            {c.addedNames.length > 0 && <li>New: {c.addedNames.join(", ")}.{waiting > 0 && <> <a href="#new-dishes" className="font-medium text-accent-ink underline-offset-4 hover:underline">{waiting === 1 ? "1 needs a recipe" : `${waiting} need a recipe`}</a></>}</li>}
            {c.priceChanged.map((p) => <li key={p.itemId}>{p.name}: price {eur(p.from)} to {eur(p.to)}. Margins below use the new price.</li>)}
            {c.removed.map((r) => <li key={r.itemId}>{r.name}: no longer on the till, archived.</li>)}
          </ul>
        </div>
        <Badge tone="accent">Demo connection</Badge>
      </div>
    </Panel>
  );
}

/** New dishes from the till: standard cost until confirmed, and the suggested recipe to check and confirm on one screen. */
export function NewDishes({ menu }: { menu: MenuOut }) {
  if (!menu.newDishes.length) return null;
  return (
    <Panel title="New dishes from Simphony" description="Each is costed at a standard share of its price until its recipe is confirmed. Check the suggested recipe, change what is different, and confirm." >
      <div id="new-dishes" className="scroll-mt-24 space-y-4">
        {menu.newDishes.map((d) => <NewDish key={d.posId} d={d} mayConfirm={menu.mayConfirm} />)}
      </div>
    </Panel>
  );
}

function NewDish({ d, mayConfirm }: { d: MenuOut["newDishes"][number]; mayConfirm: boolean }) {
  const bump = usePlanDrafts((s) => s.bump);
  const [lines, setLines] = useState<RecipeLine[]>(d.confirmed?.recipe ?? d.suggestion.lines);
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);
  const cost = lines.reduce((s, l) => s + l.qty * ingredientCostAt(l.ingredientId, DEMO_TODAY), 0);
  const confirmed = d.status === "confirmed";
  const confirm = async () => {
    setBusy(true);
    try {
      await api("/api/menu", { method: "POST", body: { action: "confirm", posId: d.posId, lines } });
      toast.done(`${d.name}: recipe confirmed. It is now costed from the recipe.`);
      bump();
    } catch (e) { toast.error(e instanceof Error ? e.message : "The recipe could not be saved."); }
    finally { setBusy(false); }
  };
  const share = STANDARD_COST_SHARE[d.dept];
  return (
    <section className="rounded-[var(--radius-control)] border border-line p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-medium text-ink">{d.name}</h3>
          <p className="text-[13px] text-graphite">{d.category}, {eur(d.price)} on the till</p>
        </div>
        {confirmed ? <Badge tone="pos">Recipe confirmed</Badge> : <Badge tone="warn">Needs a recipe</Badge>}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <div><dt className="text-xs text-steel">{confirmed ? "Recipe cost" : "Standard cost, for now"}</dt><dd className="num text-ink">{eur(confirmed ? d.recipeCost ?? cost : d.standardCost)}</dd>{!confirmed && <dd className="text-xs text-steel">{fmtPct(share, 0)} of the price until the recipe is confirmed</dd>}</div>
        <div><dt className="text-xs text-steel">{confirmed ? "Margin" : "Recipe cost, as below"}</dt><dd className="num text-ink">{confirmed ? fmtPct((d.price - (d.recipeCost ?? cost)) / d.price) : eur(cost)}</dd></div>
      </dl>
      {!confirmed && (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge tone="accent">Suggested, please check</Badge>
            <span className="text-[13px] text-graphite">{d.suggestion.why}{d.suggestion.swapped && ` ${ingredientById[d.suggestion.swapped.to].name} in place of ${ingredientById[d.suggestion.swapped.from].name}.`} Not AI: built by a fixed rule.</span>
          </div>
          <ul className="mt-3 divide-y divide-hair rounded-xl border border-hair">
            {lines.map((l, i) => {
              const g = ingredientById[l.ingredientId];
              return (
                <li key={l.ingredientId} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 text-ink">{g.name}</span>
                  {mayConfirm ? <input aria-label={`${g.name} per portion`} type="number" min="0.001" step="0.005" value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) } : x)))} className="num h-9 w-24 rounded-lg border border-line px-2 text-end" /> : <span className="num">{l.qty}</span>}
                  <span className="w-10 text-xs text-steel">{g.unit === "each" ? "each" : g.unit === "l" ? "L" : g.unit}</span>
                  <span className="num w-16 text-end text-[13px] text-graphite">{eur(l.qty * ingredientCostAt(l.ingredientId, DEMO_TODAY))}</span>
                  {mayConfirm && <button type="button" aria-label={`Remove ${g.name}`} onClick={() => setLines(lines.filter((_, j) => j !== i))} className="rounded-full p-1 text-steel hover:bg-mist hover:text-ink"><X size={15} /></button>}
                </li>
              );
            })}
            {!lines.length && <li className="px-3 py-2 text-sm text-steel">No ingredients yet.</li>}
          </ul>
          {mayConfirm && (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <Select label="Add an ingredient" value={adding} onChange={(e) => setAdding(e.target.value)} className="min-w-[220px]">
                <option value="">Choose</option>
                {INGREDIENTS.filter((g) => !["glassware", "supplies"].includes(g.dept) && !lines.some((l) => l.ingredientId === g.id)).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </Select>
              <Button disabled={!adding} onClick={() => { setLines([...lines, { ingredientId: adding, qty: ingredientById[adding].unit === "each" ? 1 : 0.05 }]); setAdding(""); }}><Plus size={15} aria-hidden /> Add</Button>
              <Button variant="primary" className="ms-auto" disabled={busy || !lines.length || lines.some((l) => !(l.qty > 0))} onClick={confirm}>Confirm recipe</Button>
            </div>
          )}
          {!mayConfirm && <p className="mt-3 text-[13px] text-steel">The chef confirms the recipe.</p>}
        </>
      )}
      {confirmed && d.confirmed && (
        <p className="mt-3 text-[13px] text-graphite">{d.confirmed.recipe.map((l) => `${ingredientById[l.ingredientId].name} ${fmtQty(l.qty, ingredientById[l.ingredientId].unit)}`).join(", ")}.</p>
      )}
    </section>
  );
}

/** Modifier rules, and what last night's modifiers from the till did to the recipe. */
export function Modifiers({ menu }: { menu: MenuOut }) {
  return (
    <Panel title="Modifiers" description="What a modifier rung on the till does to the recipe, so stock use follows what was served.">
      <ul className="space-y-1 text-sm">
        {menu.modifiers.map((m) => <li key={m.id}><span className="font-medium text-ink">{m.name}</span><span className="text-graphite">: {m.effect.toLowerCase()} ({m.ingredients.map((g) => ingredientById[g].name).join(", ")})</span></li>)}
      </ul>
      {menu.examples.length > 0 && (
        <>
          <h3 className="mt-4 text-[13px] font-medium text-ink">Last night at Mercado, from Simphony</h3>
          <ul className="mt-1 space-y-1 text-[13px]">
            {menu.examples.map((e, i) => (
              <li key={i} className={cn("rounded-xl bg-cloud px-3 py-2")}>
                <span className="text-ink">{e.item} with {e.modifier}</span>
                <span className="block text-graphite">{e.used > 0 ? `${e.ingredient}: ${fmtQty(e.used, e.unit)} used instead of the recipe's ${fmtQty(e.standard, e.unit)}.` : `${e.ingredient}: none used, instead of the recipe's ${fmtQty(e.standard, e.unit)}.`}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <Note className="mt-3">Read from recorded Simphony checks (demo connection). The simulated sales behind the rest of the demo carry no modifiers.</Note>
    </Panel>
  );
}
