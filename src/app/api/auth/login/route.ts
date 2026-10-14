import type { NextRequest } from "next/server";
import { login } from "@/lib/server/auth";
import { clientIp, json, sameOrigin, sessionCookie } from "@/lib/server/guard";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const body = (await req.json().catch(() => ({}))) as { email?: unknown; password?: unknown };
  if (typeof body.email !== "string" || typeof body.password !== "string" || !body.email || !body.password || body.email.length > 200 || body.password.length > 200) {
    return json({ error: "Enter your email and password." }, 400);
  }
  const result = login(body.email, body.password, clientIp(req));
  if (!result.ok) return json({ error: result.error, attemptsLeft: result.attemptsLeft, retryAfter: result.retryAfter }, result.status, result.retryAfter ? { "Retry-After": String(result.retryAfter) } : undefined);
  const res = json({ user: { id: result.user.id, name: result.user.name, role: result.user.role } });
  res.cookies.set(sessionCookie(result.token));
  return res;
}
