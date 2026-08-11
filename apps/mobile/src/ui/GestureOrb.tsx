import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as Haptics from "expo-haptics";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, PanResponder, StyleSheet, View } from "react-native";

import type { InterpreterDirection } from "../qwen/types";
import {
  directionForVerticalDelta,
  orbTravelForGesture,
} from "./gesture-direction";
import type { AppTheme } from "./theme";

const GESTURE_START_THRESHOLD = 6;
const DIRECTION_LOCK_THRESHOLD = 12;
const VERTICAL_INTENT_RATIO = 1.2;
const ACTIVATION_THRESHOLD = 68;
const MAX_TRAVEL = 112;
const DOUBLE_TAP_WINDOW_MS = 320;
const RECALL_DURATION_MS = 540;

interface GestureOrbProps {
  theme: AppTheme;
  topDirection: InterpreterDirection;
  bottomDirection: InterpreterDirection;
  topLanguageLabel: string;
  bottomLanguageLabel: string;
  topColor: string;
  bottomColor: string;
  connected: boolean;
  disabled: boolean;
  reduceMotion: boolean;
  waitingForTranslation: boolean;
  /** Signed drag progress shared with the transcript frames. */
  pull: Animated.Value;
  /** Vertical gesture travel. The orb returns to zero while recording. */
  orbTravel: Animated.Value;
  onPrepare: (direction: InterpreterDirection) => void;
  onActivate: (direction: InterpreterDirection) => void;
  onRelease: () => void;
  onDoubleTap: () => void;
}

export function GestureOrb({
  theme,
  topDirection,
  bottomDirection,
  topLanguageLabel,
  bottomLanguageLabel,
  topColor,
  bottomColor,
  connected,
  disabled,
  reduceMotion,
  waitingForTranslation,
  pull,
  orbTravel,
  onPrepare,
  onActivate,
  onRelease,
  onDoubleTap,
}: GestureOrbProps) {
  const pulse = useRef(new Animated.Value(0)).current;
  const trailingPulse = useRef(new Animated.Value(0)).current;
  const recall = useRef(new Animated.Value(1)).current;
  const activatedRef = useRef<InterpreterDirection | undefined>(undefined);
  const preparedRef = useRef<InterpreterDirection | undefined>(undefined);
  const lockedDirectionRef = useRef<InterpreterDirection | undefined>(
    undefined,
  );
  const gestureStartedAtRef = useRef(0);
  const lastTapAtRef = useRef(0);
  const [activated, setActivated] = useState<InterpreterDirection>();
  const [engaged, setEngaged] = useState<InterpreterDirection>();

  // The pan responder is created once. Rebuilding it while a finger is down
  // resets the gesture state, so every prop it reads goes through a ref.
  const settingsRef = useRef({
    disabled,
    reduceMotion,
    topDirection,
    bottomDirection,
  });
  const callbacksRef = useRef({
    onPrepare,
    onActivate,
    onRelease,
    onDoubleTap,
  });

  useEffect(() => {
    settingsRef.current = {
      disabled,
      reduceMotion,
      topDirection,
      bottomDirection,
    };
    callbacksRef.current = { onPrepare, onActivate, onRelease, onDoubleTap };
  });

  const isPulsing = Boolean(engaged) || waitingForTranslation;

  useEffect(() => {
    pulse.stopAnimation();
    trailingPulse.stopAnimation();

    if (!isPulsing) {
      pulse.setValue(0);
      trailingPulse.setValue(0);
      return;
    }

    if (reduceMotion) {
      pulse.setValue(0.24);
      trailingPulse.setValue(0);
      return;
    }

    pulse.setValue(0);
    trailingPulse.setValue(0);
    const duration = 1_180;
    const offset = 420;
    const primaryLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.delay(offset),
      ]),
    );
    const trailingLoop = Animated.loop(
      Animated.sequence([
        Animated.delay(offset),
        Animated.timing(trailingPulse, {
          toValue: 1,
          duration,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    );
    primaryLoop.start();
    trailingLoop.start();
    return () => {
      primaryLoop.stop();
      trailingLoop.stop();
    };
  }, [isPulsing, pulse, reduceMotion, trailingPulse]);

  const panResponder = useMemo(() => {
    const resetVisuals = (reduceMotionNow: boolean, hadPull: boolean) => {
      if (reduceMotionNow) {
        orbTravel.setValue(0);
        pull.setValue(0);
        recall.setValue(1);
        setEngaged(undefined);
        return;
      }

      Animated.parallel([
        Animated.spring(orbTravel, {
          toValue: 0,
          stiffness: 285,
          damping: 27,
          mass: 0.72,
          useNativeDriver: true,
        }),
        Animated.spring(pull, {
          toValue: 0,
          stiffness: 205,
          damping: 24,
          mass: 0.78,
          overshootClamping: true,
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) setEngaged(undefined);
      });

      if (!hadPull) return;
      // A ring collapsing inward reads as the squashed frame being drawn
      // back into the pulse at the centre.
      recall.setValue(0);
      Animated.timing(recall, {
        toValue: 1,
        duration: RECALL_DURATION_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    };

    const finishGesture = (
      gesture: { dx: number; dy: number },
      allowDoubleTap: boolean,
    ) => {
      const { onRelease: release, onDoubleTap: doubleTap } =
        callbacksRef.current;
      const activeDirection = activatedRef.current;
      const hadPull = Boolean(lockedDirectionRef.current);
      if (activeDirection) {
        release();
      } else if (
        allowDoubleTap &&
        !hadPull &&
        Math.abs(gesture.dx) < 8 &&
        Math.abs(gesture.dy) < 8 &&
        Date.now() - gestureStartedAtRef.current < 260
      ) {
        const now = Date.now();
        if (now - lastTapAtRef.current <= DOUBLE_TAP_WINDOW_MS) {
          lastTapAtRef.current = 0;
          void Haptics.notificationAsync(
            Haptics.NotificationFeedbackType.Success,
          ).catch(() => undefined);
          doubleTap();
        } else {
          lastTapAtRef.current = now;
        }
      }

      activatedRef.current = undefined;
      preparedRef.current = undefined;
      lockedDirectionRef.current = undefined;
      setActivated(undefined);
      resetVisuals(settingsRef.current.reduceMotion, hadPull);
    };

    return PanResponder.create({
      // Always receive taps so camera capture remains available when live
      // voice translation is disconnected. Dragging still respects disabled.
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gesture) => {
        const verticalDistance = Math.abs(gesture.dy);
        const horizontalDistance = Math.abs(gesture.dx);
        return (
          !settingsRef.current.disabled &&
          verticalDistance >= GESTURE_START_THRESHOLD &&
          verticalDistance > horizontalDistance * VERTICAL_INTENT_RATIO
        );
      },
      onPanResponderGrant: () => {
        activatedRef.current = undefined;
        preparedRef.current = undefined;
        lockedDirectionRef.current = undefined;
        gestureStartedAtRef.current = Date.now();
        setActivated(undefined);
        setEngaged(undefined);
        orbTravel.stopAnimation();
        pull.stopAnimation();
      },
      onPanResponderMove: (_, gesture) => {
        if (settingsRef.current.disabled) return;
        // Once recording starts, the mic belongs in the visual centre. Ignore
        // further finger travel until release so it cannot drift off-axis.
        if (activatedRef.current) return;
        if (!lockedDirectionRef.current) {
          const verticalDistance = Math.abs(gesture.dy);
          const horizontalDistance = Math.abs(gesture.dx);
          if (
            verticalDistance < DIRECTION_LOCK_THRESHOLD ||
            verticalDistance <= horizontalDistance * VERTICAL_INTENT_RATIO
          ) {
            return;
          }
          const direction = directionForVerticalDelta(
            gesture.dy,
            settingsRef.current.topDirection,
            settingsRef.current.bottomDirection,
          );
          lockedDirectionRef.current = direction;
          setEngaged(direction);
        }

        const direction = lockedDirectionRef.current;
        const clamped = orbTravelForGesture(
          direction,
          gesture.dy,
          MAX_TRAVEL,
          settingsRef.current.topDirection,
        );
        orbTravel.setValue(clamped);
        const distance = Math.abs(clamped);
        const progress = Math.min(1, distance / ACTIVATION_THRESHOLD);
        pull.setValue(
          direction === settingsRef.current.topDirection
            ? progress
            : -progress,
        );

        if (distance >= DIRECTION_LOCK_THRESHOLD && !preparedRef.current) {
          preparedRef.current = direction;
          callbacksRef.current.onPrepare(direction);
        }

        if (distance >= ACTIVATION_THRESHOLD && !activatedRef.current) {
          activatedRef.current = direction;
          setActivated(direction);
          void Haptics.impactAsync(
            Haptics.ImpactFeedbackStyle.Medium,
          ).catch(() => undefined);
          Animated.spring(orbTravel, {
            toValue: 0,
            stiffness: 320,
            damping: 28,
            mass: 0.68,
            useNativeDriver: true,
          }).start();
          callbacksRef.current.onActivate(direction);
        }
      },
      onPanResponderRelease: (_, gesture) => finishGesture(gesture, true),
      onPanResponderTerminate: (_, gesture) => finishGesture(gesture, false),
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
    });
  }, [orbTravel, pull, recall]);

  const ringOpacity = pulse.interpolate({
    inputRange: [0, 0.24, 1],
    outputRange: [0.48, 0.32, 0],
  });
  const ringScaleX = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.96, 1.08],
  });
  const ringScaleY = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.94, 1.92],
  });
  const trailingRingOpacity = trailingPulse.interpolate({
    inputRange: [0, 0.2, 1],
    outputRange: [0.4, 0.26, 0],
  });
  const trailingRingScaleX = trailingPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.98, 1.05],
  });
  const trailingRingScaleY = trailingPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.96, 1.7],
  });
  const recallOpacity = recall.interpolate({
    inputRange: [0, 0.28, 1],
    outputRange: [0, 0.46, 0],
  });
  const recallScaleX = recall.interpolate({
    inputRange: [0, 1],
    outputRange: [1.08, 0.94],
  });
  const recallScaleY = recall.interpolate({
    inputRange: [0, 1],
    outputRange: [2.05, 0.94],
  });
  const dragScale = pull.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: [0.94, 1, 0.94],
    extrapolate: "clamp",
  });

  // The rim doubles as the server connection light: green when the live
  // session is up, red while it is down, accent while the mic is open.
  const gestureColor =
    engaged === topDirection
      ? topColor
      : engaged === bottomDirection
        ? bottomColor
        : theme.accent;
  const rimColor = engaged
    ? gestureColor
    : connected
      ? theme.success
      : theme.danger;
  const activatedIconColor = activated
    ? readableTextColor(gestureColor)
    : theme.text;

  return (
    <View style={styles.zone}>
      <Animated.View
        style={[
          styles.orbAnchor,
          {
            transform: [
              { translateY: orbTravel },
              { scale: dragScale },
            ],
          },
        ]}
      >
        <Animated.View
          pointerEvents="none"
          style={[
            styles.ring,
            {
              borderColor: gestureColor,
              opacity: ringOpacity,
              transform: [{ scaleX: ringScaleX }, { scaleY: ringScaleY }],
            },
          ]}
        />
        {!reduceMotion ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.ring,
              {
                borderColor: gestureColor,
                opacity: trailingRingOpacity,
                transform: [
                  { scaleX: trailingRingScaleX },
                  { scaleY: trailingRingScaleY },
                ],
              },
            ]}
          />
        ) : null}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.ring,
            {
              borderColor: gestureColor,
              opacity: recallOpacity,
              transform: [
                { scaleX: recallScaleX },
                { scaleY: recallScaleY },
              ],
            },
          ]}
        />
        <Animated.View
          accessibilityLabel={`Kéo lên để nói ${topLanguageLabel}, kéo xuống để nói ${bottomLanguageLabel}. Nhấn đúp để chụp ảnh và dịch chữ`}
          accessibilityHint="Kéo và giữ để nghe liên tục; ứng dụng tự dịch theo từng khoảng ngắt, thả tay để dừng"
          accessibilityRole="adjustable"
          accessibilityState={{ busy: isPulsing }}
          accessibilityValue={{
            text: waitingForTranslation
              ? "Đang chờ bản dịch"
              : connected
                ? "Đã kết nối máy chủ"
                : "Chưa kết nối máy chủ",
          }}
          {...panResponder.panHandlers}
          style={[
            styles.orb,
            {
              backgroundColor: activated
                ? gestureColor
                : theme.surfaceRaised,
              borderColor: rimColor,
              shadowColor: theme.shadow,
            },
          ]}
        >
          <MaterialIcons
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            name={activated ? "mic" : "swap-vert"}
            size={activated ? 32 : 39}
            color={activatedIconColor}
          />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

function readableTextColor(background: string): "#111410" | "#FFFFFF" {
  const match = /^#([0-9A-F]{6})$/i.exec(background);
  if (!match) return "#FFFFFF";
  const value = Number.parseInt(match[1]!, 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  const luminance = (red * 299 + green * 587 + blue * 114) / 255_000;
  return luminance > 0.62 ? "#111410" : "#FFFFFF";
}

const styles = StyleSheet.create({
  zone: {
    height: 128,
    alignItems: "center",
    justifyContent: "center",
  },
  orbAnchor: {
    position: "absolute",
    left: "50%",
    top: 18,
    width: 92,
    height: 92,
    marginLeft: -46,
    alignItems: "center",
    justifyContent: "center",
  },
  ring: {
    position: "absolute",
    width: 92,
    height: 92,
    borderRadius: 46,
    borderWidth: 2,
  },
  orb: {
    width: 92,
    height: 92,
    borderRadius: 46,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 7,
  },
});
