"use client";
// The website's moving silver wave behind every page: one ribbon of fine one-pixel lines, sharp at any size.
// It drifts about 30 times a second, pauses while the tab is hidden and stays still with reduced motion.
import { useEffect, useRef } from "react";
import { PERIOD, ribbon } from "@/lib/wave";

const START = 0.3;

export function SilverWave() {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const paths = [...svg.querySelectorAll("path")];
    const reduce = matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0;
    let last = 0;
    let t = START * PERIOD;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 33) return;
      t = (t + Math.min(now - last, 100) / 1000) % PERIOD;
      last = now;
      ribbon(t / PERIOD).forEach((l, i) => paths[i]?.setAttribute("d", l.d));
    };
    const sync = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden && !reduce.matches) {
        last = performance.now();
        raf = requestAnimationFrame(draw);
      }
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    reduce.addEventListener("change", sync);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", sync);
      reduce.removeEventListener("change", sync);
    };
  }, []);
  return (
    <svg ref={ref} className="silver-wave no-print" viewBox="0 0 1440 800" preserveAspectRatio="xMidYMax slice" aria-hidden>
      <defs>
        <linearGradient id="silver-wave" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="var(--color-silver)" stopOpacity="0" />
          <stop offset="0.3" stopColor="var(--color-silver)" stopOpacity="0.35" />
          <stop offset="0.6" stopColor="var(--color-silver-mid)" stopOpacity="0.85" />
          <stop offset="0.85" stopColor="var(--color-silver-deep)" stopOpacity="0.45" />
          <stop offset="1" stopColor="var(--color-silver)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g fill="none" stroke="url(#silver-wave)" strokeWidth="1">
        {ribbon(START).map((l, i) => <path key={i} d={l.d} opacity={l.opacity} vectorEffect="non-scaling-stroke" />)}
      </g>
    </svg>
  );
}
