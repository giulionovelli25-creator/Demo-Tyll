// Where an order is between the outlet, purchasing and the supplier, in one word both teams read the same way.
import type { PurchaseRequest } from "../types";
import { DEMO_NOW_MIN, DEMO_TODAY } from "../util";

export type OrderStage = "draft" | "waiting" | "sent" | "on_the_way" | "late" | "delivered" | "short" | "returned";

const nowStamp = () => `${DEMO_TODAY}T${String(Math.floor(DEMO_NOW_MIN / 60)).padStart(2, "0")}:${String(DEMO_NOW_MIN % 60).padStart(2, "0")}`;

/** An approved order is late once the time the supplier gave has passed without a delivery. */
export function orderStage(r: PurchaseRequest): OrderStage {
  if (r.status === "draft") return "draft";
  if (r.status === "rejected" || r.status === "changes") return "returned";
  if (r.status === "received") return r.lines.some((l) => (l.received ?? l.qty) < l.qty) ? "short" : "delivered";
  if (r.status !== "approved") return "waiting";
  if (r.expectedAt && r.expectedAt < nowStamp()) return "late";
  if (r.expectedAt && r.expectedAt.slice(0, 10) === DEMO_TODAY) return "on_the_way";
  return "sent";
}

export const STAGE_LABEL: Record<OrderStage, { label: string; tone: "neutral" | "warn" | "pos" | "neg" | "ink" }> = {
  draft: { label: "Draft", tone: "neutral" },
  waiting: { label: "Waiting for approval", tone: "warn" },
  sent: { label: "Approved and sent", tone: "ink" },
  on_the_way: { label: "On the way", tone: "ink" },
  late: { label: "Late", tone: "neg" },
  delivered: { label: "Delivered", tone: "pos" },
  short: { label: "Delivered short", tone: "warn" },
  returned: { label: "Returned to the requester", tone: "neutral" },
};

/** "Today 15:00", "Tomorrow 07:30" or a date. */
export function arrivalText(expectedAt: string | undefined, fmtDate: (iso: string, withDay?: boolean) => string, tomorrow: string): string {
  if (!expectedAt) return "";
  const [d, t] = expectedAt.split("T");
  const day = d === DEMO_TODAY ? "Today" : d === tomorrow ? "Tomorrow" : fmtDate(d, true);
  return `${day} ${t}`;
}
