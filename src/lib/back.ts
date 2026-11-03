/** The way out of a sub page. Pure, so every section follows the same rule. */
const MAIN = ["/", "/waste", "/stock", "/forecast", "/money", "/drinks", "/alerts", "/reports"];
// These open a part of the main page, not a page of their own.
const ON_MAIN_PAGE: Record<string, string[]> = { "/money": ["flags", "mistakes", "pour", "outlets"] };
// Pages with their own full screen or frame already have their own way out.
const OWN_EXIT = ["/count", "/staff", "/tasks", "/login", "/welcome"];
const SECTION_HOME: Record<string, string> = { "/menu": "/", "/performance": "/", "/investigations": "/money", "/finance": "/money" };

const rootOf = (path: string) => `/${path.split("/")[1]}`;

/** Is this a main page, the kind the sidebar leads to? */
export function isMainPage(path: string, params: { get(name: string): string | null }) {
  if (!MAIN.includes(path)) return false;
  const tab = params.get("tab");
  if (tab && !ON_MAIN_PAGE[path]?.includes(tab) && path !== "/alerts") return false;
  return params.get("log") !== "1";
}

/**
 * Where the exit leads, or null when this page needs none.
 * A sub page of a main feature returns to the main page you came from, or to its own if you landed there directly.
 * A section that is not in the sidebar steps back through its own first page.
 */
export function backTarget(path: string, params: { get(name: string): string | null }, cameFrom: string | null, home: string): string | null {
  const root = rootOf(path);
  if (isMainPage(path, params) || OWN_EXIT.includes(root)) return null;
  if (MAIN.includes(root)) return cameFrom ?? root;
  if (path !== root || params.get("tab")) return root;
  if (home.split("?")[0] === root) return null;
  return cameFrom ?? SECTION_HOME[root] ?? "/reports";
}
