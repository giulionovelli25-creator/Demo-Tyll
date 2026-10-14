import type { NextRequest } from "next/server";
import { SESSION_COOKIE, lockSession } from "@/lib/server/auth";
import { clientIp, json, sameOrigin } from "@/lib/server/guard";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  lockSession(req.cookies.get(SESSION_COOKIE)?.value, clientIp(req));
  return json({ ok: true });
}
