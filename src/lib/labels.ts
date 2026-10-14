import type { ChargeSource, InvestigationStatus, Outcome, WasteReason } from "./types";

export const STATUS_LABEL: Record<InvestigationStatus, string> = { new: "New", assigned: "Assigned", in_review: "In review", closed: "Closed" };

export const OUTCOME_LABEL: Record<Outcome, string> = {
  legitimate: "Legitimate correction",
  confirmed_loss: "Confirmed loss",
  recovered: "Revenue recovered",
  inconclusive: "No finding",
};

/** The same outcomes, worded for a stock count shortfall. */
export const STOCK_OUTCOME_HELP: Record<Outcome, string> = {
  legitimate: "A recount, a delivery or a recorded transfer explains it. Nothing was lost.",
  confirmed_loss: "The stock is gone and cannot be accounted for.",
  recovered: "The stock was found, or the supplier credited it, and this has been verified.",
  inconclusive: "The records cannot settle it either way.",
};

export const OUTCOME_HELP: Record<Outcome, string> = {
  legitimate: "The change was valid. Nothing was lost.",
  confirmed_loss: "The item was served or made and cannot be charged.",
  recovered: "The amount was charged again or reposted and has been verified.",
  inconclusive: "The records cannot settle it either way.",
};

export const REASON_LABEL: Record<WasteReason, { en: string; ar: string }> = {
  waste: { en: "Waste", ar: "هدر" },
  breakage: { en: "Breakage", ar: "كسر" },
  spoilage: { en: "Spoilage", ar: "تلف" },
  damaged: { en: "Damaged goods", ar: "بضاعة تالفة" },
  other: { en: "Other", ar: "أخرى" },
};

export const SOURCE_LABEL: Record<ChargeSource, string> = {
  restaurant: "Restaurant and bar",
  room_service: "Room service",
  minibar: "Minibar",
  spa: "Spa",
  laundry: "Laundry",
};
