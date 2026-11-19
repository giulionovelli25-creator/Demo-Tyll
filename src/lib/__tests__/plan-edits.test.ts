import { beforeEach, describe, expect, it } from "vitest";
import { usePlanEditStore } from "../plan-edits";

beforeEach(() => usePlanEditStore.setState({ byUser: {} }));

describe("quantities edited on Predictions", () => {
  it("belong to the person who typed them: a switch does not carry them to the next person", () => {
    const s = usePlanEditStore.getState();
    s.set("u-buy", "salmon", 12);
    expect(usePlanEditStore.getState().byUser["u-buy"]).toEqual({ salmon: 12 });
    expect(usePlanEditStore.getState().byUser["u-fnb"]).toBeUndefined();
    s.set("u-fnb", "salmon", 3);
    s.clear("u-fnb"); // Marco builds his order: only his edits are cleared
    expect(usePlanEditStore.getState().byUser["u-buy"]).toEqual({ salmon: 12 });
    s.set("u-buy", "salmon", null);
    expect(usePlanEditStore.getState().byUser["u-buy"]).toEqual({});
  });
});
