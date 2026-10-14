"use client";
// Events and staff support: server records, reloaded after every change so every screen agrees.
import { useEffect, useState } from "react";
import { api } from "./api";
import { usePost, useSessionEntries } from "./hooks";
import { usePlanDrafts } from "./plan-hooks";
import type { Candidate, EventDetail, OpsAlert } from "./server/ops";
import type { Assignment, EventRecord, SupportRequest } from "./types";

function useLive<T>(url: string | null) {
  const version = usePlanDrafts((s) => s.version);
  const [state, setState] = useState<{ key: string; data?: T; error?: string } | null>(null);
  const key = url ? `${url}#${version}` : null;
  useEffect(() => {
    if (!url || !key) return;
    let live = true;
    api<T>(url).then((data) => live && setState({ key, data })).catch((e: unknown) => live && setState({ key, error: e instanceof Error ? e.message : "Could not load." }));
    return () => { live = false; };
  }, [url, key]);
  return { data: state?.data, error: state?.error, loading: !!key && state?.key !== key };
}

export const useEvents = (enabled = true) => useLive<{ events: EventRecord[] }>(enabled ? "/api/events" : null);
export const useSupport = (enabled = true) => useLive<{ requests: SupportRequest[]; manages: string[]; canRequestFor: string[] }>(enabled ? "/api/support" : null);
export const useSchedule = (deptId: string | null, date: string) => useLive<{ rows: { employeeId: string; name: string; title: string; shift?: string; away: string[]; leave?: string }[]; borrowed: { name: string; from: string; time: string; for: string }[] }>(deptId ? `/api/schedule?dept=${deptId}&date=${date}` : null);
export const useMyAssignments = (enabled = true) => useLive<{ assignments: (Assignment & { where: string; for: string; skillLabel: string })[] }>(enabled ? "/api/me/assignments" : null);

/** One event with its requirements. Sent with this session's stock corrections so ingredient figures match Stock. */
export function useEventDetail(id: string | null) {
  const entries = useSessionEntries();
  const version = usePlanDrafts((s) => s.version);
  return usePost<{ detail: EventDetail }>(`/api/events/${id}`, id ? { action: "read", version, ...entries } : null);
}

export function useOpsAlerts(enabled = true) {
  const entries = useSessionEntries();
  const version = usePlanDrafts((s) => s.version);
  return usePost<{ alerts: OpsAlert[] }>("/api/ops/alerts", enabled ? { ...entries, version } : null);
}

export function useCandidates(body: Record<string, unknown> | null) {
  const version = usePlanDrafts((s) => s.version);
  return usePost<{ candidates: Candidate[]; note: string }>("/api/staff/find", body ? { ...body, version } : null, 200);
}

/** Minutes from midnight to "18:00", and back. */
export const toHm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export const fromHm = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 0;
};
