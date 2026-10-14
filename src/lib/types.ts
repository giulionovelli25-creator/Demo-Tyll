// Shared data model for every Tyll module. All screens read these shapes.

export type Currency = "AED" | "QAR";
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
  /** Base cost per unit in AED at the start of the demo period. */
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
  /** Base selling price in AED, net of tax and service charge. */
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
  /** New value. For ingredients: AED cost per unit. For menu items: AED base price. */
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
  | "stock_shortfall"
  | "usage_variance";

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

export type WasteReason = "waste" | "breakage" | "spoilage" | "damaged" | "other";

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
}

export interface Transfer {
  id: string;
  propertyId: string;
  ingredientId: string;
  date: string;
  qty: number;
  direction: "in" | "out";
  counterparty: string;
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

export type RequestStatus = "draft" | "purchasing" | "accounting" | "manager" | "approved" | "received" | "rejected" | "changes";

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
  received?: number;
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
