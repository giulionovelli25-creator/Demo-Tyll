import type { NextRequest } from "next/server";
import { homePath } from "@/lib/domain/access";
import { PUBLIC_DEMO_ROLES, SESSION_COOKIE, startDemoSession } from "@/lib/server/auth";
import { freshenPublicDemo } from "@/lib/server/demo";
import { clientIp, json, sameOrigin, sessionCookie } from "@/lib/server/guard";

/** Public demo only: enter, or switch role, without a password or PIN. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const body = (await req.json().catch(() => ({}))) as { userId?: unknown };
  const userId = typeof body.userId === "string" ? body.userId : PUBLIC_DEMO_ROLES[0].userId;
  const result = startDemoSession(userId, clientIp(req), req.cookies.get(SESSION_COOKIE)?.value);
  if (!result.ok) return json({ error: result.error }, result.status);
  freshenPublicDemo();
  const res = json({ user: { id: result.user.id, name: result.user.name, role: result.user.role }, home: homePath(result.user) });
  res.cookies.set(sessionCookie(result.token));
  return res;
}
