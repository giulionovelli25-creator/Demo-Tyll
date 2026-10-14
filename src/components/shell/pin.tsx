"use client";
// The PIN keypad that unlocks management information. The PIN is checked on the server.
import { Delete, LockKeyhole } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { TyllIcon } from "@/components/brand";
import { Button, cn } from "@/components/ui";
import { ApiError, api, goToLogin, reloadTo } from "@/lib/api";
import { userById } from "@/lib/data/catalog";

const MAX = 6;

export function PinScreen({ userId, demoPin, onUnlocked }: { userId: string; demoPin?: string; onUnlocked: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const user = userById[userId];

  const submit = useCallback(async () => {
    if (pin.length < 4 || busy) return;
    setBusy(true);
    try {
      await api("/api/auth/pin", { method: "POST", body: { pin } });
      onUnlocked();
    } catch (err) {
      setPin("");
      if (err instanceof ApiError && err.body.signedOut) {
        setError(err.message);
        setTimeout(goToLogin, 2500);
      } else if (err instanceof ApiError && err.status === 401 && err.body.attemptsLeft === undefined) {
        goToLogin();
      } else {
        const left = err instanceof ApiError ? (err.body.attemptsLeft as number | undefined) : undefined;
        setError(err instanceof ApiError ? `${err.message}${left !== undefined ? ` ${left} attempt${left === 1 ? "" : "s"} left.` : ""}` : "Could not reach Tyll. Try again.");
      }
      setBusy(false);
    }
  }, [pin, busy, onUnlocked]);

  const press = (d: string) => {
    setError("");
    setPin((p) => (p.length < MAX ? p + d : p));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") setPin((p) => p.slice(0, -1));
      else if (e.key === "Enter") submit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [submit]);

  const signOut = async () => {
    await api("/api/auth/logout", { method: "POST", body: {} }).catch(() => undefined);
    reloadTo("/login");
  };

  return (
    <div className="waves waves-full flex min-h-screen items-center justify-center bg-paper px-6 py-10">
      <div className="animate-rise w-full max-w-sm text-center">
        <div className="flex justify-center"><TyllIcon size={56} /></div>
        <p className="mt-6 flex items-center justify-center gap-2 text-[13px] text-steel"><LockKeyhole size={14} aria-hidden /> Management information is locked</p>
        <h1 className="mt-2 text-[28px] tracking-[-0.03em]">Enter your PIN</h1>
        <p className="mt-1 text-sm text-graphite">{user?.name}</p>

        <div className="my-7 flex justify-center gap-3" role="status" aria-label={`${pin.length} digits entered`}>
          {Array.from({ length: MAX }).map((_, i) => (
            <span key={i} className={cn("h-3.5 w-3.5 rounded-full border transition-colors duration-200", i < pin.length ? "border-ink bg-ink" : i < 4 ? "border-fog" : "border-dashed border-line")} />
          ))}
        </div>
        <p className={cn("min-h-5 text-[13px]", error ? "text-neg" : "text-steel")} aria-live="polite">{error || (demoPin ? `Demo PIN: ${demoPin}` : "4 to 6 digits")}</p>

        <div className="mx-auto mt-5 grid max-w-[272px] grid-cols-3 gap-3">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <button key={d} type="button" onClick={() => press(d)} className="num h-16 rounded-2xl border border-line bg-paper text-2xl transition-colors hover:bg-mist active:bg-hair">{d}</button>
          ))}
          <button type="button" onClick={() => setPin((p) => p.slice(0, -1))} aria-label="Delete last digit" className="flex h-16 items-center justify-center rounded-2xl text-steel hover:bg-mist"><Delete size={22} /></button>
          <button type="button" onClick={() => press("0")} className="num h-16 rounded-2xl border border-line bg-paper text-2xl hover:bg-mist active:bg-hair">0</button>
          <span />
        </div>
        <Button variant="primary" size="lg" className="mt-6 w-full max-w-[272px]" disabled={pin.length < 4 || busy} onClick={submit}>{busy ? "Checking" : "Unlock"}</Button>
        <button type="button" onClick={signOut} className="mt-5 block w-full text-[13px] text-steel underline-offset-4 hover:text-ink hover:underline">Sign out</button>
      </div>
    </div>
  );
}
