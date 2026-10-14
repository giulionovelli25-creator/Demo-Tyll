import type { NextRequest } from "next/server";
import { userById } from "@/lib/data/catalog";
import { readAudit } from "@/lib/server/auth";
import { guard, json } from "@/lib/server/guard";

export async function GET(req: NextRequest) {
  const g = guard(req, { permission: "settings.audit" });
  if (!g.ok) return g.response;
  return json({ entries: readAudit().map((a) => ({ ...a, name: a.userId ? (userById[a.userId]?.name ?? a.userId) : "Unknown" })) });
}
