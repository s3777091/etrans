import { describe, expect, it } from "vitest";

import {
  activationThresholdForTravel,
  FRAME_CORNER_RADIUS,
  FRAME_SIDE_MARGIN,
  maxOrbTravel,
  maxPocketShift,
  POCKET_MOUTH_WIDTH,
} from "./pocket-geometry";

/** Phone widths in points, from the narrowest Android to the largest iPhone. */
const WIDTHS = [320, 360, 375, 393, 402, 414, 430, 440];

describe("pocket shift", () => {
  it("keeps the mouth clear of the rounded corners", () => {
    for (const width of WIDTHS) {
      const frameWidth = width - FRAME_SIDE_MARGIN * 2;
      const mouthEdge =
        maxPocketShift(frameWidth) + POCKET_MOUTH_WIDTH / 2;
      expect(mouthEdge).toBeLessThanOrEqual(
        frameWidth / 2 - FRAME_CORNER_RADIUS,
      );
    }
  });

  it("refuses to move at all when the frame cannot hold the mouth", () => {
    expect(maxPocketShift(POCKET_MOUTH_WIDTH)).toBe(0);
    expect(maxPocketShift(0)).toBe(0);
  });
});

describe("orb travel", () => {
  it("stays within what the pocket can follow on normal phones", () => {
    for (const width of WIDTHS.filter((value) => value >= 360)) {
      const frameWidth = width - FRAME_SIDE_MARGIN * 2;
      expect(maxOrbTravel(width)).toBeLessThanOrEqual(
        maxPocketShift(frameWidth),
      );
    }
  });

  it("keeps a usable drag on phones too narrow for the pocket", () => {
    expect(maxOrbTravel(320)).toBe(48);
  });

  it("never grows past the length the design asks for", () => {
    expect(maxOrbTravel(1024)).toBe(112);
  });
});

describe("activation threshold", () => {
  it("can always be reached within the available travel", () => {
    for (const width of [...WIDTHS, 1024]) {
      const travel = maxOrbTravel(width);
      expect(activationThresholdForTravel(travel)).toBeLessThanOrEqual(travel);
    }
  });

  it("asks for a deliberate drag rather than a nudge", () => {
    expect(activationThresholdForTravel(112)).toBe(69);
    expect(activationThresholdForTravel(48)).toBe(30);
  });
});
