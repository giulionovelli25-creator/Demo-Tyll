import { DEMO_MODE, demoAccounts } from "@/lib/server/auth";
import { json } from "@/lib/server/guard";

/** Demo only: lets testers fill in a fictional account. Disabled when TYLL_DEMO_MODE=off. */
export async function GET() {
  if (!DEMO_MODE) return json({ error: "Not available." }, 404);
  return json({ accounts: demoAccounts().map(({ userId, email, password }) => ({ userId, email, password })) });
}
