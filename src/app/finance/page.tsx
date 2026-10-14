"use client";
import { BarChart3, ReceiptText, Stamp } from "lucide-react";
import { Invoices, Reports, useFinanceHome, useFinanceProperty } from "@/components/finance/finance";
import { Approvals } from "@/components/forecast/approvals";
import { HELP } from "@/components/help";
import { ModuleHub, useSection } from "@/components/module-hub";
import { StockAlert } from "@/components/overview/stock-alert";
import { Crumbs, PageHeader, Tabs } from "@/components/ui";
import { can } from "@/lib/domain/access";
import { useView } from "@/lib/hooks";

type Tab = "approvals" | "invoices" | "reports";
const LABEL: Record<Tab, string> = { approvals: "Approvals", invoices: "Invoices & Expenses", reports: "Budgets & Reports" };

/** Three choices. The owner and general manager see budgets and reports; accounting also reviews and approves. */
export default function FinancePage() {
  const { user } = useView();
  const tabs = ([can(user, "purchase.approveFinance") && "approvals", can(user, "finance.review") && "invoices", "reports"].filter(Boolean) as Tab[]);
  const [tab, setTab] = useSection<Tab>("/finance", tabs, tabs.length === 1 ? "reports" : null);
  const { propertyId } = useFinanceProperty();
  const { data } = useFinanceHome(propertyId);
  const n = (k: number, one: string, many: string) => (k === 0 ? "Nothing waiting." : `${k} ${k === 1 ? one : many}`);
  return (
    <div className="space-y-5">
      <PageHeader
        title={tab ? LABEL[tab] : "Tyll Finance"}
        lead={tab ? undefined : "What do you want to do?"}
        crumbs={tab && tabs.length > 1 ? <Crumbs items={[{ label: "Tyll Finance", onClick: () => setTab(null) }, { label: LABEL[tab] }]} /> : undefined}
      />
      {tab === null && <StockAlert />}
      {tab === null && (
        <ModuleHub
          onPick={setTab}
          choices={tabs.map((t) => ({
            value: t, title: LABEL[t], help: t === "approvals" ? HELP.approvals : t === "invoices" ? HELP.invoices : HELP.budgets, icon: t === "approvals" ? Stamp : t === "invoices" ? ReceiptText : BarChart3,
            detail: t === "approvals" ? (data ? n(data.approvals, "request needs your review.", "requests need your review.") : "Requests waiting for financial review.")
              : t === "invoices" ? (data ? n(data.invoices, "supplier invoice needs checking.", "supplier invoices need checking.") : "Supplier invoices, expenses and differences.")
              : data?.overBudget.length ? `${data.overBudget.join(", ")}: over budget once open items are recorded.` : "Review this month's spending.",
          }))}
        />
      )}
      {tab !== null && tabs.length > 1 && <Tabs value={tab} onChange={setTab} tabs={tabs.map((t) => ({ value: t, label: LABEL[t] }))} />}
      {tab === "approvals" && <Approvals base="/finance?tab=approvals" />}
      {tab === "invoices" && <Invoices />}
      {tab === "reports" && <Reports />}
    </div>
  );
}
