import type { NextRequest } from "next/server";
import { ADMIN_COOKIE, GITHUB_COOKIE } from "@/lib/server/admin";
import { json, sameOrigin } from "@/lib/server/guard";

/** Signs out of the visits page on this browser. */
export function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const res = json({ ok: true });
  for (const name of [ADMIN_COOKIE, GITHUB_COOKIE]) res.cookies.set({ name, value: "", path: "/", maxAge: 0 });
  return res;
}
