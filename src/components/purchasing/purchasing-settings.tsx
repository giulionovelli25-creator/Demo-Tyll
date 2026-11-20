"use client";
// Purchasing settings for a hotel: how stock is valued (the controller's or general manager's choice), VAT, currency,
// approval limits and the statuses a purchase order goes through.
import { useState } from "react";
import { Badge, Button, Note, Panel, Segmented, Skeleton } from "@/components/ui";
import { toast } from "@/components/ui";
import { propertyById } from "@/lib/data/catalog";
import { usePurchasingSettings, useProcAction } from "@/lib/procurement-hooks";
import { fmtMoney, fmtPct } from "@/lib/util";

const METHODS = [
  { value: "wac", label: "Weighted average cost", text: "Every unit at the average price paid for the item's recent purchases. The usual choice for food and beverage." },
  { value: "fifo", label: "FIFO", text: "First in, first out: what is left is the newest stock, valued at the newest purchase prices." },
  { value: "last", label: "Last purchase price", text: "Every unit at the most recent invoiced price." },
] as const;

export function PurchasingSettings({ propertyId }: { propertyId: string }) {
  const { data } = usePurchasingSettings(propertyId);
  const act = useProcAction();
  const [method, setMethod] = useState<string | null>(null);
  if (!data) return <Panel title="Purchasing"><Skeleton className="h-32 w-full" /></Panel>;
  const money = (n: number) => fmtMoney(n, data.currency as "EUR");
  const chosen = method ?? data.settings.valuation;
  const save = async () => {
    try { await act("/api/procurement", { action: "save_settings", propertyId, valuation: chosen }); toast.done(`Stock is now valued at ${METHODS.find((m) => m.value === chosen)!.label.toLowerCase()}. Every stock value says so.`); setMethod(null); }
    catch (e) { toast.error(e instanceof Error ? e.message : "The setting could not be saved."); }
  };
  return (
    <Panel title="Purchasing" description={`${propertyById[propertyId].name}. Each hotel sets its own.`}>
      <div className="space-y-6 text-sm">
        <section>
          <h3 className="text-[13px] font-medium text-ink">Stock valuation</h3>
          <div className="mt-2">{data.mayChange ? <Segmented label="Valuation method" value={chosen} onChange={(v) => setMethod(v)} options={METHODS.map((m) => ({ value: m.value, label: m.label }))} /> : <Badge tone="ink">{METHODS.find((m) => m.value === chosen)!.label}</Badge>}</div>
          <p className="mt-2 text-graphite">{METHODS.find((m) => m.value === chosen)!.text}</p>
          {data.mayChange ? (method && method !== data.settings.valuation && <Button className="mt-3" variant="primary" onClick={save}>Use this method</Button>) : <Note className="mt-2">The financial controller or the general manager chooses the method.</Note>}
        </section>
        <section className="grid gap-4 sm:grid-cols-2">
          <div><h3 className="text-[13px] font-medium text-ink">Currency</h3><p className="mt-1 text-graphite">{data.currency}. Each hotel reports in its own currency: EUR, AED or SAR. Amounts in different currencies are never added together.</p></div>
          <div><h3 className="text-[13px] font-medium text-ink">VAT</h3><p className="mt-1 text-graphite">{data.vat.label}: {data.vat.rates.map((r) => `${r.area.toLowerCase()} ${fmtPct(r.rate, 0)}`).join(", ")}. Shown on every purchase order and invoice. In the UAE 5% and in Saudi Arabia 15% apply.</p></div>
        </section>
        <section>
          <h3 className="text-[13px] font-medium text-ink">Approval limits, before VAT</h3>
          <ul className="mt-1 space-y-1 text-graphite">
            <li>Purchasing reviews every order.</li>
            <li>Accounting approves {data.limits.accountingAbove > 0 ? `orders over ${money(data.limits.accountingAbove)}` : "every order"}.</li>
            <li>The {data.limits.fnbLabel} approves orders over {money(data.limits.fnbAbove)}.</li>
            <li>The {data.limits.managerLabel.toLowerCase()} also approves orders over {money(data.limits.managerAbove)}.</li>
            <li>Nobody approves an order they raised. The storekeeper receives; purchasing or the author sends.</li>
          </ul>
        </section>
        <section>
          <h3 className="text-[13px] font-medium text-ink">Sending approved orders</h3>
          <p className="mt-1 text-graphite">{data.autoSend ? "On: once an order has every approval it needs, it goes to the supplier on its own, by the supplier's channel (email with the PDF, or the supplier's ordering system). Suppliers who take orders by phone wait for purchasing to call." : "Off: purchasing sends each approved order from the order itself."} Simulated in this demo: no supplier is contacted.</p>
          {data.maySending && <Button className="mt-3" onClick={async () => { try { await act("/api/procurement", { action: "save_settings", propertyId, autoSend: !data.autoSend }); toast.done(data.autoSend ? "Approved orders now wait for purchasing to send them." : "Approved orders now go to the supplier on their own."); } catch (e) { toast.error(e instanceof Error ? e.message : "The setting could not be saved."); } }}>{data.autoSend ? "Turn automatic sending off" : "Turn automatic sending on"}</Button>}
        </section>
        <section>
          <h3 className="text-[13px] font-medium text-ink">Purchase order statuses</h3>
          <div className="mt-2 flex flex-wrap gap-1.5">{data.statuses.filter((s) => !["rejected", "changes"].includes(s.id)).map((s) => <Badge key={s.id}>{s.label}</Badge>)}</div>
        </section>
      </div>
    </Panel>
  );
}
