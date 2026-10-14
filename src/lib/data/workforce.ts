// Demo workforce: departments, people, verified skills, rostered shifts and leave. A focused scheduling model for
// staffing events and lending people between departments; not a payroll or full rostering system.
import { DEMO_TODAY, addDays, eachDay, hashString } from "../util";
import { OUTLETS, STAFF } from "./catalog";

export type Skill = "waiter" | "bartender" | "chef" | "kitchen_assistant" | "setup" | "supervisor" | "runner" | "cleaning" | "front_desk" | "housekeeping" | "bell";

export const SKILL_LABEL: Record<Skill, string> = {
  waiter: "Waiter", bartender: "Bartender", chef: "Chef", kitchen_assistant: "Kitchen assistant", setup: "Banquet setup",
  supervisor: "Event supervisor", runner: "Runner", cleaning: "Cleaning and reset", front_desk: "Front desk", housekeeping: "Housekeeping", bell: "Bell and luggage",
};

export type DeptKind = "outlet" | "banqueting" | "front_office" | "housekeeping" | "bell";

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

/** Demo hourly labour rates in AED, converted for other currencies. Planning estimates, not payroll. */
export const HOURLY_RATE_AED: Record<Skill, number> = {
  waiter: 45, bartender: 50, chef: 70, kitchen_assistant: 35, setup: 35, supervisor: 80, runner: 32, cleaning: 30, front_desk: 45, housekeeping: 32, bell: 32,
};

const outletDepts: Dept[] = OUTLETS.map((o) => ({ id: o.id, propertyId: o.propertyId, name: o.name, kind: "outlet", outletId: o.id }));
const extraDepts: Dept[] = [
  { id: "dxb-banq", propertyId: "dxb", name: "Banqueting", kind: "banqueting" },
  { id: "dxb-fo", propertyId: "dxb", name: "Front Office", kind: "front_office" },
  { id: "dxb-hk", propertyId: "dxb", name: "Housekeeping", kind: "housekeeping" },
  { id: "dxb-bell", propertyId: "dxb", name: "Bell Team", kind: "bell" },
  { id: "doh-banq", propertyId: "doh", name: "Banqueting", kind: "banqueting" },
  { id: "doh-fo", propertyId: "doh", name: "Front Office", kind: "front_office" },
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
      out.push({ id: `${code}-${String(i).padStart(2, "0")}`, name: `${FIRST[h % FIRST.length]} ${LAST[(h >> 5) % LAST.length]}`, propertyId, deptId, title: r.title, skills: r.skills });
    }
  }
  return out;
}

export const EMPLOYEES: Employee[] = [
  // Outlet teams are the existing staff, with skills from their role.
  ...STAFF.map((s) => ({ id: s.id, name: s.name, propertyId: OUTLETS.find((o) => o.id === s.outletId)!.propertyId, deptId: s.outletId, title: TITLE_BY_ROLE[s.role], skills: SKILLS_BY_ROLE[s.role] })),
  ...team("dxb-banq", "dxb", "BNQ", [
    { n: 6, title: "Banquet waiter", skills: ["waiter", "runner", "setup"] },
    { n: 3, title: "Banquet bartender", skills: ["bartender", "waiter"] },
    { n: 3, title: "Banquet chef", skills: ["chef", "kitchen_assistant"] },
    { n: 4, title: "Banquet houseman", skills: ["setup", "cleaning"] },
    { n: 2, title: "Banquet captain", skills: ["supervisor", "waiter"] },
    { n: 3, title: "Runner", skills: ["runner", "setup"] },
    { n: 3, title: "Steward", skills: ["cleaning", "kitchen_assistant"] },
  ]),
  ...team("dxb-fo", "dxb", "FO", [
    { n: 4, title: "Front desk agent", skills: ["front_desk"] },
    // Cross-trained: worked banquets before joining the front office.
    { n: 2, title: "Front desk agent", skills: ["front_desk", "waiter"] },
  ]),
  ...team("dxb-hk", "dxb", "HK", [
    { n: 7, title: "Room attendant", skills: ["housekeeping", "cleaning"] },
    { n: 1, title: "Public area attendant", skills: ["cleaning", "setup"] },
  ]),
  ...team("dxb-bell", "dxb", "BELL", [{ n: 4, title: "Bell attendant", skills: ["bell", "setup"] }]),
  ...team("doh-banq", "doh", "DBQ", [
    { n: 10, title: "Banquet waiter", skills: ["waiter", "runner", "setup"] },
    { n: 3, title: "Banquet bartender", skills: ["bartender", "waiter"] },
    { n: 4, title: "Banquet chef", skills: ["chef", "kitchen_assistant"] },
    { n: 6, title: "Banquet houseman", skills: ["setup", "cleaning"] },
    { n: 3, title: "Banquet captain", skills: ["supervisor", "waiter"] },
    { n: 4, title: "Runner", skills: ["runner", "setup"] },
    { n: 4, title: "Steward", skills: ["cleaning", "kitchen_assistant"] },
  ]),
  ...team("doh-fo", "doh", "DFO", [{ n: 5, title: "Front desk agent", skills: ["front_desk"] }]),
];
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
      if ((i + h) % 7 === 0) return;
      let s = DAY;
      if (dept.kind === "outlet") {
        // Waiters 1 and 2 open; 3 and 4 close; others alternate by week day.
        const slot = Number(e.id.split("-S")[1] ?? 0);
        s = slot === 1 || slot === 2 ? MORNING : slot === 3 || slot === 4 ? EVENING : (i + h) % 2 ? MORNING : EVENING;
      } else if (dept.kind === "front_office") s = (h + i) % 3 === 0 ? EVENING : MORNING;
      else if (dept.kind === "housekeeping") s = MORNING;
      else if (dept.kind === "bell") s = (h + i) % 2 ? MORNING : EVENING;
      out.push({ employeeId: e.id, date, ...s });
    });
  }
  return out;
}

export const SHIFTS: Shift[] = buildShifts();

/** Approved leave. Kept small and visible so the demo shows Tyll respecting it. */
export const LEAVE: Leave[] = [
  { employeeId: "LBY-S2", date: "2026-10-15", reason: "Annual leave" },
  { employeeId: "TRC-S2", date: "2026-10-13", reason: "Training day" },
];

export const shiftsOf = (employeeId: string, date: string) => SHIFTS.filter((s) => s.employeeId === employeeId && s.date === date);
export const onLeave = (employeeId: string, date: string) => LEAVE.find((l) => l.employeeId === employeeId && l.date === date);

/** Demo hourly rate in the property's currency. */
export const hourlyRate = (skill: Skill, fxFromAed: number) => Math.round(HOURLY_RATE_AED[skill] * fxFromAed * 100) / 100;

export const fmtMin = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
