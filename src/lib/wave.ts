// The Tyll silver wave from the website (tyll-website, src/scripts/wave.ts), kept identical so both look the same.
//
// A single centre curve carries everything: a fixed "check" shape (a dip beneath the buttons, then a long rise to
// the right) plus two travelling swells, so crests move along the ribbon instead of each line wobbling on its own.
// The ribbon's width also breathes along its length, and every line takes the same share of it, so the lines stay
// parallel like threads in one piece of fabric. `phase` runs from 0 to 1 over one cycle; 0 and 1 give the same
// shape, so the loop is seamless.

export const PERIOD = 16; // seconds per full cycle
const LINES = 13;
const X0 = -80;
const X1 = 1520;
const STEPS = 28; // points along each line, joined with smooth curves

const TAU = Math.PI * 2;

/** The resting shape in the 1440 × 800 drawing: a soft dip near x = 560, then a long rise to the upper right */
const rest = (x: number) => {
  const dipX = 560;
  const dipY = 668;
  if (x <= dipX) return dipY - 92 * ((dipX - x) / (dipX - X0)) ** 2;
  return dipY - 500 * ((x - dipX) / (X1 - dipX)) ** 1.55;
};

/** Centre of the ribbon at x and phase p (0…1) */
const centre = (x: number, p: number) => {
  const u = (x - X0) / (X1 - X0); // 0…1 along the ribbon
  const envelope = 0.35 + 0.65 * Math.sin(Math.PI * u); // calmer at the edges, fullest in the middle
  const swell = 30 * Math.sin(TAU * (u * 1.15 - p)); // one long swell travelling to the right
  const ripple = 9 * Math.sin(TAU * (u * 2.3 - 2 * p) + 1.3); // a shorter swell, twice per cycle
  return rest(x) + envelope * (swell + ripple);
};

/** Half-width of the ribbon at x and phase p: it widens and narrows as the swell passes */
const spread = (x: number, p: number) => {
  const u = (x - X0) / (X1 - X0);
  return 34 + 26 * u + 16 * Math.sin(TAU * (u * 0.9 - p) + 0.8);
};

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Catmull-Rom points to a smooth cubic path */
const smooth = (pts: [number, number][]) => {
  let d = `M ${r1(pts[0][0])} ${r1(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C ${r1(c1[0])} ${r1(c1[1])}, ${r1(c2[0])} ${r1(c2[1])}, ${r1(p2[0])} ${r1(p2[1])}`;
  }
  return d;
};

/** Every line of the ribbon at phase p: its path and its strength (the middle threads are brightest) */
export const ribbon = (p: number) =>
  Array.from({ length: LINES }, (_, i) => {
    const k = (i - (LINES - 1) / 2) / ((LINES - 1) / 2); // -1 … 1 across the ribbon
    const pts: [number, number][] = Array.from({ length: STEPS + 1 }, (_, s) => {
      const x = X0 + ((X1 - X0) * s) / STEPS;
      return [x, centre(x, p) + k * spread(x, p)];
    });
    return { d: smooth(pts), opacity: r1(0.95 - Math.abs(k) * 0.65) };
  });
