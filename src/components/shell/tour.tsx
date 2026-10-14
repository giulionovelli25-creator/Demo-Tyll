"use client";
import { usePathname, useRouter } from "next/navigation";
import { Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button, cn } from "@/components/ui";
import { HERO_EXCEPTION_ID } from "@/lib/data/constants";
import { api, reloadTo } from "@/lib/api";
import { useDemo } from "@/lib/store";

interface Step {
  title: string;
  body: string;
  cta: string;
  /** Account the step is meant to be seen from. */
  as: "u-owner" | "u-rm";
}

export const TOUR_STEPS: Step[] = [
  { as: "u-owner", title: "See the whole group", body: "The owner opens Tyll Overview. Sales, costs, margin and money at risk for both hotels are on one screen, with the change against the previous week.", cta: "Open the group overview" },
  { as: "u-owner", title: "Notice The Terrace", body: "The briefing and the outlet list both point to The Terrace: the lowest margin in the group, falling, and the most open issues.", cta: "Show the outlet list" },
  { as: "u-owner", title: "Open The Terrace", body: "Clicking the outlet narrows every figure to that restaurant: its costs, sales, menu profitability and open cases.", cta: "Narrow to The Terrace" },
  { as: "u-owner", title: "Open the unusual transaction", body: "Tonight at 8:49 PM a Coke was removed from a bill, six minutes after its ticket went to the bar.", cta: "Open the investigation" },
  { as: "u-owner", title: "Read what Tyll found", body: "Tyll lays out the original order, the final bill, the tickets and the stock count, then lists what to check. It states facts and does not assign blame.", cta: "Show the evidence" },
  { as: "u-rm", title: "The manager records the result", body: "Sara Haddad, the restaurant manager, reviews the case. Choose an outcome, enter the amount and close it.", cta: "Sign in as Sara Haddad" },
  { as: "u-owner", title: "Back to the owner", body: "The overview now shows one fewer open case at The Terrace, and the amount moved from potential loss to confirmed loss or recovered.", cta: "Return to the overview" },
  { as: "u-owner", title: "Plan the week ahead", body: "Tyll Forecast turns expected occupancy, bookings and Thursday's event into purchase suggestions. Move the occupancy slider and watch the quantities change.", cta: "Open Forecast" },
];

export function Tour() {
  const open = useDemo((s) => s.tourOpen);
  const step = useDemo((s) => s.tourStep);
  const setTour = useDemo((s) => s.setTour);
  const setScope = useDemo((s) => s.setScope);
  const setPreset = useDemo((s) => s.setPreset);
  const userId = useDemo((s) => s.userId);
  const router = useRouter();
  const pathname = usePathname();
  if (!open) return null;
  const current = TOUR_STEPS[step];

  const scrollTo = (id: string) => setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 250);

  const run = async () => {
    const investigation = `/investigations/${HERO_EXCEPTION_ID}`;
    // Switching person is a real sign-out and sign-in. The demo sign-in page fills in the account.
    if (userId !== current.as) {
      await api("/api/auth/logout", { method: "POST", body: {} }).catch(() => undefined);
      const next = step === 5 ? `${investigation}#resolve` : step === 7 ? "/forecast" : "/";
      reloadTo(`/login?as=${current.as}&next=${encodeURIComponent(next)}`);
      return;
    }
    switch (step) {
      case 0:
        setScope({ propertyId: "all", outletId: "all", dept: "all" });
        setPreset("week");
        router.push("/");
        break;
      case 1:
        setScope({ propertyId: "all", outletId: "all", dept: "all" });
        if (pathname !== "/") router.push("/");
        scrollTo("outlets");
        break;
      case 2:
        setScope({ outletId: "dxb-terrace" });
        if (pathname !== "/") router.push("/");
        window.scrollTo({ top: 0, behavior: "smooth" });
        break;
      case 3:
        router.push(investigation);
        break;
      case 4:
        if (pathname !== investigation) router.push(investigation);
        scrollTo("evidence");
        break;
      case 5:
        if (pathname !== investigation) router.push(investigation);
        scrollTo("resolve");
        break;
      case 6:
        setScope({ propertyId: "all", outletId: "all", dept: "all" });
        router.push("/");
        break;
      case 7:
        setScope({ propertyId: "dxb", outletId: "all", dept: "all" });
        router.push("/forecast");
        break;
    }
  };

  return (
    <aside aria-label="Guided owner demo" className="no-print animate-rise fixed bottom-5 right-5 z-40 w-[min(92vw,22.5rem)] rounded-panel border border-line bg-paper p-5 shadow-float">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-steel">Owner demo, step {step + 1} of {TOUR_STEPS.length}</p>
        <button type="button" onClick={() => setTour(false)} aria-label="Close the guided demo" className="rounded-full p-1 text-steel hover:bg-mist hover:text-ink"><X size={16} /></button>
      </div>
      <ol className="mt-3 flex gap-1" aria-hidden>
        {TOUR_STEPS.map((_, i) => (
          <li key={i} className={cn("h-1 flex-1 rounded-full transition-colors duration-300", i < step ? "bg-pos" : i === step ? "bg-ink" : "bg-hair")} />
        ))}
      </ol>
      <h2 className="mt-4 text-lg leading-snug">{current.title}</h2>
      <p className="mt-1.5 text-[13px] leading-relaxed text-graphite">{current.body}</p>
      <div className="mt-4 flex items-center justify-between gap-2">
        <Button variant="primary" size="sm" onClick={run}>{current.cta}</Button>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="!px-2" disabled={step === 0} onClick={() => setTour(true, step - 1)} aria-label="Previous step"><ChevronLeft size={16} /></Button>
          {step < TOUR_STEPS.length - 1 ? (
            <Button variant="ghost" size="sm" className="!px-2" onClick={() => setTour(true, step + 1)} aria-label="Next step"><ChevronRight size={16} /></Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setTour(false, 0)}><Check size={15} /> Finish</Button>
          )}
        </div>
      </div>
    </aside>
  );
}
