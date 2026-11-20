// Which orders each filter on Orders shows, and which filter opens first. Kept here so a test can pin it.
import type { PurchaseRequest, User } from "../types";
import { can } from "./access";
import { awaitingDelivery } from "./procurement";

export type Queue = "purchasing" | "accounting" | "fnb" | "manager" | "approved" | "delivery" | "returned" | "drafts" | "all";

export const inQueue = (r: PurchaseRequest, q: Queue, user: User): boolean =>
  q === "all" ? true
    : q === "approved" ? r.status === "approved" || r.status === "received"
      : q === "delivery" ? awaitingDelivery(r)
        : q === "returned" ? r.status === "rejected" || r.status === "changes"
          : q === "drafts" ? r.status === "draft" && (r.createdBy === user.id || can(user, "purchase.review"))
            : r.status === q;

/** The role's own step in the approval chain, if it has one. */
export const ownQueue = (user: User): Queue =>
  can(user, "purchase.review") ? "purchasing" : can(user, "purchase.approveFinance") ? "accounting" : user.role === "fnb_director" ? "fnb" : "all";

/** The filter Orders opens on: the one asked for in the address, else the role's own step,
 * else All when that step has nothing in it (an empty list would read as "no orders"). */
export function openingQueue(requests: PurchaseRequest[], user: User, asked: string | null): Queue {
  if (asked) return asked as Queue;
  const own = ownQueue(user);
  return requests.some((r) => inQueue(r, own, user)) ? own : "all";
}
