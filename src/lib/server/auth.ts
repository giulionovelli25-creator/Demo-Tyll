// Server-side accounts, sessions, PIN verification, lockouts and the audit log.
// Runs only on the server (it reads and writes the local auth store with node:fs).
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { userById } from "../data/catalog";
import type { Role, User } from "../types";

// ---- Policy -----------------------------------------------------------------
const seconds = (name: string, fallback: number) => (Number(process.env[name]) > 0 ? Number(process.env[name]) : fallback) * 1000;

export const AUTH_POLICY = {
  sessionIdleMs: seconds("TYLL_SESSION_IDLE_SECONDS", 60 * 60),
  sessionMaxMs: seconds("TYLL_SESSION_MAX_SECONDS", 12 * 60 * 60),
  pinIdleMs: seconds("TYLL_PIN_IDLE_SECONDS", 10 * 60),
  loginMaxFailures: 5,
  loginLockMs: 15 * 60 * 1000,
  pinMaxFailures: 5,
  pinLockMs: 15 * 60 * 1000,
};

export const SESSION_COOKIE = "tyll_session";
export const DEMO_MODE = process.env.TYLL_DEMO_MODE !== "off";

/** Everyone except operational staff must unlock management information with a PIN. */
export const pinRequired = (role: Role) => role !== "employee";

// ---- Secrets ----------------------------------------------------------------
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

export function hashSecret(secret: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(secret.normalize("NFKC"), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifySecret(secret: string, stored: string): boolean {
  const [alg, n, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const got = scryptSync(secret.normalize("NFKC"), Buffer.from(salt, "base64"), expected.length, { N: Number(n), r: SCRYPT.r, p: SCRYPT.p });
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** Session tokens are stored only as hashes, so a copy of the store cannot be replayed. */
const tokenKey = (token: string) => createHash("sha256").update(token).digest("base64url");

// ---- Store ------------------------------------------------------------------
interface AccountRecord {
  userId: string;
  email: string;
  passwordHash: string;
  pinHash: string;
  failedLogins: number;
  lockedUntil: number | null;
  failedPins: number;
  pinLockedUntil: number | null;
}

interface SessionRecord {
  userId: string;
  createdAt: number;
  lastSeenAt: number;
  pinVerifiedAt: number | null;
  pinActiveAt: number | null;
}

export interface AuditRecord {
  at: string;
  userId: string | null;
  action: string;
  detail: string;
  ip: string;
}

interface StoreShape {
  version: 1;
  accounts: Record<string, AccountRecord>;
  sessions: Record<string, SessionRecord>;
  audit: AuditRecord[];
}

const storePath = () => process.env.TYLL_AUTH_STORE ?? path.join(process.cwd(), ".data", "auth.json");
const seedPath = () => process.env.TYLL_DEMO_ACCOUNTS ?? path.join(process.cwd(), "config", "demo-accounts.json");

interface DemoAccount {
  userId: string;
  email: string;
  password: string;
  pin: string;
}

export function demoAccounts(): DemoAccount[] {
  return (JSON.parse(fs.readFileSync(seedPath(), "utf8")) as { accounts: DemoAccount[] }).accounts.filter((a) => userById[a.userId]);
}

let cache: { mtime: number; data: StoreShape } | null = null;

function seed(): StoreShape {
  const accounts: Record<string, AccountRecord> = {};
  for (const a of demoAccounts()) {
    if (!/^\d{4,6}$/.test(a.pin)) throw new Error(`PIN for ${a.userId} must be 4 to 6 digits.`);
    accounts[a.userId] = { userId: a.userId, email: a.email.toLowerCase(), passwordHash: hashSecret(a.password), pinHash: hashSecret(a.pin), failedLogins: 0, lockedUntil: null, failedPins: 0, pinLockedUntil: null };
  }
  return { version: 1, accounts, sessions: {}, audit: [] };
}

function load(): StoreShape {
  const file = storePath();
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    save(seed());
  }
  const mtime = fs.statSync(file).mtimeMs;
  if (!cache || cache.mtime !== mtime) cache = { mtime, data: JSON.parse(fs.readFileSync(file, "utf8")) as StoreShape };
  return cache.data;
}

function save(data: StoreShape) {
  const file = storePath();
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
  fs.renameSync(tmp, file);
  cache = { mtime: fs.statSync(file).mtimeMs, data };
}

function mutate<T>(run: (s: StoreShape) => T): T {
  const s = load();
  const out = run(s);
  save(s);
  return out;
}

export function audit(userId: string | null, action: string, detail: string, ip: string) {
  mutate((s) => {
    s.audit.unshift({ at: new Date().toISOString(), userId, action, detail, ip });
    s.audit = s.audit.slice(0, 2000);
  });
}

export const readAudit = (limit = 300): AuditRecord[] => load().audit.slice(0, limit);

// ---- Login ------------------------------------------------------------------
export type Failure = { ok: false; status: 401 | 403 | 423 | 429; error: string; retryAfter?: number; attemptsLeft?: number };

const DUMMY_HASH = hashSecret("not-a-real-password");

export function login(email: string, password: string, ip: string): { ok: true; token: string; user: User } | Failure {
  const now = Date.now();
  const s = load();
  const account = Object.values(s.accounts).find((a) => a.email === email.trim().toLowerCase());
  if (!account) {
    verifySecret(password, DUMMY_HASH); // Same work either way, so response time does not reveal which emails exist.
    audit(null, "Sign-in failed", `Unknown email ${email.slice(0, 80)}`, ip);
    return { ok: false, status: 401, error: "Email or password is not correct." };
  }
  if (account.lockedUntil && account.lockedUntil > now) {
    audit(account.userId, "Sign-in blocked", "Account temporarily locked", ip);
    return { ok: false, status: 429, error: "Too many attempts. Try again later.", retryAfter: Math.ceil((account.lockedUntil - now) / 1000) };
  }
  if (!verifySecret(password, account.passwordHash)) {
    const failures = account.failedLogins + 1;
    const locked = failures >= AUTH_POLICY.loginMaxFailures;
    mutate((st) => {
      st.accounts[account.userId].failedLogins = locked ? 0 : failures;
      st.accounts[account.userId].lockedUntil = locked ? now + AUTH_POLICY.loginLockMs : null;
    });
    audit(account.userId, locked ? "Account locked" : "Sign-in failed", locked ? `${failures} failed attempts` : "Wrong password", ip);
    return locked
      ? { ok: false, status: 429, error: "Too many attempts. Try again in 15 minutes.", retryAfter: AUTH_POLICY.loginLockMs / 1000 }
      : { ok: false, status: 401, error: "Email or password is not correct.", attemptsLeft: AUTH_POLICY.loginMaxFailures - failures };
  }
  const token = randomBytes(32).toString("base64url");
  mutate((st) => {
    st.accounts[account.userId].failedLogins = 0;
    st.accounts[account.userId].lockedUntil = null;
    st.sessions[tokenKey(token)] = { userId: account.userId, createdAt: now, lastSeenAt: now, pinVerifiedAt: null, pinActiveAt: null };
    // Drop expired sessions while we are here.
    for (const [k, v] of Object.entries(st.sessions)) if (expired(v, now)) delete st.sessions[k];
  });
  audit(account.userId, "Signed in", "", ip);
  return { ok: true, token, user: userById[account.userId] };
}

const expired = (v: SessionRecord, now: number) => now - v.lastSeenAt > AUTH_POLICY.sessionIdleMs || now - v.createdAt > AUTH_POLICY.sessionMaxMs;

// ---- Sessions ---------------------------------------------------------------
export interface SessionView {
  user: User;
  pinRequired: boolean;
  pinUnlocked: boolean;
  pinExpiresAt: number | null;
  sessionExpiresAt: number;
}

/** Looks up a session, ending it if it has expired. Activity counts towards keeping it alive. */
export function resolveSession(token: string | undefined, opts: { touch?: boolean; pinActivity?: boolean } = {}): SessionView | null {
  if (!token) return null;
  const now = Date.now();
  const key = tokenKey(token);
  const s = load();
  const rec = s.sessions[key];
  const user = rec ? userById[rec.userId] : undefined;
  if (!rec || !user) return null;
  if (expired(rec, now)) {
    mutate((st) => delete st.sessions[key]);
    return null;
  }
  const required = pinRequired(user.role);
  let unlocked = !required || (rec.pinActiveAt !== null && now - rec.pinActiveAt <= AUTH_POLICY.pinIdleMs);
  if (required && rec.pinVerifiedAt && !unlocked) {
    mutate((st) => {
      st.sessions[key].pinVerifiedAt = null;
      st.sessions[key].pinActiveAt = null;
    });
    unlocked = false;
  }
  // Write at most every 15 seconds, to keep the store quiet under normal use.
  const stale = now - rec.lastSeenAt > 15000 || (opts.pinActivity && unlocked && required && now - (rec.pinActiveAt ?? 0) > 15000);
  if (opts.touch && stale) {
    mutate((st) => {
      st.sessions[key].lastSeenAt = now;
      if (opts.pinActivity && unlocked && required) st.sessions[key].pinActiveAt = now;
    });
  }
  const fresh = load().sessions[key] ?? rec;
  return {
    user,
    pinRequired: required,
    pinUnlocked: unlocked,
    pinExpiresAt: required && unlocked && fresh.pinActiveAt ? fresh.pinActiveAt + AUTH_POLICY.pinIdleMs : null,
    sessionExpiresAt: Math.min(fresh.lastSeenAt + AUTH_POLICY.sessionIdleMs, fresh.createdAt + AUTH_POLICY.sessionMaxMs),
  };
}

export function verifyPin(token: string | undefined, pin: string, ip: string): { ok: true } | (Failure & { signedOut?: boolean }) {
  const view = resolveSession(token);
  if (!token || !view) return { ok: false, status: 401, error: "Your session has ended. Sign in again." };
  if (!view.pinRequired) return { ok: true };
  const now = Date.now();
  const account = load().accounts[view.user.id];
  if (account.pinLockedUntil && account.pinLockedUntil > now) {
    return { ok: false, status: 429, error: "PIN entry is locked. Try again later.", retryAfter: Math.ceil((account.pinLockedUntil - now) / 1000) };
  }
  if (!/^\d{4,6}$/.test(pin) || !verifySecret(pin, account.pinHash)) {
    const failures = account.failedPins + 1;
    if (failures >= AUTH_POLICY.pinMaxFailures) {
      // Too many wrong PINs: lock PIN entry and end the session, so the password is needed again.
      mutate((st) => {
        st.accounts[view.user.id].failedPins = 0;
        st.accounts[view.user.id].pinLockedUntil = now + AUTH_POLICY.pinLockMs;
        delete st.sessions[tokenKey(token)];
      });
      audit(view.user.id, "PIN locked", `${failures} wrong PINs, session ended`, ip);
      return { ok: false, status: 429, error: "Too many wrong PINs. You have been signed out for 15 minutes.", retryAfter: AUTH_POLICY.pinLockMs / 1000, signedOut: true };
    }
    mutate((st) => (st.accounts[view.user.id].failedPins = failures));
    audit(view.user.id, "PIN failed", "", ip);
    return { ok: false, status: 401, error: "That PIN is not right.", attemptsLeft: AUTH_POLICY.pinMaxFailures - failures };
  }
  mutate((st) => {
    st.accounts[view.user.id].failedPins = 0;
    st.accounts[view.user.id].pinLockedUntil = null;
    st.sessions[tokenKey(token)].pinVerifiedAt = now;
    st.sessions[tokenKey(token)].pinActiveAt = now;
  });
  audit(view.user.id, "Unlocked with PIN", "", ip);
  return { ok: true };
}

export function lockSession(token: string | undefined, ip: string) {
  const view = resolveSession(token);
  if (!token || !view) return;
  mutate((st) => {
    st.sessions[tokenKey(token)].pinVerifiedAt = null;
    st.sessions[tokenKey(token)].pinActiveAt = null;
  });
  audit(view.user.id, "Locked", "", ip);
}

export function logout(token: string | undefined, ip: string) {
  if (!token) return;
  const rec = load().sessions[tokenKey(token)];
  if (!rec) return;
  mutate((st) => delete st.sessions[tokenKey(token)]);
  audit(rec.userId, "Signed out", "", ip);
}

/** For tests: start again from the seed accounts. */
export function resetAuthStore() {
  cache = null;
  save(seed());
}
