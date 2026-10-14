// Runs on the server before every page request, including client-side navigations.
// Pages need a live session and a role that may open them. Data itself is guarded again by each API route.
import { NextResponse, type NextRequest } from "next/server";
import { canOpen, homePath, moduleOfPath } from "./lib/domain/access";
import { SESSION_COOKIE, resolveSession } from "./lib/server/auth";

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const view = resolveSession(req.cookies.get(SESSION_COOKIE)?.value, { touch: true });

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
