import Image from "next/image";

/** The Tyll logo, taken from the supplied artwork and cropped before ".ai". Never redrawn. */
// The logo as published on tyll.ai, copied path for path from the site's own vector. Never redrawn.
const MARK = [
  "M17.0355 68.4862L0.43289 39.6292C-0.799691 37.4869 0.746682 34.8131 3.2183 34.8131H19.4402C20.5517 34.8131 21.5843 35.3876 22.1705 36.332L29.9621 48.8851C30.5283 49.7973 30.6016 50.9321 30.1573 51.9096L22.7464 68.2134C21.6637 70.5954 18.3404 70.7541 17.0355 68.4862Z",
  "M53.9312 48.2028H33.5463L53.0695 1.96355C53.572 0.773501 54.7382 0 56.03 0H72.034C74.3466 0 75.9021 2.36931 74.9826 4.49124L56.8798 46.267C56.3705 47.4422 55.212 48.2028 53.9312 48.2028Z",
];
const WORD = [
  "M96.476 5.996L136.089 5.996L136.089 14.739L121.698 14.739L121.698 60L110.867 60L110.867 14.739L96.476 14.739Z",
  "M173.471 17.137L184.999 17.137L160.9 74.469L146.933 80.271Z",
  "M139.041 17.137L151.188 17.137L159.975 40.917L154.334 54.337Z",
  "M190.838 7.246L201.67 2.746L201.67 60L190.838 60Z",
  "M212.371 7.246L223.203 2.746L223.203 60L212.371 60Z",
];

/** The full logo: mark and wordmark. Takes the text colour, so it is black in light and white in dark. */
export function TyllLogo({ height = 26 }: { height?: number; priority?: boolean }) {
  return (
    <svg viewBox="0 0 224 81" height={height} width={Math.round((height * 224) / 81)} fill="currentColor" role="img" aria-label="Tyll" className="text-ink">
      {[...MARK, ...WORD].map((d) => <path key={d} d={d} />)}
    </svg>
  );
}

/** The mark alone, for narrow places. */
export function TyllMark({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 76 71" height={size} width={Math.round((size * 76) / 71)} fill="currentColor" role="img" aria-label="Tyll" className="text-ink">
      {MARK.map((d) => <path key={d} d={d} />)}
    </svg>
  );
}

/** The app icon with its layered silver background, as supplied. */
export function TyllIcon({ size = 56 }: { size?: number }) {
  return <Image src="/brand/tyll-icon-512.png" alt="" width={size} height={size} unoptimized className="rounded-[22%] shadow-panel" />;
}

export function BrandLoader({ label = "Loading Tyll" }: { label?: string }) {
  return (
    <div className="waves waves-full flex min-h-screen flex-col items-center justify-center gap-5 bg-paper" role="status" aria-live="polite">
      <TyllIcon size={64} />
      <p className="text-sm text-steel">{label}</p>
    </div>
  );
}
