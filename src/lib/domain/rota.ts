// Who was rostered behind the bar and on the floor, shift by shift. Simulated in this demo: the POS has logins, not a rota,
// and every login rings bills every day. A live version reads the rota from the hotel's scheduling system.
import { STAFF } from "../data/catalog";
import { hashString } from "../util";
import type { Shift } from "./pour";

const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/**
 * The demo's planted story, matching the seeded over pouring at Bar Azulejo: its bartender works every Friday, Saturday
 * and Sunday day shift, which are the shifts losing most. Everyone else follows an ordinary rota.
 */
const FIXED: Record<string, (wd: number) => "day" | "evening" | null> = {
  "lis-lobby": (wd) => (wd === 5 || wd === 6 || wd === 0 ? "day" : wd === 1 || wd === 2 ? null : "evening"),
};

/** The shift a person works on a date, or null on a day off. Five days a week; two days off together. */
function shiftOfPerson(staffId: string, outletId: string, role: string, date: string): "day" | "evening" | null {
  const wd = weekday(date);
  if (role === "bartender" && FIXED[outletId]) return FIXED[outletId](wd);
  const off = hashString(staffId) % 7;
  if (wd === off || wd === (off + 1) % 7) return null;
  return hashString(`${staffId}|${date}`) % 2 === 0 ? "day" : "evening";
}

/** Who was on one shift at one outlet. The late shift is worked by the evening team. */
export function rostered(outletId: string, date: string, shift: Shift): string[] {
  const want = shift === "late" ? "evening" : shift;
  const team = STAFF.filter((s) => s.outletId === outletId && (s.role === "server" || s.role === "bartender" || s.role === "supervisor"));
  const on = team.filter((s) => s.role !== "supervisor" && shiftOfPerson(s.id, outletId, s.role, date) === want).map((s) => s.id);
  // When the bartender is off, the supervisor runs the bar.
  const bartender = team.find((s) => s.role === "bartender");
  const supervisor = team.find((s) => s.role === "supervisor");
  if (bartender && !on.includes(bartender.id) && supervisor) on.push(supervisor.id);
  return on;
}
