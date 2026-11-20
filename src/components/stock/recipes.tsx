"use client";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { Delta, Note, Panel, TableWrap, Td, Th, cn, rowClass } from "@/components/ui";
import { MENU_ITEMS, ingredientById } from "@/lib/data/catalog";
import { basePriceAt, ingredientCostAt, itemCostAt, recipeBreakdown } from "@/lib/domain/pricing";
import { useCtx } from "@/lib/hooks";
import { DATA_START, DEMO_TODAY, fmtMoney, fmtPct, fmtQty } from "@/lib/util";
import { MenuSyncLine, Modifiers, NewDishes, useMenu } from "./menu-sync";
import { IngredientPrices, useIngredientPrices } from "./ingredient-prices";

const aed = (n: number) => fmtMoney(n, "EUR", { decimals: true });

export function Recipes() {
  const ctx = useCtx();
  const [open, setOpen] = useState<string | null>("burger");
  const { menu } = useMenu();
  const recipes = MENU_ITEMS.filter((m) => m.recipe && !menu?.archived[m.id]);
  // The till's price where the morning sync found a change; otherwise the group list price.
  const priceOf = (id: string) => menu?.prices[id] ?? basePriceAt(id, DEMO_TODAY);
  // Ingredient prices: an override where one is set, else the weighted average of approved supplier invoices.
  const prices = useIngredientPrices();
  const unit = (g: string) => ctx.overrides.find((o) => o.id === g)?.value ?? prices?.prices.find((p) => p.ingredientId === g)?.wac ?? ingredientCostAt(g, DEMO_TODAY, ctx.overrides);

  return (
    <div className="space-y-5">
    {menu && <MenuSyncLine menu={menu} />}
    {menu && <NewDishes menu={menu} />}
    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[1.25fr_1fr]">
      <Panel title="Recipes for the top 20 items" description="Cost per portion at today's ingredient prices, valued at weighted average cost from supplier invoices, against the selling price. Choose a recipe to see what goes into it." flush>
        <TableWrap>
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr><Th>Item</Th><Th align="right">Recipe cost</Th><Th align="right">Selling price</Th><Th align="right">Gross profit</Th><Th align="right">Margin</Th><Th align="right">Cost change</Th></tr></thead>
            <tbody>
              {recipes.map((item) => {
                const cost = (item.recipe ?? []).reduce((t, l) => t + l.qty * unit(l.ingredientId), 0);
                const start = itemCostAt(item.id, DATA_START, ctx.overrides);
                const price = priceOf(item.id);
                const isOpen = open === item.id;
                const lines = recipeBreakdown(item, DEMO_TODAY, ctx.overrides).map((l) => ({ ...l, unitCost: unit(l.ingredientId), cost: l.qty * unit(l.ingredientId) }));
                return [
                  <tr key={item.id} className={cn(rowClass, "cursor-pointer", isOpen && "bg-cloud")} onClick={() => setOpen(isOpen ? null : item.id)}>
                    <Td>
                      <button type="button" aria-expanded={isOpen} className="flex items-center gap-2 text-start text-ink" onClick={(e) => { e.stopPropagation(); setOpen(isOpen ? null : item.id); }}>
                        <ChevronDown size={15} className={cn("shrink-0 text-steel transition-transform duration-200 ease-tyll", isOpen && "rotate-180")} aria-hidden />
                        {item.name}
                      </button>
                    </Td>
                    <Td align="right">{aed(cost)}</Td>
                    <Td align="right">{aed(price)}{menu?.prices[item.id] !== undefined && <span className="block text-[11px] text-steel">from Simphony</span>}</Td>
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
        <Note className="px-6 py-4">Shown in the group price list (euros). Each outlet applies its own price level and each property its own cost level, which Menu performance on the Overview takes into account. The other six menu items use a standard cost until their recipes are built.</Note>
      </Panel>

      <IngredientPrices />
    </div>
    {menu && <Modifiers menu={menu} />}
    </div>
  );
}
