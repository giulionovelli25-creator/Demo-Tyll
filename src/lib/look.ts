"use client";
// Which colours the app wears, chosen in the Try a look panel and kept in this browser. Applied as attributes on <html>; tokens.css does the rest.
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type LookColour = "sections" | "outlets" | "indigo" | "emerald" | "bronze" | "burgundy";
export type LookWaves = "soft" | "medium" | "strong";

export const useLook = create<{ colour: LookColour; waves: LookWaves; open: boolean; setColour(c: LookColour): void; setWaves(w: LookWaves): void; setOpen(o: boolean): void; reset(): void }>()(
  persist(
    (set) => ({
      colour: "sections",
      waves: "medium",
      open: false,
      setColour: (colour) => set({ colour }),
      setWaves: (waves) => set({ waves }),
      setOpen: (open) => set({ open }),
      reset: () => set({ colour: "sections", waves: "medium" }),
    }),
    { name: "tyll-look-v1", partialize: (s) => ({ colour: s.colour, waves: s.waves }) },
  ),
);
