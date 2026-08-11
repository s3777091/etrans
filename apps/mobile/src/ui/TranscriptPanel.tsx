import { Animated, ScrollView, StyleSheet, Text, View } from "react-native";

import type { AppTheme } from "./theme";

const FRAME_HORIZONTAL_PADDING = 18;
const WRAP_NECK_WIDTH = 156;
const WRAP_NECK_EXTENT = 136;
const WRAP_STROKE_WIDTH = 2.5;
const WRAP_JOINT_RADIUS = 15;
const WRAP_CAP_RADIUS = 18;
const WRAP_MOUTH_WIDTH = WRAP_NECK_WIDTH + WRAP_JOINT_RADIUS * 2;

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
      ? { bottom: -WRAP_JOINT_RADIUS }
      : { top: -WRAP_JOINT_RADIUS };
  const leftJointBorders =
    alignment === "top"
      ? {
          borderTopWidth: WRAP_STROKE_WIDTH,
          borderRightWidth: WRAP_STROKE_WIDTH,
          borderTopRightRadius: WRAP_JOINT_RADIUS,
        }
      : {
          borderBottomWidth: WRAP_STROKE_WIDTH,
          borderRightWidth: WRAP_STROKE_WIDTH,
          borderBottomRightRadius: WRAP_JOINT_RADIUS,
        };
  const rightJointBorders =
    alignment === "top"
      ? {
          borderTopWidth: WRAP_STROKE_WIDTH,
          borderLeftWidth: WRAP_STROKE_WIDTH,
          borderTopLeftRadius: WRAP_JOINT_RADIUS,
        }
      : {
          borderBottomWidth: WRAP_STROKE_WIDTH,
          borderLeftWidth: WRAP_STROKE_WIDTH,
          borderBottomLeftRadius: WRAP_JOINT_RADIUS,
        };
  const outerMaskPosition =
    alignment === "top" ? { bottom: -4 } : { top: -4 };
  const innerMaskPosition =
    alignment === "top" ? { bottom: 0 } : { top: 0 };

  return (
    <View style={styles.container}>
      <Animated.View
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
              transform: [{ translateX: orbTravel }],
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
              transform: [{ translateX: orbTravel }],
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
                { translateX: orbTravel },
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
            leftJointBorders,
            {
              borderColor: frameColor,
              opacity: wrapOpacity,
              transform: [{ translateX: orbTravel }],
            },
          ]}
        />
        <Animated.View
          pointerEvents="none"
          style={[
            styles.wrapJoint,
            styles.rightWrapJoint,
            jointPosition,
            rightJointBorders,
            {
              borderColor: frameColor,
              opacity: wrapOpacity,
              transform: [{ translateX: orbTravel }],
            },
          ]}
        />

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
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  frame: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: 24,
    paddingHorizontal: FRAME_HORIZONTAL_PADDING,
    paddingTop: 12,
    paddingBottom: 12,
  },
  activeRim: {
    position: "absolute",
    top: -0.5,
    left: -0.5,
    right: -0.5,
    bottom: -0.5,
    borderWidth: WRAP_STROKE_WIDTH,
    borderRadius: 24.5,
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
    height: WRAP_NECK_EXTENT - WRAP_JOINT_RADIUS + 1,
    marginLeft: -WRAP_NECK_WIDTH / 2 + FRAME_HORIZONTAL_PADDING,
    borderLeftWidth: WRAP_STROKE_WIDTH,
    borderRightWidth: WRAP_STROKE_WIDTH,
  },
  wrapJoint: {
    position: "absolute",
    left: "50%",
    width: WRAP_JOINT_RADIUS,
    height: WRAP_JOINT_RADIUS,
  },
  leftWrapJoint: {
    marginLeft:
      -WRAP_NECK_WIDTH / 2 -
      WRAP_JOINT_RADIUS +
      FRAME_HORIZONTAL_PADDING,
  },
  rightWrapJoint: {
    marginLeft: WRAP_NECK_WIDTH / 2 + FRAME_HORIZONTAL_PADDING,
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
