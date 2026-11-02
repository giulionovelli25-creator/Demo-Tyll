"use client";
// Cmd+K: actions, screens, items, outlets and saved records, all from the keyboard.
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/components/ui";
import { api } from "@/lib/api";
import { MENU_ITEMS, PROPERTIES, outletById, outletLabel } from "@/lib/data/catalog";
import { MODULE_PATH, allowedOutlets, allowedProperties, can, canOpen, modulesFor, type ModuleId, type Permission } from "@/lib/domain/access";
import { useInvestigations } from "@/lib/hooks";
import { useDemo } from "@/lib/store";
import type { User } from "@/lib/types";
import { fmtDate, fmtTime } from "@/lib/util";

interface Hit {
  group: string;
  label: string;
  detail: string;
  href?: string;
  run?: () => void;
}

const ACTIONS: { label: string; detail: string; href: string; module?: ModuleId; perm?: Permission }[] = [
  { label: "See what to order", detail: "Stock prediction to month end", href: "/stock#order", module: "stock" },
  { label: "Start a stock count", detail: "By location, in walking order", href: "/count", perm: "stock.count" },
  { label: "Review money flags", detail: "Largest amount first", href: "/money", module: "money" },
  { label: "See Pour Control", detail: "Wine and spirits yield", href: "/money?tab=pour", module: "money" },
  { label: "See profit by outlet", detail: "Revenue, cost and profit", href: "/money?tab=outlets", module: "money" },
  { label: "Open orders", detail: "Drafts, approvals and deliveries", href: "/forecast", module: "forecast" },
  { label: "See waste and breakage", detail: "What was lost, and why", href: "/waste", module: "waste" },
  { label: "See all alerts", detail: "Stock, money and waste", href: "/alerts", module: "alerts" },
];

export function CommandPalette({ user, pages, onClose }: { user: User; pages: Partial<Record<ModuleId, string>>; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const router = useRouter();
  const setScope = useDemo((s) => s.setScope);
  const investigations = useInvestigations();
  const listRef = useRef<HTMLDivElement>(null);
  // Orders are searched on the server, which only returns orders from outlets this user may see.
  const [orderHits, setOrderHits] = useState<{ q: string; hits: { id: string; outletId: string; date: string; openMin: number }[] }>({ q: "", hits: [] });
  useEffect(() => {
    const term = q.trim();
    if (term.length < 3 || !canOpen(user, "money")) return;
    const t = setTimeout(() => {
      api<{ hits: { id: string; outletId: string; date: string; openMin: number }[] }>(`/api/orders?q=${encodeURIComponent(term)}`).then((r) => setOrderHits({ q: term, hits: r.hits })).catch(() => setOrderHits({ q: term, hits: [] }));
    }, 250);
    return () => clearTimeout(t);
  }, [q, user]);
  // Saved records (requests, events, rooms, invoices and more) come from the server, already limited to this person.
  const [recordHits, setRecordHits] = useState<{ q: string; hits: { group: string; label: string; detail: string; href: string }[] }>({ q: "", hits: [] });
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const t = setTimeout(() => {
      api<{ hits: { group: string; label: string; detail: string; href: string }[] }>(`/api/search?q=${encodeURIComponent(term)}`).then((r) => setRecordHits({ q: term, hits: r.hits })).catch(() => setRecordHits({ q: term, hits: [] }));
    }, 200);
    return () => clearTimeout(t);
  }, [q]);
  const [recent, setRecent] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem("tyll-recent-search") ?? "[]") as string[]; } catch { return []; } });
  const remember = (term: string) => {
    if (term.length < 2) return;
    const next = [term, ...recent.filter((r) => r !== term)].slice(0, 5);
    setRecent(next);
    try { localStorage.setItem("tyll-recent-search", JSON.stringify(next)); } catch { /* private window */ }
  };
  const hits = useMemo<Hit[]>(() => {
    const term = q.trim().toLowerCase();
    const actions = ACTIONS.filter((a) => (!a.module || canOpen(user, a.module)) && (!a.perm || can(user, a.perm))).map((a) => ({ group: "Actions", label: a.label, detail: a.detail, href: a.href }));
    if (term.length < 2) return actions;
    const outlets = allowedOutlets(user);
    const out: Hit[] = actions.filter((a) => a.label.toLowerCase().includes(term));
    for (const m of modulesFor(user)) if (pages[m]?.toLowerCase().includes(term)) out.push({ group: "Pages", label: pages[m]!, detail: "Open", href: MODULE_PATH[m] });
    for (const p of PROPERTIES) if (allowedProperties(user).includes(p.id) && p.name.toLowerCase().includes(term)) out.push({ group: "Properties", label: p.name, detail: "Show this hotel", run: () => setScope({ propertyId: p.id, outletId: "all" }) });
    for (const id of outlets) {
      const o = outletById[id];
      if (`${o.name} ${o.kind}`.toLowerCase().includes(term)) out.push({ group: "Outlets", label: outletLabel(id), detail: o.kind, run: () => setScope({ propertyId: o.propertyId, outletId: id }) });
    }
    if (canOpen(user, "overview")) {
      for (const it of MENU_ITEMS) {
        if (it.name.toLowerCase().includes(term) && outlets.some((id) => outletById[id].menu.some((m) => m.itemId === it.id))) out.push({ group: "Menu items", label: it.name, detail: it.category, href: `/menu/${it.id}` });
      }
    }
    if (canOpen(user, "investigations")) {
      for (const i of investigations.filter((x) => `${x.id} ${x.headline}`.toLowerCase().includes(term)).slice(0, 5)) out.push({ group: "Money cases", label: i.headline, detail: i.id.replace("EX-", ""), href: `/investigations/${i.id}` });
    }
    if (term.length >= 3 && orderHits.q.toLowerCase() === term) {
      for (const o of orderHits.hits) out.push({ group: "Orders", label: o.id, detail: `${outletById[o.outletId].name}, ${fmtDate(o.date)} ${fmtTime(o.openMin)}`, href: `/money/orders/${o.id}` });
    }
    if (recordHits.q.toLowerCase() === term) for (const h of recordHits.hits) if (!(h.group === "Features" && out.some((o) => o.href === h.href))) out.push(h);
    return out.slice(0, 40);
  }, [q, user, investigations, setScope, orderHits, recordHits, pages]);

  // Groups are shown in order of first appearance, so the arrow keys follow what is on screen.
  const groups = [...new Set(hits.map((h) => h.group))];
  const flat = groups.flatMap((g) => hits.filter((h) => h.group === g));
  const selected = Math.min(at, Math.max(0, flat.length - 1));
  const run = (h: Hit | undefined) => {
    if (!h) return;
    remember(q.trim());
    h.run?.();
    if (h.href) router.push(h.href);
    onClose();
  };
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selected, flat.length]);
  let index = -1;

  return (
    <div className="no-print fixed inset-0 z-50 flex items-start justify-center bg-scrim p-4 pt-[10vh] animate-fade" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="Search and actions" className="flex max-h-[76vh] w-full max-w-[640px] flex-col overflow-hidden rounded-panel border border-line bg-paper shadow-float">
        <div className="relative border-b border-hair">
          <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-steel" aria-hidden />
          <input
            autoFocus
            value={q}
            onChange={(e) => { setQ(e.target.value); setAt(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setAt(Math.min(flat.length - 1, selected + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setAt(Math.max(0, selected - 1)); }
              else if (e.key === "Enter") { e.preventDefault(); run(flat[selected]); }
              else if (e.key === "Escape") { e.preventDefault(); onClose(); }
            }}
            placeholder="Search items, outlets and actions"
            aria-label="Search items, outlets and actions"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            className="h-14 w-full bg-transparent pl-12 pr-16 text-[15px] text-ink outline-none placeholder:text-steel"
          />
          <kbd className="absolute right-4 top-1/2 -translate-y-1/2 rounded-md border border-line px-1.5 py-0.5 text-[11px] text-steel">Esc</kbd>
        </div>
        {q.trim().length < 2 && recent.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-hair px-4 py-3 text-sm">
            <span className="text-xs text-steel">Recent</span>
            {recent.map((r) => <button key={r} type="button" onClick={() => setQ(r)} className="rounded-full border border-line px-3 py-1 text-graphite transition-colors duration-200 hover:bg-cloud">{r}</button>)}
          </div>
        )}
        <div ref={listRef} id="palette-list" role="listbox" aria-label="Results" className="scroll-thin min-h-0 flex-1 overflow-y-auto p-2">
          {flat.length === 0 && <p className="px-3 py-4 text-sm text-steel">{recordHits.q !== q.trim() ? "Searching" : <>Nothing you can open matches &ldquo;{q}&rdquo;. Try an item such as Coca-Cola, or an outlet such as The Terrace.</>}</p>}
          {groups.map((g) => (
            <div key={g} className="mb-2">
              <p className="px-3 py-1 text-xs text-steel">{g}</p>
              {hits.filter((h) => h.group === g).map((h) => {
                index += 1;
                const i = index;
                return (
                  <button
                    key={`${g}-${h.label}-${i}`}
                    type="button"
                    role="option"
                    aria-selected={i === selected}
                    onMouseEnter={() => setAt(i)}
                    onClick={() => run(h)}
                    className={cn("flex w-full items-center justify-between gap-4 rounded-[var(--radius-control)] px-3 py-2 text-left text-sm", i === selected ? "bg-accent-soft text-accent-ink" : "text-ink")}
                  >
                    <span className="min-w-0 truncate">{h.label}</span>
                    <span className={cn("shrink-0 text-xs", i === selected ? "text-accent-ink" : "text-steel")}>{h.detail}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <p className="hidden gap-4 border-t border-hair px-4 py-2 text-xs text-steel sm:flex"><span>Up and down arrows to move</span><span>Enter to open</span><span>Esc to close</span></p>
      </div>
    </div>
  );
}
