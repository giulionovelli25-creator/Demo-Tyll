// Notifications: one server-backed inbox for work handed from one person to another. Each notice names the record,
// who sent it and what is needed, and opens the exact record. Notices resolve when the work is done.
// Email is optional: by default it is only logged as a preview. It is sent only when a provider is configured, and its
// status says exactly what happened. Emails carry a reference and a link, never guest details, PINs or amounts.
import { USERS, userById } from "../data/catalog";
import { allowedProperties, can, type Permission } from "../domain/access";
import type { User } from "../types";
import { loadStore, mutateStore, type Shape } from "./purchasing-store";

export interface Notice {
  id: string;
  at: string;
  to: string;
  type: string;
  ref: string;
  propertyId: string;
  from?: string;
  title: string;
  body: string;
  href: string;
  read: boolean;
  resolved: boolean;
}

export type EmailStatus = "logged" | "queued" | "sent" | "failed";
export interface EmailRecord { id: string; at: string; userId: string; to: string; subject: string; text: string; link: string; status: EmailStatus; key: string; detail?: string }
export interface NotifyShape { notices: Notice[]; emails: EmailRecord[]; prefs: Record<string, { email: boolean }> }

export const emptyNotify = (): NotifyShape => ({ notices: [], emails: [], prefs: {} });

/** People at a hotel with a permission. The owner is left out of routine handoffs; they see outcomes instead. */
export function peopleWith(permission: Permission, propertyId: string, filter: (u: User) => boolean = () => true): User[] {
  return USERS.filter((u) => u.role !== "owner" && can(u, permission) && allowedProperties(u).includes(propertyId) && filter(u));
}

const origin = () => process.env.TYLL_PUBLIC_URL ?? "http://localhost:3210";
const emailOf = (userId: string) => process.env.TYLL_DEMO_EMAIL_DOMAIN && userById[userId] ? `${userId}@${process.env.TYLL_DEMO_EMAIL_DOMAIN}` : `${userById[userId]?.name.split(" ")[0].toLowerCase()}@grandresorts.example`;

interface Send {
  to: (User | string)[];
  type: string;
  ref: string;
  propertyId: string;
  from?: string;
  title: string;
  body: string;
  href: string;
  /** Send an email as well, for important handoffs only. */
  email?: boolean;
}

/** Records notices inside a store change. The same open notice is never sent twice to the same person. */
export function notify(x: Shape, n: Send) {
  const at = new Date().toISOString();
  const ids = [...new Set(n.to.map((u) => (typeof u === "string" ? u : u.id)))].filter((id) => id && id !== n.from && userById[id]);
  for (const to of ids) {
    if (x.notify.notices.some((o) => o.to === to && o.type === n.type && o.ref === n.ref && !o.resolved)) continue;
    x.notify.notices.push({ id: `N-${x.notify.notices.length + 1}-${Date.now().toString(36)}`, at, to, type: n.type, ref: n.ref, propertyId: n.propertyId, from: n.from, title: n.title, body: n.body, href: n.href, read: false, resolved: false });
    if (!n.email || x.notify.prefs[to]?.email === false) continue;
    const key = `${to}:${n.type}:${n.ref}`;
    if (x.notify.emails.some((e) => e.key === key)) continue;
    const configured = process.env.TYLL_EMAIL_PROVIDER === "resend" && !!process.env.RESEND_API_KEY && !!process.env.TYLL_EMAIL_FROM;
    x.notify.emails.push({
      id: `E-${x.notify.emails.length + 1}`, at, userId: to, to: emailOf(to), subject: `Tyll: ${n.title}`,
      text: `${n.body}\n\nReference: ${n.ref}\nOpen in Tyll: ${origin()}${n.href}`, link: `${origin()}${n.href}`, status: configured ? "queued" : "logged", key,
      detail: configured ? undefined : "Preview only. No email provider is configured, so nothing was sent.",
    });
  }
}

/** Marks open notices for a record as handled, for everyone who received them. */
export function resolve(x: Shape, type: string | string[], ref: string) {
  const types = Array.isArray(type) ? type : [type];
  for (const n of x.notify.notices) if (n.ref === ref && types.includes(n.type)) n.resolved = true;
}

/** Sends queued emails through the configured provider. Runs after the change is saved; failures are recorded. */
export async function deliverQueued() {
  const queued = loadStore().notify.emails.filter((e) => e.status === "queued");
  for (const e of queued) {
    let status: EmailStatus = "failed";
    let detail = "";
    try {
      const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: process.env.TYLL_EMAIL_FROM, to: e.to, subject: e.subject, text: e.text }) });
      status = r.ok ? "sent" : "failed";
      detail = r.ok ? "Accepted by the email provider." : `Provider answered ${r.status}.`;
    } catch {
      detail = "Could not reach the email provider.";
    }
    mutateStore((x) => { const y = x.notify.emails.find((z) => z.id === e.id); if (y) { y.status = status; y.detail = detail; } });
  }
}

export function noticesFor(user: User) {
  const s = loadStore();
  const props = new Set(allowedProperties(user));
  const mine = s.notify.notices.filter((n) => n.to === user.id && props.has(n.propertyId)).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 40);
  return { notices: mine, unread: mine.filter((n) => !n.read && !n.resolved).length, emailOn: s.notify.prefs[user.id]?.email !== false };
}

export function markRead(user: User, body: Record<string, unknown>) {
  const ids = Array.isArray(body.ids) ? new Set(body.ids.map(String)) : null;
  mutateStore((x) => { for (const n of x.notify.notices) if (n.to === user.id && (!ids || ids.has(n.id))) n.read = true; });
}

export function setEmailPref(user: User, on: boolean) {
  mutateStore((x) => { x.notify.prefs[user.id] = { email: on }; });
}

export const emailsFor = (user: User) => loadStore().notify.emails.filter((e) => e.userId === user.id).slice(-20).reverse();
