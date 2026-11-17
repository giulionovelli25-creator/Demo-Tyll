"use client";
// The pilot offer waits for a useful moment: a built order, an opened flag or invoice. Then it stays, small, in the top bar.
import { useEffect } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export const usePilot = create<{ earned: boolean; earn(): void }>()(persist((set) => ({ earned: false, earn: () => set({ earned: true }) }), { name: "tyll-pilot-v1" }));

/** Call on a page that just showed something worth money. */
export function useEarnPilot(when = true) {
  const earn = usePilot((s) => s.earn);
  useEffect(() => { if (when) earn(); }, [when, earn]);
}

export const PILOT_URL = "https://tyll.ai/en/";
