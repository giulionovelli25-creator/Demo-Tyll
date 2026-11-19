"use client";
// Counting a stock take on a phone or tablet: item by item in walking order, by scanning the pack barcode (a handheld
// scanner types into the scan field; the camera works where the browser can read barcodes) or by typing the quantity.
// Each count is saved as it is entered, so a stock take can be paused and continued on another device.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Camera, Check, ScanLine, X } from "lucide-react";
import { Button, Skeleton, WidgetError, cn, toast } from "@/components/ui";
import { CountFlow } from "@/components/stock/count-flow";
import { ingredientById } from "@/lib/data/catalog";
import { locationOf } from "@/lib/data/locations";
import { useProcAction, useStockTake } from "@/lib/procurement-hooks";
import type { StockTakeView } from "@/lib/server/stocktake";
import { areaName } from "@/lib/stock-areas";
import { fmtQty, unitLabel } from "@/lib/util";

/** /count opens the quick count, or a stock take when the address names one. */
export function CountRoute() {
  const take = useSearchParams().get("take");
  return take ? <TakeCount id={take} /> : <CountFlow />;
}

interface Detector { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> }
declare global { interface Window { BarcodeDetector?: new (o: { formats: string[] }) => Detector } }

function CameraScan({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    let stream: MediaStream | null = null;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!video.current || !live) return;
        video.current.srcObject = stream;
        await video.current.play();
        const detector = new window.BarcodeDetector!({ formats: ["ean_13", "ean_8", "upc_a", "code_128"] });
        const tick = async () => {
          if (!live || !video.current) return;
          const found = await detector.detect(video.current).catch(() => []);
          if (found[0]?.rawValue) { onCode(found[0].rawValue); return; }
          timer = setTimeout(tick, 350);
        };
        tick();
      } catch {
        toast.error("The camera could not start. Type the code, or use a handheld scanner.");
        onClose();
      }
    })();
    return () => { live = false; if (timer) clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, [onCode, onClose]);
  return (
    <div role="dialog" aria-label="Scan a barcode" className="fixed inset-0 z-50 flex flex-col bg-black">
      <video ref={video} className="flex-1 object-cover" playsInline muted />
      <div className="flex items-center justify-between gap-3 bg-black/80 px-4 py-4 text-white">
        <span className="text-sm">Point the camera at the pack barcode.</span>
        <button type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15" aria-label="Close the camera"><X size={18} /></button>
      </div>
    </div>
  );
}

function TakeCount({ id }: { id: string }) {
  const router = useRouter();
  const { data, error } = useStockTake(id);
  const act = useProcAction();
  const [values, setValues] = useState<Record<string, string>>({});
  // The item to count next; the counter lets the same item be scanned twice in a row.
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);
  const [code, setCode] = useState("");
  const [blind, setBlind] = useState(true);
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const canCamera = typeof window !== "undefined" && !!window.BarcodeDetector && !!navigator.mediaDevices;
  const ready = !!data;
  useEffect(() => { if (focus && ready) { const el = document.getElementById(`qty-${focus.id}`) as HTMLInputElement | null; el?.scrollIntoView({ block: "center" }); el?.focus(); el?.select(); } }, [focus, ready]);
  if (error) return <div className="p-6"><WidgetError>This stock take could not load.</WidgetError></div>;
  if (!data) return <div className="p-6"><Skeleton className="h-64 w-full" /></div>;
  const t: StockTakeView = data.take;
  if (t.status !== "counting") {
    return <div className="mx-auto max-w-lg p-6 text-center"><p className="text-ink">This stock take has been submitted.</p><Link prefetch={false} href={`/stock?tab=takes&take=${t.id}`} className="mt-3 inline-block text-accent-ink underline">See the variance report</Link></div>;
  }
  const counted = t.lines.filter((l) => l.counted !== null).length;
  const save = async (g: string, raw: string, method?: "scan") => {
    const v = raw.trim() === "" ? null : Number(raw.replace(",", "."));
    if (v !== null && (!Number.isFinite(v) || v < 0)) return toast.error("Enter a quantity of 0 or more.");
    try { await act("/api/stock/takes", { action: "count", id: t.id, ingredientId: g, counted: v, method }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "The count could not be saved."); }
  };
  const scan = async (raw: string) => {
    const c = raw.trim();
    if (!c) return;
    try {
      const r = await act<{ ingredientId: string }>("/api/stock/takes", { action: "count", id: t.id, barcode: c });
      setFocus((f) => ({ id: r.ingredientId, n: (f?.n ?? 0) + 1 }));
      setCode("");
      toast.done(`${ingredientById[r.ingredientId].name}. Enter the quantity.`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Unknown barcode."); }
  };
  const submit = async () => {
    setBusy(true);
    try { await act("/api/stock/takes", { action: "submit", id: t.id }); toast.done("Sent for approval. Stock changes once a manager approves."); router.push(`/stock?tab=takes&take=${t.id}`); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not send it."); setBusy(false); }
  };
  const areas = [...new Set(t.lines.map((l) => locationOf(l.ingredientId)))];
  return (
    <div className="mx-auto min-h-dvh max-w-2xl bg-cloud pb-28">
      <header className="sticky top-0 z-10 border-b border-line bg-paper/95 px-4 pb-3 pt-3 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <Link prefetch={false} href="/stock?tab=takes" className="flex items-center gap-1.5 text-[13px] text-steel"><ArrowLeft size={15} aria-hidden />Leave, counts are saved</Link>
          <label className="flex items-center gap-2 text-[13px] text-graphite"><input type="checkbox" checked={blind} onChange={(e) => setBlind(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />Blind count</label>
        </div>
        <h1 className="mt-2 text-[19px] font-medium text-ink">{t.id}, {t.locationName}</h1>
        <p className="text-[13px] text-steel">{t.kind === "full" ? "Full count" : t.areaNames.join(", ")}. {counted} of {t.lines.length} counted.</p>
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); scan(code); }}>
          <label className="relative flex-1"><span className="sr-only">Scan or type a barcode</span>
            <ScanLine size={16} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-steel" aria-hidden />
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="off" placeholder="Scan or type a barcode" className="h-11 w-full rounded-full border border-line bg-paper ps-10 pe-3 text-base text-ink" />
          </label>
          {canCamera && <Button type="button" onClick={() => setCamera(true)} aria-label="Scan with the camera"><Camera size={16} aria-hidden /></Button>}
        </form>
      </header>
      {areas.map((a) => (
        <section key={a} className="px-4 pt-5">
          <h2 className="mb-2 text-[13px] font-medium text-steel">{areaName(a)}</h2>
          <ul className="divide-y divide-hair overflow-hidden rounded-2xl border border-line bg-paper">
            {t.lines.filter((l) => locationOf(l.ingredientId) === a).map((l) => {
              const g = ingredientById[l.ingredientId];
              const v = values[l.ingredientId] ?? (l.counted === null ? "" : String(l.counted));
              return (
                <li key={l.ingredientId} className={cn("flex items-center gap-3 px-4 py-3", focus?.id === l.ingredientId && "bg-accent-soft")}>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] text-ink">{g.name}</span>
                    <span className="text-xs text-steel">{blind ? unitLabel(g.unit === "each" ? "units" : g.unit) : `System ${fmtQty(l.system, g.unit)}`}{l.method === "scan" ? ", scanned" : ""}</span>
                  </span>
                  {l.counted !== null && <Check size={16} className="shrink-0 text-pos" aria-label="Counted" />}
                  <label className="shrink-0"><span className="sr-only">Counted {g.name}</span>
                    <input id={`qty-${l.ingredientId}`} type="number" inputMode="decimal" min={0} step="any" value={v} placeholder="Count" onChange={(e) => setValues({ ...values, [l.ingredientId]: e.target.value })} onBlur={(e) => { if ((l.counted === null ? "" : String(l.counted)) !== e.target.value) save(l.ingredientId, e.target.value, focus?.id === l.ingredientId ? "scan" : undefined); }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} className="num h-11 w-24 rounded-xl border border-line bg-paper px-3 text-end text-base text-ink" />
                  </label>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <footer className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-paper/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
          <span className="text-[13px] text-graphite">{counted} of {t.lines.length} counted{t.kind === "full" && counted < t.lines.length ? ". A full count needs every item." : "."}</span>
          <Button variant="primary" disabled={busy || counted === 0 || (t.kind === "full" && counted < t.lines.length)} onClick={submit}>Send for approval</Button>
        </div>
      </footer>
      {camera && <CameraScan onCode={(c) => { setCamera(false); scan(c); }} onClose={() => setCamera(false)} />}
    </div>
  );
}
