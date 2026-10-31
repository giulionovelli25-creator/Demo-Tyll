// Runs on the server before every page request, including client-side navigations.
// Pages need a live session and a role that may open them. Data itself is guarded again by each API route.
// Public demo (TYLL_PUBLIC_DEMO=on): no sign-in. Visitors start on /welcome, and a deep link opens directly as a role that may see it.
import { NextResponse, type NextRequest } from "next/server";
import { can, canOpen, homePath, moduleOfPath } from "./lib/domain/access";
import { SESSION_COOKIE, demoRoleFor, publicDemo, resolveSession, startDemoSession } from "./lib/server/auth";
import { sessionCookie } from "./lib/server/guard";

/** The role a deep link opens as, when the visitor has none yet. */
const PREFERRED: Record<string, string> = { forecast: "u-buy", stock: "u-chef", tasks: "u-chef", money: "u-fc", finance: "u-fc", rooms: "u-gm", staff: "u-emp" };

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const view = resolveSession(req.cookies.get(SESSION_COOKIE)?.value, { touch: true });

  if (publicDemo()) {
    if (pathname === "/login") return NextResponse.redirect(new URL(view ? homePath(view.user) : "/welcome", req.url));
    if (pathname === "/welcome") return NextResponse.next();
    if (pathname === "/" && (!view || !canOpen(view.user, "overview"))) return NextResponse.redirect(new URL(view ? homePath(view.user) : "/welcome", req.url));
    const mod = moduleOfPath(pathname);
    // Finance links are about reconciliation, which only the Financial Controller's role reviews.
    const fits = (u: Parameters<typeof canOpen>[0]) => canOpen(u, mod) && (mod !== "finance" || can(u, "finance.review"));
    if (view && fits(view.user)) return NextResponse.next();
    const userId = demoRoleFor(fits, PREFERRED[mod ?? ""] ?? "u-fnb");
    const started = userId ? startDemoSession(userId, req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local", req.cookies.get(SESSION_COOKIE)?.value) : null;
    if (!started?.ok) return NextResponse.redirect(new URL("/welcome", req.url));
    // Redirect to the same address so the page renders with the new cookie.
    const res = NextResponse.redirect(new URL(pathname + search, req.url));
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
