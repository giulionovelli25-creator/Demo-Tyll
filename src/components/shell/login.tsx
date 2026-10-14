"use client";
import { useSearchParams } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { TyllIcon, TyllLogo } from "@/components/brand";
import { Button, Field, cn } from "@/components/ui";
import { ApiError, api, reloadTo } from "@/lib/api";
import { ROLE_LABEL, userById } from "@/lib/data/catalog";

interface DemoAccount {
  userId: string;
  email: string;
  password: string;
}

/** Only relative paths inside the app are accepted as a destination after sign-in. */
const safeNext = (next: string | null) => (next && next.startsWith("/") && !next.startsWith("//") ? next : "/");

export function Login() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState<DemoAccount[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const top = useRef<HTMLHeadingElement>(null);
  const signIn = useRef<HTMLButtonElement>(null);

  const choose = (a: DemoAccount, reveal = false) => {
    setPicked(a.userId);
    setEmail(a.email);
    setPassword(a.password);
    setError("");
    if (!reveal) return;
    // Bring the filled-in form back into view; keyboard users land on Sign in.
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // The button is enabled once the details are filled in, so this runs after that render. Focus first:
    // moving focus during a smooth scroll would stop the scroll.
    setTimeout(() => {
      signIn.current?.focus({ preventScroll: true });
      top.current?.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
    }, 0);
  };

  useEffect(() => {
    api<{ accounts: DemoAccount[] }>("/api/auth/demo-accounts")
      .then(({ accounts }) => {
        setDemo(accounts);
        const as = accounts.find((a) => a.userId === params.get("as"));
        if (as) choose(as);
      })
      .catch(() => setDemo([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/login", { method: "POST", body: { email, password } });
      reloadTo(safeNext(params.get("next")));
    } catch (err) {
      const left = err instanceof ApiError ? (err.body.attemptsLeft as number | undefined) : undefined;
      setError(err instanceof ApiError ? `${err.message}${left !== undefined ? ` ${left} attempt${left === 1 ? "" : "s"} left.` : ""}` : "Could not reach Tyll. Try again.");
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

      <section className="flex flex-col justify-center px-6 py-10 sm:px-12">
        <div className="animate-rise mx-auto w-full max-w-md">
          <div className="flex items-center gap-4 lg:hidden"><TyllIcon size={48} /><TyllLogo height={26} priority /></div>
          <h1 ref={top} className="scroll-mt-6 mt-8 text-[34px] leading-[1.1] tracking-[-0.03em] lg:mt-0">Sign in</h1>

          <form className="mt-7 space-y-4" onSubmit={submit}>
            <Field label="Email" type="email" autoComplete="username" value={email} onChange={(e) => { setEmail(e.target.value); setPicked(null); }} required />
            <Field label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => { setPassword(e.target.value); setPicked(null); }} required error={error || undefined} />
            <Button ref={signIn} type="submit" variant="primary" size="lg" className="w-full" disabled={busy || !email || !password}>{busy ? "Signing in" : "Sign in"}</Button>
          </form>

          {demo.length > 0 && (
            <div className="mt-10">
              <p className="text-[13px] text-steel">Demo accounts. Choose one to fill in its details.</p>
              <ul className="mt-3 overflow-hidden rounded-panel border border-line">
                {demo.map((a) => {
                  const u = userById[a.userId];
                  return (
                    <li key={a.userId} className="border-t border-hair first:border-t-0">
                      <button type="button" onClick={() => choose(a, true)} aria-pressed={picked === a.userId} className={cn("flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-300 ease-tyll hover:bg-mist", picked === a.userId && "bg-mist")}>
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-paper text-xs font-medium text-graphite ring-1 ring-line" aria-hidden>{u.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm text-ink">{u.name}</span>
                          <span className="block truncate text-xs text-steel">{ROLE_LABEL[u.role]}</span>
                        </span>
                        <ArrowRight size={15} className="text-fog" aria-hidden />
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-xs leading-relaxed text-steel">Fictional people and simulated data. Demo credentials are listed in config/demo-accounts.json.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
