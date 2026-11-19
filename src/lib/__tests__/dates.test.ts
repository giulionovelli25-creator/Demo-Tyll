import { describe, expect, it } from "vitest";
import { caseIsPastDeadline, isPastDeadline } from "../domain/deadline";
import { DAY_COOKIE, dayIn, resolveBusinessDay } from "../util";

const today = "2026-11-19";

describe("past deadline: one rule everywhere", () => {
  it("counts only open records whose date-only deadline is before the hotel's today", () => {
    expect(isPastDeadline("2026-11-18", false, today)).toBe(true); // yesterday
    expect(isPastDeadline("2026-11-19", false, today)).toBe(false); // due today is not overdue
    expect(isPastDeadline("2026-11-20", false, today)).toBe(false); // tomorrow
    expect(isPastDeadline(undefined, false, today)).toBe(false);
    expect(isPastDeadline("2026-11-01", true, today)).toBe(false); // closed never is
    expect(caseIsPastDeadline({ deadline: "2026-11-18", status: "closed" }, today)).toBe(false);
    expect(caseIsPastDeadline({ deadline: "2026-11-18", status: "in_review" }, today)).toBe(true);
    // A deadline edited to later stops being overdue at once.
    expect(caseIsPastDeadline({ deadline: "2026-11-21", status: "in_review" }, today)).toBe(false);
  });
});

describe("the hotel's day", () => {
  it("turns at the hotel's midnight, not UTC's or the viewer's", () => {
    // Lisbon is UTC+0 in November.
    expect(dayIn("Europe/Lisbon", new Date("2026-11-19T23:59:00Z"))).toBe("2026-11-19");
    expect(dayIn("Europe/Lisbon", new Date("2026-11-20T00:00:00Z"))).toBe("2026-11-20");
    // A Dubai hotel (UTC+4) checked from Zurich (UTC+1) at 21:30 in Zurich: already the 20th at the hotel.
    const zurichEvening = new Date("2026-11-19T20:30:00Z");
    expect(dayIn("Europe/Zurich", zurichEvening)).toBe("2026-11-19");
    expect(dayIn("Asia/Dubai", zurichEvening)).toBe("2026-11-20");
    expect(isPastDeadline("2026-11-19", false, dayIn("Asia/Dubai", zurichEvening))).toBe(true);
    expect(isPastDeadline("2026-11-19", false, dayIn("Europe/Zurich", zurichEvening))).toBe(false);
  });

  it("is one value per server process, and the browser takes the server's", () => {
    const shared: { day?: string } = {};
    expect(resolveBusinessDay({ shared, now: new Date("2026-11-19T23:59:00Z") })).toBe("2026-11-19");
    // After midnight a module loaded later in the same process still gets the same day as the others.
    expect(resolveBusinessDay({ shared, now: new Date("2026-11-20T00:05:00Z") })).toBe("2026-11-19");
    // The browser's own clock is past midnight, but it shows the server's day.
    expect(resolveBusinessDay({ shared: {}, cookie: `x=1; ${DAY_COOKIE}=2026-11-19`, now: new Date("2026-11-20T00:05:00Z") })).toBe("2026-11-19");
    expect(resolveBusinessDay({ shared: {}, cookie: `${DAY_COOKIE}=garbage`, now: new Date("2026-11-20T00:05:00Z") })).toBe("2026-11-20");
    expect(resolveBusinessDay({ pinned: "2026-01-02", shared, cookie: `${DAY_COOKIE}=2026-11-19`, now: new Date() })).toBe("2026-01-02");
  });
});
