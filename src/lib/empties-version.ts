"use client";
import { create } from "zustand";

/** Bumped after every empty bottle scan or undo, so Over pouring and the scan list fetch again. */
export const useEmptiesVersion = create<{ v: number; bump(): void }>((set) => ({ v: 0, bump: () => set((s) => ({ v: s.v + 1 })) }));
