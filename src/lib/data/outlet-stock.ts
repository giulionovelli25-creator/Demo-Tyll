// Outlet stock records: each bar and kitchen's working stock, issued from the main storeroom and counted at close or handover.
// Usage between two counts comes from the actual POS lines, by the time they were sent. Three periods are set up as worked
// examples (Coca-Cola, house wine, Wagyu beef) with counts chosen so the figures match round numbers; every other figure
// follows from the records.
import { periodVariance } from "../domain/variance";
import { ingredientCostAt } from "../domain/pricing";
import { wasteQuantities } from "../domain/inventory";
import type { OutletCheck, OutletMovement, Order, PeriodRemoval, PeriodSale, PeriodWaste, UsagePeriod, WasteLog } from "../types";
import { DEMO_TODAY, addDays, eachDay, rng } from "../util";
import { INGREDIENTS, OUTLETS, ingredientById, itemById, propertyById } from "./catalog";

export const CLOSE = 1440;
const FIRST_CLOSE = "2026-10-05";
const LAST_CLOSE = "2026-10-12";

interface Scenario {
  outletId: string;
  ingredientId: string;
  /** Day of the opening count; its time is found so expected use matches the target. */
  fromDate: string;
  to: { date: string; min: number };
  target: number;
  opening: number;
  issue: { date: string; min: number; qty: number };
  missing: number;
  by: string;
}

/** Worked examples. Counted quantities are chosen; sales and removals are the recorded POS lines. */
export const SCENARIOS: Scenario[] = [
  // 30 cans sold, 40 opening, 10 issued, 12 counted: 38 used, 8 unexplained. Includes the Coke removed from TRC-1013-198.
  { outletId: "dxb-terrace", ingredientId: "coke", fromDate: "2026-10-12", to: { date: DEMO_TODAY, min: 20 * 60 + 53 }, target: 30, opening: 40, issue: { date: DEMO_TODAY, min: 11 * 60, qty: 10 }, missing: 8, by: "TRC-S7" },
  // 20 glasses at 150 ml: 3,000 ml expected. 8 bottles opening, 6 issued, 9 counted: 3,750 ml used.
  { outletId: "dxb-lobby", ingredientId: "wine", fromDate: "2026-10-11", to: { date: "2026-10-12", min: CLOSE }, target: 3, opening: 6, issue: { date: "2026-10-12", min: 10 * 60, qty: 4.5 }, missing: 0.75, by: "LBY-S7" },
  // 80 burgers at 180 g: 14.4 kg expected. 18 kg opening, 10 kg issued, 11.8 kg counted: 16.2 kg used.
  { outletId: "dxb-terrace", ingredientId: "wagyu", fromDate: "2026-10-11", to: { date: DEMO_TODAY, min: 20 * 60 + 53 }, target: 14.4, opening: 18, issue: { date: "2026-10-12", min: 10 * 60, qty: 10 }, missing: 1.8, by: "TRC-S7" },
];

/** Counting precision: cans and units exactly, wine to a tenth of a bottle, other liquids and food to 50 ml or 50 g. */
export const countStep = (ingredientId: string) => (ingredientById[ingredientId].unit === "each" ? 1 : ingredientId === "wine" ? 0.075 : 0.05);
const roundTo = (n: number, step: number) => Math.round(Math.round(n / step) * step * 1000) / 1000;
const ceilTo = (n: number, step: number) => Math.round(Math.ceil(n / step - 1e-9) * step * 1000) / 1000;
const issueStep = (ingredientId: string) => (ingredientById[ingredientId].unit === "each" ? 6 : ingredientId === "wine" ? 0.75 : 0.5);

interface Use {
  date: string;
  min: number;
  itemId: string;
  qty: number;
  qtyPerUnit: number;
  comped: number;
  removal?: PeriodRemoval;
}

export interface OutletStock {
  periods: UsagePeriod[];
  checks: OutletCheck[];
}

/** Ingredients each outlet counts: priority items its menu uses, except glassware. */
function tracked(outletId: string): string[] {
  const o = OUTLETS.find((x) => x.id === outletId)!;
  const used = new Set(o.menu.flatMap((m) => itemById[m.itemId].recipe?.map((l) => l.ingredientId) ?? []));
  return INGREDIENTS.filter((g) => g.priority && g.dept !== "glassware" && used.has(g.id)).map((g) => g.id);
}

const after = (a: { date: string; min: number }, b: { date: string; min: number }) => a.date > b.date || (a.date === b.date && a.min > b.min);
const within = (t: { date: string; min: number }, from: { date: string; min: number }, to: { date: string; min: number }) => after(t, from) && !after(t, to);

export function buildOutletStock(orders: readonly Order[], wasteLogs: readonly WasteLog[]): OutletStock {
  // Every use of each ingredient at each outlet, timed by when the line was sent for preparation.
  const uses = new Map<string, Use[]>();
  const key = (o: string, g: string) => `${o}|${g}`;
  for (const o of orders) {
    if (o.date <= FIRST_CLOSE) continue;
    for (const l of o.lines) {
      const recipe = itemById[l.itemId].recipe;
      if (!recipe) continue;
      const min = l.sentMin ?? l.enteredMin;
      const sold = !o.voided && (l.state === "kept" || l.state === "comped");
      const made = l.state === "removed_post" || (o.voided && l.sentMin !== undefined && l.state !== "removed_pre");
      if (!sold && !made) continue;
      for (const rl of recipe) {
        const k = key(o.outletId, rl.ingredientId);
        let list = uses.get(k);
        if (!list) uses.set(k, (list = []));
        list.push({
          date: o.date, min, itemId: l.itemId, qty: l.qty, qtyPerUnit: rl.qty, comped: l.state === "comped" ? l.qty : 0,
          removal: made ? { orderId: o.id, itemId: l.itemId, date: o.date, sentMin: min, removedMin: l.removedMin ?? o.voided?.min ?? min, qty: l.qty, qtyPerUnit: rl.qty, how: o.voided ? "voided" : "removed" } : undefined,
        });
      }
    }
  }
  const wasteBy = new Map<string, PeriodWaste[]>();
  for (const w of wasteLogs) {
    if (w.date <= FIRST_CLOSE) continue;
    for (const q of wasteQuantities(w)) {
      const k = key(w.outletId, q.ingredientId);
      let list = wasteBy.get(k);
      if (!list) wasteBy.set(k, (list = []));
      list.push({ id: w.id, date: w.date, qty: q.qty, reason: w.reason, by: w.by });
    }
  }

  const periods: UsagePeriod[] = [];
  const checks: OutletCheck[] = [];
  for (const outlet of OUTLETS) {
    const property = propertyById[outlet.propertyId];
    for (const gid of tracked(outlet.id)) {
      const all = uses.get(key(outlet.id, gid)) ?? [];
      const wastes = wasteBy.get(key(outlet.id, gid)) ?? [];
      if (all.length === 0) continue;
      const step = countStep(gid);
      const r = rng(`outlet-stock|${outlet.id}|${gid}`);
      const scenario = SCENARIOS.find((s) => s.outletId === outlet.id && s.ingredientId === gid);
      const consumedIn = (from: { date: string; min: number }, to: { date: string; min: number }, sold = true) =>
        all.filter((u) => within(u, from, to) && (sold ? !u.removal : true)).reduce((s, u) => s + u.qty * u.qtyPerUnit, 0);
      const wasteIn = (fromDate: string, toDate: string) => wastes.filter((w) => w.date > fromDate && w.date <= toDate).reduce((s, w) => s + w.qty, 0);

      // Check times: a close each day, and for a worked example a handover count, then the example's closing count.
      const times: { date: string; min: number; kind: OutletCheck["kind"] }[] = [{ date: FIRST_CLOSE, min: CLOSE, kind: "close" }];
      let scenarioFrom: { date: string; min: number } | null = null;
      if (scenario) {
        for (const d of eachDay({ from: addDays(FIRST_CLOSE, 1), to: addDays(scenario.fromDate, -1) })) times.push({ date: d, min: CLOSE, kind: "close" });
        // Latest time on the opening day from which expected use up to the closing count equals the target.
        const candidates = [...new Set(all.filter((u) => u.date === scenario.fromDate).map((u) => u.min))].sort((a, b) => b - a);
        let best = { min: 15 * 60, gap: Infinity };
        for (const m of [CLOSE, ...candidates.map((c) => c - 1)]) {
          const gap = Math.abs(consumedIn({ date: scenario.fromDate, min: m }, scenario.to) - scenario.target);
          if (gap < best.gap - 1e-9) best = { min: m, gap };
          if (gap < 1e-9) break;
        }
        scenarioFrom = { date: scenario.fromDate, min: best.min };
        times.push({ ...scenarioFrom, kind: "handover" }, { ...scenario.to, kind: "handover" });
      } else {
        for (const d of eachDay({ from: addDays(FIRST_CLOSE, 1), to: LAST_CLOSE })) times.push({ date: d, min: CLOSE, kind: "close" });
      }

      const avgDaily = consumedIn({ date: FIRST_CLOSE, min: CLOSE }, { date: LAST_CLOSE, min: CLOSE }, false) / 7;
      const par = Math.max(step * 4, avgDaily * 2.2);
      let level = ceilTo(par, step);
      const outletChecks: OutletCheck[] = [];
      const mkCheck = (t: { date: string; min: number; kind: OutletCheck["kind"] }, counted: number, by: string): OutletCheck => ({
        id: `OC-${outlet.code}-${gid}-${t.date.slice(5).replace("-", "")}-${t.min}`, outletId: outlet.id, ingredientId: gid, date: t.date, min: t.min, counted, by, kind: t.kind,
      });
      outletChecks.push(mkCheck(times[0], level, `${outlet.code}-S9`));
      const movementsBy = new Map<string, { issues: OutletMovement[]; transfers: OutletMovement[] }>();

      for (let i = 1; i < times.length; i++) {
        const from = times[i - 1];
        const to = times[i];
        const isScenarioOpen = scenario && scenarioFrom && to.date === scenarioFrom.date && to.min === scenarioFrom.min && to.kind === "handover";
        const isScenarioClose = scenario && i === times.length - 1;
        const used = consumedIn(from, to, false) + wasteIn(from.date, to.date);
        const issues: OutletMovement[] = [];
        const transfers: OutletMovement[] = [];
        let counted: number;
        if (isScenarioClose) {
          const s = scenario!;
          issues.push({ id: `IS-${outlet.code}-${gid}-${s.issue.date.slice(5).replace("-", "")}`, date: s.issue.date, min: s.issue.min, qty: s.issue.qty, counterparty: "Main storeroom" });
          counted = Math.round((s.opening + s.issue.qty - s.target - s.missing) * 1000) / 1000;
        } else if (isScenarioOpen) {
          // Top up or return to the storeroom so the handover count is the example's opening figure.
          const need = scenario!.opening + used - level;
          const day = to.date > from.date ? to.date : from.date;
          if (need > 0) issues.push({ id: `IS-${outlet.code}-${gid}-${day.slice(5).replace("-", "")}`, date: day, min: 10 * 60, qty: Math.round(need * 1000) / 1000, counterparty: "Main storeroom" });
          if (need < 0) transfers.push({ id: `TR-${outlet.code}-${gid}-${day.slice(5).replace("-", "")}`, date: day, min: 10 * 60, qty: Math.round(need * 1000) / 1000, counterparty: "Returned to the main storeroom" });
          counted = scenario!.opening;
        } else {
          // Morning issue tops the outlet up to its par level and covers the day.
          const want = Math.max(par - level, used * 1.15 - level, 0);
          const qty = want > 0 ? ceilTo(want, issueStep(gid)) : 0;
          if (qty > 0) issues.push({ id: `IS-${outlet.code}-${gid}-${to.date.slice(5).replace("-", "")}`, date: to.date, min: 10 * 60, qty, counterparty: "Main storeroom" });
          const shrink = used * r.between(-0.008, 0.015);
          counted = Math.max(0, roundTo(level + qty - used - shrink, step));
        }
        const check = mkCheck(to, counted, isScenarioClose || isScenarioOpen ? scenario!.by : `${outlet.code}-S9`);
        outletChecks.push(check);
        movementsBy.set(check.id, { issues, transfers });
        level = counted;
      }

      // Periods between consecutive checks, with every record that bears on them.
      const unitCost = (date: string) => ingredientCostAt(gid, date) * property.costFactor;
      const tolerance = gid === "wine" ? 2 * 0.075 : ingredientById[gid].unit === "each" ? 1 : 0.1;
      const history: { to: string; unexplained: number }[] = [];
      for (let i = 1; i < outletChecks.length; i++) {
        const from = outletChecks[i - 1];
        const to = outletChecks[i];
        const inWindow = all.filter((u) => within(u, from, to));
        const sales = new Map<string, PeriodSale>();
        for (const u of inWindow) {
          if (u.removal) continue;
          const k = `${u.itemId}|${u.date}`;
          const s = sales.get(k) ?? { itemId: u.itemId, date: u.date, units: 0, comped: 0, qtyPerUnit: u.qtyPerUnit };
          s.units += u.qty;
          s.comped += u.comped;
          sales.set(k, s);
        }
        const mv = movementsBy.get(to.id)!;
        const period: UsagePeriod = {
          id: `UP-${outlet.code}-${gid}-${to.date.slice(5).replace("-", "")}-${to.min}`,
          outletId: outlet.id, propertyId: outlet.propertyId, ingredientId: gid, from, to,
          issues: mv.issues, transfers: mv.transfers, sales: [...sales.values()],
          removals: inWindow.filter((u) => u.removal).map((u) => u.removal!),
          waste: wastes.filter((w) => w.date > from.date && w.date <= to.date),
          unitCost: Math.round(unitCost(to.date) * 100) / 100, tolerance, history: [...history],
        };
        periods.push(period);
        history.push({ to: to.date, unexplained: Math.round(periodVariance(period).unexplained * 1000) / 1000 });
      }
      checks.push(...outletChecks);
    }
  }
  return { periods, checks };
}

/** The latest period for each outlet and ingredient. */
export const latestPeriods = (periods: readonly UsagePeriod[]) => {
  const out = new Map<string, UsagePeriod>();
  for (const p of periods) out.set(`${p.outletId}|${p.ingredientId}`, p);
  return [...out.values()];
};

export const isScenario = (p: UsagePeriod) => SCENARIOS.some((s) => s.outletId === p.outletId && s.ingredientId === p.ingredientId && p.to.date === s.to.date && p.to.min === s.to.min);
