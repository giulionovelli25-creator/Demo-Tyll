"use client";
// The bell: work handed to this person (saved on the server) and the few things that need attention.
// Opening a notification goes to the exact record and marks it read.
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/components/ui";
import { api } from "@/lib/api";
import { useLiveGet } from "@/lib/guest-hooks";
import { personName } from "@/lib/hooks";
import type { Notice } from "@/lib/server/notify";

export interface Attention { id: string; text: string; detail: string; href: string; tone: "warn" | "neg" | "neutral" }

const ago = (at: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 60000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

export function useNotices() {
  return useLiveGet<{ notices: Notice[]; unread: number; emailOn: boolean }>("/api/notifications", 20000);
}

export function NotificationBell({ attention = [], align = "right" }: { attention?: Attention[]; align?: "right" | "left" }) {
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState<Record<string, true>>({});
  const { data } = useNotices();
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const notices = (data?.notices ?? []).map((n) => (local[n.id] ? { ...n, read: true } : n));
  const unread = notices.filter((n) => !n.read && !n.resolved).length;
  const count = unread + attention.length;
  const go = (n: Notice) => {
    setLocal((l) => ({ ...l, [n.id]: true }));
    void api("/api/notifications", { method: "POST", body: { ids: [n.id] } }).catch(() => undefined);
    setOpen(false);
    router.push(n.href);
  };
  const readAll = () => {
    setLocal(Object.fromEntries(notices.map((n) => [n.id, true])));
    void api("/api/notifications", { method: "POST", body: {} }).catch(() => undefined);
  };
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        className={cn("relative flex h-10 w-10 items-center justify-center rounded-full text-graphite transition-colors hover:bg-mist", open && "bg-mist text-ink")}>
        <Bell size={18} strokeWidth={1.7} />
        {unread > 0 ? <span className="num absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-ink px-1 text-[10px] text-paper ring-2 ring-paper">{unread > 9 ? "9+" : unread}</span>
          : count > 0 && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-warn ring-2 ring-paper" aria-hidden />}
      </button>
      {open && (
        <div role="dialog" aria-label="Notifications" className={cn("animate-rise fixed inset-x-3 top-16 z-50 rounded-2xl border border-line bg-paper p-2 shadow-float sm:absolute sm:inset-x-auto sm:top-12 sm:w-[360px]", align === "right" ? "sm:right-0" : "sm:left-0")}>
          <div className="flex items-center justify-between px-3 py-2">
            <p className="text-[13px] text-steel">For you</p>
            {unread > 0 && <button type="button" onClick={readAll} className="text-[13px] text-graphite underline-offset-2 hover:underline">Mark all read</button>}
          </div>
          {notices.length === 0 ? <p className="px-3 pb-3 text-sm text-graphite">No requests for you. When another team sends you work, it appears here.</p> : (
            <ul className="scroll-thin max-h-[50vh] overflow-y-auto">
              {notices.slice(0, 15).map((n) => (
                <li key={n.id}>
                  <button type="button" onClick={() => go(n)} className={cn("flex w-full gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-mist", n.resolved && "opacity-60")}>
                    <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", !n.read && !n.resolved ? "bg-ink" : "bg-transparent")} aria-hidden />
                    <span className="min-w-0">
                      <span className={cn("block text-sm", !n.read && !n.resolved ? "text-ink" : "text-graphite")}>{n.title}</span>
                      <span className="block text-xs text-steel">{n.body}</span>
                      <span className="mt-0.5 block text-[11px] text-fog">{n.from ? `From ${personName(n.from)} · ` : ""}{ago(n.at)}{n.resolved ? " · done" : ""}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {attention.length > 0 && (
            <>
              <p className="mt-1 border-t border-hair px-3 pb-1 pt-3 text-[13px] text-steel">Needs attention</p>
              <ul>
                {attention.map((a) => (
                  <li key={a.id}>
                    <button type="button" onClick={() => { setOpen(false); router.push(a.href); }} className="flex w-full gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-mist">
                      <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", a.tone === "neg" ? "bg-neg" : a.tone === "warn" ? "bg-warn" : "bg-fog")} aria-hidden />
                      <span className="min-w-0"><span className="block text-sm text-ink">{a.text}</span><span className="block truncate text-xs text-steel">{a.detail}</span></span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
