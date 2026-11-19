// Who may open the visits page.
// - Sign in with GitHub (GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET): people named in TYLL_ADMIN_GITHUB_USERS, or anyone
//   with access to TYLL_ADMIN_GITHUB_REPO (checked with the read-only TYLL_ADMIN_GITHUB_TOKEN). Checked again at every
//   sign-in; a sign-in lasts 12 hours, so removing someone takes effect within 12 hours.
// - The admin key (TYLL_ADMIN_KEY): anyone who types it.
// - Neither set: only requests made on the computer running Tyll (localhost), so a deployed demo shows nothing.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export const ADMIN_COOKIE = "tyll_admin";
export const GITHUB_COOKIE = "tyll_admin_gh";
export const STATE_COOKIE = "tyll_admin_state";
export const GITHUB_SESSION_SECONDS = 12 * 60 * 60;
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const LOOPBACK = /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/;
/** Next.js fills x-forwarded-for with the caller's address; a proxy in front adds the real client's. Local only if all are loopback. */
const fromThisComputer = (req: NextRequest) => LOCAL.test(req.headers.get("host") ?? "") && (req.headers.get("x-forwarded-for") ?? "").split(",").map((x) => x.trim()).filter(Boolean).every((x) => LOOPBACK.test(x));
const sign = (key: string) => createHmac("sha256", key).update("tyll-admin-v1").digest("base64url");
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export const adminKeySet = () => !!process.env.TYLL_ADMIN_KEY;
export const githubSet = () => !!process.env.GITHUB_CLIENT_ID && !!process.env.GITHUB_CLIENT_SECRET && (!!allowedUsers().length || (!!process.env.TYLL_ADMIN_GITHUB_REPO && !!process.env.TYLL_ADMIN_GITHUB_TOKEN));
const allowedUsers = () => (process.env.TYLL_ADMIN_GITHUB_USERS ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);

export type AdminWho = { via: "local" } | { via: "key" } | { via: "github"; login: string };

/** The person opening the visits page, or null if they may not. */
export function adminWho(req: NextRequest, now = Date.now()): AdminWho | null {
  const gh = githubSet() ? readGithubCookie(req.cookies.get(GITHUB_COOKIE)?.value, now) : null;
  if (gh) return { via: "github", login: gh };
  const key = process.env.TYLL_ADMIN_KEY;
  if (key && same(req.cookies.get(ADMIN_COOKIE)?.value ?? "", sign(key))) return { via: "key" };
  if (!key && !githubSet() && fromThisComputer(req)) return { via: "local" };
  return null;
}
export const isAdmin = (req: NextRequest) => adminWho(req) !== null;

/** The cookie value for a correct key, or null. */
export function adminCookieFor(typed: unknown): string | null {
  const key = process.env.TYLL_ADMIN_KEY;
  if (!key || typeof typed !== "string") return null;
  return same(typed, key) ? sign(key) : null;
}

// ---- GitHub sign-in ----------------------------------------------------------------------------------------------------

const sessionKey = () => createHmac("sha256", process.env.GITHUB_CLIENT_SECRET ?? "").update("tyll-admin-github-session").digest();

export function githubCookieFor(login: string, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ login, exp: now + GITHUB_SESSION_SECONDS * 1000 })).toString("base64url");
  return `${body}.${createHmac("sha256", sessionKey()).update(body).digest("base64url")}`;
}

export function readGithubCookie(value: string | undefined, now = Date.now()): string | null {
  if (!value || !process.env.GITHUB_CLIENT_SECRET) return null;
  const [body, mac] = value.split(".");
  if (!body || !mac || !same(mac, createHmac("sha256", sessionKey()).update(body).digest("base64url"))) return null;
  try {
    const { login, exp } = JSON.parse(Buffer.from(body, "base64url").toString()) as { login?: unknown; exp?: unknown };
    return typeof login === "string" && typeof exp === "number" && exp > now ? login : null;
  } catch {
    return null;
  }
}

export const newState = () => randomBytes(24).toString("base64url");

/** Where GitHub sends people back to. TYLL_PUBLIC_URL when set, as a proxy may hide the public address. */
export const callbackUrl = (req: NextRequest) => `${process.env.TYLL_PUBLIC_URL ?? req.nextUrl.origin}/api/admin/github/callback`;

/** GitHub's sign-in page. No extra permissions are asked for: only who the person is. */
export function githubAuthorizeUrl(req: NextRequest, state: string): string {
  const u = new URL("https://github.com/login/oauth/authorize");
  u.searchParams.set("client_id", process.env.GITHUB_CLIENT_ID ?? "");
  u.searchParams.set("redirect_uri", callbackUrl(req));
  u.searchParams.set("state", state);
  u.searchParams.set("allow_signup", "false");
  return u.toString();
}

type Signed = { ok: true; login: string } | { ok: false; reason: string };

/** Finishes a GitHub sign-in: swaps the code for the person's GitHub name, then checks they are allowed. */
export async function finishGithubSignIn(req: NextRequest, code: string): Promise<Signed> {
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: process.env.GITHUB_CLIENT_ID, client_secret: process.env.GITHUB_CLIENT_SECRET, code, redirect_uri: callbackUrl(req) }),
  });
  const token = ((await tokenRes.json().catch(() => ({}))) as { access_token?: string }).access_token;
  if (!token) return { ok: false, reason: "GitHub did not confirm the sign-in. Try again." };
  const me = await fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "tyll-demo" } });
  const login = ((await me.json().catch(() => ({}))) as { login?: string }).login;
  if (!login) return { ok: false, reason: "GitHub did not say who you are. Try again." };
  return (await mayView(login)) ? { ok: true, login } : { ok: false, reason: `@${login} does not have access to the visits page. Ask the owner to add you.` };
}

/** Named in the list, or has access to the repository. */
export async function mayView(login: string): Promise<boolean> {
  if (allowedUsers().includes(login.toLowerCase())) return true;
  const repo = process.env.TYLL_ADMIN_GITHUB_REPO, token = process.env.TYLL_ADMIN_GITHUB_TOKEN;
  if (!repo || !token || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^[\w-]+$/.test(login)) return false;
  const r = await fetch(`https://api.github.com/repos/${repo}/collaborators/${encodeURIComponent(login)}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "tyll-demo" } }).catch(() => null);
  return r?.status === 204;
}
