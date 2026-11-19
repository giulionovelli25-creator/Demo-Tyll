import { NextResponse, type NextRequest } from "next/server";
import { STATE_COOKIE, githubAuthorizeUrl, githubSet, newState } from "@/lib/server/admin";

/** Sends the person to GitHub to sign in. The state value guards against a forged return. */
export function GET(req: NextRequest) {
  if (!githubSet()) return NextResponse.redirect(new URL("/admin/visits?error=github", req.url));
  const state = newState();
  const res = NextResponse.redirect(githubAuthorizeUrl(req, state));
  res.cookies.set({ name: STATE_COOKIE, value: state, httpOnly: true, sameSite: "lax", secure: req.nextUrl.protocol === "https:", path: "/api/admin/github", maxAge: 600 });
  return res;
}
