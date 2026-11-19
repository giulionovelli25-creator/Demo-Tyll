"use client";
// Asks once whether the demo may record which pages this visitor opens, then records them only after a yes.
// "No" is as easy as "Yes"; a Global Privacy Control signal counts as no and the question is never shown.
// The choice can be changed in Settings; turning it off erases what was recorded.
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { Button } from "@/components/ui";

const KEY = "tyll-visit-consent-v1";
type Choice = { choice: "yes"; visitorId: string; at: string } | { choice: "no"; at: string };

const listeners = new Set<() => void>();
const read = (): string | null => { try { return localStorage.getItem(KEY); } catch { return null; } };
const parse = (raw: string | null): Choice | null => { try { return raw ? (JSON.parse(raw) as Choice) : null; } catch { return null; } };
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
const gpc = () => typeof navigator !== "undefined" && (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;

function write(c: Choice | null) {
  try { if (c) localStorage.setItem(KEY, JSON.stringify(c)); else localStorage.removeItem(KEY); } catch { /* private window: nothing is recorded */ }
  listeners.forEach((l) => l());
}

const newId = () => {
  const b = new Uint8Array(18);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export function useVisitConsent() {
  const raw = useSyncExternalStore(subscribe, read, () => null);
  const c = parse(raw);
  return {
    choice: gpc() ? ("no" as const) : c?.choice ?? null,
    gpc: gpc(),
    visitorId: c?.choice === "yes" ? c.visitorId : null,
    allow: () => write({ choice: "yes", visitorId: newId(), at: new Date().toISOString() }),
    refuse: async () => {
      // Withdrawing after a yes erases what was recorded.
      if (c?.choice === "yes") await fetch("/api/visits", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ visitorId: c.visitorId }) }).catch(() => undefined);
      write({ choice: "no", at: new Date().toISOString() });
    },
  };
}

const post = (body: unknown) => fetch("/api/visits", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive: true });

/** Records each page while the visitor has agreed: the page, and the active time spent on it. */
function Recorder({ visitorId }: { visitorId: string }) {
  const pathname = usePathname();
  const tab = useSearchParams().get("tab");
  const path = tab ? `${pathname}?tab=${tab}` : pathname;
  useEffect(() => {
    let since = document.visibilityState === "visible" ? Date.now() : 0;
    let active = 0;
    const viewId = post({ visitorId, path, consent: true }).then((r) => r.json()).then((j: { viewId?: string }) => j.viewId ?? null).catch(() => null);
    const flush = () => {
      if (since) { active += Date.now() - since; since = 0; }
      const seconds = active / 1000;
      active = 0;
      if (seconds < 1) return;
      void viewId.then((id) => {
        if (!id) return;
        const body = JSON.stringify({ event: "leave", visitorId, viewId: id, seconds });
        if (!navigator.sendBeacon?.("/api/visits", new Blob([body], { type: "application/json" }))) void post(JSON.parse(body));
      });
    };
    const onVisibility = () => (document.visibilityState === "hidden" ? flush() : (since = Date.now()));
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [path, visitorId]);
  return null;
}

export function VisitConsent() {
  const c = useVisitConsent();
  if (c.choice === "yes" && c.visitorId) return <Recorder visitorId={c.visitorId} />;
  if (c.choice !== null) return null;
  return (
    <section aria-labelledby="visit-consent" className="no-print fixed inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom))] z-40 mx-auto max-w-[560px] rounded-panel border border-line bg-paper p-4 shadow-panel md:bottom-5 md:start-auto md:end-5 md:mx-0">
      <h2 id="visit-consent" className="text-[15px] font-semibold text-ink">This demo uses cookies</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-graphite">With your consent, we use cookies to see which demo pages are opened and for how long, so we can improve Tyll. No name, email or IP address is stored, and records are deleted after 90 days. You can change your choice at any time in Settings.</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button onClick={c.allow}>Accept cookies</Button>
        <Button onClick={() => void c.refuse()}>Reject cookies</Button>
      </div>
    </section>
  );
}

/** For Settings: the current choice, and a way to change it. */
export function VisitConsentSetting() {
  const c = useVisitConsent();
  const text = c.gpc ? "Rejected: your browser asks sites not to track you (Global Privacy Control)." : c.choice === "yes" ? "Accepted: the demo pages you open are recorded for the Tyll team." : c.choice === "no" ? "Rejected: nothing is recorded." : "Not chosen yet: nothing is recorded.";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-ink">{text}</p>
      {!c.gpc && (c.choice === "yes"
        ? <Button size="sm" onClick={() => void c.refuse()}>Reject cookies and erase my visits</Button>
        : <Button size="sm" onClick={c.allow}>Accept cookies</Button>)}
    </div>
  );
}
