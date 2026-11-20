// Oracle Simphony (MICROS), the hotel's point of sale in the Radisson set up. A PosAdapter like the Lightspeed one, with
// one more read: the menu, with prices and modifiers, which the morning menu sync compares with Tyll's recipes.
// Shaped after Oracle's published Simphony data (guest checks with detail lines; menu items with prices and condiment
// groups). In this demo it runs on recorded sample responses only, replayed as a demo connection: no Oracle account is
// connected and no call leaves the server. Field names are to be confirmed against a sandbox before going live.
import type { PosAdapter } from "../../adapters";
import type { PosMenuItem } from "../../domain/menu-sync";
import type { Order, OrderLine } from "../../types";
import { round2 } from "../../util";
import { minutesInto } from "./time";
import type { Transport } from "./transport";

// ---- The response shapes the adapter reads ----

export interface SimphonyMenuItem { miNum: number; name: string; majGrpName: string; famGrpName: string; prices: { prcLvl: number; price: string; effFrDt?: string }[]; condimentGroups: string[] }
export interface SimphonyMenu { locRef: string; rvcNum: number; menuItems: SimphonyMenuItem[]; condimentGroups: { id: string; condiments: { miNum: number; name: string; price: string }[] }[] }
export interface SimphonyLine { lineNum: number; detailUTC: string; dspQty: number; dspTtl: string; menuItem?: { miNum: number }; parentLineNum?: number; vdFlag?: boolean; reasonCode?: string; discount?: { dscNum: number; name: string } }
export interface SimphonyCheck { guestCheckId: number; chkNum: number; rvcNum: number; tblNum: string; gstCnt: number; empNum: number; opnUTC: string; clsdUTC: string; clsdFlag: boolean; detailLines: SimphonyLine[]; tenders: { tmedName: string; ttl: string }[] }
export interface SimphonyChecks { locRef: string; busDt: string; guestChecks: SimphonyCheck[] }

// ---- What a hotel agrees at onboarding. Nothing here is a secret. ----

export interface SimphonyConfig {
  propertyId: string;
  timeZone: string;
  locRef: string;
  /** Revenue centre per outlet, and the outlet's bill prefix in Tyll. */
  outlets: Record<string, { rvcNum: number; code: string }>;
  /** Simphony menu item number to Tyll item. A number that is not here is a dish Tyll does not cost yet. */
  items: Record<string, string>;
  /** Simphony condiment number to a Tyll modifier rule (lib/domain/menu-sync.ts). */
  modifiers: Record<string, string>;
  staff: Record<string, string>;
  roomTender: string[];
}

/** What Tyll reads from Simphony, shown on Settings. */
export const SIMPHONY_READS = [
  { what: "Sales", detail: "Guest checks with every line, per revenue centre and business day" },
  { what: "Menu items and prices", detail: "Each menu item, its family group and its price, read at the morning sync" },
  { what: "Modifiers", detail: "Condiments on a line, such as Double or No cheese, applied to the recipe" },
  { what: "Voids", detail: "Lines taken off a check, with the reason code" },
  { what: "Discounts", detail: "Discount lines, by name, against the check they reduce" },
];

export const menuRequest = (cfg: SimphonyConfig, rvcNum: number) => ({ system: "simphony" as const, method: "GET" as const, path: `/menus/${cfg.locRef}/rvc/${rvcNum}` });
export const checksRequest = (cfg: SimphonyConfig, busDt: string) => ({ system: "simphony" as const, method: "POST" as const, path: "/bi/getGuestChecks", body: { locRef: cfg.locRef, busDt } });

const money = (s: string | undefined) => (s ? Number(s) : 0);

/** The menu of one revenue centre, as Tyll reads it. Pure. */
export function mapMenu(cfg: SimphonyConfig, res: SimphonyMenu): PosMenuItem[] {
  const condimentRule = (groupId: string) => res.condimentGroups.find((g) => g.id === groupId)?.condiments.map((c) => cfg.modifiers[String(c.miNum)]).filter(Boolean) ?? [];
  return res.menuItems.map((m) => ({
    posId: String(m.miNum), name: m.name, dept: m.majGrpName.toLowerCase().startsWith("bev") ? "beverage" : "food", category: m.famGrpName,
    price: money([...m.prices].sort((a, b) => a.prcLvl - b.prcLvl)[0]?.price), itemId: cfg.items[String(m.miNum)],
    modifiers: [...new Set(m.condimentGroups.flatMap(condimentRule))] as string[],
  }));
}

/** One business day of one revenue centre, as Tyll bills, with each line's modifiers. Pure. */
export function mapChecks(cfg: SimphonyConfig, outletId: string, busDt: string, res: SimphonyChecks): { orders: (Order & { modifiers: Record<number, string[]> })[]; unmapped: string[] } {
  const o = cfg.outlets[outletId];
  const unmapped = new Set<string>();
  const orders = res.guestChecks.filter((c) => c.rvcNum === o.rvcNum).map((c) => {
    const at = (iso: string) => minutesInto(busDt, `${iso}Z`, cfg.timeZone);
    const lines: OrderLine[] = [];
    const modifiers: Record<number, string[]> = {};
    let discount = 0;
    let gross = 0;
    for (const l of c.detailLines) {
      if (l.discount) { discount += -money(l.dspTtl); continue; }
      const mi = l.menuItem ? String(l.menuItem.miNum) : "";
      // A condiment belongs to the line it was rung on: its rule is kept with that line, its price added to it.
      if (l.parentLineNum !== undefined) {
        const rule = cfg.modifiers[mi];
        const idx = lines.findIndex((x) => (x as OrderLine & { _n?: number })._n === l.parentLineNum);
        if (idx >= 0) {
          if (rule) modifiers[idx] = [...(modifiers[idx] ?? []), ...Array(Math.max(1, l.dspQty)).fill(rule)];
          lines[idx].unitPrice = round2(lines[idx].unitPrice + money(l.dspTtl) / lines[idx].qty);
          gross += money(l.dspTtl);
        }
        continue;
      }
      const itemId = cfg.items[mi];
      if (!itemId) unmapped.add(mi);
      const min = at(l.detailUTC);
      const line = { itemId: itemId ?? `simphony:${mi}`, qty: l.dspQty, unitPrice: round2(money(l.dspTtl) / Math.max(1, l.dspQty)), state: l.vdFlag ? "removed_post" : "kept", enteredMin: min, sentMin: min, ...(l.vdFlag ? { removedMin: min, reason: l.reasonCode } : {}), _n: l.lineNum } as OrderLine & { _n?: number };
      if (!l.vdFlag) gross += money(l.dspTtl);
      lines.push(line);
    }
    for (const l of lines) delete (l as OrderLine & { _n?: number })._n;
    const tender = c.tenders[0]?.tmedName ?? "";
    const order: Order & { modifiers: Record<number, string[]> } = {
      id: `${o.code}-S${c.chkNum}`, outletId, date: busDt, openMin: at(c.opnUTC), closeMin: at(c.clsdUTC), covers: c.gstCnt,
      staffId: cfg.staff[String(c.empNum)] ?? `simphony:${c.empNum}`, table: c.tblNum, lines,
      discountPct: gross > 0 ? Math.round((discount / gross) * 10000) / 10000 : 0,
      ...(discount > 0 ? { discountReason: c.detailLines.find((l) => l.discount)?.discount?.name } : {}),
      payment: cfg.roomTender.includes(tender) ? "room" : /cash/i.test(tender) ? "cash" : "card",
      modifiers,
    };
    return order;
  });
  return { orders, unmapped: [...unmapped] };
}

/** Simphony behind Tyll's PosAdapter, with the menu read for the morning sync. */
export class SimphonyPos implements PosAdapter {
  constructor(private readonly cfg: SimphonyConfig, private readonly transport: Transport) {}
  async readMenu(outletId: string): Promise<PosMenuItem[]> {
    const res = (await this.transport(menuRequest(this.cfg, this.cfg.outlets[outletId].rvcNum))) as SimphonyMenu;
    return mapMenu(this.cfg, res);
  }
  async readDay(outletId: string, businessDate: string) {
    const res = (await this.transport(checksRequest(this.cfg, businessDate))) as SimphonyChecks;
    return mapChecks(this.cfg, outletId, businessDate, res);
  }
  async fetchOrders(outletId: string, businessDate: string): Promise<Order[]> {
    return (await this.readDay(outletId, businessDate)).orders.map(({ modifiers: _m, ...o }) => { void _m; return o; });
  }
}
