"use client";
// Log an empty bottle: scan its barcode or tap the bottle, before it goes in the bin. One tap saves it; Undo is in the toast.
// Saved on the server with the person and role. Over pouring counts it as a bottle used where the outlet scans its empties.
import { Camera, Martini, ScanLine, Wine } from "lucide-react";
import { useCallback, useState } from "react";
import { CameraScan } from "@/components/stock/take-count";
import { Button, cn, textLink, toast } from "@/components/ui";
import { api } from "@/lib/api";
import { useEmptiesVersion } from "@/lib/empties-version";
import { outletById } from "@/lib/data/catalog";
import { allowedOutlets } from "@/lib/domain/access";
import { mayLogEmpty, pourOutlets } from "@/lib/domain/empties";
import { useApi, useView } from "@/lib/hooks";
import type { EmptiesView, MyScan } from "@/lib/server/empties";
import { fmtTime } from "@/lib/util";


export { mayLogEmpty };

const LAST_OUTLET = "tyll-empties-outlet";
function firstOutlet(outlets: readonly string[], picked: readonly string[]): string {
  const mine = outlets.filter((o) => picked.includes(o));
  if (mine.length === 1) return mine[0];
  let last: string | null = null;
  try { last = localStorage.getItem(LAST_OUTLET); } catch { /* private window */ }
  return last && outlets.includes(last) ? last : outlets[0];
}

/** The flow itself: on Waste and breakage and in the staff app. */
export function EmptyBottleFlow({ wide }: { wide?: boolean }) {
  const { user, sel } = useView();
  const v = useEmptiesVersion((s) => s.v);
  const bump = useEmptiesVersion((s) => s.bump);
  const { data } = useApi<EmptiesView & { ok: true }>(`/api/stock/empties?v=${v}`);
  const outlets = pourOutlets(allowedOutlets(user));
  const [picked, setPicked] = useState<string | null>(null);
  const outletId = picked ?? firstOutlet(outlets, sel.outletIds);
  const [code, setCode] = useState("");
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const canCamera = typeof window !== "undefined" && !!window.BarcodeDetector && !!navigator.mediaDevices;
  const bottles = data?.bottles ?? [];
  const nameOf = (skuId: string) => bottles.find((b) => b.id === skuId)?.name ?? skuId;

  const undo = useCallback((id: string) => {
    api<{ mine: MyScan[] }>("/api/stock/empties", { method: "POST", body: { action: "undo", id } })
      .then(() => { bump(); toast.done("Taken back. The scan stays on record and no longer counts."); })
      .catch((e) => toast.error(e instanceof Error ? e.message : "That could not be taken back. Try again."));
  }, [bump]);

  const save = async (body: { skuId?: string; barcode?: string }) => {
    if (busy) return;
    setBusy(true);
    try { localStorage.setItem(LAST_OUTLET, outletId); } catch { /* private window */ }
    try {
      const r = await api<{ scan: { id: string; skuId: string } }>("/api/stock/empties", { method: "POST", body: { outletId, ...body, clientId: `empty-${Date.now()}` } });
      bump();
      setCode("");
      toast.done(`Empty bottle logged: ${nameOf(r.scan.skuId)}, ${outletById[outletId].name}. Over pouring counts it.`, { label: "Undo", run: () => undo(r.scan.id) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That was not saved. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (outlets.length === 0) return null;
  const mine = (data?.mine ?? []).filter((m) => m.outletId === outletId);
  const group = (family: "wine" | "spirits") => bottles.filter((b) => b.family === family);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <form className="flex min-w-0 flex-1 gap-2 sm:max-w-[360px]" onSubmit={(e) => { e.preventDefault(); if (code.trim()) save({ barcode: code.trim() }); }}>
          <label className="relative min-w-0 flex-1"><span className="sr-only">Scan or type a barcode</span>
            <ScanLine size={16} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-steel" aria-hidden />
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="off" placeholder="Scan or type a barcode" className="h-11 w-full rounded-full border border-line bg-paper ps-10 pe-3 text-base text-ink placeholder:text-steel sm:text-sm" />
          </label>
          {canCamera && <Button type="button" onClick={() => setCamera(true)} aria-label="Scan with the camera"><Camera size={16} aria-hidden /></Button>}
        </form>
        {outlets.length > 1 && (
          <label className="flex items-center gap-2 text-[13px] text-steel">
            <span className="sr-only sm:not-sr-only">Outlet</span>
            <select value={outletId} onChange={(e) => setPicked(e.target.value)} aria-label="Outlet" className="h-10 max-w-[180px] rounded-full border border-line bg-paper px-3 text-[13px] text-ink">
              {outlets.map((o) => <option key={o} value={o}>{outletById[o].name}</option>)}
            </select>
          </label>
        )}
      </div>
      <p className="mb-2 text-[13px] text-steel">Or tap the bottle. Tapping saves it.</p>
      <div className={cn("grid grid-cols-2 gap-2 sm:grid-cols-4", wide && "lg:grid-cols-7")}>
        {(["wine", "spirits"] as const).flatMap((f) => group(f)).map((b) => (
          <button key={b.id} type="button" disabled={busy} onClick={() => save({ skuId: b.id })} className="flex h-[84px] flex-col items-center justify-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-paper px-1 text-center text-[13px] leading-tight text-ink transition-colors duration-150 hover:bg-cloud active:scale-[0.98] disabled:opacity-60">
            <span className="text-accent-ink">{b.family === "wine" ? <Wine size={22} aria-hidden /> : <Martini size={22} aria-hidden />}</span>
            {b.name}
          </button>
        ))}
        {!data && Array.from({ length: 7 }, (_, i) => <span key={i} className="h-[84px] animate-pulse rounded-[var(--radius-control)] bg-cloud" aria-hidden />)}
      </div>
      {mine.length > 0 && (
        <div className="mt-3 text-[13px]">
          <p className="text-graphite">{mine.length === 1 ? "1 empty" : `${mine.length} empties`} logged by you today at {outletById[outletId].name}.</p>
          <ul className="mt-1 space-y-1">
            {mine.slice(0, 3).map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 text-steel">
                <span><span className="text-ink">{nameOf(m.skuId)}</span> · <span>{m.method === "scan" ? "scanned" : "picked"} at {fmtTime(m.min)}</span></span>
                <button type="button" onClick={() => undo(m.id)} className={textLink}>Undo</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {camera && <CameraScan hint="Point the camera at the bottle's barcode." onCode={(c) => { setCamera(false); save({ barcode: c }); }} onClose={() => setCamera(false)} />}
    </div>
  );
}
