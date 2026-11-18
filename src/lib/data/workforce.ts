// Demo workforce: departments, people, verified skills, rostered shifts and leave. A focused scheduling model for
// staffing events and lending people between departments; not a payroll or full rostering system.
import { DEMO_TODAY, addDays, eachDay, hashString, rel } from "../util";
import { OUTLETS, STAFF } from "./catalog";

export type Skill = "waiter" | "bartender" | "chef" | "kitchen_assistant" | "setup" | "supervisor" | "runner" | "cleaning" | "front_desk" | "housekeeping" | "bell" | "concierge" | "inspection";

export const SKILL_LABEL: Record<Skill, string> = {
  waiter: "Waiter", bartender: "Bartender", chef: "Chef", kitchen_assistant: "Kitchen assistant", setup: "Banquet setup",
  supervisor: "Event supervisor", runner: "Runner", cleaning: "Cleaning and reset", front_desk: "Front desk", housekeeping: "Housekeeping", bell: "Bell and luggage", concierge: "Concierge", inspection: "Room inspection",
};

export type DeptKind = "outlet" | "banqueting" | "front_office" | "housekeeping" | "bell" | "concierge";

export interface Dept {
  id: string;
  propertyId: string;
  name: string;
  kind: DeptKind;
  outletId?: string;
}

export interface Employee {
  id: string;
  name: string;
  propertyId: string;
  deptId: string;
  title: string;
  skills: Skill[];
}

export interface Shift {
  employeeId: string;
  date: string;
  /** Minutes from midnight. */
  start: number;
  end: number;
}

export interface Leave {
  employeeId: string;
  date: string;
  reason: string;
}

/** Demo hourly labour rates in euros. Planning estimates, not payroll. */
export const HOURLY_RATE_EUR: Record<Skill, number> = {
  waiter: 13, bartender: 14, chef: 18, kitchen_assistant: 11, setup: 11, supervisor: 20, runner: 10, cleaning: 10, front_desk: 13, housekeeping: 10, bell: 10, concierge: 14, inspection: 13,
};

const outletDepts: Dept[] = OUTLETS.map((o) => ({ id: o.id, propertyId: o.propertyId, name: o.name, kind: "outlet", outletId: o.id }));
const extraDepts: Dept[] = [
  { id: "lis-banq", propertyId: "lis", name: "Banqueting", kind: "banqueting" },
  { id: "lis-fo", propertyId: "lis", name: "Front Office", kind: "front_office" },
  { id: "lis-hk", propertyId: "lis", name: "Housekeeping", kind: "housekeeping" },
  { id: "lis-bell", propertyId: "lis", name: "Bell Team", kind: "bell" },
  { id: "lis-conc", propertyId: "lis", name: "Concierge", kind: "concierge" },
];
export const DEPTS: Dept[] = [...outletDepts, ...extraDepts];
export const deptById: Record<string, Dept> = Object.fromEntries(DEPTS.map((d) => [d.id, d]));

const SKILLS_BY_ROLE: Record<string, Skill[]> = {
  server: ["waiter", "runner"], bartender: ["bartender", "waiter"], supervisor: ["supervisor", "waiter"], manager: ["supervisor"], chef: ["chef", "kitchen_assistant"], steward: ["kitchen_assistant", "cleaning"],
};
const TITLE_BY_ROLE: Record<string, string> = { server: "Waiter", bartender: "Bartender", supervisor: "Supervisor", manager: "Outlet manager", chef: "Chef", steward: "Steward" };

const FIRST = ["Ana", "Bilal", "Chloe", "Dev", "Eman", "Felix", "Hiba", "Ivan", "Joy", "Khalid", "Lara", "Mohammed", "Noor", "Oscar", "Priya", "Rami", "Salma", "Tom", "Usha", "Wael", "Yara", "Zaid"];
const LAST = ["Ali", "Brown", "Costa", "Dsouza", "Erdem", "Faris", "Gomez", "Hadi", "Iqbal", "Joshi", "Khan", "Lopez", "Mansour", "Nasser", "Ortiz", "Pillai", "Qureshi", "Reyes", "Silva", "Tahir"];

function team(deptId: string, propertyId: string, code: string, rows: { n: number; title: string; skills: Skill[] }[]): Employee[] {
  const out: Employee[] = [];
  let i = 0;
  for (const r of rows) {
    for (let k = 0; k < r.n; k++) {
      i += 1;
      const h = hashString(`${deptId}|${i}`);
      out.push({ id: `${code}-${String(i).padStart(2, "0")}`, name: `${FIRST[h % FIRST.length]} ${LAST[Math.floor(h / 32) % LAST.length]}`, propertyId, deptId, title: r.title, skills: r.skills });
    }
  }
  return out;
}

export const EMPLOYEES: Employee[] = [
  // Outlet teams are the existing staff, with skills from their role.
  ...STAFF.map((s) => ({ id: s.id, name: s.name, propertyId: OUTLETS.find((o) => o.id === s.outletId)!.propertyId, deptId: s.outletId, title: TITLE_BY_ROLE[s.role], skills: SKILLS_BY_ROLE[s.role] })),
  ...team("lis-banq", "lis", "BNQ", [
    { n: 6, title: "Banquet waiter", skills: ["waiter", "runner", "setup"] },
    { n: 3, title: "Banquet bartender", skills: ["bartender", "waiter"] },
    { n: 3, title: "Banquet chef", skills: ["chef", "kitchen_assistant"] },
    { n: 4, title: "Banquet houseman", skills: ["setup", "cleaning"] },
    { n: 2, title: "Banquet captain", skills: ["supervisor", "waiter"] },
    { n: 3, title: "Runner", skills: ["runner", "setup"] },
    { n: 3, title: "Steward", skills: ["cleaning", "kitchen_assistant"] },
  ]),
  ...team("lis-fo", "lis", "FO", [
    { n: 4, title: "Front desk agent", skills: ["front_desk"] },
    // Cross-trained: worked banquets before joining the front office.
    { n: 2, title: "Front desk agent", skills: ["front_desk", "waiter"] },
  ]),
  ...team("lis-hk", "lis", "HK", [
    { n: 7, title: "Room attendant", skills: ["housekeeping", "cleaning"] },
    { n: 1, title: "Public area attendant", skills: ["cleaning", "setup"] },
    { n: 1, title: "Housekeeping supervisor", skills: ["inspection", "housekeeping"] },
  ]),
  ...team("lis-bell", "lis", "BELL", [{ n: 4, title: "Bell attendant", skills: ["bell", "setup"] }]),
  ...team("lis-conc", "lis", "CON", [{ n: 2, title: "Concierge", skills: ["concierge", "front_desk"] }]),
];
// People who appear in the guided demo by name.
const NAMED: Record<string, string> = { "HK-01": "Maria Santos", "HK-09": "Agnes Mwangi", "BELL-01": "Yusuf Adeyemi", "CON-01": "Lina Haddad" };
for (const e of EMPLOYEES) if (NAMED[e.id]) e.name = NAMED[e.id];

export const employeeById: Record<string, Employee> = Object.fromEntries(EMPLOYEES.map((e) => [e.id, e]));

const MORNING = { start: 7 * 60, end: 15 * 60 };
const EVENING = { start: 15 * 60, end: 23 * 60 };
const DAY = { start: 9 * 60, end: 17 * 60 };

/** Rostered shifts for the week around the demo day. Banqueting works only when it has events, by assignment. */
function buildShifts(): Shift[] {
  const out: Shift[] = [];
  const days = eachDay({ from: addDays(DEMO_TODAY, -1), to: addDays(DEMO_TODAY, 7) });
  for (const e of EMPLOYEES) {
    const dept = deptById[e.deptId];
    if (dept.kind === "banqueting") continue;
    const h = hashString(e.id);
    days.forEach((date, i) => {
      // One rest day a week, spread across the team.
      if ((i + h) % 7 === 0 && !(date === DEMO_TODAY && NAMED[e.id])) return;
      let s = DAY;
      if (dept.kind === "outlet") {
        // Waiters 1 and 2 open; 3 and 4 close; others alternate by week day.
        const slot = Number(e.id.split("-S")[1] ?? 0);
        s = slot === 1 || slot === 2 ? MORNING : slot === 3 || slot === 4 ? EVENING : (i + h) % 2 ? MORNING : EVENING;
      } else if (dept.kind === "front_office") s = (h + i) % 3 === 0 ? EVENING : MORNING;
      // Housekeeping works an evening turndown shift on the demo day so rooms can still be turned around.
      else if (dept.kind === "housekeeping") s = date === DEMO_TODAY ? EVENING : MORNING;
      else if (dept.kind === "concierge") s = EVENING;
      else if (dept.kind === "bell") s = date === DEMO_TODAY && (NAMED[e.id] || e.id === "BELL-02") ? EVENING : (h + i) % 2 ? MORNING : EVENING;
      out.push({ employeeId: e.id, date, ...s });
    });
  }
  return out;
}

export const SHIFTS: Shift[] = buildShifts();

/** Approved leave. Kept small and visible so the demo shows Tyll respecting it. */
export const LEAVE: Leave[] = [
  { employeeId: "AZU-S2", date: rel(2), reason: "Annual leave" },
  { employeeId: "MER-S2", date: rel(0), reason: "Training day" },
];

export const shiftsOf = (employeeId: string, date: string) => SHIFTS.filter((s) => s.employeeId === employeeId && s.date === date);
export const onLeave = (employeeId: string, date: string) => LEAVE.find((l) => l.employeeId === employeeId && l.date === date);

/** Demo hourly rate in the property's currency. */
export const hourlyRate = (skill: Skill, fxFromAed: number) => Math.round(HOURLY_RATE_EUR[skill] * fxFromAed * 100) / 100;

export const fmtMin = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
