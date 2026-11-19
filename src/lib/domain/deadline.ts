// The one rule for "past deadline", used by the dashboard, lists, alerts and case pages alike.
// A deadline is a plain date (YYYY-MM-DD), never a time and never converted through UTC. A record is past its deadline
// when it is still open and the hotel's today is after that date. Due today is not past the deadline. Closed records
// never are. "Today" is the hotel's business date (DEMO_TODAY, the hotel's day in its own time zone).
import { DEMO_TODAY } from "../util";

export function isPastDeadline(deadline: string | undefined | null, closed: boolean, today: string = DEMO_TODAY): boolean {
  return !closed && !!deadline && deadline < today;
}

/** For investigations: open until closed. */
export const caseIsPastDeadline = (i: { deadline?: string; status: string }, today: string = DEMO_TODAY) => isPastDeadline(i.deadline, i.status === "closed", today);
