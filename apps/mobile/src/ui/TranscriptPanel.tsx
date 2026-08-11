import { Animated, ScrollView, StyleSheet, Text, View } from "react-native";

import type { AppTheme } from "./theme";

const ACTIVE_SCALE_Y = 0.975;
const COUNTER_STRETCH_Y = 1.006;
const FRAME_HORIZONTAL_PADDING = 18;
const WRAP_NECK_WIDTH = 156;
const WRAP_NECK_EXTENT = 136;

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
  /** Horizontal pulse position used to keep the opening attached to it. */
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

  const scaleY = squash.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: [COUNTER_STRETCH_Y, 1, ACTIVE_SCALE_Y],
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
  const rimScaleX = wrapProgress.interpolate({
    inputRange: [0, 0.3, 0.72, 1],
    outputRange: [0.34, 0.5, 0.9, 1],
    extrapolate: "clamp",
  });
  const rimScaleY = wrapProgress.interpolate({
    inputRange: [0, 0.34, 0.78, 1],
    outputRange: [0.04, 0.15, 0.86, 1],
    extrapolate: "clamp",
  });
  const nearEdge = alignment === "top" ? "50% 100%" : "50% 0%";
  const neckOrigin = alignment === "top" ? "50% 100%" : "50% 0%";
  const neckPosition =
    alignment === "top"
      ? { bottom: -WRAP_NECK_EXTENT }
      : { top: -WRAP_NECK_EXTENT };
  const neckBorders =
    alignment === "top"
      ? {
          borderBottomWidth: 2.5,
          borderBottomLeftRadius: 24,
          borderBottomRightRadius: 24,
        }
      : {
          borderTopWidth: 2.5,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
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
            // Anchor on the edge facing the orb so the frame collapses toward it.
            transformOrigin: alignment === "top" ? "50% 100%" : "50% 0%",
            transform: [{ scaleY }],
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
              transformOrigin: nearEdge,
              transform: [{ scaleX: rimScaleX }, { scaleY: rimScaleY }],
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
    top: -1.5,
    left: -1.5,
    right: -1.5,
    bottom: -1.5,
    borderWidth: 2.5,
    borderRadius: 25.5,
  },
  mouthMask: {
    position: "absolute",
    left: "50%",
    width: WRAP_NECK_WIDTH - 7,
    height: 4,
    marginLeft: -(WRAP_NECK_WIDTH - 7) / 2 + FRAME_HORIZONTAL_PADDING,
  },
  wrapNeck: {
    position: "absolute",
    left: "50%",
    width: WRAP_NECK_WIDTH,
    height: WRAP_NECK_EXTENT,
    marginLeft: -WRAP_NECK_WIDTH / 2 + FRAME_HORIZONTAL_PADDING,
    borderLeftWidth: 2.5,
    borderRightWidth: 2.5,
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
