import { describe, expect, it } from "vitest";

import {
  directionForVerticalDelta,
  orbTravelForGesture,
} from "./gesture-direction";

describe("vertical gesture direction", () => {
  it("maps up to the top language and down to Vietnamese", () => {
    expect(directionForVerticalDelta(-80)).toBe("zh-to-vi");
    expect(directionForVerticalDelta(80)).toBe("vi-to-zh");
  });

  it("uses the active English pair", () => {
    expect(
      directionForVerticalDelta(-80, "en-to-vi", "vi-to-en"),
    ).toBe("en-to-vi");
    expect(
      directionForVerticalDelta(80, "en-to-vi", "vi-to-en"),
    ).toBe("vi-to-en");
  });
});

describe("orb travel", () => {
  it("follows the finger in the vertical direction that was locked", () => {
    expect(orbTravelForGesture("zh-to-vi", -40, 112)).toBe(-40);
    expect(orbTravelForGesture("vi-to-zh", 40, 112)).toBe(40);
  });

  it("stops at the maximum travel", () => {
    expect(orbTravelForGesture("zh-to-vi", -300, 112)).toBe(-112);
    expect(orbTravelForGesture("vi-to-zh", 300, 112)).toBe(112);
  });

  it("ignores movement back past the resting point", () => {
    expect(orbTravelForGesture("zh-to-vi", 40, 112)).toBe(0);
    expect(orbTravelForGesture("vi-to-zh", -40, 112)).toBe(0);
  });

  it("keeps the English top direction on the negative side", () => {
    expect(orbTravelForGesture("en-to-vi", -40, 112, "en-to-vi")).toBe(-40);
    expect(orbTravelForGesture("vi-to-en", 40, 112, "en-to-vi")).toBe(40);
  });
});
