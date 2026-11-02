"use client";
// Everything beyond the five priority areas, with what is live and what is still being built kept apart.
import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";
import { MODULE_ICON } from "@/components/theme";
import { Badge, PageHeader } from "@/components/ui";
import { useSession } from "@/lib/api";
import { canOpen, type ModuleId } from "@/lib/domain/access";
import { useView } from "@/lib/hooks";

interface Entry { m: ModuleId; href: string; title: string; detail: string; icon?: LucideIcon; preview?: boolean }

const AVAILABLE: Entry[] = [
  { m: "finance", href: "/finance?tab=invoices", title: "Reconciliation", detail: "Supplier invoices checked against orders and deliveries." },
  { m: "investigations", href: "/investigations", title: "Money Back List", detail: "Every money case, open and closed." },
  { m: "alerts", href: "/alerts", title: "All alerts", detail: "Everything that needs a decision, in one list." },
  { m: "overview", href: "/menu", title: "Menu", detail: "What each dish sells and earns." },
  { m: "tasks", href: "/tasks", title: "My tasks", detail: "Work assigned to you." },
  { m: "flow", href: "/flow", title: "Tyll Flow", detail: "Orders moving through the kitchen and bar." },
  { m: "staff", href: "/staff", title: "Tyll Staff", detail: "The phone app for your team." },
  { m: "settings", href: "/settings", title: "Settings", detail: "What is connected, who can see what, and the change log." },
];
const COMING: Entry[] = [
  { m: "events", href: "/events", title: "Events and Staffing", detail: "Plan events and find the staff they need.", preview: true },
  { m: "rooms", href: "/rooms", title: "Rooms and Guest Experience", detail: "Room readiness, guest requests and luggage.", preview: true },
  { m: "overview", href: "/performance", title: "Sales and Performance", detail: "Outlets side by side, trends and guest results.", preview: true },
];

function Card({ e, reload }: { e: Entry; reload: boolean }) {
  const Icon = MODULE_ICON[e.m];
  const body = (
    <>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-accent-soft text-accent-ink"><Icon size={20} aria-hidden /></span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2 text-[15px] font-medium text-ink">{e.title}{e.preview && <Badge tone="accent" className="!py-0">Preview</Badge>}</span>
        <span className="mt-0.5 block text-[13px] text-graphite">{e.detail}</span>
      </span>
      <ArrowRight size={16} className="shrink-0 text-steel transition-transform duration-200 ease-tyll group-hover:translate-x-0.5" aria-hidden />
    </>
  );
  const className = "group flex items-center gap-4 rounded-panel border border-line bg-paper p-4 shadow-panel transition-shadow duration-200 ease-tyll hover:shadow-lift";
  return <li>{reload ? <a href={e.href} className={className}>{body}</a> : <Link href={e.href} className={className}>{body}</Link>}</li>;
}

export function MorePage() {
  const { user } = useView();
  const publicDemo = useSession((s) => !!s.demoRoles);
  const shown = (list: Entry[]) => list.filter((e) => canOpen(user, e.m) || (publicDemo && e.m !== "tasks" && e.m !== "staff"));
  const live = shown(AVAILABLE);
  const soon = shown(COMING);
  return (
    <div className="space-y-6">
      <PageHeader title="More tools" question="What else is here, and what is coming next?" />
      {live.length > 0 && (
        <section aria-labelledby="available">
          <h2 id="available" className="mb-2 text-section font-medium text-ink">Available now</h2>
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{live.map((e) => <Card key={e.href} e={e} reload={publicDemo} />)}</ul>
        </section>
      )}
      {soon.length > 0 && (
        <section aria-labelledby="coming">
          <h2 id="coming" className="mb-2 text-section font-medium text-ink">Coming soon</h2>
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{soon.map((e) => <Card key={e.href} e={e} reload={publicDemo} />)}</ul>
        </section>
      )}
    </div>
  );
}
