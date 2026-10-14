"use client";
// Rooms and guest service: server records, reloaded after every change so every department sees the same thing.
import { useEffect, useState } from "react";
import { api } from "./api";
import { usePlanDrafts } from "./plan-hooks";
import type { RoomsBoard } from "./server/guest";
import type { BellTask } from "./types";

export function useLiveGet<T>(url: string | null, everyMs = 30000) {
  const version = usePlanDrafts((s) => s.version);
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<{ key: string; data?: T; error?: string } | null>(null);
  const key = url ? `${url}#${version}#${tick}` : null;
  // Other departments change these records too, so they refresh on a timer as well as after the user's own changes.
  useEffect(() => {
    if (!url) return;
    const t = setInterval(() => setTick((n) => n + 1), everyMs);
    return () => clearInterval(t);
  }, [url, everyMs]);
  useEffect(() => {
    if (!url || !key) return;
    let live = true;
    api<T>(url).then((data) => live && setState({ key, data })).catch((e: unknown) => live && setState({ key, error: e instanceof Error ? e.message : "Could not load." }));
    return () => { live = false; };
  }, [url, key]);
  return { data: state?.data, error: state?.error };
}

export const useRoomsBoard = (enabled = true) => useLiveGet<{ board: RoomsBoard }>(enabled ? "/api/guest/rooms" : null);
export type BellRow = BellTask & { assigneeName?: string; overdue: boolean; age: number };
export const useBell = (enabled = true) => useLiveGet<{ tasks: BellRow[]; team: { id: string; name: string; onShift: boolean }[]; now: number; mine?: boolean }>(enabled ? "/api/guest/bell" : null);

/** "21:30" from minutes of the day. */
export const hm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(Math.round(m) % 60).padStart(2, "0")}`;
