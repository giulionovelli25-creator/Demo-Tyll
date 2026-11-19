import type { NextRequest } from "next/server";
import { json, sameOrigin } from "@/lib/server/guard";
import { SESSION_COOKIE, resolveSession } from "@/lib/server/auth";
import { deliverAlerts, eraseVisitor, recordLeave, recordView } from "@/lib/server/visits";

/** A page opened, or left, by a visitor who agreed to be recorded. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (body.event === "leave") {
    const r = recordLeave(body.visitorId, body.viewId, body.seconds);
    return r.ok ? json({ ok: true }) : json({ error: r.error }, r.status);
  }
  const session = resolveSession(req.cookies.get(SESSION_COOKIE)?.value);
  const r = recordView({ visitorId: body.visitorId, path: body.path, consent: body.consent, userAgent: req.headers.get("user-agent") ?? "", sessionUserId: session?.user.id, gpc: req.headers.get("sec-gpc") === "1" });
  if (!r.ok) return json({ error: r.error }, r.status);
  if ("viewId" in r && r.alerts.length) void deliverAlerts(r.alerts.map((a) => a.id));
  return json("viewId" in r ? { viewId: r.viewId } : { skipped: r.skipped });
}

/** The visitor withdrew: erase what was recorded for them. */
export async function DELETE(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const r = eraseVisitor(body.visitorId);
  return r.ok ? json(r) : json({ error: r.error }, r.status);
}
