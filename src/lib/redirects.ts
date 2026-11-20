// Old addresses and where they live now. The proxy sends them on, so no saved link, email or bookmark breaks.
// Merges (simplify pass, 20 November 2026): the Money Back List is part of Flagged transactions, and Deliveries and
// invoices has one address. Parts switched off in lib/features.ts lead to the Overview or their main page.
import { hiddenRedirect } from "./features";

/** Where an address lives now, with its other query values kept, or null when it has not moved. */
export function movedTo(pathname: string, params: URLSearchParams): string | null {
  const tab = params.get("tab");
  const keep = (to: string, drop: string[] = ["tab"]) => {
    const [path, q] = to.split("?");
    const out = new URLSearchParams(q);
    params.forEach((v, k) => { if (!drop.includes(k) && !out.has(k)) out.set(k, v); });
    const s = out.toString();
    return s ? `${path}?${s}` : path;
  };
  const hidden = hiddenRedirect(pathname, tab);
  if (hidden) return keep(hidden, ["tab"]);
  // The Money Back List and the flags are one page: the cases with their rules, follow up and money recovered.
  if (pathname === "/investigations") return keep("/money?tab=flags");
  if (pathname === "/money" && tab === "mistakes") return keep("/money?tab=flags");
  // Deliveries and invoices: one address, two tabs.
  if (pathname === "/stock" && tab === "suppliers") return keep("/deliveries");
  if (pathname === "/finance" && tab === "invoices") return keep("/deliveries?tab=invoices");
  return null;
}
