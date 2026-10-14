"use client";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Delta, Note, Panel, TableWrap, Td, Th, cn, report, rowClass } from "@/components/ui";
import { INGREDIENTS, MENU_ITEMS, ingredientById, supplierById } from "@/lib/data/catalog";
import { can } from "@/lib/domain/access";
import { basePriceAt, ingredientCostAt, itemCostAt, recipeBreakdown } from "@/lib/domain/pricing";
import { useCtx, useUser } from "@/lib/hooks";
import { useDemo } from "@/lib/store";
import { DATA_START, DEMO_TODAY, fmtMoney, fmtPct, fmtQty } from "@/lib/util";

const aed = (n: number) => fmtMoney(n, "AED", { decimals: true });

export function Recipes() {
  const ctx = useCtx();
  const user = useUser()!;
  const setPrice = useDemo((s) => s.setIngredientPrice);
  const [open, setOpen] = useState<string | null>("burger");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const mayEdit = can(user, "stock.editPrices");
  const recipes = MENU_ITEMS.filter((m) => m.recipe);
  const ingredients = INGREDIENTS.filter((g) => g.dept !== "glassware");

  return (
    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[1.25fr_1fr]">
      <Panel title="Recipes for the top 20 items" description="Cost per portion at today's ingredient prices, against the group list price. Choose a recipe to see what goes into it." flush>
        <TableWrap>
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr><Th>Item</Th><Th align="right">Recipe cost</Th><Th align="right">Selling price</Th><Th align="right">Gross profit</Th><Th align="right">Margin</Th><Th align="right">Cost change</Th></tr></thead>
            <tbody>
              {recipes.map((item) => {
                const cost = itemCostAt(item.id, DEMO_TODAY, ctx.overrides);
                const start = itemCostAt(item.id, DATA_START, ctx.overrides);
                const price = basePriceAt(item.id, DEMO_TODAY);
                const isOpen = open === item.id;
                const lines = recipeBreakdown(item, DEMO_TODAY, ctx.overrides);
                return [
                  <tr key={item.id} className={cn(rowClass, "cursor-pointer", isOpen && "bg-cloud")} onClick={() => setOpen(isOpen ? null : item.id)}>
                    <Td>
                      <button type="button" aria-expanded={isOpen} className="flex items-center gap-2 text-left text-ink" onClick={(e) => { e.stopPropagation(); setOpen(isOpen ? null : item.id); }}>
                        <ChevronDown size={15} className={cn("shrink-0 text-steel transition-transform duration-300 ease-tyll", isOpen && "rotate-180")} aria-hidden />
                        {item.name}
                      </button>
                    </Td>
                    <Td align="right">{aed(cost)}</Td>
                    <Td align="right">{aed(price)}</Td>
                    <Td align="right">{aed(price - cost)}</Td>
                    <Td align="right" className="text-ink">{fmtPct((price - cost) / price)}</Td>
                    <Td align="right">{Math.abs(cost / start - 1) < 0.0005 ? <span className="text-xs text-fog">none</span> : <Delta value={cost / start - 1} goodWhen="down" />}</Td>
                  </tr>,
                  isOpen && (
                    <tr key={`${item.id}-detail`} className="border-t border-hair bg-cloud">
                      <td colSpan={6} className="px-6 pb-5 pt-1">
                        <ul className="grid gap-x-8 gap-y-1.5 sm:grid-cols-2">
                          {lines.map((l) => {
                            const g = ingredientById[l.ingredientId];
                            return (
                              <li key={l.ingredientId} className="num flex justify-between gap-3 border-b border-hair py-1.5 text-[13px]">
                                <span className="text-graphite">{g.name}, {fmtQty(l.qty, g.unit)} <span className="text-steel">at {aed(l.unitCost)} per {g.unit === "each" ? "unit" : g.unit}</span></span>
                                <span className="text-ink">{aed(l.cost)}</span>
                              </li>
                            );
                          })}
                        </ul>
                        <Link href={`/menu/${item.id}`} className="mt-3 inline-block text-[13px] text-steel underline underline-offset-4 hover:text-ink">See sales, margin by outlet and orders</Link>
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        </TableWrap>
        <Note className="px-6 py-4">Shown in the group price list (AED). Each outlet applies its own price level and each property its own cost level, which Menu performance on the Overview takes into account. The other six menu items use a standard cost until their recipes are built.</Note>
      </Panel>

      <Panel title="Ingredient prices" description={mayEdit ? "Change a price and every recipe cost, margin and forecast that uses it updates from today." : "Your role can view prices but not change them."} flush>
        <div className="scroll-thin max-h-[760px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-paper"><tr><Th>Ingredient</Th><Th align="right">Price per unit (AED)</Th>{mayEdit && <Th> </Th>}</tr></thead>
            <tbody>
              {ingredients.map((g) => {
                const current = ingredientCostAt(g.id, DEMO_TODAY, ctx.overrides);
                const changed = ctx.overrides.some((o) => o.id === g.id);
                const draft = drafts[g.id];
                const dirty = draft !== undefined && draft !== "" && Number(draft) !== current;
                const used = recipes.filter((m) => m.recipe!.some((l) => l.ingredientId === g.id)).length;
                return (
                  <tr key={g.id} className={rowClass}>
                    <Td>
                      <span className="text-ink">{g.name}</span>{changed && <Badge tone="ink" className="ml-2 !py-0">changed today</Badge>}
                      <span className="block text-xs text-steel">{supplierById[g.supplierId].name} · per {g.unit === "each" ? "unit" : g.unit} · in {used} recipe{used === 1 ? "" : "s"}</span>
                    </Td>
                    <Td align="right">
                      {mayEdit ? (
                        <input aria-label={`Price of ${g.name}`} type="number" min="0.01" step="0.01" inputMode="decimal" value={draft ?? current} onChange={(e) => setDrafts((d) => ({ ...d, [g.id]: e.target.value }))} className="num h-9 w-24 rounded-lg border border-line px-2 text-right hover:border-fog" />
                      ) : aed(current)}
                    </Td>
                    {mayEdit && (
                      <Td align="right">
                        <Button size="sm" variant={dirty ? "primary" : "secondary"} disabled={!dirty} onClick={() => { if (report(setPrice(g.id, Number(draft)), `${g.name} is now AED ${Number(draft).toFixed(2)}. Recipe costs and margins are updated.`)) setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== g.id))); }}>Save</Button>
                      </Td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
