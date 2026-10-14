"use client";
// Fetch wrapper for the protected API. A 401 sends the user to sign in; a 423 locks the screen.
import { create } from "zustand";
import { clearDataset } from "./data/dataset";

export type SessionStatus = "loading" | "locked" | "ready";

interface SessionState {
  status: SessionStatus;
  userId: string | null;
  demoPin?: string;
  pinExpiresAt: number | null;
  set(patch: Partial<Omit<SessionState, "set">>): void;
}

export const useSession = create<SessionState>((set) => ({ status: "loading", userId: null, pinExpiresAt: null, set: (patch) => set(patch) }));

export class ApiError extends Error {
  constructor(public status: number, message: string, public body: Record<string, unknown> = {}) {
    super(message);
  }
}

/** A full page load, used whenever the signed-in person changes so no data from the last session stays in memory. */
export function reloadTo(path: string) {
  window.location.assign(path);
}

export function goToLogin() {
  const next = window.location.pathname + window.location.search;
  reloadTo(next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`);
}

export function lockLocally() {
  clearDataset();
  useSession.getState().set({ status: "locked", pinExpiresAt: null });
}

export async function api<T>(url: string, init?: { method?: "GET" | "POST"; body?: unknown }): Promise<T> {
  const res = await fetch(url, {
    method: init?.method ?? "GET",
    headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 401 && !url.startsWith("/api/auth/")) goToLogin();
  if (res.status === 423) lockLocally();
  if (!res.ok) throw new ApiError(res.status, typeof body.error === "string" ? body.error : "Something went wrong.", body);
  return body as T;
}
