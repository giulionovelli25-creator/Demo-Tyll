// Public demo workspaces. Each visitor's browser carries its own workspace id in a cookie that outlives role switches,
// and every request works on that workspace's own copy of the demo records, started from the seeded demo data.
// Two prospects in the demo at the same time never see or overwrite each other's changes. Sign-in sessions, the
// accounts and the visit tracking stay in their own global files.
// Outside the public demo there is no workspace: everyone at the hotel shares one set of records, as in a real install.
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataFile } from "./data-file";

export const WORKSPACE_COOKIE = "tyll_ws";
/** A workspace nobody has used for this long is removed; the next visit with its cookie starts again from the demo data. */
export const WORKSPACE_TTL_MS = 24 * 60 * 60 * 1000;
/** At most this many workspaces are kept; beyond it the least recently used go first. */
export const WORKSPACE_MAX = 400;

const context = new AsyncLocalStorage<string | null>();
const VALID = /^[A-Za-z0-9_-]{22}$/;

export const isWorkspaceId = (v: unknown): v is string => typeof v === "string" && VALID.test(v);
export const newWorkspaceId = () => randomBytes(16).toString("base64url");

/** The workspace of the request being handled, or null when records are shared. */
export const workspaceId = (): string | null => context.getStore() ?? null;

/** Runs a function inside one workspace. Used by tests and by code that is handed an id. */
export const inWorkspace = <T>(id: string | null, run: () => T): T => context.run(isWorkspaceId(id) ? id : null, run);

/**
 * Puts the rest of this request in the visitor's workspace. Called by `guard()` before any record is read, so every
 * route that reads or writes the store works on the right copy. Only the public demo has workspaces.
 */
export function enterWorkspace(cookie: string | undefined, isPublicDemo: boolean) {
  context.enterWith(isPublicDemo && isWorkspaceId(cookie) ? cookie : null);
}

/** Where the workspaces live: beside the shared store, so tests that move the store move these too. */
export function workspaceRoot(): string {
  const shared = process.env.TYLL_PURCHASING_STORE;
  return shared ? path.join(path.dirname(shared), "workspaces") : dataFile("workspaces");
}

/** A file of the current workspace, such as its store or a purchase order PDF, or the shared file outside one. */
export function workspaceFile(name: string, shared: () => string): string {
  const id = workspaceId();
  return id ? path.join(workspaceRoot(), id, name) : shared();
}

export const workspaceCookie = (id: string) => ({
  name: WORKSPACE_COOKIE,
  value: id,
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production" && process.env.TYLL_LOCAL_HTTP !== "on",
  path: "/",
  maxAge: 30 * 24 * 60 * 60,
});

export interface WorkspaceInfo { id: string; startedAt: string; lastUsedAt: string }

/** When the current workspace was started and last changed, for the Settings page. */
export function workspaceInfo(): WorkspaceInfo | null {
  const id = workspaceId();
  if (!id) return null;
  const dir = path.join(workspaceRoot(), id);
  try {
    const st = fs.statSync(path.join(dir, "purchasing.json"));
    return { id, startedAt: fs.statSync(dir).birthtime.toISOString(), lastUsedAt: st.mtime.toISOString() };
  } catch {
    return null;
  }
}

let lastSweep = 0;
/** Removes workspaces unused for a day, and the oldest beyond the cap. Runs at most every ten minutes. */
export function sweepWorkspaces(now = Date.now(), force = false): string[] {
  if (!force && now - lastSweep < 10 * 60 * 1000) return [];
  lastSweep = now;
  const root = workspaceRoot();
  let dirs: { id: string; used: number }[];
  try {
    dirs = fs.readdirSync(root).filter(isWorkspaceId).map((id) => {
      const dir = path.join(root, id);
      let used = 0;
      try { used = fs.statSync(path.join(dir, "purchasing.json")).mtimeMs; } catch { used = fs.statSync(dir).mtimeMs; }
      return { id, used };
    });
  } catch {
    return [];
  }
  dirs.sort((a, b) => b.used - a.used);
  const gone = dirs.filter((d, i) => now - d.used > WORKSPACE_TTL_MS || i >= WORKSPACE_MAX).map((d) => d.id);
  for (const id of gone) fs.rmSync(path.join(root, id), { recursive: true, force: true });
  return gone;
}
