"use client";
// For the Tyll team: who is on the demo now, what visitors look at and for how long, and what was sent to the team.
// Only visitors who agreed are recorded. Open on the computer running Tyll, or with the admin key.
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, EmptyState, Field, Note, PageHeader, Panel, Segmented, Skeleton, SummaryBar, TableWrap, Td, Th, WidgetError, rowClass } from "@/components/ui";
import { TyllLogo } from "@/components/brand";
import { ALL_ITEMS } from "@/lib/nav";
import type { VisitReport } from "@/lib/server/visits";

type Days = "1" | "7" | "30" | "90";
type State = { kind: "loading" } | { kind: "ready"; r: VisitReport } | { kind: "locked"; needsKey: boolean; error: string } | { kind: "error" };

const dur = (s: number | null | undefined) => (s === null || s === undefined ? "" : s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`);
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const STATUS: Record<string, { label: string; tone: "pos" | "neg" | "neutral" | "warn" }> = { sent: { label: "Sent", tone: "pos" }, failed: { label: "Failed", tone: "neg" }, queued: { label: "Sending", tone: "warn" }, logged: { label: "Logged, not sent", tone: "neutral" } };

export default function VisitsPage() {
  const [days, setDays] = useState<Days>("7");
  const [state, setState] = useState<State>({ kind: "loading" });
  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/visits?days=${days}`, { cache: "no-store" }).catch(() => null);
    if (!res) return setState({ kind: "error" });
    if (res.status === 401) { const j = await res.json(); return setState({ kind: "locked", needsKey: !!j.needsKey, error: j.error }); }
    if (!res.ok) return setState({ kind: "error" });
    setState({ kind: "ready", r: await res.json() });
  }, [days]);
  useEffect(() => {
    // Loads at once, then again every 30 seconds: who is on the demo now changes by the minute.
    const first = setTimeout(() => void load(), 0);
    const t = setInterval(() => void load(), 30000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [load]);

  return (
    <main className="mx-auto w-full max-w-[1200px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <TyllLogo height={22} />
      <PageHeader title="Demo visits" lead="Who is on the demo, which pages they open and for how long. Only visitors who agreed in the banner are recorded; no names, emails or IP addresses.">
        {state.kind === "ready" && (
          <span className="flex flex-wrap items-center gap-2">
            <Segmented label="Period" value={days} onChange={setDays} options={[{ value: "1", label: "24 hours" }, { value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }]} />
            <a href={`/api/admin/visits?days=${days}&format=csv`} className="inline-flex h-10 items-center rounded-full border border-line px-4 text-sm text-ink hover:bg-cloud">Download CSV</a>
          </span>
        )}
      </PageHeader>
      {state.kind === "loading" && <Skeleton className="h-64 w-full" />}
      {state.kind === "error" && <WidgetError onRetry={() => void load()}>Visits could not load.</WidgetError>}
      {state.kind === "locked" && <KeyForm needsKey={state.needsKey} error={state.error} onDone={() => void load()} />}
      {state.kind === "ready" && <Report r={state.r} />}
    </main>
  );
}

function KeyForm({ needsKey, error, onDone }: { needsKey: boolean; error: string; onDone: () => void }) {
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState("");
  if (!needsKey) return <Panel><EmptyState title="This page is not available here">{error}</EmptyState></Panel>;
  return (
    <Panel title="Enter the admin key">
      <form className="flex max-w-md flex-col gap-3" onSubmit={async (e) => {
        e.preventDefault();
        const r = await fetch("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
        if (r.ok) onDone(); else setMsg((await r.json()).error ?? "That key is not right.");
      }}>
        <Field label="Admin key" type="password" autoComplete="current-password" value={key} onChange={(e) => setKey(e.target.value)} error={msg || undefined} />
        <Button type="submit" variant="primary" disabled={!key}>Open visits</Button>
      </form>
    </Panel>
  );
}

function Report({ r }: { r: VisitReport }) {
  const t = r.totals;
  const seen = new Set(r.pages.map((p) => p.page));
  const unopened = ALL_ITEMS.filter((i) => !seen.has(i.label)).map((i) => i.label);
  return (
    <>
      <SummaryBar items={[
        { label: "On the demo now", value: t.onNow, tone: t.onNow ? "pos" : undefined, compare: { text: "Active in the last 5 minutes", good: null } },
        { label: "Visitors today", value: t.visitorsToday, compare: { text: `${t.viewsToday} page ${t.viewsToday === 1 ? "view" : "views"} today`, good: null } },
        { label: `Visitors, ${r.days === 1 ? "24 hours" : `${r.days} days`}`, value: t.visitors, compare: { text: `${t.visits} ${t.visits === 1 ? "visit" : "visits"}, ${t.views} page views`, good: null } },
        { label: "Average visit", value: dur(t.avgVisitSeconds) || "0s", compare: { text: "Time with the page in view", good: null } },
      ]} />

      <Panel title="Visits" description="Newest first. Each visit lists the pages in the order they were opened, with the time spent on each." flush>
        {r.visits.length === 0 ? <div className="p-6"><EmptyState title="No visits recorded yet">Visits appear here once someone opens the demo and agrees to be recorded.</EmptyState></div> : (
          <ul className="divide-y divide-line">
            {r.visits.map((v) => (
              <li key={v.id} className="px-5 py-4 sm:px-6">
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="font-semibold text-ink">{v.visitor}</span>
                  {v.live && <Badge tone="pos">On the demo now</Badge>}
                  <span className="text-graphite">{v.returning ? "Returning" : "First visit"}, on a {v.device}</span>
                  <span className="text-steel">{when(v.start)}, {dur(v.seconds) || "under a second"}, {v.path.length} {v.path.length === 1 ? "page" : "pages"}</span>
                </p>
                <ol className="mt-2 flex flex-wrap gap-1.5 text-[13px]" aria-label={`Pages opened by ${v.visitor}`}>
                  {v.path.map((p, i) => (
                    <li key={i} className="rounded-full border border-line bg-cloud px-2.5 py-0.5 text-ink">
                      {p.page}{p.seconds !== null && <span className="text-steel">, {dur(p.seconds)}</span>}{p.role && <span className="text-steel">, as {p.role}</span>}
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[2fr_1fr]">
        <Panel title="Pages" description="Most viewed first. Average time counts only time with the page in view." flush>
          {r.pages.length === 0 ? <div className="p-6"><EmptyState title="No pages viewed in this period" /></div> : (
            <TableWrap>
              <table className="w-full text-table">
                <thead><tr><Th>Page</Th><Th align="right">Views</Th><Th align="right">Visitors</Th><Th align="right">Average time</Th></tr></thead>
                <tbody>
                  {r.pages.map((p) => (
                    <tr key={p.page} className={rowClass}><Td className="text-ink">{p.page}</Td><Td align="right" className="num">{p.views}</Td><Td align="right" className="num">{p.visitors}</Td><Td align="right" className="num">{dur(p.avgSeconds) || "n/a"}</Td></tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
          {unopened.length > 0 && <p className="px-6 py-4 text-[13px] text-graphite"><span className="font-medium text-ink">Not opened in this period: </span>{unopened.join(", ")}.</p>}
        </Panel>
        <div className="space-y-5">
          <Panel title="Roles used">
            {r.roles.length === 0 ? <p className="text-sm text-graphite">None yet.</p> : (
              <ul className="space-y-1.5 text-sm">{r.roles.map((x) => <li key={x.role} className="flex justify-between gap-3"><span className="text-ink">{x.role}</span><span className="num text-graphite">{x.views} views</span></li>)}</ul>
            )}
          </Panel>
          <Panel title="Messages to the team" description={r.delivery === "Not configured" ? "Not connected: messages are logged here and not sent." : `Sent by ${r.delivery}.`}>
            {r.alerts.length === 0 ? <p className="text-sm text-graphite">None yet. A message is made when a visit starts, and a summary of the day before on the first visit of each day.</p> : (
              <ul className="space-y-3">
                {r.alerts.map((a) => (
                  <li key={a.id} className="text-sm">
                    <p className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-steel">{when(a.at)}, {a.kind === "daily" ? "daily summary" : "visit started"}</span><Badge tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Badge></p>
                    <p className="mt-0.5 text-ink">{a.text}</p>
                    {a.status === "failed" && a.detail && <p className="text-xs text-neg">{a.detail}</p>}
                  </li>
                ))}
              </ul>
            )}
            {r.delivery === "Not configured" && <Note className="mt-4">To receive them, set TYLL_SLACK_WEBHOOK_URL for Slack, or TYLL_EMAIL_PROVIDER=resend with RESEND_API_KEY, TYLL_EMAIL_FROM and TYLL_VISIT_ALERT_EMAIL for email, on the server.</Note>}
          </Panel>
        </div>
      </div>
      <Note>Records older than {r.retentionDays} days are deleted. A visitor who turns recording off in Settings has their visits erased.</Note>
    </>
  );
}
