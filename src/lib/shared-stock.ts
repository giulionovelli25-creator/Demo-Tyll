"use client";
// Waste and counts saved on the server, held here for the screens that work out stock in the browser. Entries made
// on this device are uploaded once (each with its own key, so a retry is not saved twice) and then read back from
// the server like everyone else's. Offline entries wait on the device until the connection returns.
import { useEffect } from "react";
import { create } from "zustand";
import { api } from "./api";
import { usePlanDrafts } from "./plan-hooks";
import { useDemo } from "./store";
import type { SharedCount, SharedWaste, SharedWasteCorrection, User } from "./types";

interface SharedState {
  waste: SharedWaste[];
  corrections: SharedWasteCorrection[];
  counts: SharedCount[];
  set(v: Partial<Pick<SharedState, "waste" | "corrections" | "counts">>): void;
}

export const useShared = create<SharedState>()((set) => ({ waste: [], corrections: [], counts: [], set: (v) => set(v) }));

let running = false;

async function upload(user: User) {
  const s = useDemo.getState();
  if (s.offline || running) return;
  const me = user.staffId ?? user.id;
  const waste = s.wasteLogs.filter((w) => w.synced && w.by === me);
  const counts = s.counts.filter((c) => c.by === me);
  if (!waste.length && !counts.length) return;
  running = true;
  try {
    for (const w of waste) {
      const r = await api<{ entry: SharedWaste }>("/api/stock/waste", { method: "POST", body: { outletId: w.outletId, ingredientId: w.ingredientId, itemId: w.itemId, qty: w.qty, reason: w.reason, date: w.date, periodId: w.periodId, clientId: w.id } });
      // Corrections made to the entry on this device follow it to the server.
      for (const c of useDemo.getState().wasteCorrections.filter((x) => x.wasteId === w.id)) {
        const cr = await api<{ correction: SharedWasteCorrection }>(`/api/stock/waste/${r.entry.id}`, { method: "POST", body: { qty: c.qty, reason: c.reason, clientId: c.id } });
        useShared.setState((st) => ({ corrections: [...st.corrections.filter((x) => x.id !== cr.correction.id), cr.correction] }));
      }
      useShared.setState((st) => ({ waste: [...st.waste.filter((x) => x.id !== r.entry.id), r.entry] }));
      useDemo.getState().dropUploaded({ waste: [w.id] });
    }
    for (const c of counts) {
      const r = await api<{ count: SharedCount }>("/api/stock/counts", { method: "POST", body: { propertyId: c.propertyId, ingredientId: c.ingredientId, counted: c.counted, allocation: c.allocation, clientId: c.id } });
      useShared.setState((st) => ({ counts: [...st.counts.filter((x) => x.id !== r.count.id), r.count] }));
      useDemo.getState().dropUploaded({ counts: [c.id] });
    }
  } catch {
    // Left on the device; the next pass tries again.
  } finally {
    running = false;
  }
}

/** Keeps shared entries current, and uploads this device's own entries. Mounted once for signed-in users. */
export function SharedStockSync({ user }: { user: User }) {
  const version = usePlanDrafts((s) => s.version);
  const offline = useDemo((s) => s.offline);
  const local = useDemo((s) => s.wasteLogs.length + s.counts.length);
  useEffect(() => {
    let live = true;
    const pull = () => api<Pick<SharedState, "waste" | "corrections" | "counts">>("/api/stock/shared").then((d) => live && useShared.getState().set(d)).catch(() => undefined);
    void upload(user).then(pull);
    const t = setInterval(() => { void upload(user).then(pull); }, 30000);
    return () => { live = false; clearInterval(t); };
  }, [user, version, offline, local]);
  return null;
}
