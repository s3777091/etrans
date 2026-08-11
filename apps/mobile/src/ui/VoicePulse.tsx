import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet } from "react-native";

/** One ripple plus a gap, so the ring reads as a heartbeat and not a strobe. */
const CYCLE_MS = 1_180;
const TRAIL_DELAY_MS = 420;
/** Held instead of animated when the user asked for less motion. */
const STILL_PROGRESS = 0.24;
/** The trailing ring never catches the leading one up. */
const TRAIL_SCALE_RATIO = 0.72;

interface VoicePulseProps {
  /** Rings only exist while the microphone is open or a reply is on its way. */
  active: boolean;
  color: string;
  /** Diameter of the control the rings ripple out of. */
  size: number;
  /** How far the leading ring may grow before it would leave its container. */
  maxScale: number;
  reduceMotion: boolean;
}

/**
 * The ripple both voice controls share, so ETrans and EAgent pulse alike.
 *
 * It grows evenly in every direction: a ring scaled on one axis only turns into
 * an oval whose side walls thicken as it expands, which reads as a rendering
 * fault rather than a pulse.
 */
export function VoicePulse({
  active,
  color,
  size,
  maxScale,
  reduceMotion,
}: VoicePulseProps) {
  const lead = useRef(new Animated.Value(0)).current;
  const trail = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    lead.stopAnimation();
    trail.stopAnimation();

    if (!active) {
      lead.setValue(0);
      trail.setValue(0);
      return;
    }

    if (reduceMotion) {
      lead.setValue(STILL_PROGRESS);
      trail.setValue(0);
      return;
    }

    lead.setValue(0);
    trail.setValue(0);
    const leadLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(lead, {
          toValue: 1,
          duration: CYCLE_MS,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.delay(TRAIL_DELAY_MS),
      ]),
    );
    const trailLoop = Animated.loop(
      Animated.sequence([
        Animated.delay(TRAIL_DELAY_MS),
        Animated.timing(trail, {
          toValue: 1,
          duration: CYCLE_MS,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    );
    leadLoop.start();
    trailLoop.start();
    return () => {
      leadLoop.stop();
      trailLoop.stop();
    };
  }, [active, lead, reduceMotion, trail]);

  if (!active) return null;

  const ring = {
    width: size,
    height: size,
    borderRadius: size / 2,
    borderColor: color,
  };
  const leadOpacity = lead.interpolate({
    inputRange: [0, 0.22, 1],
    outputRange: [0.46, 0.32, 0],
  });
  const leadScale = lead.interpolate({
    inputRange: [0, 1],
    outputRange: [0.94, maxScale],
  });
  const trailOpacity = trail.interpolate({
    inputRange: [0, 0.2, 1],
    outputRange: [0.38, 0.24, 0],
  });
  const trailScale = trail.interpolate({
    inputRange: [0, 1],
    outputRange: [0.96, 1 + (maxScale - 1) * TRAIL_SCALE_RATIO],
  });

  return (
    <>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.ring,
          ring,
          { opacity: leadOpacity, transform: [{ scale: leadScale }] },
        ]}
      />
      {reduceMotion ? null : (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.ring,
            ring,
            { opacity: trailOpacity, transform: [{ scale: trailScale }] },
          ]}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  ring: {
    position: "absolute",
    borderWidth: 2,
  },
});
