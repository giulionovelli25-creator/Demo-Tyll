import Image from "next/image";

/** The Tyll logo, taken from the supplied banner artwork. Never redrawn. */
export function TyllLogo({ height = 26, priority = false }: { height?: number; priority?: boolean }) {
  return <Image src="/brand/tyll-lockup-ink.png" alt="Tyll.ai" width={Math.round((height * 660) / 195)} height={height} priority={priority} />;
}

export function TyllMark({ size = 22 }: { size?: number }) {
  return <Image src="/brand/tyll-mark-ink.png" alt="Tyll" width={Math.round((size * 208) / 178)} height={size} />;
}

/** The app icon with its layered silver background, as supplied. */
export function TyllIcon({ size = 56 }: { size?: number }) {
  return <Image src="/brand/tyll-icon-512.png" alt="" width={size} height={size} className="rounded-[22%] shadow-[0_10px_30px_-12px_rgba(20,22,26,0.35)]" />;
}

export function BrandLoader({ label = "Loading Tyll" }: { label?: string }) {
  return (
    <div className="waves waves-full flex min-h-screen flex-col items-center justify-center gap-5 bg-paper" role="status" aria-live="polite">
      <TyllIcon size={64} />
      <p className="text-sm text-steel">{label}</p>
    </div>
  );
}
