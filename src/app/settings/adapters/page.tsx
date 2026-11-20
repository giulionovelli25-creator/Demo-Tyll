"use client";
// Settings > Data sources > POS and PMS adapters. The Lightspeed and Mews adapters, run on sample responses replayed as
// last night (/api/integrations/sample). Nothing here is live, and nothing read here changes a figure in the demo.
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { Section } from "@/components/disclosure";
import { Badge, Note, PageHeader, Panel, Skeleton, SummaryBar, TableWrap, Td, Th, WidgetError, cn, rowClass, textLink } from "@/components/ui";
import { outletLabel } from "@/lib/data/catalog";
import { can } from "@/lib/domain/access";
import { ROOM_STATUS_LABEL } from "@/lib/domain/room-charges";
import { useApi, useUser } from "@/lib/hooks";
import { useMenu } from "@/components/stock/menu-sync";
import { SIMPHONY_READS } from "@/lib/server/integrations/simphony";
import type { AdapterSampleView, SampleCharge } from "@/lib/server/integrations/sample";
import { fmtDate, fmtMoney, fmtNum, fmtPct, fmtTime } from "@/lib/util";

const TOP = 5;
const money = (n: number) => fmtMoney(n, "EUR");

/** What a sandbox account has to confirm before either adapter reads a hotel's own data. */
const TO_CONFIRM = {
  lightspeed: [
    "Which field carries the room number on a room charge payment (read from the payment's external reference here).",
    "Whether line discounts include tax, as line totals do.",
    "When the business day closes, and that voids after a bill is sent arrive as lines with a negative quantity.",
    "Who approved a discount, a complimentary item or a line taken off. The sales export has no field for it, so until then no rule counts a missing approval on these bills.",
  ],
  mews: [
    "That the POS link writes the till's receipt id on each posting (without it, Tyll matches on amount and time).",
    "Which Mews services the outlets post to, and that rooms are the active space resources.",
    "That check-out times arrive on the stay as soon as the guest leaves.",
  ],
};

const LIGHTSPEED_FIELDS: [string, string][] = [
  ["accountFiscId, receiptId", "Bill number, and the reference matched on the guest bill"],
  ["timeOfOpening, timeClosed", "Bill opened and closed, in the hotel's time zone"],
  ["salesLines: sku, quantity", "Menu item and units, through the item list agreed at onboarding"],
  ["totalNetAmountWithoutTax", "Net of tax, the figure every Tyll total uses"],
  ["totalDiscountAmount, discountName", "Discount and its reason; a line taken off in full is complimentary"],
  ["quantity below zero, voidReason", "Items taken off after they were rung, with the reason"],
  ["type REFUND, source.initialAccountId", "A refund, kept on the bill it refunds"],
  ["payments: code, externalReference", "Card, cash or room, and the room the bill was signed to"],
  ["ownerId, staffId", "The login on the bill and on each change, through the staff list"],
];
const MEWS_FIELDS: [string, string][] = [
  ["Resources: Name", "Room numbers; meeting rooms and beds are left out"],
  ["Reservations: AssignedResourceId, AccountId", "Which guest account belongs to which room"],
  ["ActualStartUtc, ActualEndUtc, State", "Check-in and check-out; Processed means checked out"],
  ["PersonCounts", "Guests per room, for guests a night"],
  ["OrderItems: ServiceOrderId, ExternalIdentifier", "One posting per bill, and the till's receipt id on it"],
  ["Amount.GrossValue, AccountingState", "Amount posted with tax; cancelled items are left out"],
  ["CreatedUtc", "When the posting reached the guest bill, against check-out"],
];

function chargeTone(c: SampleCharge) {
  return c.status === "matched" ? "pos" : "warn";
}

export default function AdaptersPage() {
  const user = useUser()!;
  const { data, error } = useApi<AdapterSampleView>("/api/integrations/sample");
  const [everything, setEverything] = useState(false);

  const header = (
    <PageHeader
      title="POS and PMS adapters"
      question="Can Tyll read our own tills and guest bills?"
      lead="Oracle Simphony runs as a demo connection on recorded responses. Lightspeed Restaurant K Series and Mews adapters are built from their public API documentation and tested on sample responses only. None is connected to a live account."
    />
  );
  if (error) return <div className="space-y-5">{header}<WidgetError>The sample could not be read.</WidgetError></div>;
  if (!data) return <div className="space-y-5">{header}<Skeleton className="h-72 w-full" /></div>;

  const { pos, pms, summary: s } = data;
  const agree = Math.abs(pos.sourceNet - pos.tyllNet) < 0.005;
  const shown = everything ? data.charges : data.charges.slice(0, TOP);
  const outlets = pos.outlets.map((o) => outletLabel(o.outletId)).join(" and ");
  const roomCheck = can(user, "roomcharge.view");

  return (
    <div className="space-y-5">
      {header}

      <SimphonyPanel />

      <SummaryBar
        items={[
          { label: "Bills read from the sample", value: fmtNum(pos.bills), note: `${outlets}, ${fmtDate(data.businessDate)}` },
          { label: "Sample totals agree", value: money(pos.tyllNet), tone: agree ? "pos" : "neg", compare: { text: agree ? "Same net total in Lightspeed and in Tyll" : `Lightspeed says ${money(pos.sourceNet)}`, good: agree } },
          { label: "Room charges to check", value: `${s.toCheck} of ${s.checked}`, tone: s.toCheck ? "warn" : "pos", note: s.toCheck ? `${money(s.atRisk)} in the sample` : "Every sample charge matched" },
          { label: "Live calls made", value: fmtNum(data.liveCalls), note: "No account is connected" },
        ]}
      />

      <Panel
        title="Room charge check on the sample"
        description="The room charge check's own rule, run on what the two adapters read. Largest amount to check first. Sample data: it changes no figure in the demo."
        action={roomCheck ? <Link prefetch={false} href="/money?tab=rooms" className="flex items-center gap-1 text-[13px] text-steel hover:text-ink">Room charge check <ArrowRight size={14} className="rtl:rotate-180" /></Link> : undefined}
        flush
      >
        <ul className="divide-y divide-hair border-t border-hair">
          {shown.map((c) => (
            <li key={c.id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:px-6">
              <div className="min-w-0">
                <p className="text-sm text-ink">{c.headline ?? `Room ${c.room}: posted as charged`}</p>
                <p className="mt-0.5 text-xs text-graphite">{c.description}</p>
                <p className="mt-0.5 text-xs text-steel">{`${outletLabel(c.outletId)}, ${fmtTime(c.min)}. Charged ${money(c.expected)}, ${c.posted.length ? `posted ${c.posted.map(money).join(" and ")}` : "nothing posted"}.`}</p>
                {roomCheck && <div className="mt-2 hidden sm:block"><HowChecked /></div>}
              </div>
              <div className="flex shrink-0 items-center justify-between gap-3 sm:flex-col sm:items-end sm:gap-1">
                <Badge tone={chargeTone(c)}>{ROOM_STATUS_LABEL[c.status]}</Badge>
                <span className={cn("num text-sm font-medium", c.atRisk ? "text-ink" : "text-steel")}>{c.atRisk ? money(c.atRisk) : "Nothing to check"}</span>
              </div>
              {/* On phones the link follows the status, so each row reads finding, status, action. */}
              {roomCheck && <div className="sm:hidden"><HowChecked /></div>}
            </li>
          ))}
        </ul>
        {data.charges.length > TOP && <div className="border-t border-hair px-5 py-3 sm:px-6"><button type="button" onClick={() => setEverything((v) => !v)} className={textLink}>{everything ? "Show the five largest" : `Show all ${data.charges.length} room charges`}</button></div>}
        <div className="space-y-2 border-t border-hair px-5 py-4 sm:px-6">
          {pms.unmatched.map((u, i) => (
            <Note key={i}>One posting in Mews matched no bill charged to a room: {money(u.amount)} at {fmtTime(u.min)}, with no receipt id. It is shown here, not flagged.</Note>
          ))}
          <Note>A difference is a prompt to check the guest bill, not proof of anyone&rsquo;s mistake. With a live account, these become room charge flags like the ones in the room charge check.</Note>
        </div>
      </Panel>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2 [&>*]:min-w-0">
        <AdapterPanel
          title="Lightspeed Restaurant K Series"
          kind="Point of sale"
          reads={pos.reads}
          requests={pos.requests}
          columns={3}
          figures={[
            ["Bills", fmtNum(pos.bills)], ["Lines on the bills", fmtNum(pos.lines)], ["Cancelled bills", fmtNum(pos.cancelled)],
            ["Refunds", fmtNum(pos.refunds)], ["Taken off after ringing", fmtNum(pos.removedLines)], ["Discounted bills", fmtNum(pos.discountedBills)],
            ["Complimentary items", fmtNum(pos.compedLines)], ["Not matched to the menu", fmtNum(pos.unmappedItems.length)], ["Room charges with no room number", fmtNum(pos.roomChargesWithoutRoom)],
          ]}
          result={[
            `Net of tax: ${money(pos.sourceNet)} in Lightspeed, ${money(pos.tyllNet)} in Tyll.`,
            ...(pos.unmappedItems.length === 1 ? ["One item is not yet matched to the menu. It stays on the bill and is listed for onboarding."]
              : pos.unmappedItems.length > 1 ? [`${pos.unmappedItems.length} items are not yet matched to the menu. They stay on the bill and are listed for onboarding.`] : []),
            ...(pos.roomChargesWithoutRoom === 1 ? ["One bill was paid to a room with no room number on the payment. Its room charge cannot be checked until the room is known."]
              : pos.roomChargesWithoutRoom > 1 ? [`${pos.roomChargesWithoutRoom} bills were paid to a room with no room number on the payment. Their room charges cannot be checked until the room is known.`] : []),
          ]}
        />
        <AdapterPanel
          title="Mews"
          kind="Property management system"
          reads={pms.reads}
          requests={pms.requests}
          figures={[["Rooms in house", `${fmtNum(pms.inHouse)} of ${fmtNum(pms.rooms)}`], ["Occupancy", fmtPct(pms.occupancy, 1)], ["Guests", fmtNum(pms.guests)], ["Postings", fmtNum(pms.postings)]]}
          result={[`Night of ${fmtDate(data.businessDate)}. Cancelled items left out: ${fmtNum(pms.canceledItems)}.`]}
        />
      </div>

      <Section id="adapters.fields" title="Fields, and what is left to confirm" summary="The documented fields each adapter reads, what Tyll makes of them, and what a sandbox account must confirm.">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 [&>*]:min-w-0">
          <ConfirmList title="Lightspeed: to confirm with a sandbox account" items={TO_CONFIRM.lightspeed} />
          <ConfirmList title="Mews: to confirm with a sandbox account" items={TO_CONFIRM.mews} />
        </div>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 [&>*]:min-w-0">
          <FieldTable title="Lightspeed" rows={LIGHTSPEED_FIELDS} />
          <FieldTable title="Mews" rows={MEWS_FIELDS} />
        </div>
        {pos.unmappedItems.length > 0 && (
          <div>
            <h3 className="text-[13px] font-medium text-ink">Not yet matched to the menu</h3>
            <ul className="mt-2 space-y-1 text-sm text-graphite">
              {pos.unmappedItems.map((u) => <li key={u.sku}><span translate="no" dir="ltr">{u.name}, SKU {u.sku}</span></li>)}
            </ul>
            <Note className="mt-1">Matched once, at onboarding, in the item list. Until then the line stays on the bill under its Lightspeed name.</Note>
          </div>
        )}
      </Section>

      <Note>The sample responses follow each system&rsquo;s documented format and hold simulated data for the Grand Hotel Lumière, replayed as last night. They are not recordings of a live account. Both adapters stay unverified until they are tested with sandbox credentials. No credentials are stored in this demo.</Note>
    </div>
  );
}

/** Where the live equivalent of a sample finding is handled. Sample rows are never assigned or closed. */
function HowChecked() {
  return <Link prefetch={false} href="/money?tab=rooms" className={textLink}>See how this is checked <ArrowRight size={14} className="rtl:rotate-180" /></Link>;
}

function AdapterPanel({ title, kind, reads, requests, figures, result, columns = 4 }: { title: string; kind: string; reads: { method: string; path: string; gives: string }[]; requests: number; figures: [string, string][]; result: string[]; columns?: 3 | 4 }) {
  return (
    <Panel title={title} description={kind}>
      <div className="space-y-5 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent" className="!h-auto min-h-[22px] !whitespace-normal py-0.5 leading-snug">Adapter built, not yet connected to a live account</Badge>
          <Badge tone="neutral">Unverified</Badge>
        </div>
        <div>
          <h3 className="text-[13px] font-medium text-ink">What it reads</h3>
          <ul className="mt-2 space-y-2">
            {reads.map((r) => (
              <li key={r.path}>
                <span translate="no" dir="ltr" className="block break-all font-mono text-[11.5px] text-steel">{r.method} {r.path}</span>
                <span className="text-graphite">{r.gives}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="text-[13px] font-medium text-ink">From the sample</h3>
          <dl className={cn("mt-2 grid grid-cols-2 gap-x-4 gap-y-2", columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-4")}>
            {figures.map(([label, n]) => (
              <div key={label} className="flex min-w-0 flex-col">
                {/* Labels may take two lines; every figure in a row still shares one line. */}
                <dt className="min-h-[2.6em] text-xs leading-snug text-steel">{label}</dt>
                <dd className="num whitespace-nowrap text-[17px] font-medium text-ink">{n}</dd>
              </div>
            ))}
          </dl>
          <ul className="mt-3 space-y-1.5 text-graphite">{result.map((r) => <li key={r}>{r}</li>)}</ul>
          <p className="mt-1.5 text-xs text-steel">{`Requests answered from the sample: ${fmtNum(requests)}.`}</p>
        </div>
      </div>
    </Panel>
  );
}

function ConfirmList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="text-[13px] font-medium text-ink">{title}</h3>
      <ul className="mt-2 list-disc space-y-1.5 ps-5 text-sm text-graphite">{items.map((c) => <li key={c}>{c}</li>)}</ul>
    </div>
  );
}

function FieldTable({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div>
      <h3 className="text-[13px] font-medium text-ink">{title}</h3>
      <TableWrap className="mt-2">
        <table className="w-full text-sm">
          <thead><tr><Th>Field</Th><Th>In Tyll</Th></tr></thead>
          <tbody>
            {rows.map(([field, tyll]) => (
              <tr key={field} className={rowClass}>
                <Td><span translate="no" dir="ltr" className="font-mono text-[12px] text-graphite">{field}</span></Td>
                <Td className="text-graphite">{tyll}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </div>
  );
}

/** Simphony, the hotel's till: a demo connection on recorded responses, and what this morning's sync found. */
function SimphonyPanel() {
  const { menu } = useMenu();
  return (
    <Panel title="Oracle Simphony (MICROS)" description="PosAdapter: SimphonyPos">
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent">Demo connection</Badge>
          <span className="text-graphite">Last sync {menu?.sync ? menu.sync.at.slice(11, 16) : "06:00"}, recorded Simphony responses for Mercado. No Oracle account is connected.</span>
        </div>
        <div>
          <h3 className="text-[13px] font-medium text-ink">What it reads</h3>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {SIMPHONY_READS.map((r) => <li key={r.what}><span className="text-ink">{r.what}</span><span className="block text-graphite">{r.detail}</span></li>)}
          </ul>
        </div>
        {menu?.sync && <p className="text-graphite">{menu.sync.label}. <Link prefetch={false} href="/stock?tab=recipes" className={textLink}>See it on Recipes and costs</Link></p>}
      </div>
    </Panel>
  );
}
