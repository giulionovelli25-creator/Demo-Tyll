// Shared data model for every Tyll module. All screens read these shapes.

/** Each hotel reports in one currency. Amounts in different currencies are never added together. */
export type Currency = "EUR" | "AED" | "SAR";
export type Dept = "food" | "beverage";
export type Station = "kitchen" | "bar";

export interface Property {
  id: string;
  name: string;
  city: string;
  currency: Currency;
  rooms: number;
  /** Local ingredient cost relative to the group base price list. */
  costFactor: number;
  /** IANA time zone. "Today", deadlines and times on orders are this hotel's, whoever looks at them and from wherever. */
  timeZone: string;
}

export interface OutletMenuEntry {
  itemId: string;
  /** Relative popularity used by the demo data generator. */
  weight: number;
}

export interface Outlet {
  id: string;
  propertyId: string;
  name: string;
  kind: string;
  code: string;
  priceFactor: number;
  menu: OutletMenuEntry[];
  /** Items sold beyond the weighted menu: added to bills after they are drawn (Bar Azulejo's premium serves), so the draws stay as they were. */
  sells?: string[];
  baseOrders: number;
  linesPerOrder: number;
  openMin: number;
  closeMin: number;
  roomChargeShare: number;
  /** Rostered labor: fixed daily amount plus a share of net sales (native currency). */
  laborFixed: number;
  laborVariable: number;
  /** Other operating expenses allocated per day (native currency). */
  opexDaily: number;
  targetMinutes: number;
  reservable: boolean;
}

export interface Ingredient {
  id: string;
  name: string;
  nameAr: string;
  unit: "kg" | "l" | "each";
  /** Base cost per unit in euros at the start of the demo period. */
  cost: number;
  supplierId: string;
  shelfLifeDays: number;
  leadDays: number;
  packSize: number;
  priority: boolean;
  dept: Dept | "glassware" | "supplies";
}

export interface RecipeLine {
  ingredientId: string;
  qty: number;
}

export interface MenuItem {
  id: string;
  name: string;
  nameAr: string;
  dept: Dept;
  category: string;
  /** Base selling price in euros, net of tax and service charge. */
  price: number;
  recipe?: RecipeLine[];
  /** Used only where no recipe has been built yet. */
  standardCost?: number;
  prepMinutes: number;
  station: Station;
}

export interface Supplier {
  id: string;
  name: string;
}

export interface Staff {
  id: string;
  name: string;
  outletId: string;
  role: "server" | "bartender" | "supervisor" | "manager" | "chef" | "steward";
}

export interface PriceChange {
  id: string;
  from: string;
  /** New value. For ingredients: euro cost per unit. For menu items: euro base price. */
  value: number;
}

// ---- Orders -----------------------------------------------------------------

export type LineState = "kept" | "removed_pre" | "removed_post" | "comped";

export interface OrderLine {
  itemId: string;
  qty: number;
  unitPrice: number;
  state: LineState;
  enteredMin: number;
  sentMin?: number;
  /** Kitchen or bar display marked the item as completed. */
  completedMin?: number;
  removedMin?: number;
  removedBy?: string;
  reason?: string;
  approvedBy?: string;
  /** Seconds into `enteredMin` when the till records them, so two entries seconds apart can be told from a second round. */
  enteredSec?: number;
  /** Set when the price on the bill was not the menu price: an open item, the misc button or a price changed by hand. */
  till?: TillPrice;
}

/** How a line's price was set at the till when it was not taken from the menu. `unitPrice` on the line is what was charged. */
export interface TillPrice {
  kind: "open_item" | "misc" | "override";
  /** The menu price of the item on the kitchen or bar ticket, per unit, on the day. */
  menuPrice: number;
  reason?: string;
  approvedBy?: string;
}

/** A bill reopened after it was paid, changed and closed again. Lines taken off are `removed_post` with `removedMin` after `closeMin`. */
export interface BillReopen {
  /** When it was reopened and closed again, in minutes from the start of the day. `closeMin` on the order is the first payment. */
  min: number;
  closedMin: number;
  /** The POS login that reopened it. */
  by: string;
  /** What the guest paid the first time. The order's totals give what the bill says now. */
  paid: number;
  /** What was done, in words, when the till recorded it: "tip added", "two lamb chops taken off". */
  change?: string;
  reason?: string;
  approvedBy?: string;
}

export interface Order {
  id: string;
  outletId: string;
  date: string;
  openMin: number;
  closeMin: number;
  covers: number;
  staffId: string;
  table: string;
  lines: OrderLine[];
  discountPct: number;
  discountReason?: string;
  discountApprovedBy?: string;
  refund?: { amount: number; min: number; reason?: string; approvedBy?: string };
  voided?: { min: number; reason?: string; approvedBy?: string };
  payment: "card" | "cash" | "room";
  room?: string;
  /** The bill was reopened after payment and closed again. */
  reopened?: BillReopen;
}

/** Bottles issued to a bar from the cellar, one for each empty handed back (simulated). Feeds the cheaper item rule. */
export interface BottleIssue {
  outletId: string;
  date: string;
  /** A premium label in `MIX_LABELS` (lib/domain/till-rules.ts). */
  labelId: string;
  bottles: number;
}

export interface OrderTotals {
  original: number;
  gross: number;
  comps: number;
  discounts: number;
  refunds: number;
  net: number;
  removedPost: number;
  removedPre: number;
}

/** Sales rolled up per outlet, day and item. `late` marks orders closed after the demo clock time. */
export interface DayItem {
  outletId: string;
  date: string;
  itemId: string;
  late: boolean;
  units: number;
  gross: number;
  comps: number;
  discounts: number;
  refunds: number;
}

export interface DayOutlet {
  outletId: string;
  date: string;
  late: boolean;
  orders: number;
  covers: number;
}

// ---- Room charges -----------------------------------------------------------

export type ChargeSource = "restaurant" | "room_service" | "minibar" | "spa" | "laundry";

export interface RoomCharge {
  id: string;
  propertyId: string;
  outletId?: string;
  date: string;
  min: number;
  room: string;
  source: ChargeSource;
  description: string;
  orderId?: string;
  /** Amount the source system says should be on the guest bill. */
  expected: number;
  /** Amounts actually posted to the guest bill in the PMS. */
  posted: number[];
  /** The room whose folio the posting landed on, when the PMS put it on a different room from the one charged. */
  folioRoom?: string;
  /** When the posting reached the folio, in minutes from the start of `date` (past 1440 means the next day). */
  postedMin?: number;
  /** When the guest of `room` checked out, in minutes from the start of `date`. Absent while the guest is still in house. */
  checkoutMin?: number;
}

// ---- Exceptions and investigations -----------------------------------------

export type ExceptionType =
  | "removed_after_dispatch"
  | "prepared_not_charged"
  | "bill_mismatch"
  | "unusual_discount"
  | "excessive_comp"
  | "unusual_refund"
  | "unexplained_void"
  | "room_charge_missing"
  | "room_charge_duplicate"
  | "room_charge_incorrect"
  | "room_charge_wrong_room"
  | "room_charge_after_checkout"
  | "stock_shortfall"
  | "usage_variance"
  | "bought_not_used"
  | "bill_reopened"
  | "cheaper_item_rung"
  | "price_override"
  | "duplicate_ring"
  | "seated_no_bill";

export interface Exception {
  id: string;
  type: ExceptionType;
  propertyId: string;
  outletId?: string;
  date: string;
  min: number;
  orderId?: string;
  chargeId?: string;
  staffId?: string;
  /** For a stock shortfall: the count that found it. */
  countId?: string;
  ingredientId?: string;
  /** For a usage variance: the records of the stock period, so the figures can be recalculated as corrections arrive. */
  period?: UsagePeriod;
  /** Potential value involved, in the property's own currency. */
  exposure: number;
  headline: string;
  /** What the figure was compared against, in words, so anyone can check the flag. */
  comparedWith?: string;
  /** Stock based losses are estimates until a stock take confirms them. */
  basis?: "estimate" | "confirmed";
  /** For bought against used: the figures of the 30 day check that raised the flag. */
  boughtUsed?: BoughtUsedEvidence;
  /** For a cheaper item rung up: the week of bottles issued against what was billed. */
  mix?: MixEvidence;
  /** For a seated table with no bill: the booking from the reservation book and the bills around it. */
  booking?: BookingEvidence;
}

/** The meal a booking or a bill belongs to, by the time it starts. */
export type Service = "breakfast" | "lunch" | "dinner";

/**
 * One booking in an outlet's reservation book (simulated, server only). Seated bookings carry the times the host marked
 * the table seated and finished; no-shows and cancellations never sat down.
 */
export interface Booking {
  id: string;
  outletId: string;
  date: string;
  service: Service;
  /** Guests on the booking. */
  party: number;
  table: string;
  /** The time booked for, in minutes from midnight. */
  bookedFor: number;
  status: "seated" | "no_show" | "cancelled";
  seatedMin?: number;
  /** When the host marked the table finished. */
  leftMin?: number;
  via: "phone" | "online" | "concierge";
  /** When the booking was made by a hotel guest: the room. */
  room?: string;
}

/** A bill near a booking with no bill, as the case page lists it. */
export interface NearbyBill {
  orderId: string;
  table: string;
  openMin: number;
  closeMin: number;
  covers: number;
  /** The booking this bill was already matched to, at its own table or as a party seated elsewhere. Unset when no booking has it. */
  matchedTo?: string;
}

/** The facts behind a seated table with no bill. */
export interface BookingEvidence {
  bookingId: string;
  service: Service;
  table: string;
  party: number;
  bookedFor: number;
  seatedMin: number;
  leftMin?: number;
  via: Booking["via"];
  room?: string;
  /** The window searched for a bill at the table, in minutes from midnight. */
  from: number;
  to: number;
  /** Other bills at the same table that day, all outside the window. */
  atTable: NearbyBill[];
  /** Bills opened elsewhere at the outlet near the seating time. None of them is both free (no `matchedTo`) and for a party of this size. */
  nearby: NearbyBill[];
  /** The outlet's average spend per guest at this service over the days before, the basis of the estimate. */
  spendPerGuest: number;
}

/** A week of premium bottles issued to a bar against the premium serves billed, and the cheaper serve billed beside them. */
export interface MixEvidence {
  /** The closed days compared, inclusive. */
  from: string;
  to: string;
  /** "premium": a premium bottle against the house wine. "double": doubles against singles of the same bottle. */
  rule: "premium" | "double";
  labelId: string;
  /** The serve Tyll expected to see billed, and the cheaper one it found. */
  premiumItemId: string;
  cheapItemId: string;
  /** Serves in a bottle: glasses for wine, single measures for spirits. */
  perBottle: number;
  bottles: number;
  /** Premium serves billed in the week, in the same units as `perBottle`. */
  billed: number;
  /** Serves the bottles give that the premium sales do not account for. */
  gap: number;
  /** The cheaper serve billed in the same week. */
  cheapBilled: number;
  /** Menu price difference per serve. */
  priceGap: number;
  /** Weekly average of the four weeks before. */
  before: { bottles: number; billed: number; cheapBilled: number };
}

/** What a manager found when they checked a bought against used gap. */
export type BoughtUsedOutcome = "on_shelf" | "no_recipe" | "not_found";

/** What a manager did after looking at a waiter's drinks per guest. */
export type CoachingOutcome = "coached" | "bar_check" | "no_change";

/** A coaching note on one waiter at one outlet, kept on the demo server. The latest per waiter is shown. */
export interface WaiterCoaching {
  id: string;
  propertyId: string;
  outletId: string;
  /** The POS login of the waiter. */
  staffId: string;
  /** The business date it was recorded. */
  date: string;
  outcome: CoachingOutcome;
  note?: string;
  by: string;
  role: Role;
  at: string;
  /** The figures it answered: the shift marked to coach (or the waiter's busiest), drinks per guest against colleagues, and the period. */
  shift: "day" | "evening" | "late";
  rate: number | null;
  peerRate: number | null;
  days: number;
  /** Set when the note was taken back: it stays on record and is no longer shown. */
  withdrawnBy?: string;
  withdrawnRole?: Role;
  withdrawnAt?: string;
}

/** A bought against used gap marked checked, saved on the demo server with who did it. */
export interface BoughtUsedCheck {
  id: string;
  propertyId: string;
  ingredientId: string;
  /** The check date it answers. */
  date: string;
  outcome: BoughtUsedOutcome;
  note?: string;
  by: string;
  role: Role;
  at: string;
  /** The gap when it was checked, in the item's unit and in money. */
  gap: number;
  gapValue: number;
  /**
   * A manager who may close flags confirmed a check made by someone who may not (purchasing). Until then the flag stays
   * open in review: the team that placed an order never closes the flag about it on its own.
   */
  confirmedBy?: string;
  confirmedRole?: Role;
  confirmedAt?: string;
}

/** What a bought against used flag was raised on, in the item's own unit. */
export interface BoughtUsedEvidence {
  from: string;
  to: string;
  bought: number;
  deliveries: number;
  lastDelivery: number;
  lastDeliveryDate?: string | null;
  sold: number;
  waste: number;
  movedIn: number;
  movedOut: number;
  used: number;
  gap: number;
  /** The gap beyond the last delivery: what the flag values. */
  excess?: number;
  unitCost: number;
  share: number;
  /** The item's latest count at the hotel, from the count records, and the Stock levels estimate today. */
  lastCount?: BoughtUsedCount | null;
}

/** What Tyll's own count records already say about an item on a bought against used check. */
export interface BoughtUsedCount {
  date: string;
  counted: number;
  expected: number;
  /** Stock levels' estimate today: the latest count plus everything recorded since. */
  onHand: number;
}

export type InvestigationStatus = "new" | "assigned" | "in_review" | "closed";
export type Outcome = "legitimate" | "confirmed_loss" | "recovered" | "inconclusive";

export interface InvestigationNote {
  at: string;
  by: string;
  text: string;
}

export interface InvestigationState {
  status: InvestigationStatus;
  assigneeId?: string;
  deadline?: string;
  notes: InvestigationNote[];
  outcome?: Outcome;
  confirmedLoss: number;
  recovered: number;
  closedAt?: string;
  closedBy?: string;
  /** For stock cases: the cause the manager verified, and what was done about it. */
  verifiedCause?: string;
  correctiveAction?: string;
}

export interface Investigation extends Exception, InvestigationState {}

// ---- Stock ------------------------------------------------------------------

export type WasteReason = "waste" | "breakage" | "spoilage" | "damaged" | "expired" | "other";

export interface WasteLog {
  id: string;
  outletId: string;
  date: string;
  /** Either an ingredient or a prepared menu item. */
  ingredientId?: string;
  itemId?: string;
  qty: number;
  reason: WasteReason;
  by: string;
  synced: boolean;
  /** Order of entry for records created in the demo session. */
  seq: number;
  /** A late entry recorded against one outlet stock period. */
  periodId?: string;
}

export interface CountRecord {
  id: string;
  propertyId: string;
  ingredientId: string;
  date: string;
  kind: "weekly" | "spot";
  expected: number;
  counted: number;
  by: string;
  seq: number;
  /** Share of the variance allocated to each outlet, by usage. */
  allocation: Record<string, number>;
}

export interface DeliveryLine {
  ingredientId: string;
  ordered: number;
  delivered: number;
  invoiced: number;
  poPrice: number;
  invoicePrice: number;
}

export interface Delivery {
  id: string;
  propertyId: string;
  supplierId: string;
  date: string;
  status: "delivered" | "expected";
  lines: DeliveryLine[];
  /** A credit note the supplier issued for an invoice difference. Simulated. */
  credit?: { amount: number; date: string };
}

export interface Transfer {
  id: string;
  propertyId: string;
  ingredientId: string;
  date: string;
  qty: number;
  direction: "in" | "out";
  counterparty: string;
  /** The hotel's own outlet on the other side, when it is one: a move inside the hotel, not stock coming or going. */
  outletId?: string;
}

// ---- Outlet stock -----------------------------------------------------------
// Each bar and kitchen holds its own working stock, issued from the main storeroom and counted at handover or close.

export interface OutletCheck {
  id: string;
  outletId: string;
  ingredientId: string;
  date: string;
  /** Minute of the day. 1440 is the close of service. */
  min: number;
  counted: number;
  by: string;
  kind: "handover" | "close";
}

export interface OutletMovement {
  id: string;
  date: string;
  min: number;
  /** Positive into the outlet, negative out of it. */
  qty: number;
  /** Where it came from or went. */
  counterparty: string;
}

export interface PeriodSale {
  itemId: string;
  date: string;
  /** Units recorded in the POS, including complimentary ones. */
  units: number;
  comped: number;
  /** Recipe quantity of this ingredient in one unit, as set at the time. */
  qtyPerUnit: number;
}

/** A line sent to the kitchen or bar that never reached the bill. It was probably made, but no sale records it. */
export interface PeriodRemoval {
  orderId: string;
  itemId: string;
  date: string;
  sentMin: number;
  removedMin: number;
  qty: number;
  qtyPerUnit: number;
  how: "removed" | "voided";
}

export interface PeriodWaste {
  id: string;
  date: string;
  qty: number;
  reason: WasteReason;
  by: string;
}

export interface UsagePeriod {
  id: string;
  outletId: string;
  propertyId: string;
  ingredientId: string;
  from: OutletCheck;
  to: OutletCheck;
  issues: OutletMovement[];
  transfers: OutletMovement[];
  sales: PeriodSale[];
  removals: PeriodRemoval[];
  waste: PeriodWaste[];
  /** Cost of one unit in the property's currency on the closing date. */
  unitCost: number;
  /** How far the two counts can be out between them, in the item's unit. */
  tolerance: number;
  /** Unexplained quantity in earlier periods at this outlet, oldest first. */
  history: { to: string; unexplained: number }[];
}

export interface Recount {
  id: string;
  checkId: string;
  counted: number;
  reason: string;
  by: string;
  date: string;
  seq: number;
}

export interface RecipeChange {
  id: string;
  itemId: string;
  ingredientId: string;
  qty: number;
  /** Applies to sales on and after this date. */
  from: string;
  reason: string;
  by: string;
  seq: number;
}

export interface WasteCorrection {
  id: string;
  wasteId: string;
  /** Corrected quantity. Zero cancels the entry. */
  qty: number;
  reason: string;
  by: string;
  seq: number;
}

export interface ReceiptCorrection {
  id: string;
  deliveryId: string;
  ingredientId: string;
  /** Quantity actually received. */
  received: number;
  reason: string;
  by: string;
  seq: number;
}

// ---- Hotel context ----------------------------------------------------------

export interface OccupancyDay {
  propertyId: string;
  date: string;
  occupancy: number;
  forecast: boolean;
}

export interface ReservationDay {
  outletId: string;
  date: string;
  covers: number;
  forecast: boolean;
}

export interface HotelEvent {
  id: string;
  propertyId: string;
  date: string;
  name: string;
  attendance: number;
}

// ---- Flow -------------------------------------------------------------------

export type FlowStatus = "new" | "sent" | "preparing" | "ready" | "served" | "cancelled";

export interface LiveOrder {
  id: string;
  outletId: string;
  table: string;
  station: Station;
  placedMin: number;
  status: FlowStatus;
  items: { itemId: string; qty: number }[];
  roomService: boolean;
}

// ---- Rooms ------------------------------------------------------------------

export type RoomStatus = "occupied" | "departure_due" | "dirty" | "cleaning" | "ready" | "out_of_order";

export interface Room {
  id: string;
  propertyId: string;
  number: string;
  type: string;
  status: RoomStatus;
  attendantId?: string;
  /** Minute of day cleaning started, when status is cleaning. */
  cleaningStartedMin?: number;
  cleanMinutes: number;
  priority: boolean;
}

export interface Arrival {
  id: string;
  propertyId: string;
  guest: string;
  room: string;
  etaMin: number;
  status: "expected" | "waiting" | "checked_in";
  vip: boolean;
}

export interface Attendant {
  id: string;
  propertyId: string;
  name: string;
}

export interface GuestRequest {
  id: string;
  propertyId: string;
  room: string;
  text: string;
  raisedMin: number;
  department: "housekeeping" | "front_office" | "engineering";
  done: boolean;
}

// ---- Access -----------------------------------------------------------------

export type Role = "owner" | "gm" | "controller" | "fnb_director" | "restaurant_manager" | "event_manager" | "purchasing" | "chef" | "front_office" | "housekeeping_manager" | "concierge" | "bell_captain" | "employee" | "sales" | "sales_director" | "storekeeper";

export interface User {
  id: string;
  name: string;
  role: Role;
  title: string;
  propertyIds: "all" | string[];
  outletIds: "all" | string[];
  staffId?: string;
  /** Hotel department a department manager runs, such as Housekeeping. */
  deptId?: string;
}

export interface Scope {
  propertyId: "all" | string;
  outletId: "all" | string;
  dept: "all" | Dept;
}

export interface DateRange {
  from: string;
  to: string;
}

export interface AuditEntry {
  at: string;
  userId: string;
  action: string;
  detail: string;
}

// ---- Purchasing and kitchen preparation ---------------------------------------
// Stored on the server, so every department sees the same record.

export type RequestStatus = "draft" | "purchasing" | "accounting" | "fnb" | "manager" | "approved" | "received" | "rejected" | "changes";

export interface RequestLine {
  ingredientId: string;
  qty: number;
  /** What Tyll suggested when the line was added, and the figures behind it. */
  suggested: number;
  requirement: number;
  available: number;
  incoming: number;
  safety: number;
  supplierId: string;
  /** Quoted price, set on the server from the supplier's quote. */
  unitPrice: number;
  /** Accepted into stock so far, over every delivery: delivered less damaged. */
  received?: number;
  /** Delivered but refused as damaged, over every delivery. */
  damaged?: number;
  /** What the receiver noted: damaged, missing or wrong items. */
  receiveNote?: string;
  /** VAT rate on this line, from the supplier catalogue, such as 0.06. */
  vatRate?: number;
  /** How the supplier sells it: units of the item per pack, and the pack's name, such as "Case of 12". */
  packSize?: number;
  packLabel?: string;
}

/** One delivery against a purchase order. An order can arrive in several deliveries. */
export interface Receipt {
  id: string;
  at: string;
  by: string;
  /** True when the receiver closed the order: nothing more is expected, whatever is still missing. */
  final: boolean;
  note?: string;
  lines: ReceiptLine[];
}

export interface ReceiptLine {
  ingredientId: string;
  delivered: number;
  damaged: number;
  /** Delivered less damaged. Only this enters stock. */
  accepted: number;
  batch?: string;
  /** Use-by or best-before date, YYYY-MM-DD. */
  expiry?: string;
  note?: string;
}

/** A credit the hotel asks a supplier for, worked out from the three way match. Drafted in Tyll; sending is simulated. */
export interface CreditRequest {
  id: string;
  at: string;
  by: string;
  status: "draft" | "sent";
  sentAt?: string;
  invoiceId?: string;
  lines: { ingredientId: string; reason: "short" | "damaged" | "price"; qty: number; amount: number; text: string }[];
  amount: number;
  to: string;
  subject: string;
  body: string;
}

export interface RequestEvent {
  at: string;
  by: string;
  action: string;
  status: RequestStatus;
  comment?: string;
  /** Quantity changes made at this step, with the reason. */
  changes?: { ingredientId: string; from: number; to: number; reason: string }[];
}

export interface PurchaseRequest {
  id: string;
  propertyId: string;
  /** Outlets the request is for. Visibility follows these. */
  outletIds: string[];
  period: { from: string; to: string };
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  status: RequestStatus;
  lines: RequestLine[];
  comment?: string;
  /** Prep plan the request was raised from, if any. */
  prepPlanId?: string;
  /** Event the request buys for, if any. */
  eventId?: string;
  /** Hotel department the request buys for, such as Housekeeping. */
  deptId?: string;
  /** Set when approved. Demo only: nothing is sent to a supplier. */
  poNumber?: string;
  /** When the approved order went to the supplier (simulated), and when the supplier said it would arrive. Local time, YYYY-MM-DDTHH:MM. */
  sentAt?: string;
  expectedAt?: string;
  /** The delivery record this order arrived as, for the ordered, delivered and invoiced view. */
  deliveryId?: string;
  /** A purchase order goes to one supplier. Older requests may mix suppliers and leave this empty. */
  supplierId?: string;
  /** The supplier's delivery day the order is for. */
  deliveryDate?: string;
  /** Where the cost is booked, such as "4100 F&B food". */
  costCentre?: string;
  /** Every delivery recorded against the order, partial ones included. */
  receipts?: Receipt[];
  /** The email to the supplier with the order as a PDF. The PDF is kept; in this demo the email is logged, not sent. */
  sent?: { at: string; by: string; to: string; subject: string; pdf: string; emailId: string };
  /** Closed: received, invoiced and settled, or closed by hand with a reason. */
  closed?: { at: string; by: string; note: string };
  credits?: CreditRequest[];
  /** Created by the morning automatic ordering run, with the rule that decided whether it was sent or held. */
  auto?: { runAt: string; decision: "sent" | "held"; why: string };
  history: RequestEvent[];
}

export interface PrepTask {
  id: string;
  itemId: string;
  portions: number;
  assigneeId?: string;
  done: boolean;
  doneBy?: string;
  doneAt?: string;
  /** Set when the task is an event's portions. */
  eventId?: string;
  startedAt?: string;
  /** A problem reported from the kitchen, such as a missing ingredient. */
  issue?: { note: string; by: string; at: string };
}

export interface PrepPlan {
  id: string;
  propertyId: string;
  outletId: string;
  period: { from: string; to: string };
  meal: "all" | "breakfast" | "lunch" | "dinner";
  /** Portions to prepare over the period, by dish. */
  portions: Record<string, number>;
  /** What Tyll suggested, kept for comparison. */
  suggested: Record<string, number>;
  tasks: PrepTask[];
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

// ---- Events and staffing ------------------------------------------------------
// Stored on the server with purchasing, so every department sees the same record.

export type EventStatus = "draft" | "planning" | "ready" | "in_progress" | "completed" | "cancelled";
export type EventType = "Conference" | "Wedding" | "Corporate dinner" | "Banquet" | "Private dining" | "Cocktail reception" | "Hotel function";
export type ServiceFormat = "seated" | "buffet" | "reception" | "theatre";
export type ServiceId = "coffee_break" | "breakfast_buffet" | "lunch_buffet" | "set_menu" | "three_course" | "cocktail" | "soft_drinks" | "wine";

export interface EventService {
  id: ServiceId;
  /** Guests taking this service. Defaults to the event's guests. */
  guests: number;
  items: { itemId: string; perGuest: number }[];
}

/** Guests per person for each event role. 0 means the role is not needed. Demo planning assumptions. */
export type StaffRatios = Record<"waiter" | "bartender" | "chef" | "setup" | "supervisor" | "runner" | "cleaning", number>;

export interface EventRecord {
  id: string;
  propertyId: string;
  name: string;
  type: EventType;
  venue: string;
  date: string;
  /** Minutes from midnight. */
  start: number;
  end: number;
  setupStart: number;
  cleanupEnd: number;
  guests: number;
  format: ServiceFormat;
  dietary: string;
  notes: string;
  status: EventStatus;
  /** Kitchen that prepares the food. Its prep plan shows the event's portions. */
  kitchenOutletId: string;
  services: EventService[];
  ratios: StaffRatios;
  /** Agreed price per guest, if known. Used only for an estimated contribution. */
  pricePerGuest?: number;
  /** Stock already issued from the storeroom to this event, so it is not counted again. */
  issued: { ingredientId: string; qty: number; ref: string }[];
  /** Portions the kitchen changed, by dish, replacing the calculated figure. */
  kitchenPortions?: Record<string, number>;
  /** The seeded record this event continues, if any. */
  seedId?: string;
  /** The sales opportunity and proposal this event was confirmed from. */
  opportunityId?: string;
  proposalId?: string;
  createdBy: string;
  updatedAt: string;
  history: { at: string; by: string; action: string; detail?: string }[];
}

export type SupportItemStatus = "pending" | "approved" | "declined" | "alternative" | "cancelled";

export interface SupportItem {
  id: string;
  /** The person asked for, or empty when the lending department chooses. */
  employeeId?: string;
  deptId: string;
  status: SupportItemStatus;
  /** A lending manager's counter-proposal: another person, other hours, or both. */
  proposed?: { employeeId: string; start: number; end: number };
  assignmentId?: string;
  decidedBy?: string;
  comment?: string;
}

export interface SupportRequest {
  id: string;
  propertyId: string;
  requestedBy: string;
  /** Department receiving the help. */
  toDeptId: string;
  eventId?: string;
  kind: string;
  skill: string;
  date: string;
  start: number;
  end: number;
  count: number;
  reason: string;
  priority: "normal" | "urgent";
  status: "open" | "filled" | "cancelled";
  items: SupportItem[];
  createdAt: string;
  updatedAt: string;
  history: { at: string; by: string; action: string; comment?: string }[];
}

export interface Assignment {
  id: string;
  employeeId: string;
  propertyId: string;
  fromDeptId: string;
  toDeptId: string;
  eventId?: string;
  requestId?: string;
  date: string;
  start: number;
  end: number;
  skill: string;
  status: "confirmed" | "cancelled";
  approvedBy: string;
  createdAt: string;
  cancelledReason?: string;
  done?: boolean;
}

// ---- Rooms, guest service, Guest Connect and bell (Stage 5) ----------------------
// Kept on the server with the other shared records. Times are minutes on the demo day.

/** Housekeeping readiness, kept apart from whether a guest is in the room. */
export type HkStatus = "occupied" | "vacant_dirty" | "cleaning" | "inspection" | "ready" | "out_of_service";

export interface OpsEvent {
  /** Minute of the demo day. */
  min: number;
  by: string;
  action: string;
  note?: string;
}

export interface RoomOps {
  roomId: string;
  propertyId: string;
  number: string;
  floor: number;
  type: string;
  status: HkStatus;
  /** Front office view: a guest is in the room, leaving today, or the room is empty. */
  occupancy: "occupied" | "due_out" | "vacant";
  housekeeperId?: string;
  /** Second person helping, from the team or borrowed through Staff Support. */
  helperId?: string;
  startedMin?: number;
  cleanedMin?: number;
  readyMin?: number;
  priority: boolean;
  /** Front office asked for this room first, and when. */
  priorityRequestedMin?: number;
  issues: { min: number; by: string; text: string; supply?: boolean; resolved?: boolean }[];
  history: OpsEvent[];
}

export interface ArrivalOps {
  id: string;
  propertyId: string;
  /** Surname only, for the front desk. */
  guest: string;
  roomId: string;
  etaMin: number;
  vip: boolean;
  status: "expected" | "waiting" | "checked_in";
}

export type BellKind = "delivery" | "pickup" | "arrival" | "departure";
export type BellStatus = "requested" | "assigned" | "on_the_way" | "collected" | "delivered" | "completed" | "cancelled";

export interface BellTask {
  id: string;
  propertyId: string;
  kind: BellKind;
  room: string;
  from: string;
  to: string;
  bags: number;
  requestedBy: string;
  requestedMin: number;
  assigneeId?: string;
  priority: "normal" | "urgent";
  status: BellStatus;
  /** How the bags were handed over, as recorded by the bell attendant. Not a guest signature. */
  handover?: string;
  sourceRequestId?: string;
  history: OpsEvent[];
}

export type GuestRequestKind = "taxi" | "restaurant" | "spa" | "activity" | "assistance" | "bell" | "general";
export type GuestRequestStatus = "new" | "assigned" | "in_progress" | "awaiting_confirmation" | "confirmed" | "completed" | "cancelled" | "unable";

export interface ServiceRequest {
  id: string;
  propertyId: string;
  kind: GuestRequestKind;
  room: string;
  details: string;
  forMin: number;
  priority: "normal" | "urgent";
  /** Department responsible for the next step. */
  deptId: string;
  status: GuestRequestStatus;
  createdBy: string;
  createdMin: number;
  assigneeId?: string;
  /** An external confirmation typed in by staff, marked as simulated in the demo. */
  confirmation?: string;
  linkedId?: string;
  history: OpsEvent[];
}

export type GcStatus = "pending" | "accepted" | "declined" | "alternative" | "confirmed" | "cancelled";

export interface GcRequest {
  id: string;
  propertyId: string;
  venueId: string;
  room: string;
  party: number;
  date: string;
  /** Minute of the day requested. */
  timeMin: number;
  notes: string;
  status: GcStatus;
  proposedMin?: number;
  createdBy: string;
  fromDeptId: string;
  createdMin: number;
  respondedMin?: number;
  respondedBy?: string;
  sourceRequestId?: string;
  history: OpsEvent[];
}

// ---- Stage 6: finance, sales and shared stock entries -------------------------------------------------------------

export type InvoiceStatus = "to_check" | "matched" | "flagged" | "correction_requested" | "approved" | "posted";

export interface HistoryEntry { at: string; by: string; action: string; note?: string }

/** A supplier invoice for a Tyll purchase order, entered by accounting from the supplier's document. */
export interface TyllInvoice {
  id: string;
  propertyId: string;
  requestId: string;
  poNumber: string;
  supplierId: string;
  supplierRef: string;
  date: string;
  lines: { ingredientId: string; qty: number; unitPrice: number }[];
  status: InvoiceStatus;
  /** Lines as first entered, kept when a corrected invoice replaces them. */
  original?: { ingredientId: string; qty: number; unitPrice: number }[];
  recordedBy: string;
  history: HistoryEntry[];
}

/** Accounting's review of an invoice already in the dataset (a delivered purchase order). */
export interface InvoiceReview {
  status: InvoiceStatus;
  /** Corrected lines from the supplier, replacing the invoiced figures. */
  corrected?: { ingredientId: string; qty: number; unitPrice: number }[];
  history: HistoryEntry[];
}

export type OppType = "Conference" | "Group booking" | "Wedding" | "Private dining" | "Banquet" | "Corporate hospitality";
export type OppStatus = "new" | "contacted" | "proposal_needed" | "proposal_sent" | "confirmed" | "lost";

export interface Opportunity {
  id: string;
  propertyId: string;
  type: OppType;
  /** Organisation or display name only; no personal contact details are kept. */
  customer: string;
  expectedDate: string;
  guests: number;
  /** Expected value in the hotel's currency. A sales estimate, not revenue. */
  value: number;
  ownerId: string;
  status: OppStatus;
  nextAction: string;
  nextActionDue?: string;
  notes: string;
  lostReason?: string;
  eventId?: string;
  createdAt: string;
  updatedAt: string;
  history: HistoryEntry[];
}

export type ProposalStatus = "draft" | "discount_pending" | "changes_requested" | "ready" | "sent" | "accepted" | "confirmed" | "declined" | "superseded";

export interface Proposal {
  id: string;
  oppId: string;
  propertyId: string;
  version: number;
  date: string;
  start: number;
  end: number;
  guests: number;
  venue: string;
  format: ServiceFormat;
  services: ServiceId[];
  /** Selling price per guest before discount, in the hotel's currency. */
  pricePerGuest: number;
  extras: { label: string; amount: number }[];
  discountPct: number;
  validUntil: string;
  notes: string;
  status: ProposalStatus;
  /** How the customer's acceptance was recorded. Tyll sends nothing to customers. */
  acceptance?: { by: string; at: string; note: string };
  approval?: { by: string; at: string; decision: "approved" | "rejected" | "changes"; note: string };
  eventId?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  history: HistoryEntry[];
}

/** A waste or breakage entry saved on the server. */
export interface SharedWaste extends WasteLog {
  propertyId: string;
  /** The account that recorded it, and when. */
  byUser: string;
  at: string;
  note?: string;
  /** The browser entry this came from, so a retry is not saved twice. */
  clientKey?: string;
}

export interface SharedWasteCorrection { id: string; wasteId: string; qty: number; reason: string; by: string; at: string; seq: number; clientKey?: string }

export type CountStatus = "submitted" | "accepted" | "rejected";

/** A stock count saved on the server. Staff counts wait for a manager; managers' counts apply at once. */
export interface SharedCount {
  id: string;
  propertyId: string;
  ingredientId: string;
  date: string;
  expected: number;
  counted: number;
  by: string;
  byUser: string;
  at: string;
  seq: number;
  status: CountStatus;
  allocation: Record<string, number>;
  note?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNote?: string;
  clientKey?: string;
}

// ---- Purchasing master data, stock takes and cash (purchasing and stock control) ----------------------------------

export type ValuationMethod = "wac" | "fifo" | "last";
export type VatScheme = "PT" | "AE" | "SA";

/** A supplier as one hotel deals with it. Another hotel can deal with the same company on other terms, or not at all. */
export interface SupplierAccount {
  id: string;
  propertyId: string;
  name: string;
  contact: string;
  phone: string;
  /** Where purchase orders go. Fictional addresses in this demo. */
  orderEmail: string;
  /** Days the supplier delivers, 0 Sunday to 6 Saturday. */
  deliveryDays: number[];
  /** Orders after this local time count from the next day. */
  cutOff: string;
  minOrderValue: number;
  paymentTerms: string;
  leadDays: number;
  active: boolean;
  notes?: string;
}

/** What a supplier sells a hotel: its code and barcode, the pack, and the agreed price per unit of the item. */
export interface CatalogueLine {
  propertyId: string;
  supplierId: string;
  ingredientId: string;
  code: string;
  /** EAN-13 on the pack. Fictional codes in the restricted 29 range in this demo. */
  barcode: string;
  /** Units of the item in one pack, such as 24 bottles or 5 kg. */
  packSize: number;
  packLabel: string;
  /** Agreed price per unit of the item (per kg, litre or piece), before VAT. */
  agreedPrice: number;
  vatRate: number;
  /** The supplier the hotel orders this item from first. */
  preferred: boolean;
}

/** Minimum and maximum stock of an item at one location: the main store or an outlet's own store. */
export interface ParRecord {
  propertyId: string;
  /** "main" for the hotel store, or an outlet id. */
  location: string;
  ingredientId: string;
  min: number;
  max: number;
  by: string;
  at: string;
  source: "seed" | "set" | "suggested";
}

export interface PurchasingSettings {
  valuation: ValuationMethod;
  vatScheme: VatScheme;
  costCentres: { id: string; name: string }[];
}

/** An email Tyll prepared, with its attachments kept. In this demo emails to suppliers are logged, never sent. */
export interface OutboxEmail {
  id: string;
  at: string;
  by: string;
  propertyId: string;
  ref: string;
  to: string;
  subject: string;
  body: string;
  attachments: { name: string; file: string; bytes: number }[];
  status: "logged";
  note: string;
}

export type StockTakeStatus = "counting" | "submitted" | "approved" | "rejected";

export interface StockTakeLine {
  ingredientId: string;
  /** What the system said was there when the stock take started. */
  system: number;
  /** Null until counted. Items not counted change nothing. */
  counted: number | null;
  unitCost: number;
  by?: string;
  at?: string;
  method?: "scan" | "manual";
}

/** A stock take of one location: full (every item) or partial (some areas). Stock changes only when a manager approves it. */
export interface StockTake {
  id: string;
  propertyId: string;
  /** "main" for the hotel store, or an outlet id. */
  location: string;
  areas: string[];
  kind: "full" | "partial";
  status: StockTakeStatus;
  startedBy: string;
  startedAt: string;
  date: string;
  submittedAt?: string;
  decidedBy?: string;
  decidedAt?: string;
  note?: string;
  lines: StockTakeLine[];
  /** Counts created when it was approved: these move stock. */
  countIds?: string[];
  history: HistoryEntry[];
}

/** Cash counted at the end of a shift, against the till's cash sales for the same shift. */
export interface CashUp {
  id: string;
  outletId: string;
  date: string;
  shift: "day" | "night";
  counted: number;
  by: string;
  at: string;
  note?: string;
}
