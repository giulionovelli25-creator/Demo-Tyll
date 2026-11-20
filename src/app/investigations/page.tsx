"use client";
// The Money Back List on its own. Since the simplify pass the same list sits inside Flagged transactions and this address
// leads there (lib/redirects.ts); the page is kept so it can come back without rebuilding it.
import { CaseList } from "@/components/money/case-list";

export default function MoneyBackListPage() {
  return <CaseList />;
}
