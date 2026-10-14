import type { NextRequest } from "next/server";
import { DEMO_MODE, SESSION_COOKIE, demoAccounts, resolveSession } from "@/lib/server/auth";
import { json } from "@/lib/server/guard";

/** Who is signed in and whether management data is unlocked. Checking does not extend the PIN unlock. */
export async function GET(req: NextRequest) {
  const view = resolveSession(req.cookies.get(SESSION_COOKIE)?.value, { touch: true });
  if (!view) return json({ error: "Sign in to continue." }, 401);
  const demoPin = DEMO_MODE && view.pinRequired ? demoAccounts().find((a) => a.userId === view.user.id)?.pin : undefined;
  return json({ userId: view.user.id, pinRequired: view.pinRequired, pinUnlocked: view.pinUnlocked, pinExpiresAt: view.pinExpiresAt, sessionExpiresAt: view.sessionExpiresAt, demoPin });
}
