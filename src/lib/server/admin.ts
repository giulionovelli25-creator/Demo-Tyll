// Who may open the visits page. With TYLL_ADMIN_KEY set, only someone who typed that key (kept as a signed cookie).
// Without it, only requests made on this computer (localhost), so a deployed demo without a key shows nothing.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export const ADMIN_COOKIE = "tyll_admin";
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const LOOPBACK = /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/;
/** Next.js fills x-forwarded-for with the caller's address; a proxy in front adds the real client's. Local only if all are loopback. */
const fromThisComputer = (req: NextRequest) => LOCAL.test(req.headers.get("host") ?? "") && (req.headers.get("x-forwarded-for") ?? "").split(",").map((x) => x.trim()).filter(Boolean).every((x) => LOOPBACK.test(x));
const sign = (key: string) => createHmac("sha256", key).update("tyll-admin-v1").digest("base64url");

export const adminKeySet = () => !!process.env.TYLL_ADMIN_KEY;

export function isAdmin(req: NextRequest): boolean {
  const key = process.env.TYLL_ADMIN_KEY;
  if (!key) return fromThisComputer(req);
  const got = req.cookies.get(ADMIN_COOKIE)?.value ?? "";
  const want = sign(key);
  return got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

/** The cookie value for a correct key, or null. */
export function adminCookieFor(typed: unknown): string | null {
  const key = process.env.TYLL_ADMIN_KEY;
  if (!key || typeof typed !== "string") return null;
  const a = Buffer.from(typed), b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b) ? sign(key) : null;
}
