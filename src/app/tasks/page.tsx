"use client";
import Link from "next/link";
import { ArrowRight, ClipboardCheck, Trash2, UtensilsCrossed } from "lucide-react";
import { Badge, Button, PageHeader, Panel, toast } from "@/components/ui";
import { toHm, useMyAssignments } from "@/lib/ops-hooks";
import { ingredientById, itemById, outletById, propertyById } from "@/lib/data/catalog";
import { allowedOutlets } from "@/lib/domain/access";
import { ACTIVE_STATUSES } from "@/lib/domain/operations";
import { useCtx, useUser } from "@/lib/hooks";
import { REASON_LABEL } from "@/lib/labels";
import { useDemo } from "@/lib/store";
import { DEMO_TODAY, addDays, fmtDate, fmtQty } from "@/lib/util";
import { Checklist } from "@/components/forecast/prep";
import { useMutate, usePrepPlans } from "@/lib/plan-hooks";

/** Help this person has been lent to give: where, when and doing what. They tick it off afterwards. */
function MyAssignments() {
  const { data } = useMyAssignments();
  const mutate = useMutate();
  const list = (data?.assignments ?? []).filter((a) => a.status === "confirmed");
  if (!list.length) return null;
  return (
    <Panel title="Where you are helping" description="Confirmed by your manager. Your usual shift is unchanged.">
      <ul className="divide-y divide-hair rounded-2xl border border-line">
        {list.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <span><span className="text-[15px] text-ink">{a.skillLabel} for {a.for}</span><span className="block text-sm text-steel">{fmtDate(a.date, true)}, {toHm(a.start)} to {toHm(a.end)}{a.where && a.where !== a.for ? ` · ${a.where}` : ""}</span></span>
            {a.done ? <Badge tone="pos">Done</Badge> : <Button size="sm" onClick={async () => { const r = await mutate("/api/me/assignments", { id: a.id }); if (!r.ok) toast.error(r.error); else toast.done("Marked as done."); }}>Mark as done</Button>}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** Tomorrow's prep plan for this kitchen, as a checklist. Staff tick off their own jobs; the plan itself is the chef's. */
function PrepForShift({ outletId }: { outletId: string }) {
  const { data } = usePrepPlans();
  const plans = (data?.plans ?? []).filter((p) => p.outletId === outletId && p.period.to >= addDays(DEMO_TODAY, 1)).sort((a, b) => (a.period.from < b.period.from ? -1 : 1));
  const plan = plans[0];
  if (!plan) return null;
  return <Checklist plan={plan} assignees={data?.assignees[outletId] ?? []} />;
}

export default function TasksPage() {
  const user = useUser()!;
  const ctx = useCtx();
  const wasteLogs = useDemo((s) => s.wasteLogs);
  const counts = useDemo((s) => s.counts);
  const flowStatus = useDemo((s) => s.flowStatus);
  const outletId = allowedOutlets(user)[0];
  const outlet = outletById[outletId];
  const me = user.staffId ?? user.id;
  const myWaste = wasteLogs.filter((w) => w.by === me).slice().reverse();
  const myCounts = counts.filter((c) => c.by === me && c.date === DEMO_TODAY);
  const open = ctx.data.liveOrders.filter((o) => o.outletId === outletId && ACTIVE_STATUSES.includes(flowStatus[o.id] ?? o.status)).length;

  const tasks = [
    { href: "/stock?tab=log", icon: Trash2, title: "Log waste", detail: "Three taps: the item, how much, and why.", status: myWaste.length ? `${myWaste.length} logged this session` : "Nothing logged yet" },
    { href: "/stock?tab=counts", icon: ClipboardCheck, title: "Today's spot checks", detail: "Count five priority items.", status: `${Math.min(5, myCounts.length)} of 5 counted` },
    { href: "/flow", icon: UtensilsCrossed, title: "Order board", detail: "Move tickets along as they are prepared and served.", status: `${open} tickets in progress` },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title={`Good evening, ${user.name.split(" ")[0]}`} lead={`${outlet.name}, ${propertyById[outlet.propertyId].name}. ${fmtDate(DEMO_TODAY, true)}. Here is what needs doing on this shift.`} />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {tasks.map(({ href, icon: Icon, title, detail, status }) => (
          <Link key={href} href={href} className="group flex min-h-[176px] flex-col justify-between rounded-panel border border-line bg-paper p-6 shadow-panel transition-colors duration-300 ease-tyll hover:border-fog">
            <span>
              <Icon size={26} strokeWidth={1.5} aria-hidden />
              <span className="mt-4 block text-xl tracking-[-0.02em]">{title}</span>
              <span className="mt-1 block text-sm text-steel">{detail}</span>
            </span>
            <span className="mt-5 flex items-center justify-between text-[13px] text-graphite">{status}<ArrowRight size={16} className="text-fog transition-transform duration-300 ease-tyll group-hover:translate-x-1 group-hover:text-ink" aria-hidden /></span>
          </Link>
        ))}
      </div>
      <MyAssignments />
      <PrepForShift outletId={outletId} />
      <Panel title="What you have logged" description="Your entries feed the stock and waste figures managers see. Sales and cost figures are not shown on this account.">
        {myWaste.length === 0 ? <p className="text-sm text-steel">Nothing yet this session.</p> : (
          <ul className="divide-y divide-hair">
            {myWaste.slice(0, 8).map((w) => {
              const name = w.ingredientId ? ingredientById[w.ingredientId].name : itemById[w.itemId!].name;
              const unit = w.ingredientId ? ingredientById[w.ingredientId].unit : "each";
              return (
                <li key={w.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <span className="num text-ink">{fmtQty(w.qty, unit)} {unit === "each" ? "× " : ""}{name}<span className="ml-2 text-xs text-steel">{REASON_LABEL[w.reason].en}</span></span>
                  {w.synced ? <Badge tone="pos">Saved</Badge> : <Badge tone="warn">Waiting to sync</Badge>}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
