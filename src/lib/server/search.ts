// Global search across saved records. Every list comes from the same function the record's own screen uses, so a
// result appears only if this person may open it; nothing from another hotel is fetched and then hidden.
import { INGREDIENTS, SUPPLIERS, outletById, propertyById } from "../data/catalog";
import { employeeById } from "../data/workforce";
import { canOpen, can, type ModuleId, type Permission } from "../domain/access";
import type { User } from "../types";
import { invoicesFor } from "./finance";
import { bellBoard, roomsBoard } from "./guest";
import { gcFor, requestsFor as guestRequestsFor } from "./guest-service";
import { eventsFor, myAssignments, supportFor } from "./ops";
import { requestsFor } from "./purchasing";
import { salesFor } from "./sales";
import { periodsFor } from "./variance";
import { allowedProperties } from "../domain/access";

export interface SearchHit { group: string; label: string; detail: string; href: string }

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 -]/g, " ").replace(/\s+/g, " ").trim();

/** One edit away (a missing, extra or wrong letter), for words of five letters or more. */
function near(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** Every word typed must start a word in the text, appear in it, or be one letter away from a word in it. */
export function matches(text: string, query: string): boolean {
  const hay = norm(text);
  const words = hay.split(" ");
  return norm(query).split(" ").filter(Boolean).every((t) => hay.includes(t) || (t.length >= 5 && words.some((w) => near(w, t))));
}

/** Screens people look for by name. Each needs the module or permission its screen needs. */
const FEATURES: { label: string; detail: string; href: string; module?: ModuleId; perm?: Permission; also?: string }[] = [
  { label: "What to buy", detail: "Forecast ingredients and create a purchase request", href: "/forecast?tab=buy", perm: "purchase.create", also: "order purchase shortage" },
  { label: "What to prep", detail: "Portions the kitchen should prepare", href: "/forecast?tab=prep", perm: "prep.plan", also: "kitchen preparation" },
  { label: "Purchase approvals", detail: "Requests waiting for a decision", href: "/forecast?tab=approvals", module: "forecast", also: "approve purchase order po" },
  { label: "Where did it go?", detail: "Stock used that sales do not explain", href: "/stock?tab=where", module: "investigations", also: "missing variance stock" },
  { label: "Log waste or breakage", detail: "Record waste, breakage or spoilage", href: "/stock?tab=log", perm: "stock.logWaste", also: "waste breakage spoilage" },
  { label: "Stock count", detail: "Enter what is on the shelf", href: "/stock?tab=counts", perm: "stock.count", also: "count inventory" },
  { label: "Plan an event", detail: "Food, stock and staff for an event", href: "/events?tab=plan", perm: "events.plan", also: "conference wedding banquet" },
  { label: "Staff support", detail: "Ask another department for help", href: "/events?tab=support", perm: "staff.request", also: "borrow staff shortage" },
  { label: "Opportunities", detail: "Sales enquiries and potential business", href: "/events?tab=opportunities", perm: "sales.work", also: "sales lead" },
  { label: "Proposals", detail: "Quotes for customers", href: "/events?tab=proposals", perm: "sales.work", also: "quote offer" },
  { label: "Room readiness", detail: "Arriving guests and their rooms", href: "/rooms?tab=readiness", perm: "rooms.view", also: "arrivals late room" },
  { label: "Guest Connect", detail: "Ask a hotel venue for a table or slot", href: "/rooms?tab=connect", perm: "fo.desk", also: "restaurant dinner table booking" },
  { label: "Bell & luggage", detail: "Luggage requests and tasks", href: "/rooms?tab=bell", perm: "bell.dispatch", also: "luggage bags porter" },
  { label: "Invoices & expenses", detail: "Supplier invoices checked against deliveries", href: "/finance?tab=invoices", perm: "finance.review", also: "invoice supplier expense" },
  { label: "Budgets & reports", detail: "Spending against budget", href: "/finance?tab=reports", perm: "finance.view", also: "budget spending report" },
  { label: "Tyll Staff", detail: "Your tasks and quick actions", href: "/staff", module: "staff", also: "mobile tasks" },
];

export function searchFor(user: User, q: string): SearchHit[] {
  const term = q.trim();
  if (term.length < 2) return [];
  const out: SearchHit[] = [];
  const add = (group: string, text: string, hit: Omit<SearchHit, "group">) => { if (matches(text, term)) out.push({ group, ...hit }); };
  const props = allowedProperties(user);

  for (const f of FEATURES) if ((!f.module || canOpen(user, f.module)) && (!f.perm || can(user, f.perm))) add("Features", `${f.label} ${f.also ?? ""}`, { label: f.label, detail: f.detail, href: f.href });

  // Items: the stock check for the item at this person's outlets, or the inventory.
  if (canOpen(user, "investigations")) {
    for (const p of props) for (const per of periodsFor(user, p)) {
      const g = INGREDIENTS.find((x) => x.id === per.ingredientId)!;
      add("Stock checks", `${g.name} ${outletById[per.outletId].name}`, { label: `Where did ${g.name.toLowerCase()} go?`, detail: `${outletById[per.outletId].name}, ${propertyById[p].name}`, href: `/stock?tab=where&period=${per.id}` });
    }
  } else if (canOpen(user, "stock")) {
    for (const g of INGREDIENTS) add("Items", g.name, { label: g.name, detail: "Stock levels", href: "/stock?tab=inventory" });
  }
  if (canOpen(user, "stock") || can(user, "finance.view")) for (const s of SUPPLIERS) add("Suppliers", s.name, { label: s.name, detail: "Deliveries and invoices", href: can(user, "finance.review") ? "/finance?tab=invoices" : "/stock?tab=suppliers" });

  if (canOpen(user, "forecast") || can(user, "purchase.receive")) {
    for (const r of requestsFor(user)) add("Purchase requests", `${r.id} ${r.poNumber ?? ""} ${r.lines.map((l) => INGREDIENTS.find((g) => g.id === l.ingredientId)?.name).join(" ")}`, { label: r.poNumber ? `${r.id} · ${r.poNumber}` : r.id, detail: `${r.status} · ${r.lines.length} item${r.lines.length === 1 ? "" : "s"}`, href: canOpen(user, "forecast") ? `/forecast?tab=approvals&request=${r.id}` : `/staff?do=receive&order=${r.id}` });
  }
  if (can(user, "finance.view")) {
    const inv = invoicesFor(user);
    if (inv.ok) for (const i of inv.invoices) add("Invoices", `${i.id} ${i.supplierRef} ${i.poNumber} ${i.supplierName}`, { label: `${i.supplierName} · ${i.supplierRef}`, detail: `${i.poNumber} · ${i.status.replace("_", " ")}`, href: `/finance?tab=invoices&invoice=${i.id}` });
  }
  if (canOpen(user, "events")) {
    for (const e of eventsFor(user)) add("Events", `${e.id} ${e.name} ${e.type} ${e.venue}`, { label: e.name, detail: `${e.id} · ${e.date} · ${e.guests} guests`, href: can(user, "events.plan") ? `/events?tab=events&event=${e.id}` : "/events?tab=confirmed" });
    if (can(user, "staff.request") || can(user, "staff.lend")) for (const r of supportFor(user)) add("Staff support", `${r.id} ${r.kind} ${r.reason}`, { label: `${r.id} · ${r.kind}`, detail: `${r.status} · ${r.date}`, href: `/events?tab=support&request=${r.id}` });
    const sales = salesFor(user);
    if (sales.ok) for (const o of sales.opps) add("Sales", `${o.id} ${o.customer} ${o.type} ${o.proposals.map((p) => p.id).join(" ")}`, { label: `${o.customer} · ${o.type}`, detail: `${o.id} · ${o.status.replace("_", " ")}`, href: can(user, "sales.work") || can(user, "sales.approve") ? `/events?tab=opportunities&opp=${o.id}` : "/events?tab=confirmed" });
  }
  const rooms = roomsBoard(user);
  if (rooms.ok) for (const r of rooms.board.rooms) add("Rooms", `room ${r.number} ${r.type}`, { label: `Room ${r.number}`, detail: `${r.type} · ${r.status.replace("_", " ")}`, href: user.role === "employee" ? `/staff?do=rooms&room=${r.roomId}` : can(user, "hk.manage") ? `/rooms?tab=housekeeping&room=${r.roomId}` : `/rooms?tab=readiness&room=${r.roomId}` });
  const gc = gcFor(user);
  if (gc.ok) for (const r of gc.requests) add("Guest Connect", `${r.id} ${r.venueName} room ${r.room}`, { label: `${r.id} · ${r.venueName}`, detail: `Room ${r.room} · ${r.party} guests · ${r.status}`, href: can(user, "fo.desk") ? `/rooms?tab=connect&request=${r.id}` : `/rooms?tab=tables&request=${r.id}` });
  const gr = guestRequestsFor(user);
  if (gr.ok) for (const r of gr.requests) add("Guest requests", `${r.id} ${r.kind} ${r.details} room ${r.room}`, { label: `${r.id} · room ${r.room}`, detail: r.details, href: `/rooms?tab=requests&request=${r.id}` });
  const bell = bellBoard(user);
  if (bell.ok) for (const t of bell.tasks) add("Luggage", `${t.id} room ${t.room} luggage`, { label: `${t.id} · room ${t.room}`, detail: t.status.replace("_", " "), href: user.role === "employee" ? `/staff?do=bell&task=${t.id}` : `/rooms?tab=bell&task=${t.id}` });
  for (const a of myAssignments(user)) add("My assignments", `${a.id} ${a.where} ${a.for}`, { label: a.for, detail: `${a.date} · ${employeeById[a.employeeId]?.name ?? ""}`, href: "/tasks" });
  return out.slice(0, 40);
}
