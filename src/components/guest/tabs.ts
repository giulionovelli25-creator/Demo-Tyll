import { can } from "@/lib/domain/access";
import type { User } from "@/lib/types";

export type RoomsTab = "readiness" | "housekeeping" | "requests" | "connect" | "tables" | "bell" | "service";
type Tab = RoomsTab;

/** Which choices a person sees. The owner gets the strategic view; departments get their own work. */
export function roomsTabs(user: User): Tab[] {
  const ops = can(user, "fo.desk") || can(user, "hk.manage") || can(user, "bell.dispatch");
  const strategic = can(user, "rooms.view") && !can(user, "fo.desk") && !can(user, "hk.manage") && !can(user, "bell.dispatch") && !can(user, "concierge");
  return ([
    (can(user, "fo.desk") || can(user, "hk.manage") || strategic) && "readiness",
    can(user, "hk.manage") && "housekeeping",
    (can(user, "concierge") || can(user, "fo.desk")) && "requests",
    can(user, "fo.desk") && "connect",
    can(user, "gc.respond") && !can(user, "fo.desk") && "tables",
    (can(user, "fo.desk") || can(user, "bell.dispatch")) && "bell",
    (strategic || user.role === "gm") && "service",
  ].filter(Boolean) as Tab[]).filter((t) => ops || strategic || t === "tables" || t === "requests" || t === "connect");
}

