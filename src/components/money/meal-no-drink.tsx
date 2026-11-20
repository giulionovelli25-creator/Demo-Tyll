"use client";
// Meal with no drink: food bills for two or more guests with no drink billed, last 7 days. A possible drink sale, not a
// loss. The waiter is never named here; coaching by person stays on Drinks per guest by waiter.
import Link from "next/link";
import { Badge, EmptyState, Note, Panel, TableWrap, Td, Th, rowClass, textLink } from "@/components/ui";
import { outletById } from "@/lib/data/catalog";
import { can } from "@/lib/domain/access";
import { useApi, useView } from "@/lib/hooks";
import type { MealNoDrinkOut } from "@/lib/server/meal-no-drink";
import { fmtDate, fmtMoney } from "@/lib/util";

export const useMealNoDrink = (on = true) => useApi<MealNoDrinkOut>(on ? "/api/money/meal-no-drink" : null).data ?? undefined;

export function MealNoDrink() {
  const data = useMealNoDrink();
  const { user } = useView();
  const money = (n: number) => fmtMoney(n, "EUR");
  if (!data) return null;
  return (
    <Panel title="Meal with no drink" description={`Food bills for 2 or more guests with no drink billed, ${fmtDate(data.from)} to ${fmtDate(data.to)}. A chance to offer a drink, not a loss: most are guests who did not want one.`} action={<Badge tone="accent">Upsell opportunity</Badge>} flush>
      {data.cases.length === 0 ? <div className="p-6"><EmptyState title="Every table for two or more had a drink">Nothing to follow up this week.</EmptyState></div> : (
        <TableWrap>
          <table className="w-full min-w-[760px] text-table">
            <thead><tr><Th>When</Th><Th>Outlet and table</Th><Th align="right">Guests</Th><Th>Food billed</Th><Th align="right">Food</Th><Th align="right">Possible drink sale</Th></tr></thead>
            <tbody>
              {data.cases.map((c) => (
                <tr key={c.orderId} className={rowClass}>
                  <Td className="whitespace-nowrap">{fmtDate(c.date, true)}<span className="block text-xs text-steel">{c.time}</span></Td>
                  <Td>{outletById[c.outletId]?.name}<span className="block text-xs text-steel">{/^table/i.test(c.table) ? c.table : `Table ${c.table}`}</span></Td>
                  <Td align="right">{c.guests}</Td>
                  <Td className="max-w-[260px] text-graphite">{c.food.join(", ")}</Td>
                  <Td align="right">{money(c.foodValue)}</Td>
                  <Td align="right" className="font-medium text-ink">{money(c.possible)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      <Note className="px-6 py-4">
        {data.tables} of {data.foodTables} food tables for two or more had no drink, about {money(data.total)} of drink sales possible (an estimate: guests at that outlet and shift usually spend this on drinks). No waiter is named here.
        {can(user, "waiters.view") && <> <Link prefetch={false} href="/money?tab=waiters" className={textLink}>Drinks per guest by waiter</Link></>}
      </Note>
    </Panel>
  );
}
