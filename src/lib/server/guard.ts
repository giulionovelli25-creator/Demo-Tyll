// Request helpers shared by every API route.
import { NextResponse, type NextRequest } from "next/server";
import { can, canOpen, type ModuleId, type Permission } from "../domain/access";
import type { User } from "../types";
import { SESSION_COOKIE, resolveSession, type SessionView } from "./auth";

export const clientIp = (req: NextRequest) => req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";

export const json = (body: unknown, status = 200, headers?: Record<string, string>) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

/** Rejects cross-site form posts: state-changing requests must come from this origin as JSON. */
export function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (origin && host && new URL(origin).host !== host) return false;
  return (req.headers.get("content-type") ?? "").includes("application/json");
}

type Guarded = { ok: true; user: User; view: SessionView; token: string } | { ok: false; response: NextResponse };

/**
 * Every protected route starts here. Checks, in order: a live session, a recent PIN unlock
 * for management roles, then the module or permission the route needs.
 */
export function guard(req: NextRequest, need: { pin?: boolean; module?: ModuleId; permission?: Permission } = {}): Guarded {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const view = resolveSession(token, { touch: true, pinActivity: need.pin !== false });
  if (!token || !view) return { ok: false, response: json({ error: "Sign in to continue." }, 401) };
  if (need.pin !== false && view.pinRequired && !view.pinUnlocked) return { ok: false, response: json({ error: "Enter your PIN to continue.", locked: true }, 423) };
  if (need.module && !canOpen(view.user, need.module)) return { ok: false, response: json({ error: "Your role cannot open this." }, 403) };
  if (need.permission && !can(view.user, need.permission)) return { ok: false, response: json({ error: "Your role cannot do this." }, 403) };
  return { ok: true, user: view.user, view, token };
}

export const sessionCookie = (token: string) => ({
  name: SESSION_COOKIE,
  value: token,
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
});
