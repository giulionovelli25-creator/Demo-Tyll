import { describe, expect, it } from "vitest";
import { lostAndSaved, paceSaving, type LeakRow } from "../domain/trends";

describe("Overview lost and saved", () => {
  it("saves only what runs below last month's daily pace", () => {
    // 30 days at 100 a day is the pace; 12 days at 80 a day saves 240.
    expect(paceSaving(3000, 30, 960, 12)).toBe(240);
    // Above the pace is a negative saving, never hidden.
    expect(paceSaving(3000, 30, 1500, 12)).toBe(-300);
    expect(paceSaving(3000, 0, 960, 12)).toBe(0);
  });

  it("adds every kind of loss once, and never lets one row's overrun cancel another's saving", () => {
    const row = (id: string, lost: number, saved: number): LeakRow => ({ id, label: id, lost, saved, how: "pace", href: "/" });
    const r = lostAndSaved([row("a", 100, 20), row("b", 500, -50), row("c", 300, 30)]);
    expect(r.lost).toBe(900);
    expect(r.saved).toBe(50);
    expect(r.share).toBeCloseTo(50 / 900);
    expect(r.rows.map((x) => x.id)).toEqual(["b", "c", "a"]);
  });
});
