"use client";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui";

/** Shown if a screen fails to draw. Says what happened and offers the one next step. */
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto mt-16 max-w-md rounded-panel border border-line bg-paper p-8 text-center shadow-panel">
      <h1 className="text-title font-medium text-ink">This screen could not load</h1>
      <p className="mt-2 text-sm text-graphite">Your records are safe. Try loading it again.</p>
      <Button variant="primary" className="mt-6" onClick={reset}><RotateCw size={15} aria-hidden /> Try again</Button>
    </div>
  );
}
