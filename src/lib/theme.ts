"use client";
// Light is the default. Dark is an optional toggle; the inline script in app/layout.tsx applies a saved choice before first paint.
import { useSyncExternalStore } from "react";

export type Theme = "dark" | "light";
const KEY = "tyll-theme-v2";
const listeners = new Set<() => void>();

const read = (): Theme => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");

export function useTheme(): [Theme, () => void] {
  const theme = useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, read, () => "light" as Theme);
  const toggle = () => {
    const next: Theme = read() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(KEY, next); } catch { /* private window */ }
    listeners.forEach((l) => l());
  };
  return [theme, toggle];
}
