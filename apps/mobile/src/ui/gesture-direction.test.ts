import { describe, expect, it } from "vitest";

import {
  directionForHorizontalDelta,
  orbTravelForGesture,
} from "./gesture-direction";

describe("horizontal gesture direction", () => {
  it("maps right to spoken Chinese and left to spoken Vietnamese", () => {
    expect(directionForHorizontalDelta(80)).toBe("zh-to-vi");
    expect(directionForHorizontalDelta(-80)).toBe("vi-to-zh");
  });

  it("uses the active English pair", () => {
    expect(
      directionForHorizontalDelta(80, "en-to-vi", "vi-to-en"),
    ).toBe("en-to-vi");
    expect(
      directionForHorizontalDelta(-80, "en-to-vi", "vi-to-en"),
    ).toBe("vi-to-en");
  });
});

describe("orb travel", () => {
  it("follows the finger on the side that locked the direction", () => {
    expect(orbTravelForGesture("zh-to-vi", 40, 112)).toBe(40);
    expect(orbTravelForGesture("vi-to-zh", -40, 112)).toBe(-40);
  });

  it("stops at the maximum travel", () => {
    expect(orbTravelForGesture("zh-to-vi", 300, 112)).toBe(112);
    expect(orbTravelForGesture("vi-to-zh", -300, 112)).toBe(-112);
  });

  it("ignores movement back past the resting point", () => {
    expect(orbTravelForGesture("zh-to-vi", -40, 112)).toBe(0);
    expect(orbTravelForGesture("vi-to-zh", 40, 112)).toBe(0);
  });

  it("keeps the English right direction on the positive side", () => {
    expect(orbTravelForGesture("en-to-vi", 40, 112, "en-to-vi")).toBe(40);
    expect(orbTravelForGesture("vi-to-en", -40, 112, "en-to-vi")).toBe(-40);
  });
});
