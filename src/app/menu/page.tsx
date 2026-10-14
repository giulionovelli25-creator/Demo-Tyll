"use client";
import { useMemo } from "react";
import { MenuTable } from "@/components/overview/menu-table";
import { Badge, PageHeader, Panel } from "@/components/ui";
import { GROUP_NAME, outletById, propertyById } from "@/lib/data/catalog";
import { itemPerformance } from "@/lib/domain/metrics";
import { useCtx, useView } from "@/lib/hooks";
import { fmtRange } from "@/lib/util";

export default function MenuPage() {
  const { sel, money, propertyId } = useView();
  const ctx = useCtx();
  const items = useMemo(() => itemPerformance(ctx, sel), [ctx, sel]);
  const where = sel.outletIds.length === 1 ? outletById[sel.outletIds[0]].name : propertyId ? propertyById[propertyId].name : GROUP_NAME;
  return (
    <div className="space-y-5">
      <PageHeader title="Menu performance" lead={`${where}. Margins use each item's recipe cost on the day it was sold.`}>
        <Badge>{fmtRange(sel.range)}</Badge>
      </PageHeader>
      <Panel flush className="pt-5">
        <MenuTable rows={items} money={money} />
      </Panel>
    </div>
  );
}
