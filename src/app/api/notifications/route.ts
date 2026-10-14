import type { NextRequest } from "next/server";
import { guard, json, sameOrigin } from "@/lib/server/guard";
import { deliverQueued, emailsFor, markRead, noticesFor, setEmailPref } from "@/lib/server/notify";

/** This person's notifications. Any queued emails are handed to the provider, when one is configured. */
export async function GET(req: NextRequest) {
  const g = guard(req, {});
  if (!g.ok) return g.response;
  void deliverQueued();
  return json({ ...noticesFor(g.user), emails: req.nextUrl.searchParams.get("emails") ? emailsFor(g.user) : undefined });
}

/** Mark notifications read, or switch email on or off for this person. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const g = guard(req, {});
  if (!g.ok) return g.response;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (body.action === "prefs") setEmailPref(g.user, body.email === true);
  else markRead(g.user, body);
  return json(noticesFor(g.user));
}
