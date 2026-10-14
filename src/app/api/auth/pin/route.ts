import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifyPin } from "@/lib/server/auth";
import { clientIp, json, sameOrigin } from "@/lib/server/guard";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const body = (await req.json().catch(() => ({}))) as { pin?: unknown };
  if (typeof body.pin !== "string" || body.pin.length > 12) return json({ error: "Enter your PIN." }, 400);
  const result = verifyPin(req.cookies.get(SESSION_COOKIE)?.value, body.pin, clientIp(req));
  if (result.ok) return json({ ok: true });
  const res = json({ error: result.error, attemptsLeft: result.attemptsLeft, retryAfter: result.retryAfter, signedOut: result.signedOut }, result.status);
  if (result.signedOut) res.cookies.delete(SESSION_COOKIE);
  return res;
}
