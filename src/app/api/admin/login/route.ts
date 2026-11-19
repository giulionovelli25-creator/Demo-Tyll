import type { NextRequest } from "next/server";
import { ADMIN_COOKIE, adminCookieFor } from "@/lib/server/admin";
import { json, sameOrigin } from "@/lib/server/guard";

/** Exchanges the admin key for a cookie. Slow on a wrong key, to make guessing pointless. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const body = (await req.json().catch(() => ({}))) as { key?: unknown };
  const value = adminCookieFor(body.key);
  if (!value) {
    await new Promise((r) => setTimeout(r, 800));
    return json({ error: "That key is not right." }, 401);
  }
  const res = json({ ok: true });
  res.cookies.set({ name: ADMIN_COOKIE, value, httpOnly: true, sameSite: "strict", secure: req.nextUrl.protocol === "https:", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return res;
}
