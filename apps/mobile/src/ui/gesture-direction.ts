import type { InterpreterDirection } from "../qwen/types";

export function directionForHorizontalDelta(
  deltaX: number,
  rightDirection: InterpreterDirection = "zh-to-vi",
  leftDirection: InterpreterDirection = "vi-to-zh",
): InterpreterDirection {
  return deltaX > 0 ? rightDirection : leftDirection;
}

export function orbTravelForGesture(
  direction: InterpreterDirection,
  deltaX: number,
  maxTravel: number,
  rightDirection: InterpreterDirection = "zh-to-vi",
): number {
  return direction === rightDirection
    ? Math.min(maxTravel, Math.max(0, deltaX))
    : Math.max(-maxTravel, Math.min(0, deltaX));
}
