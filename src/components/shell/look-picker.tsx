"use client";
// Try a look: switch the app's colours live on the real pages, then keep the one that works. Not modal, so you can keep clicking around while it is open.
import { X } from "lucide-react";
import { useEffect } from "react";
import { OUTLET_TONE } from "@/components/theme";
import { Segmented, cn, textLink } from "@/components/ui";
import { outletById } from "@/lib/data/catalog";
import { allowedOutlets, clampScope } from "@/lib/domain/access";
import { useLook, type LookColour } from "@/lib/look";
import { useDemo } from "@/lib/store";
import type { User } from "@/lib/types";

const Swatch = ({ tones }: { tones: string[] }) => (
  <span className="flex shrink-0 -space-x-1" aria-hidden>
    {tones.map((t) => <span key={t} className="h-4 w-4 rounded-full border-2 border-paper" style={{ background: `var(--color-${t})` }} />)}
  </span>
);

const WHOLE: { value: LookColour; title: string; note: string; tones: string[] }[] = [
  { value: "sections", title: "By section", note: "Stock teal, Predictions violet, Revenue blue", tones: ["teal", "violet", "blue", "indigo"] },
  { value: "outlets", title: "By outlet", note: "The app takes the colour of the outlet you pick", tones: ["burgundy", "emerald", "azure", "bronze", "violet"] },
];
const ONE: { value: LookColour; title: string }[] = [
  { value: "indigo", title: "Indigo" },
  { value: "emerald", title: "Emerald" },
  { value: "bronze", title: "Bronze" },
  { value: "burgundy", title: "Burgundy" },
];

export function LookPicker({ user }: { user: User }) {
  const { open, setOpen, colour, setColour, waves, setWaves, reset } = useLook();
  const rawScope = useDemo((s) => s.scope);
  const setScope = useDemo((s) => s.setScope);
  const scope = clampScope(user, rawScope);
  const outlets = allowedOutlets(user).filter((id) => scope.propertyId === "all" || outletById[id].propertyId === scope.propertyId);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open, setOpen]);
  if (!open) return null;
  const row = (active: boolean) => cn("flex w-full items-center gap-3 rounded-[var(--radius-control)] border p-2.5 text-left transition-colors duration-150", active ? "border-ink bg-cloud" : "border-line hover:bg-cloud");
  return (
    <div role="dialog" aria-label="Try a look" className="no-print animate-rise fixed bottom-20 left-4 z-40 max-h-[calc(100vh-7rem)] w-[calc(100vw-2rem)] max-w-[340px] overflow-y-auto overscroll-contain rounded-panel border border-line bg-paper p-4 shadow-float md:bottom-6 md:left-[104px] xl:left-[248px]">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-section font-medium text-ink">Try a look</h2>
          <p className="text-xs text-steel">Changes only this browser. Keep clicking around while it is open.</p>
        </div>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="-mr-1 -mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-steel transition-colors duration-150 hover:bg-mist hover:text-ink"><X size={18} aria-hidden /></button>
      </div>

      <div role="radiogroup" aria-label="Colours" className="mt-3 space-y-2">
        {WHOLE.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={colour === o.value} onClick={() => setColour(o.value)} className={row(colour === o.value)}>
            <Swatch tones={o.tones} />
            <span className="min-w-0"><span className="block text-sm font-medium text-ink">{o.title}</span><span className="block text-xs text-steel">{o.note}</span></span>
          </button>
        ))}
        {colour === "outlets" && (
          <div className="flex flex-wrap gap-1.5 py-1">
            <button type="button" onClick={() => setScope({ outletId: "all" })} className={cn("h-9 rounded-full border px-3 text-xs font-medium", scope.outletId === "all" ? "border-ink bg-ink text-paper" : "border-line text-graphite hover:bg-cloud")}>All</button>
            {outlets.map((id) => (
              <button key={id} type="button" onClick={() => setScope({ outletId: id })} className={cn("flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium", scope.outletId === id ? "border-ink bg-cloud text-ink" : "border-line text-graphite hover:bg-cloud")}>
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: `var(--color-outlet-${OUTLET_TONE[id].mark})` }} aria-hidden />{outletById[id].name}
              </button>
            ))}
          </div>
        )}
        <p className="pt-1 text-xs text-steel">Or one signature colour everywhere</p>
        <div className="grid grid-cols-2 gap-2">
          {ONE.map((o) => (
            <button key={o.value} type="button" role="radio" aria-checked={colour === o.value} onClick={() => setColour(o.value)} className={row(colour === o.value)}>
              <Swatch tones={[o.value]} /><span className="text-sm font-medium text-ink">{o.title}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-steel">Waves</span>
        <Segmented size="sm" label="Waves" value={waves} onChange={setWaves} options={[{ value: "soft", label: "Soft" }, { value: "medium", label: "Medium" }, { value: "strong", label: "Strong" }]} />
      </div>
      <p className="mt-3"><button type="button" onClick={reset} className={textLink}>Back to the start</button></p>
    </div>
  );
}
