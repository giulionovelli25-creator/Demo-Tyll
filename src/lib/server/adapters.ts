// Simulated, read-only implementations of the integration interfaces. Server only.
import type { AccountingAdapter, InventoryAdapter, PmsAdapter, PosAdapter, ReservationsAdapter } from "../adapters";
import { getDataset } from "../data/generate";

const data = () => getDataset();

export const simulatedPos: PosAdapter = {
  async fetchOrders(outletId, businessDate) {
    return data().orders.filter((o) => o.outletId === outletId && o.date === businessDate);
  },
};

export const simulatedPms: PmsAdapter = {
  async fetchRoomCharges(propertyId, businessDate) {
    return data().roomCharges.filter((c) => c.propertyId === propertyId && c.date === businessDate);
  },
  async fetchOccupancy(propertyId, from, to) {
    return data().occupancy.filter((o) => o.propertyId === propertyId && o.date >= from && o.date <= to);
  },
};

export const simulatedReservations: ReservationsAdapter = {
  async fetchCovers(outletId, from, to) {
    return data().reservations.filter((r) => r.outletId === outletId && r.date >= from && r.date <= to);
  },
};

export const simulatedInventory: InventoryAdapter = {
  async fetchDeliveries(propertyId, from, to) {
    return data().deliveries.filter((d) => d.propertyId === propertyId && d.date >= from && d.date <= to);
  },
  async fetchCounts(propertyId, from, to) {
    return data().counts.filter((c) => c.propertyId === propertyId && c.date >= from && c.date <= to);
  },
  async fetchWaste(outletId, from, to) {
    return data().wasteLogs.filter((w) => w.outletId === outletId && w.date >= from && w.date <= to);
  },
};

export const unconnectedAccounting: AccountingAdapter = {
  async fetchPostedLabor() {
    return null;
  },
};
