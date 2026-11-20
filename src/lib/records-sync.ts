"use client";
// Keeps the browser's copy of the saved records in step with the demo server (overnight feature 8). Each change made
// here is sent once, with its own key, so a retry after a dropped connection is not saved twice. The server answers
// with this person's records; a change it refuses is taken back and the reason shown. While offline, changes wait
// on this device and go as soon as the connection returns.
import { useEffect } from "react";
import { create } from "zustand";
import { ApiError, api } from "./api";
import { toast } from "../components/ui";
import type { Records } from "./domain/records";
import { useDemo } from "./store";
import type { User } from "./types";

export interface RecordsMeta {
  /** Public demo: when this visitor's workspace started and was last used, and how long it is kept after that. */
  workspace: { startedAt: string; lastUsedAt: string; keptHours: number } | null;
  /** True outside the public demo, where everyone at the hotel shares one set of records. */
  shared: boolean;
  loaded: boolean;
}

export const useRecordsMeta = create<RecordsMeta>(() => ({ workspace: null, shared: true, loaded: false }));

type Out = { records: Records; workspace: RecordsMeta["workspace"]; shared: boolean };

const take = (out: Out, confirmed?: string) => {
  useDemo.getState().receiveRecords(out.records, confirmed);
  useRecordsMeta.setState({ workspace: out.workspace, shared: out.shared, loaded: true });
};

/** Bumped each time the server confirms a change, so an older read that arrives later never undoes it. */
let confirmedVersion = 0;

export async function pullRecords() {
  const v = confirmedVersion;
  const out = await api<Out>("/api/records");
  if (v === confirmedVersion) take(out);
}

let flushing = false;

/** Sends this person's unconfirmed changes, oldest first. Stops at the first one that cannot reach the server. */
export async function flushRecords(userId: string) {
  if (flushing) return;
  flushing = true;
  try {
    for (;;) {
      const s = useDemo.getState();
      if (s.offline || s.userId !== userId) break;
      const next = s.pendingOps.find((p) => p.userId === userId);
      if (!next) break;
      try {
        const out = await api<Out>("/api/records", { method: "POST", body: { key: next.key, op: next.op } });
        confirmedVersion++;
        take(out, next.key);
      } catch (e) {
        // Refused by the server's own check: take the change back and say why. Anything else is tried again later.
        if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 423) {
          useDemo.getState().dropPending(next.key);
          toast.error(`Not saved: ${e.message}`);
          await pullRecords().catch(() => undefined);
          continue;
        }
        break;
      }
    }
  } finally {
    flushing = false;
  }
}

/** Loads the saved records for the person signed in, sends changes as they are made, and refreshes every 30 seconds. */
export function RecordsSync({ user }: { user: User }) {
  const pending = useDemo((s) => s.pendingOps.length);
  const offline = useDemo((s) => s.offline);
  useEffect(() => {
    let live = true;
    const pull = () => pullRecords().catch(() => live && useRecordsMeta.setState({ loaded: true }));
    void flushRecords(user.id).then(pull);
    const t = setInterval(() => { void flushRecords(user.id).then(pull); }, 30000);
    return () => { live = false; clearInterval(t); };
  }, [user]);
  useEffect(() => {
    if (pending > 0 && !offline) void flushRecords(user.id);
  }, [user, pending, offline]);
  return null;
}
