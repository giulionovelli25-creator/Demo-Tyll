// Runs on the server before every page request, including client-side navigations.
// Pages need a live session and a role that may open them. Data itself is guarded again by each API route.
// Public demo (TYLL_PUBLIC_DEMO=on): no sign-in and no entry page. A first visit opens as a role that may see the address.
// After that the role only changes when the visitor picks another one; a page the role cannot open leads to its home page. /welcome only shows if the demo cannot start.
import { NextResponse, type NextRequest } from "next/server";
import { canOpen, demoRoleFits, homePath, moduleOfPath } from "./lib/domain/access";
import { SESSION_COOKIE, demoRoleFor, publicDemo, resolveSession, startDemoSession } from "./lib/server/auth";
import { freshenPublicDemo } from "./lib/server/demo";
import { sessionCookie } from "./lib/server/guard";
import { DAY_COOKIE, DEMO_TODAY } from "./lib/util";

/** The role a deep link opens as, when the visitor has none yet. */
const PREFERRED: Record<string, string> = { forecast: "u-buy", stock: "u-chef", tasks: "u-chef", money: "u-fc", finance: "u-fc", rooms: "u-gm", staff: "u-emp" };

/** Every page carries the server's business date, so the browser shows the same "today" as the server's figures. */
export function proxy(req: NextRequest) {
  const res = route(req);
  res.cookies.set({ name: DAY_COOKIE, value: DEMO_TODAY, path: "/", sameSite: "lax" });
  return res;
}

function route(req: NextRequest): NextResponse {
  const { pathname, search } = req.nextUrl;
  const view = resolveSession(req.cookies.get(SESSION_COOKIE)?.value, { touch: true });

  if (publicDemo()) {
    if (pathname === "/login" || (pathname === "/welcome" && view)) return NextResponse.redirect(new URL(view ? homePath(view.user) : "/", req.url));
    const mod = moduleOfPath(pathname);
    // A live module needs a role that can do its main job: reconcile invoices, or plan what to buy.
    const fits = (u: Parameters<typeof canOpen>[0]) => demoRoleFits(u, mod);
    // Never switch role behind the visitor's back: a signed-in role keeps its role, and is sent home from pages it cannot open.
    if (view) return canOpen(view.user, mod) ? NextResponse.next() : NextResponse.redirect(new URL(homePath(view.user), req.url));
    // Deliveries and invoices sits under Purchasing, so a first visit opens it as purchasing, who sees the prices.
    const preferred = pathname === "/stock" && req.nextUrl.searchParams.get("tab") === "suppliers" ? "u-buy" : PREFERRED[mod ?? ""] ?? "u-fnb";
    const userId = demoRoleFor(fits, preferred);
    const started = userId ? startDemoSession(userId, req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local", req.cookies.get(SESSION_COOKIE)?.value) : null;
    if (!started?.ok) return pathname === "/welcome" ? NextResponse.next() : NextResponse.redirect(new URL("/welcome", req.url));
    freshenPublicDemo();
    // Redirect to the same address so the page renders with the new cookie.
    const res = NextResponse.redirect(new URL(pathname === "/welcome" ? "/" : pathname + search, req.url));
    res.cookies.set(sessionCookie(started.token));
    return res;
  }

  if (pathname === "/welcome") return NextResponse.redirect(new URL("/login", req.url));
  if (pathname === "/login") {
    return view ? NextResponse.redirect(new URL(homePath(view.user), req.url)) : NextResponse.next();
  }
  if (!view) {
    const to = new URL("/login", req.url);
    if (pathname !== "/") to.searchParams.set("next", pathname + search);
    return NextResponse.redirect(to);
  }
  if (!canOpen(view.user, moduleOfPath(pathname))) {
    return NextResponse.redirect(new URL(homePath(view.user), req.url));
  }
  return NextResponse.next();
}

export const config = {
  // Everything except API routes (which check for themselves), build assets and brand files.
  matcher: ["/((?!api/|_next/static|_next/image|brand/|icon.png|apple-icon.png|favicon.ico).*)"],
};
