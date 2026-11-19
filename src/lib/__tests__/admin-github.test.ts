import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as A from "../server/admin";

const req = (url: string, cookies: Record<string, string> = {}, host = "demo.tyll.ai") =>
  new NextRequest(`https://${host}${url}`, { headers: { host, cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ") } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  vi.stubEnv("GITHUB_CLIENT_ID", "client-id");
  vi.stubEnv("GITHUB_CLIENT_SECRET", "client-secret-for-tests");
  vi.stubEnv("TYLL_ADMIN_GITHUB_USERS", "Giulio-Team, nadia-ops");
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("signing in to the visits page with GitHub", () => {
  it("keeps a sign-in for 12 hours, and refuses forged or expired ones", () => {
    const now = Date.parse("2026-11-19T10:00:00Z");
    const c = A.githubCookieFor("nadia-ops", now);
    expect(A.readGithubCookie(c, now + 60_000)).toBe("nadia-ops");
    expect(A.readGithubCookie(c, now + 12 * 3600_000 + 1)).toBeNull();
    const [body] = c.split(".");
    const forged = Buffer.from(JSON.stringify({ login: "intruder", exp: now + 1e9 })).toString("base64url");
    expect(A.readGithubCookie(`${forged}.${c.split(".")[1]}`, now)).toBeNull();
    expect(A.readGithubCookie(`${body}.wrong`, now)).toBeNull();
    expect(A.adminWho(req("/api/admin/visits", { [A.GITHUB_COOKIE]: A.githubCookieFor("nadia-ops") }))).toEqual({ via: "github", login: "nadia-ops" });
  });

  it("once GitHub sign-in is set up, this computer needs to sign in too", () => {
    expect(A.adminWho(req("/api/admin/visits", {}, "localhost:3210"))).toBeNull();
  });

  it("asks GitHub only who the person is, with a state value and the right return address", () => {
    const u = new URL(A.githubAuthorizeUrl(req("/api/admin/github/start"), "state123"));
    expect(u.origin + u.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(u.searchParams.get("state")).toBe("state123");
    expect(u.searchParams.get("scope")).toBeNull();
    expect(u.searchParams.get("redirect_uri")).toBe("https://demo.tyll.ai/api/admin/github/callback");
  });

  it("lets in people on the list, and people with access to the repository", async () => {
    expect(await A.mayView("giulio-team")).toBe(true); // the list ignores case
    expect(await A.mayView("stranger")).toBe(false);
    vi.stubEnv("TYLL_ADMIN_GITHUB_REPO", "owner/Demo-Tyll");
    vi.stubEnv("TYLL_ADMIN_GITHUB_TOKEN", "read-only-token");
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status: 204 })).mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect(await A.mayView("collaborator")).toBe(true);
    expect(await A.mayView("stranger")).toBe(false);
    expect(String(f.mock.calls[0][0])).toBe("https://api.github.com/repos/owner/Demo-Tyll/collaborators/collaborator");
  });
});

describe("the GitHub return route", () => {
  const callback = () => import("../../app/api/admin/github/callback/route");
  const where = (r: Response) => new URL(r.headers.get("location")!);

  it("refuses a return that did not start here", async () => {
    const { GET } = await callback();
    const r = await GET(req("/api/admin/github/callback?code=abc&state=forged", { [A.STATE_COOKIE]: "real" }));
    expect(where(r).pathname).toBe("/admin/visits");
    expect(where(r).searchParams.get("error")).toMatch(/expired or did not start here/);
    expect(r.headers.get("set-cookie") ?? "").not.toContain(`${A.GITHUB_COOKIE}=e`);
  });

  it("signs in someone allowed, and turns away someone who is not", async () => {
    const { GET } = await callback();
    const f = vi.spyOn(globalThis, "fetch");
    f.mockResolvedValueOnce(json({ access_token: "t1" })).mockResolvedValueOnce(json({ login: "nadia-ops" }));
    const ok = await GET(req("/api/admin/github/callback?code=abc&state=s1", { [A.STATE_COOKIE]: "s1" }));
    expect(where(ok).searchParams.get("error")).toBeNull();
    const cookie = /tyll_admin_gh=([^;]+)/.exec(ok.headers.get("set-cookie") ?? "")?.[1];
    expect(A.readGithubCookie(cookie)).toBe("nadia-ops");

    f.mockResolvedValueOnce(json({ access_token: "t2" })).mockResolvedValueOnce(json({ login: "stranger" }));
    const no = await GET(req("/api/admin/github/callback?code=abc&state=s2", { [A.STATE_COOKIE]: "s2" }));
    expect(where(no).searchParams.get("error")).toBe("@stranger does not have access to the visits page. Ask the owner to add you.");
    expect(no.headers.get("set-cookie") ?? "").not.toMatch(/tyll_admin_gh=[^;]+\./);
  });
});
