import type { InterpreterDirection } from "../qwen/types";

export function directionForVerticalDelta(
  deltaY: number,
  upDirection: InterpreterDirection = "zh-to-vi",
  downDirection: InterpreterDirection = "vi-to-zh",
): InterpreterDirection {
  return deltaY < 0 ? upDirection : downDirection;
}

export function orbTravelForGesture(
  direction: InterpreterDirection,
  deltaY: number,
  maxTravel: number,
  upDirection: InterpreterDirection = "zh-to-vi",
): number {
  return direction === upDirection
    ? Math.max(-maxTravel, Math.min(0, deltaY))
    : Math.min(maxTravel, Math.max(0, deltaY));
}
