"use client";
import { Badge, Button, Panel } from "@/components/ui";
import { api } from "@/lib/api";
import { useLiveGet } from "@/lib/guest-hooks";
import { usePlanDrafts } from "@/lib/plan-hooks";
import type { EmailRecord } from "@/lib/server/notify";

const STATUS: Record<EmailRecord["status"], { label: string; tone: "neutral" | "pos" | "warn" | "neg" }> = {
  logged: { label: "Preview only, not sent", tone: "neutral" }, queued: { label: "Email queued", tone: "warn" }, sent: { label: "Email sent", tone: "pos" }, failed: { label: "Email failed", tone: "neg" },
};

/** Email on or off for this person, and the emails Tyll prepared for them, with exactly what happened to each. */
export function NotificationSettings() {
  const { data } = useLiveGet<{ emailOn: boolean; emails: EmailRecord[] }>("/api/notifications?emails=1");
  const bump = usePlanDrafts((s) => s.bump);
  if (!data) return null;
  return (
    <Panel title="Notifications" description="Requests for you appear in the bell. Important handoffs can also be emailed. In this demo no email provider is configured, so emails are prepared and shown here but not sent.">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">Email for important requests: <span className="text-ink">{data.emailOn ? "on" : "off"}</span></p>
        <Button size="sm" onClick={async () => { await api("/api/notifications", { method: "POST", body: { action: "prefs", email: !data.emailOn } }); bump(); }}>{data.emailOn ? "Turn email off" : "Turn email on"}</Button>
      </div>
      {data.emails.length > 0 && (
        <ul className="mt-4 divide-y divide-hair rounded-2xl border border-line text-sm">
          {data.emails.map((e) => (
            <li key={e.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-ink">{e.subject}</span><Badge tone={STATUS[e.status].tone} className="!py-0">{STATUS[e.status].label}</Badge></div>
              <p className="mt-1 whitespace-pre-line text-xs text-steel">To {e.to} · {e.at.slice(0, 16).replace("T", " ")}{"\n"}{e.text}</p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
