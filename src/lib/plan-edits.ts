// Quantities changed by hand on Predictions before an order is built. Kept in this browser until the order is built,
// separately for each person: after a role switch nobody sees, or orders, the previous person's numbers.
import { useCallback } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useSession } from "./api";

type Qty = Record<string, number>;
interface EditStore {
  byUser: Record<string, Qty>;
  set(userId: string, ingredientId: string, qty: number | null): void;
  clear(userId: string): void;
}

export const usePlanEditStore = create<EditStore>()(
  persist(
    (set) => ({
      byUser: {},
      set: (u, id, q) => set((s) => {
        const mine = { ...s.byUser[u] };
        if (q === null) delete mine[id]; else mine[id] = q;
        return { byUser: { ...s.byUser, [u]: mine } };
      }),
      clear: (u) => set((s) => { const byUser = { ...s.byUser }; delete byUser[u]; return { byUser }; }),
    }),
    // v2: v1 kept one set of edits for everyone on the device.
    { name: "tyll-plan-edits-v2" },
  ),
);

const NONE: Qty = {};

/** The signed-in person's own edits. */
export function useMyPlanEdits() {
  const userId = useSession((s) => s.userId) ?? "";
  const qty = usePlanEditStore((s) => s.byUser[userId] ?? NONE);
  const setOne = usePlanEditStore((s) => s.set);
  const clearAll = usePlanEditStore((s) => s.clear);
  const set = useCallback((id: string, q: number | null) => { if (userId) setOne(userId, id, q); }, [userId, setOne]);
  const clear = useCallback(() => clearAll(userId), [userId, clearAll]);
  return { qty, set, clear };
}
