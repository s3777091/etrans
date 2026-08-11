import { useState } from "react";
import { Animated, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  FRAME_CORNER_RADIUS,
  FRAME_SIDE_MARGIN,
  maxPocketShift,
  POCKET_JOINT_RADIUS,
  POCKET_MOUTH_WIDTH,
  POCKET_NECK_WIDTH,
  POCKET_STROKE_WIDTH,
} from "./pocket-geometry";
import type { AppTheme } from "./theme";

const FRAME_HORIZONTAL_PADDING = 18;
const WRAP_NECK_WIDTH = POCKET_NECK_WIDTH;
const WRAP_NECK_EXTENT = 136;
const WRAP_STROKE_WIDTH = POCKET_STROKE_WIDTH;
const WRAP_JOINT_RADIUS = POCKET_JOINT_RADIUS;
const WRAP_CAP_RADIUS = 18;
const FRAME_BORDER_WIDTH = 1.5;
/** The lit rim sits exactly on top of the frame's resting border instead of
 *  just inside it. Any less and the mouth reads as a thinner stretch of
 *  outline, because the mask has to take the resting border with it. */
const RIM_INSET = FRAME_BORDER_WIDTH;

// The pocket is drawn as three separate views — two corner joints and the neck
// — and every border is painted INSIDE its own box. Butting the boxes edge to
// edge therefore lays the strokes side by side instead of on top of each other,
// which is what tore the outline: a joint's curve ended one stroke width away
// from the wall it was supposed to continue into. Each joint is pulled back
// over its neighbour by exactly one stroke so the two paint the same band.

/** Left edge of the neck box, measured from the pocket centre. */
const NECK_LEFT = -WRAP_NECK_WIDTH / 2;
/** Joint boxes overlap the neck walls by a stroke so the curves line up. */
const LEFT_JOINT_LEFT = NECK_LEFT + WRAP_STROKE_WIDTH - WRAP_JOINT_RADIUS;
const RIGHT_JOINT_LEFT = -NECK_LEFT - WRAP_STROKE_WIDTH;
/** …and stand on the rim's own band rather than under the frame's edge. */
const JOINT_EDGE_INSET = WRAP_JOINT_RADIUS - (WRAP_STROKE_WIDTH - RIM_INSET);
/** The walls run up behind the joints, so the seam cannot open a gap. */
const WRAP_NECK_HEIGHT = WRAP_NECK_EXTENT - JOINT_EDGE_INSET + 1;
/** The opening stops a hair short of the joints so the rim runs under the
 *  start of each curve. Cutting it flush leaves an antialiased seam where the
 *  two strokes butt together. */
const MASK_SEAM_OVERLAP = 1;
const WRAP_MOUTH_WIDTH = POCKET_MOUTH_WIDTH - MASK_SEAM_OVERLAP * 2;

interface TranscriptPanelProps {
  languageLabel: string;
  frameColor: string;
  textColor: string;
  textSize: number;
  fontFamily?: string;
  note?: string;
  text: string;
  alignment: "top" | "bottom";
  theme: AppTheme;
  /** Signed drag progress: positive pulls the top frame, negative the bottom. */
  pull: Animated.Value;
  /** Horizontal orb position used to keep the opening attached to it. */
  orbTravel: Animated.Value;
}

export function TranscriptPanel({
  languageLabel,
  frameColor,
  textColor,
  textSize,
  fontFamily,
  note,
  text,
  alignment,
  theme,
  pull,
  orbTravel,
}: TranscriptPanelProps) {
  // Positive means this frame is the one being pulled toward the orb.
  const squash = Animated.multiply(pull, alignment === "top" ? 1 : -1);

  // The pocket follows the orb sideways, but it is an opening cut into the
  // frame edge: let it reach a rounded corner and the outline tears open. The
  // frame is measured rather than assumed so no screen width can break it.
  const [frameWidth, setFrameWidth] = useState(0);
  const shiftLimit = maxPocketShift(frameWidth);
  const pocketShift = orbTravel.interpolate({
    inputRange: [-Math.max(shiftLimit, 1), 0, Math.max(shiftLimit, 1)],
    outputRange: [-shiftLimit, 0, shiftLimit],
    extrapolate: "clamp",
  });

  const wrapProgress = squash.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
    extrapolate: "clamp",
  });
  const wrapOpacity = wrapProgress.interpolate({
    inputRange: [0, 0.16, 0.3, 0.56, 1],
    outputRange: [0, 0, 0.24, 0.8, 1],
    extrapolate: "clamp",
  });
  const mouthOpacity = wrapProgress.interpolate({
    inputRange: [0, 0.16, 0.32, 0.52, 1],
    outputRange: [0, 0, 0.42, 1, 1],
    extrapolate: "clamp",
  });
  const neckScaleX = wrapProgress.interpolate({
    inputRange: [0, 0.22, 0.52, 1],
    outputRange: [0.3, 0.72, 1, 1],
    extrapolate: "clamp",
  });
  const neckScaleY = wrapProgress.interpolate({
    inputRange: [0, 0.18, 0.62, 1],
    outputRange: [0.04, 0.18, 1, 1],
    extrapolate: "clamp",
  });
  const neckOrigin = alignment === "top" ? "50% 100%" : "50% 0%";
  const neckPosition =
    alignment === "top"
      ? { bottom: -WRAP_NECK_EXTENT }
      : { top: -WRAP_NECK_EXTENT };
  const neckBorders =
    alignment === "top"
      ? {
          borderBottomWidth: WRAP_STROKE_WIDTH,
          borderBottomLeftRadius: WRAP_CAP_RADIUS,
          borderBottomRightRadius: WRAP_CAP_RADIUS,
        }
      : {
          borderTopWidth: WRAP_STROKE_WIDTH,
          borderTopLeftRadius: WRAP_CAP_RADIUS,
          borderTopRightRadius: WRAP_CAP_RADIUS,
        };
  const jointPosition =
    alignment === "top"
      ? { bottom: -JOINT_EDGE_INSET }
      : { top: -JOINT_EDGE_INSET };
  // Each joint is a quarter of a full ring, clipped to the quadrant that turns
  // the frame edge into the pocket wall. Drawing it as a box with only two
  // borders instead leaves Android painting a hairline down the sides that
  // carry no border at all — visible as a stray tick beside the curve.
  const arcVertical = alignment === "top" ? { top: 0 } : { top: -WRAP_JOINT_RADIUS };
  const leftArcPosition = { ...arcVertical, left: -WRAP_JOINT_RADIUS };
  const rightArcPosition = { ...arcVertical, left: 0 };
  const outerMaskPosition =
    alignment === "top" ? { bottom: -4 } : { top: -4 };
  const innerMaskPosition =
    alignment === "top" ? { bottom: 0 } : { top: 0 };

  return (
    <View style={styles.container}>
      <Animated.View
        onLayout={(event) => setFrameWidth(event.nativeEvent.layout.width)}
        style={[
          styles.frame,
          {
            backgroundColor: theme.surfaceRaised,
            borderColor: `${frameColor}66`,
          },
        ]}
      >
        <Animated.View
          pointerEvents="none"
          style={[
            styles.activeRim,
            {
              borderColor: frameColor,
              opacity: wrapOpacity,
            },
          ]}
        />
        <Animated.View
          pointerEvents="none"
          style={[
            styles.mouthMask,
            outerMaskPosition,
            {
              backgroundColor: theme.background,
              opacity: mouthOpacity,
              transform: [{ translateX: pocketShift }],
            },
          ]}
        />
        <Animated.View
          pointerEvents="none"
          style={[
            styles.mouthMask,
            innerMaskPosition,
            {
              backgroundColor: theme.surfaceRaised,
              opacity: mouthOpacity,
              transform: [{ translateX: pocketShift }],
            },
          ]}
        />
        <Animated.View
          pointerEvents="none"
          style={[
            styles.wrapNeck,
            neckPosition,
            neckBorders,
            {
              borderColor: frameColor,
              opacity: wrapOpacity,
              transformOrigin: neckOrigin,
              transform: [
                { scaleX: neckScaleX },
                { scaleY: neckScaleY },
                { translateX: pocketShift },
              ],
            },
          ]}
        />
        <Animated.View
          pointerEvents="none"
          style={[
            styles.wrapJoint,
            styles.leftWrapJoint,
            jointPosition,
            {
              opacity: wrapOpacity,
              transform: [{ translateX: pocketShift }],
            },
          ]}
        >
          <View
            style={[
              styles.jointArc,
              leftArcPosition,
              {
                borderTopColor: frameColor,
                borderRightColor: frameColor,
                borderBottomColor: frameColor,
                borderLeftColor: frameColor,
              },
            ]}
          />
        </Animated.View>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.wrapJoint,
            styles.rightWrapJoint,
            jointPosition,
            {
              opacity: wrapOpacity,
              transform: [{ translateX: pocketShift }],
            },
          ]}
        >
          <View
            style={[
              styles.jointArc,
              rightArcPosition,
              {
                borderTopColor: frameColor,
                borderRightColor: frameColor,
                borderBottomColor: frameColor,
                borderLeftColor: frameColor,
              },
            ]}
          />
        </Animated.View>

        <View style={styles.labelRow}>
          <Text style={[styles.label, { color: frameColor }]}>
            {languageLabel}
          </Text>
          {note ? (
            <Text style={[styles.note, { color: theme.muted }]}>{note}</Text>
          ) : null}
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={
            alignment === "top" ? styles.scrollTop : styles.scrollBottom
          }
          showsVerticalScrollIndicator={false}
        >
          <Text
            selectable
            style={[
              styles.transcript,
              {
                color: textColor,
                fontFamily,
                fontSize: textSize,
                lineHeight: Math.round(textSize * 1.42),
              },
            ]}
          >
            {text}
          </Text>
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: FRAME_SIDE_MARGIN,
    paddingVertical: 8,
  },
  frame: {
    flex: 1,
    borderWidth: FRAME_BORDER_WIDTH,
    borderRadius: FRAME_CORNER_RADIUS,
    paddingHorizontal: FRAME_HORIZONTAL_PADDING,
    paddingTop: 12,
    paddingBottom: 12,
  },
  activeRim: {
    position: "absolute",
    top: -RIM_INSET,
    left: -RIM_INSET,
    right: -RIM_INSET,
    bottom: -RIM_INSET,
    borderWidth: WRAP_STROKE_WIDTH,
    borderRadius: FRAME_CORNER_RADIUS,
  },
  mouthMask: {
    position: "absolute",
    left: "50%",
    width: WRAP_MOUTH_WIDTH,
    height: 4,
    marginLeft: -WRAP_MOUTH_WIDTH / 2 + FRAME_HORIZONTAL_PADDING,
  },
  wrapNeck: {
    position: "absolute",
    left: "50%",
    width: WRAP_NECK_WIDTH,
    height: WRAP_NECK_HEIGHT,
    marginLeft: -WRAP_NECK_WIDTH / 2 + FRAME_HORIZONTAL_PADDING,
    borderLeftWidth: WRAP_STROKE_WIDTH,
    borderRightWidth: WRAP_STROKE_WIDTH,
  },
  wrapJoint: {
    position: "absolute",
    left: "50%",
    width: WRAP_JOINT_RADIUS,
    height: WRAP_JOINT_RADIUS,
    overflow: "hidden",
  },
  jointArc: {
    position: "absolute",
    width: WRAP_JOINT_RADIUS * 2,
    height: WRAP_JOINT_RADIUS * 2,
    borderRadius: WRAP_JOINT_RADIUS,
    borderWidth: WRAP_STROKE_WIDTH,
  },
  leftWrapJoint: {
    marginLeft: LEFT_JOINT_LEFT + FRAME_HORIZONTAL_PADDING,
  },
  rightWrapJoint: {
    marginLeft: RIGHT_JOINT_LEFT + FRAME_HORIZONTAL_PADDING,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  label: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.35,
  },
  note: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.1,
  },
  scroll: { flex: 1 },
  scrollTop: {
    flexGrow: 1,
    justifyContent: "flex-end",
    paddingTop: 12,
  },
  scrollBottom: {
    flexGrow: 1,
    justifyContent: "flex-start",
    paddingTop: 12,
  },
  transcript: {
    fontWeight: "500",
    letterSpacing: -0.35,
  },
});
