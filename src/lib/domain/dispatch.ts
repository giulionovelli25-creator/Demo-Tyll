// Sending an order to its supplier, as one state machine both purchasing and the screens read the same way:
// draft, pending approval, approved, sending, sent, failed. A failed order can be retried; a sent one never goes twice.
import type { PurchaseRequest, SendChannel } from "../types";

export type SendState = "draft" | "pending" | "approved" | "sending" | "sent" | "failed";

/** Where each state may go next. Sent is the end; failed goes back to sending, never straight to sent. */
export const SEND_NEXT: Record<SendState, SendState[]> = {
  draft: ["pending"],
  pending: ["approved", "draft"],
  approved: ["sending"],
  sending: ["sent", "failed"],
  failed: ["sending"],
  sent: [],
};

export const canMove = (from: SendState, to: SendState) => SEND_NEXT[from].includes(to);

/** The sending state of an order, from its record. Older orders sent before this record count as sent. */
export function sendState(r: Pick<PurchaseRequest, "status" | "sent" | "sentAt" | "dispatch">): SendState {
  if (r.status === "draft" || r.status === "changes" || r.status === "rejected") return "draft";
  if (r.status === "purchasing" || r.status === "accounting" || r.status === "fnb" || r.status === "manager") return "pending";
  if (r.dispatch) return r.dispatch.state;
  return r.sent || r.sentAt ? "sent" : "approved";
}

export const SEND_LABEL: Record<SendState, string> = {
  draft: "Draft",
  pending: "Waiting for approval",
  approved: "Approved, not sent yet",
  sending: "Sending",
  sent: "Sent to the supplier",
  failed: "Sending failed",
};

export const CHANNEL_LABEL: Record<SendChannel, string> = {
  email: "Email with the PDF",
  portal: "The supplier's ordering system",
  manual: "By phone, recorded by purchasing",
};

/** The sending reference of an order: the same on every try. */
export const sendKey = (r: Pick<PurchaseRequest, "id" | "poNumber">) => `SEND-${(r.poNumber ?? r.id).replace(/^P[OR]-/, "")}`;
