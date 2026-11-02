// The few alerts shown first. One from each area where there is one, so money and Pour Control are not crowded out by stock.
const AREAS: ((kind: string) => boolean)[] = [(k) => k === "stock" || k === "supplier", (k) => k === "money" || k === "margin" || k === "waste", (k) => k === "pour"];

export function topAlerts<T extends { kind: string; rag: string; amount: number | null }>(open: readonly T[], count = 3): T[] {
  const rank = (a: T, b: T) => Number(b.rag === "red") - Number(a.rag === "red") || (b.amount ?? -1) - (a.amount ?? -1);
  const sorted = [...open].sort(rank);
  const picked = AREAS.map((inArea) => sorted.find((a) => inArea(a.kind))).filter((a): a is T => !!a);
  for (const a of sorted) if (picked.length < count && !picked.includes(a)) picked.push(a);
  return picked.slice(0, count).sort(rank);
}
