"use client";
import { useState } from "react";
import { Badge, Button, Field, Panel, toast } from "@/components/ui";
import { ingredientById } from "@/lib/data/catalog";
import { can } from "@/lib/domain/access";
import { api } from "@/lib/api";
import { personName, useUser } from "@/lib/hooks";
import { useShared } from "@/lib/shared-stock";
import { fmtQty } from "@/lib/util";

/** Counts submitted by staff from their phones. They change stock only once a manager accepts them. */
export function CountReview({ propertyId }: { propertyId: string }) {
  const user = useUser()!;
  const counts = useShared((s) => s.counts).filter((c) => c.propertyId === propertyId && c.status === "submitted");
  const [why, setWhy] = useState("");
  if (!can(user, "stock.review") || counts.length === 0) return null;
  const decide = (id: string, decision: "accept" | "reject") =>
    api<{ count: (typeof counts)[number] }>(`/api/stock/counts/${id}`, { method: "POST", body: { decision, note: why } })
      .then((r) => { useShared.setState((s) => ({ counts: s.counts.map((c) => (c.id === id ? r.count : c)) })); setWhy(""); toast.done(decision === "accept" ? "Count accepted. Stock now uses it." : "Count rejected. Stock is unchanged."); })
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Could not save."));
  return (
    <Panel title={`Counts to review (${counts.length})`} description="Submitted by staff. The original figure and the count are both kept, whatever you decide.">
      <ul className="divide-y divide-hair">
        {counts.map((c) => {
          const g = ingredientById[c.ingredientId];
          const diff = c.counted - c.expected;
          return (
            <li key={c.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
              <span className="min-w-[200px] flex-1"><span className="text-ink">{g.name}: counted {fmtQty(c.counted, g.unit)}, expected {fmtQty(c.expected, g.unit)}</span><span className="block text-xs text-steel">{personName(c.byUser)} · {c.at.slice(0, 16).replace("T", " ")}{c.note ? ` · ${c.note}` : ""}</span></span>
              <Badge tone={Math.abs(diff) > 0.001 ? "warn" : "pos"} className="!py-0">{diff > 0 ? "+" : ""}{fmtQty(diff, g.unit)}</Badge>
              <Button size="sm" variant="primary" disabled={c.byUser === user.id} onClick={() => decide(c.id, "accept")}>Accept</Button>
              <Button size="sm" variant="ghost" disabled={c.byUser === user.id} onClick={() => decide(c.id, "reject")}>Reject</Button>
            </li>
          );
        })}
      </ul>
      <Field className="mt-3" label="Reason, needed to reject" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="For example: recount needed, part of the rack was missed" />
    </Panel>
  );
}
