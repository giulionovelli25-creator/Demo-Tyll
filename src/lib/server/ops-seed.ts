// Starting records for events and staffing. The Dubai conference continues the seeded event EV-1, including the 30 kg of
// chicken already issued to Banqueting (transfer T-7), so neither its guests nor that stock are counted twice.
import { DEFAULT_RATIOS, roleWindow, serviceFor, staffNeeds } from "../domain/events";
import { EMPLOYEES } from "../data/workforce";
import type { Assignment, EventRecord, StaffRatios } from "../types";

const at = "2026-10-13T08:00:00.000Z";
const h = (hh: number, mm = 0) => hh * 60 + mm;

export function seedOps() {
  const conference: EventRecord = {
    id: "EVT-DXB-0001", seedId: "EV-1", propertyId: "dxb", name: "Regional sales conference dinner", type: "Conference", venue: "Grand Ballroom",
    date: "2026-10-15", start: h(18), end: h(22), setupStart: h(16), cleanupEnd: h(23), guests: 180, format: "seated",
    dietary: "12 vegetarian, 3 gluten-free", notes: "Client may reduce numbers after final registration.", status: "planning", kitchenOutletId: "dxb-terrace",
    services: [serviceFor("set_menu", 180), serviceFor("soft_drinks", 180), serviceFor("wine", 180)],
    ratios: { ...DEFAULT_RATIOS.seated }, pricePerGuest: 320,
    issued: [{ ingredientId: "chicken", qty: 30, ref: "Transfer T-7, 13 Oct" }],
    createdBy: "u-fnb", updatedAt: at, history: [{ at, by: "u-fnb", action: "Event created", detail: "Carried over from the sales calendar." }],
  };
  const wedding: EventRecord = {
    id: "EVT-DOH-0001", seedId: "EV-2", propertyId: "doh", name: "Wedding reception", type: "Wedding", venue: "Pearl Ballroom",
    date: "2026-10-16", start: h(19), end: h(23, 30), setupStart: h(15), cleanupEnd: h(24, 30), guests: 240, format: "seated",
    dietary: "", notes: "", status: "planning", kitchenOutletId: "doh-souq",
    services: [serviceFor("three_course", 240), serviceFor("soft_drinks", 240)], ratios: { ...DEFAULT_RATIOS.seated },
    issued: [], createdBy: "u-owner", updatedAt: at, history: [{ at, by: "u-owner", action: "Event created" }],
  };
  // Each event's own banqueting team, already confirmed. The conference team is sized for 120 guests:
  // at 180 it is short across several roles; at 120 only waiters are short.
  const teamSize: Partial<Record<keyof StaffRatios, number>> = { waiter: 6, bartender: 3, chef: 3, setup: 4, supervisor: 2, runner: 3, cleaning: 3 };
  const assignments: Assignment[] = [];
  const book = (e: EventRecord, deptId: string) => {
    const pool = EMPLOYEES.filter((x) => x.deptId === deptId);
    const used = new Set<string>();
    for (const n of staffNeeds({ ...e, guests: e.id === conference.id ? 120 : e.guests })) {
      const want = e.id === conference.id ? teamSize[n.role] ?? 0 : n.required - (n.role === "waiter" ? 2 : 0);
      const people = pool.filter((p) => p.skills[0] === n.skill && !used.has(p.id)).slice(0, want);
      for (const p of people) {
        used.add(p.id);
        const w = roleWindow(e, n.role);
        assignments.push({ id: `AS-${e.id.slice(4)}-${p.id}`, employeeId: p.id, propertyId: e.propertyId, fromDeptId: deptId, toDeptId: deptId, eventId: e.id, date: e.date, start: w.start, end: w.end, skill: n.skill, status: "confirmed", approvedBy: e.createdBy, createdAt: at });
      }
    }
  };
  book(conference, "dxb-banq");
  book(wedding, "doh-banq");
  return { events: [conference, wedding], support: [], assignments, counters: { "EVT-DXB": 1, "EVT-DOH": 1 } };
}
