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
  dept: Dept | "glassware";
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
  | "room_charge_incorrect";

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

export type Role = "owner" | "gm" | "controller" | "fnb_director" | "restaurant_manager" | "employee";

export interface User {
  id: string;
  name: string;
  role: Role;
  title: string;
  propertyIds: "all" | string[];
  outletIds: "all" | string[];
  staffId?: string;
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
