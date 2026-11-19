import { NextResponse, type NextRequest } from "next/server";
import { GITHUB_COOKIE, GITHUB_SESSION_SECONDS, STATE_COOKIE, finishGithubSignIn, githubCookieFor, githubSet } from "@/lib/server/admin";

/** GitHub sends the person back here. Signed in only if the state matches and they are allowed. */
export async function GET(req: NextRequest) {
  const back = (reason?: string) => {
    const u = new URL("/admin/visits", req.url);
    if (reason) u.searchParams.set("error", reason);
    const res = NextResponse.redirect(u);
    res.cookies.set({ name: STATE_COOKIE, value: "", path: "/api/admin/github", maxAge: 0 });
    return res;
  };
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const expected = req.cookies.get(STATE_COOKIE)?.value;
  if (!githubSet()) return back("GitHub sign-in is not set up on this server.");
  if (!code || !state || !expected || state !== expected) return back("The sign-in expired or did not start here. Try again.");
  const r = await finishGithubSignIn(req, code).catch(() => ({ ok: false as const, reason: "Could not reach GitHub. Try again." }));
  if (!r.ok) return back(r.reason);
  const res = back();
  res.cookies.set({ name: GITHUB_COOKIE, value: githubCookieFor(r.login), httpOnly: true, sameSite: "lax", secure: req.nextUrl.protocol === "https:", path: "/", maxAge: GITHUB_SESSION_SECONDS });
  return res;
}
