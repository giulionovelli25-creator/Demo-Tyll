"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, report } from "@/components/ui";
import { outletById, storeOwner } from "@/lib/data/catalog";
import { allowedOutlets, can } from "@/lib/domain/access";
import { useUser } from "@/lib/hooks";
import { useDemo } from "@/lib/store";
import type { CountRecord } from "@/lib/types";

/** Outlets a shortfall can be charged to, largest share first: the owning outlet for its own store, otherwise those that used the item. */
export function caseOutlets(count: CountRecord, mine: string[]): { id: string; share: number }[] {
  const owner = storeOwner(count.propertyId, count.ingredientId);
  if (owner) return mine.includes(owner) ? [{ id: owner, share: 1 }] : [];
  const shares = Object.entries(count.allocation ?? {}).filter(([id, s]) => s > 0 && mine.includes(id));
  if (shares.length === 0 && Object.keys(count.allocation ?? {}).length === 0) {
    return mine.filter((id) => outletById[id]?.propertyId === count.propertyId).map((id) => ({ id, share: 1 }));
  }
  return shares.map(([id, share]) => ({ id, share })).sort((a, b) => b.share - a.share);
}

/** Opens, or links to, the investigation into one count's shortfall. Renders nothing for roles that cannot open cases. */
export function OpenStockCase({ count }: { count: CountRecord }) {
  const router = useRouter();
  const user = useUser()!;
  const open = useDemo((s) => s.openStockCase);
  const existing = useDemo((s) => s.stockCases).filter((e) => e.countId === count.id);
  const options = caseOutlets(count, allowedOutlets(user)).filter((o) => !existing.some((e) => e.outletId === o.id));
  const [outlet, setOutlet] = useState("");
  if (!can(user, "investigation.assign")) return null;

  const chosen = outlet || options[0]?.id;
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-2">
      {existing.map((e) => (
        <Link key={e.id} href={`/investigations/${e.id}`} className="text-[13px] underline underline-offset-4">
          Case{existing.length > 1 ? `, ${outletById[e.outletId!].name}` : ""}
        </Link>
      ))}
      {options.length > 1 && (
        <select aria-label="Outlet to investigate" value={chosen} onChange={(e) => setOutlet(e.target.value)} className="h-8 rounded-full border border-line bg-paper px-2.5 text-[13px] hover:border-fog">
          {options.map((o) => <option key={o.id} value={o.id}>{outletById[o.id].name}, {Math.round(o.share * 100)}%</option>)}
        </select>
      )}
      {chosen && (
        <Button
          size="sm"
          onClick={(ev) => {
            ev.stopPropagation();
            const r = open(count.id, chosen);
            if (report(r, "Case opened. It is on the Money Back List.") && r.ok && r.id) router.push(`/investigations/${r.id}`);
          }}
        >
          Open a case
        </Button>
      )}
    </span>
  );
}
