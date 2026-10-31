"use client";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { TyllIcon, TyllLogo } from "@/components/brand";
import { Button } from "@/components/ui";
import { ApiError, api, reloadTo } from "@/lib/api";
import { useDemo } from "@/lib/store";

/** Public demo entry: one button, no accounts or PIN. Starts as the Purchasing Manager on the purchasing report. */
export function Welcome() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const signOut = useDemo((s) => s.signOut);
  const enter = async () => {
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/demo", { method: "POST", body: {} });
      signOut();
      reloadTo("/forecast?tab=buy");
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? "The public demo is not switched on for this server." : "The demo could not start. Try again.");
      setBusy(false);
    }
  };
  return (
    <div className="grid min-h-screen bg-paper lg:grid-cols-[1.05fr_1fr]">
      <section className="waves waves-full hidden flex-col justify-between overflow-hidden border-r border-line p-12 lg:sticky lg:top-0 lg:flex lg:h-screen">
        <TyllLogo height={44} priority />
        <div>
          <p className="max-w-[20ch] text-[40px] leading-[1.08] tracking-[-0.035em] text-ink">Find problems. Explain them. Help fix them. Protect profits.</p>
          <p className="mt-4 text-[15px] text-graphite">All in one place.</p>
        </div>
      </section>
      <section className="flex min-w-0 flex-col justify-center px-6 py-10 sm:px-12">
        <div className="mx-auto w-full max-w-md">
          <div className="flex items-center gap-4 lg:hidden"><TyllIcon size={48} /><TyllLogo height={26} priority /></div>
          <span className="mt-8 inline-block rounded-full bg-accent-soft px-2.5 text-xs font-medium leading-[22px] text-accent-ink lg:mt-0">Early access</span>
          <h1 className="mt-4 text-[34px] font-medium leading-[1.1] tracking-[-0.03em] text-ink">Welcome to the Tyll demo</h1>
          <p className="mt-4 text-[15px] leading-relaxed text-graphite">Explore Tyll with a fictional hotel, Grand Resort Dubai. This is an early version of our product. New features are added regularly.</p>
          <Button type="button" variant="primary" size="lg" className="mt-8 w-full" onClick={enter} disabled={busy}>
            {busy ? "Opening the demo" : "Enter demo"} {!busy && <ArrowRight size={16} aria-hidden />}
          </Button>
          {error && <p role="alert" className="mt-3 text-sm text-neg">{error}</p>}
          <p className="mt-6 text-xs leading-relaxed text-steel">All names, figures and orders are simulated. You start as the Purchasing Manager and can switch role from the top bar.</p>
        </div>
      </section>
    </div>
  );
}
