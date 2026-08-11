/**
 * Geometry shared by the transcript frames and the gesture orb.
 *
 * Dragging sideways slides the pocket that the speaking frame grows around the
 * orb. That pocket cuts the frame's edge open, so it has to stay on the
 * straight part of the edge: the moment it reaches a rounded corner the outline
 * breaks and the frame looks torn. Both components read their limits from here
 * so the pocket and the orb can never disagree about how far a drag may go.
 */

/** Horizontal padding around a transcript frame, from TranscriptPanel. */
export const FRAME_SIDE_MARGIN = 18;
/** Corner radius of a transcript frame, from TranscriptPanel. */
export const FRAME_CORNER_RADIUS = 24;
/** Width of the pocket walls; wide enough to hold the 92pt orb and its ring. */
export const POCKET_NECK_WIDTH = 132;
export const POCKET_JOINT_RADIUS = 15;
export const POCKET_STROKE_WIDTH = 2.5;
/** The opening the pocket cuts into the frame edge, joints included. Each
 *  joint overlaps its neck wall by one stroke, so it reaches that much less
 *  far than its radius suggests. */
export const POCKET_MOUTH_WIDTH =
  POCKET_NECK_WIDTH + (POCKET_JOINT_RADIUS - POCKET_STROKE_WIDTH) * 2;

/** Breathing room between the mouth and where the corner arc begins. */
const CORNER_CLEARANCE = 8;
/** Longest drag the design asks for, on phones wide enough to allow it. */
const PREFERRED_ORB_TRAVEL = 112;
/** Under this a drag stops feeling like a drag, so on narrow phones the pocket
 *  is allowed to lag behind the orb rather than the gesture being cut short. */
const MIN_ORB_TRAVEL = 48;

/** How far the pocket may slide before its mouth would eat a frame corner. */
export function maxPocketShift(frameWidth: number): number {
  const toFrameEdge = frameWidth / 2 - POCKET_MOUTH_WIDTH / 2;
  return Math.max(0, toFrameEdge - FRAME_CORNER_RADIUS - CORNER_CLEARANCE);
}

/** How far the orb may travel, so the pocket can stay attached to it. */
export function maxOrbTravel(windowWidth: number): number {
  const frameWidth = windowWidth - FRAME_SIDE_MARGIN * 2;
  return Math.min(
    PREFERRED_ORB_TRAVEL,
    Math.max(MIN_ORB_TRAVEL, maxPocketShift(frameWidth)),
  );
}

/** Where along that travel the microphone opens. Always reachable. */
export function activationThresholdForTravel(travel: number): number {
  return Math.min(travel, Math.max(28, Math.round(travel * 0.62)));
}
