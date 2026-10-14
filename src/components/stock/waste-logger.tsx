"use client";
import { Apple, Beef, Check, ChevronLeft, CloudOff, Coffee, Delete, Fish, GlassWater, Hammer, HelpCircle, Languages, Milk, PackageX, Salad, Soup, Trash2, Wheat, Wine, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Note, Panel, Select, cn, toast } from "@/components/ui";
import { INGREDIENTS, ingredientById, itemById, outletById, outletLabel, propertyById } from "@/lib/data/catalog";
import { can } from "@/lib/domain/access";
import { wasteCost } from "@/lib/domain/inventory";
import { personName, useCtx, useServerStock, useUser, useView } from "@/lib/hooks";
import { REASON_LABEL } from "@/lib/labels";
import { useDemo } from "@/lib/store";
import type { WasteReason } from "@/lib/types";
import { DEMO_TODAY, fmtMoney, fmtQty } from "@/lib/util";

/** Demo PIN for the staff app. A live version would issue one per employee. */
const DEMO_PIN = "2580";

const T = {
  en: { title: "Log waste", pin: "Enter your PIN", pinHint: "Demo PIN: 2580", wrong: "That PIN is not right. Try again.", step1: "What is it?", step2: "How much?", step3: "Why?", ingredients: "Ingredients", dishes: "Dishes", glass: "Glass and plates", back: "Back", next: "Next", saved: "Saved", savedOffline: "Saved on this device", another: "Log another", offline: "Offline", lock: "Lock" },
  ar: { title: "تسجيل الهدر", pin: "أدخل الرقم السري", pinHint: "الرقم التجريبي: 2580", wrong: "الرقم السري غير صحيح. حاول مرة أخرى.", step1: "ما هو الصنف؟", step2: "ما الكمية؟", step3: "ما السبب؟", ingredients: "مكونات", dishes: "أطباق", glass: "زجاج وأطباق", back: "رجوع", next: "التالي", saved: "تم الحفظ", savedOffline: "تم الحفظ على هذا الجهاز", another: "تسجيل آخر", offline: "غير متصل", lock: "قفل" },
};

const REASON_ICON: Record<WasteReason, LucideIcon> = { waste: Trash2, breakage: Hammer, spoilage: Apple, damaged: PackageX, other: HelpCircle };

function iconFor(id: string, kind: "ingredient" | "dish"): LucideIcon {
  if (kind === "dish") return Soup;
  const g = ingredientById[id];
  if (g.dept === "glassware") return GlassWater;
  if (g.supplierId === "meat") return Beef;
  if (g.supplierId === "sea") return Fish;
  if (g.supplierId === "produce") return Salad;
  if (["milk", "cream", "butter", "cheddar", "parmesan", "mozzarella", "creamcheese", "labneh", "icecream"].includes(id)) return Milk;
  if (id === "coffee") return Coffee;
  if (g.supplierId === "bev") return Wine;
  return Wheat;
}

type Pick = { kind: "ingredient" | "dish"; id: string };
type Group = "ingredients" | "dishes" | "glass";

export function WasteLogger({ propertyId }: { propertyId: string }) {
  const user = useUser()!;
  const ctx = useCtx();
  const lang = useDemo((s) => s.lang);
  const setLang = useDemo((s) => s.setLang);
  const offline = useDemo((s) => s.offline);
  const setOffline = useDemo((s) => s.setOffline);
  const logWaste = useDemo((s) => s.logWaste);
  const userLogs = useDemo((s) => s.wasteLogs);
  const t = T[lang];
  const property = propertyById[propertyId];
  const money = (n: number) => fmtMoney(n, property.currency, { decimals: true });

  const outlets = useMemo(() => {
    const allowed = user.outletIds === "all" ? null : user.outletIds;
    return Object.values(outletById).filter((o) => o.propertyId === propertyId && (!allowed || allowed.includes(o.id)));
  }, [user, propertyId]);
  // Start on the outlet chosen in the top bar when there is one.
  const { sel } = useView();
  const preferred = sel.outletIds.length === 1 && outlets.some((o) => o.id === sel.outletIds[0]) ? sel.outletIds[0] : outlets[0]?.id;
  const [outletId, setOutletId] = useState(preferred ?? "");
  const outlet = outlets.find((o) => o.id === outletId) ?? outlets[0];

  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [group, setGroup] = useState<Group>("ingredients");
  const [pick, setPick] = useState<Pick | null>(null);
  const [qty, setQty] = useState("1");
  const [last, setLast] = useState<{ cost: number; label: string; synced: boolean } | null>(null);

  // Follow the browser's own connection state as well as the demo switch.
  useEffect(() => {
    const down = () => setOffline(true);
    const up = () => setOffline(false);
    window.addEventListener("offline", down);
    window.addEventListener("online", up);
    return () => {
      window.removeEventListener("offline", down);
      window.removeEventListener("online", up);
    };
  }, [setOffline]);

  const press = (d: string) => {
    const next = (pin + d).slice(0, 4);
    setPin(next);
    setPinError(false);
    if (next.length === 4) {
      if (next === DEMO_PIN) setUnlocked(true);
      else setPinError(true);
      setPin("");
    }
  };

  const tiles = useMemo(() => {
    if (!outlet) return [];
    if (group === "dishes") return outlet.menu.filter((m) => itemById[m.itemId].recipe && itemById[m.itemId].dept === "food").map((m) => ({ kind: "dish" as const, id: m.itemId, en: itemById[m.itemId].name, ar: itemById[m.itemId].nameAr }));
    if (group === "glass") return INGREDIENTS.filter((g) => g.dept === "glassware").map((g) => ({ kind: "ingredient" as const, id: g.id, en: g.name, ar: g.nameAr }));
    const used = new Set(outlet.menu.flatMap((m) => itemById[m.itemId].recipe?.map((l) => l.ingredientId) ?? []));
    return INGREDIENTS.filter((g) => used.has(g.id)).sort((a, b) => a.shelfLifeDays - b.shelfLifeDays).map((g) => ({ kind: "ingredient" as const, id: g.id, en: g.name, ar: g.nameAr }));
  }, [outlet, group]);

  const unit = pick?.kind === "ingredient" ? ingredientById[pick.id].unit : "each";
  const unitLabel = unit === "each" ? (lang === "ar" ? "حبة" : pick?.kind === "dish" ? "portions" : "units") : unit;
  const chips = unit === "each" ? [1, 2, 3, 5, 10] : [0.25, 0.5, 1, 2, 5];
  const bump = (d: number) => setQty((q) => String(Math.max(0, Math.round(((Number(q) || 0) + d) * 100) / 100)));
  const label = (p: Pick) => (p.kind === "dish" ? itemById[p.id] : ingredientById[p.id])[lang === "ar" ? "nameAr" : "name"];

  const submit = (reason: WasteReason) => {
    if (!pick || !outlet) return;
    const entry = { outletId: outlet.id, qty: Number(qty), reason, ...(pick.kind === "dish" ? { itemId: pick.id } : { ingredientId: pick.id }) };
    const result = logWaste(entry);
    if (!result.ok) return toast.error(result.error);
    const cost = wasteCost({ ...entry, id: "", date: DEMO_TODAY, by: "", synced: true, seq: 0 }, ctx.overrides);
    setLast({ cost, label: `${fmtQty(Number(qty), unit)} ${unit === "each" ? "× " : ""}${label(pick)}`, synced: !offline });
    setStep(4);
  };
  const reset = () => {
    setStep(1);
    setPick(null);
    setQty("1");
  };

  const mine = userLogs.filter((w) => outletById[w.outletId].propertyId === propertyId).slice().reverse();
  const pending = userLogs.filter((w) => !w.synced).length;
  const { data: stockData } = useServerStock(propertyId);
  const position = useMemo(() => stockData?.rows ?? [], [stockData]);
  const lastEntry = mine[0];
  const lastIngredient = lastEntry?.ingredientId ?? (lastEntry?.itemId ? itemById[lastEntry.itemId].recipe?.[0]?.ingredientId : undefined);
  const lastRow = position.find((r) => r.ingredientId === lastIngredient);

  if (!can(user, "stock.logWaste") || !outlet) {
    return <Panel title="Log waste"><Note>Your role cannot log waste. Kitchen, bar and outlet management accounts can.</Note></Panel>;
  }

  return (
    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(340px,420px)_1fr]">
      <div className="mx-auto w-full max-w-[420px] overflow-hidden rounded-[34px] border border-line bg-paper shadow-float" dir={lang === "ar" ? "rtl" : "ltr"} style={lang === "ar" ? { fontFamily: "var(--font-arabic)" } : undefined}>
        <div className="flex items-center justify-between gap-2 border-b border-hair px-5 py-4">
          <div className="min-w-0">
            <p className="text-lg leading-tight">{t.title}</p>
            <p className="truncate text-xs text-steel">{outletLabel(outlet.id)}</p>
          </div>
          <div className="flex items-center gap-1.5">
            {offline && <Badge tone="warn"><CloudOff size={12} /> {t.offline}</Badge>}
            <button type="button" onClick={() => setLang(lang === "en" ? "ar" : "en")} className="flex h-10 items-center gap-1.5 rounded-full border border-line px-3 text-sm hover:bg-mist" aria-label="Switch language between English and Arabic">
              <Languages size={16} aria-hidden /> {lang === "en" ? "العربية" : "English"}
            </button>
          </div>
        </div>

        {!unlocked ? (
          <div className="px-6 pb-7 pt-6 text-center">
            <p className="text-[15px]">{t.pin}</p>
            <div className="my-5 flex justify-center gap-3" aria-label={`${pin.length} of 4 digits entered`}>
              {[0, 1, 2, 3].map((i) => <span key={i} className={cn("h-3.5 w-3.5 rounded-full border", i < pin.length ? "border-ink bg-ink" : "border-fog")} />)}
            </div>
            <p className={cn("min-h-5 text-xs", pinError ? "text-neg" : "text-steel")} role="status">{pinError ? t.wrong : t.pinHint}</p>
            <div className="mx-auto mt-4 grid max-w-[264px] grid-cols-3 gap-3" dir="ltr">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => <button key={d} type="button" onClick={() => press(d)} className="num h-16 rounded-2xl border border-line text-2xl transition-colors hover:bg-mist active:bg-hair">{d}</button>)}
              <span />
              <button type="button" onClick={() => press("0")} className="num h-16 rounded-2xl border border-line text-2xl hover:bg-mist active:bg-hair">0</button>
              <button type="button" onClick={() => setPin((p) => p.slice(0, -1))} aria-label="Delete last digit" className="flex h-16 items-center justify-center rounded-2xl text-steel hover:bg-mist"><Delete size={22} /></button>
            </div>
          </div>
        ) : (
          <div className="px-5 pb-6 pt-4">
            {step < 4 && (
              <ol className="mb-4 flex gap-1.5" aria-label={`Step ${step} of 3`}>
                {[1, 2, 3].map((n) => <li key={n} className={cn("h-1.5 flex-1 rounded-full", n <= step ? "bg-ink" : "bg-hair")} />)}
              </ol>
            )}

            {step === 1 && (
              <>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xl">{t.step1}</p>
                  {outlets.length > 1 && (
                    <Select label="Outlet" hideLabel className="w-[150px]" value={outlet.id} onChange={(e) => setOutletId(e.target.value)}>
                      {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </Select>
                  )}
                </div>
                <div className="mt-3 grid grid-cols-3 gap-1 rounded-full border border-line p-1 text-[13px]">
                  {(["ingredients", "dishes", "glass"] as Group[]).map((g) => <button key={g} type="button" onClick={() => setGroup(g)} className={cn("h-10 rounded-full", group === g ? "bg-ink text-paper" : "text-steel")}>{t[g]}</button>)}
                </div>
                <div className="scroll-thin mt-3 grid max-h-[420px] grid-cols-3 gap-2 overflow-y-auto pb-1">
                  {tiles.map((tile) => {
                    const Icon = iconFor(tile.id, tile.kind);
                    return (
                      <button key={tile.id} type="button" onClick={() => { setPick({ kind: tile.kind, id: tile.id }); setQty("1"); setStep(2); }} className="flex min-h-[96px] flex-col items-center justify-center gap-2 rounded-2xl border border-line px-1.5 py-3 text-center transition-colors hover:border-ink hover:bg-cloud active:bg-mist">
                        <Icon size={26} strokeWidth={1.5} aria-hidden />
                        <span className="text-[12.5px] leading-tight">{tile[lang]}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {step === 2 && pick && (
              <>
                <p className="text-xl">{t.step2}</p>
                <p className="text-sm text-steel">{label(pick)}</p>
                <div className="my-5 flex items-center justify-center gap-4" dir="ltr">
                  <button type="button" onClick={() => bump(unit === "each" ? -1 : -0.25)} aria-label="Less" className="h-16 w-16 rounded-full border border-line text-3xl hover:bg-mist">−</button>
                  <div className="text-center">
                    <input aria-label="Quantity" type="number" inputMode="decimal" min="0" step={unit === "each" ? 1 : 0.05} value={qty} onChange={(e) => setQty(e.target.value)} className="num w-32 border-b-2 border-ink bg-transparent text-center text-5xl tracking-[-0.03em] outline-none" />
                    <p className="mt-1 text-sm text-steel">{unitLabel}</p>
                  </div>
                  <button type="button" onClick={() => bump(unit === "each" ? 1 : 0.25)} aria-label="More" className="h-16 w-16 rounded-full border border-line text-3xl hover:bg-mist">+</button>
                </div>
                <div className="flex flex-wrap justify-center gap-2" dir="ltr">
                  {chips.map((c) => <button key={c} type="button" onClick={() => setQty(String(c))} className={cn("num h-11 min-w-14 rounded-full border px-3 text-sm", Number(qty) === c ? "border-ink bg-ink text-paper" : "border-line hover:bg-mist")}>{c}</button>)}
                </div>
                <div className="mt-6 flex gap-2">
                  <Button size="lg" className="flex-1" onClick={() => setStep(1)}><ChevronLeft size={16} className={lang === "ar" ? "rotate-180" : ""} /> {t.back}</Button>
                  <Button size="lg" variant="primary" className="flex-1" disabled={!(Number(qty) > 0)} onClick={() => setStep(3)}>{t.next}</Button>
                </div>
              </>
            )}

            {step === 3 && pick && (
              <>
                <p className="text-xl">{t.step3}</p>
                <p className="num text-sm text-steel">{fmtQty(Number(qty), unit)} {unit === "each" ? "× " : ""}{label(pick)}</p>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {(Object.keys(REASON_LABEL) as WasteReason[]).map((r) => {
                    const Icon = REASON_ICON[r];
                    return (
                      <button key={r} type="button" onClick={() => submit(r)} className={cn("flex min-h-[92px] flex-col items-center justify-center gap-2 rounded-2xl border border-line text-[15px] transition-colors hover:border-ink hover:bg-cloud active:bg-mist", r === "other" && "col-span-2 min-h-[64px] flex-row")}>
                        <Icon size={26} strokeWidth={1.5} aria-hidden /> {REASON_LABEL[r][lang]}
                      </button>
                    );
                  })}
                </div>
                <Button size="lg" className="mt-4 w-full" onClick={() => setStep(2)}><ChevronLeft size={16} className={lang === "ar" ? "rotate-180" : ""} /> {t.back}</Button>
              </>
            )}

            {step === 4 && last && (
              <div className="py-8 text-center">
                <span className={cn("mx-auto flex h-16 w-16 items-center justify-center rounded-full", last.synced ? "bg-pos-soft text-pos" : "bg-warn-soft text-warn")}>{last.synced ? <Check size={30} /> : <CloudOff size={28} />}</span>
                <p className="mt-4 text-xl">{last.synced ? t.saved : t.savedOffline}</p>
                <p className="num mt-1 text-sm text-steel">{last.label} · {money(last.cost)}</p>
                <Button size="lg" variant="primary" className="mt-6 w-full" onClick={reset}>{t.another}</Button>
                <button type="button" className="mt-3 text-sm text-steel underline underline-offset-4" onClick={() => { setUnlocked(false); reset(); }}>{t.lock}</button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="space-y-5">
        <Panel title="What your entries changed" description="Each entry lowers estimated stock and adds to the waste figures on the Overview, in Reports and in waste analytics.">
          {mine.length === 0 ? (
            <p className="text-sm text-graphite">Nothing logged yet in this session. Unlock the app with the demo PIN and log an item to see stock and waste cost move.</p>
          ) : (
            <>
              {lastRow && lastEntry?.synced && (
                <div className="mb-5 rounded-2xl bg-mist px-5 py-4 text-sm">
                  <p className="text-steel">Estimated stock of {ingredientById[lastRow.ingredientId].name.toLowerCase()} after your last entry</p>
                  <p className="num mt-1 text-2xl tracking-[-0.02em]">{fmtQty(lastRow.estimated, ingredientById[lastRow.ingredientId].unit)}</p>
                </div>
              )}
              <ul className="divide-y divide-hair">
                {mine.slice(0, 8).map((w) => {
                  const name = w.ingredientId ? ingredientById[w.ingredientId].name : itemById[w.itemId!].name;
                  const u = w.ingredientId ? ingredientById[w.ingredientId].unit : "each";
                  return (
                    <li key={w.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                      <span><span className="num text-ink">{fmtQty(w.qty, u)} {u === "each" ? "× " : ""}{name}</span><span className="block text-xs text-steel">{REASON_LABEL[w.reason].en} · {outletById[w.outletId].name} · {personName(w.by)}</span></span>
                      <span className="flex items-center gap-3"><span className="num">{money(wasteCost(w, ctx.overrides))}</span>{w.synced ? <Badge tone="pos">in reports</Badge> : <Badge tone="warn">waiting to sync</Badge>}</span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Panel>

        <Panel title="Working without a connection" description="Kitchens and stores often have no signal. Entries made offline are kept on the device and released when the connection returns.">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <label className="flex cursor-pointer items-center gap-3 text-sm">
              <input type="checkbox" className="h-5 w-5 accent-ink" checked={offline} onChange={(e) => setOffline(e.target.checked)} />
              Simulate losing the connection
            </label>
            <p className="num text-sm text-graphite">{pending} entr{pending === 1 ? "y" : "ies"} waiting to synchronise</p>
          </div>
          <Note className="mt-3 max-w-[90ch]">Offline entries stay out of stock and reports until they synchronise. In this demo they synchronise into this browser&rsquo;s storage as soon as you untick the box or the browser reconnects. Synchronising to a Tyll server, with conflict handling across devices, is planned and not built here.</Note>
        </Panel>
      </div>
    </div>
  );
}
