import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as Haptics from "expo-haptics";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import {
  AgentChatClient,
  type AgentChatMessage,
  type AgentSource,
} from "../agent/agent-client";
import { compressPhotoForAgent } from "../agent/agent-image";
import { transcribeRecording } from "../agent/agent-speech";
import {
  applyAgentEvent,
  createAssistantPlaceholder,
} from "../agent/agent-stream-state";
import { useVoiceRecorder } from "../audio/use-voice-recorder";
import {
  agentEntranceForLanguage,
  type AgentLanguage,
  type AgentSettings,
} from "../settings/agent-settings";
import { LANGUAGE_META } from "../settings/translation-settings";
import type { CapturedPhoto } from "./CameraCaptureModal";
import type { AppTheme } from "./theme";

const ORB_SIZE = 78;
const ORB_MARGIN = 18;
const FRAME_INSET = 10;
const FRAME_PADDING = 12;
const HOLD_THRESHOLD_MS = 200;
const DOUBLE_TAP_WINDOW_MS = 320;
const RISE_DURATION_MS = 360;
const FALL_DURATION_MS = 520;
const OPEN_DURATION_MS = 520;
const CLOSE_DURATION_MS = 300;
const LIFT_DURATION_MS = 440;

/** The first thing the agent says, so the screen is never a blank frame. */
const GREETINGS: Record<AgentLanguage, string> = {
  vi: "Xin chào, tôi giúp được gì cho bạn?",
  zh: "你好，有什么可以帮你的吗？",
  en: "Hi, how can I help you?",
};

type AgentPhase = "idle" | "recording" | "transcribing" | "streaming";

interface AgentScreenProps {
  theme: AppTheme;
  settings: AgentSettings;
  frameColor: string;
  apiBaseUrl: string;
  reduceMotion: boolean;
  micPermissionGranted: boolean;
  /** Owned by the app so the conversation survives a tab switch. */
  messages: AgentChatMessage[];
  onMessagesChanged: Dispatch<SetStateAction<AgentChatMessage[]>>;
  onRequestPhoto: () => Promise<CapturedPhoto | undefined>;
  /** Set while the translate tab is waiting for the orb to travel back up. */
  leaving: boolean;
  onExited: () => void;
}

export function AgentScreen({
  theme,
  settings,
  frameColor,
  apiBaseUrl,
  reduceMotion,
  micPermissionGranted,
  messages,
  onMessagesChanged: setMessages,
  onRequestPhoto,
  leaving,
  onExited,
}: AgentScreenProps) {
  const { width, height } = useWindowDimensions();
  const [phase, setPhase] = useState<AgentPhase>("idle");
  const [hint, setHint] = useState<string>();
  const [entranceDone, setEntranceDone] = useState(reduceMotion);
  const [zoneHeight, setZoneHeight] = useState(height * 0.72);

  const messagesRef = useRef<AgentChatMessage[]>([]);
  const streamingIdRef = useRef<string | undefined>(undefined);
  const scrollRef = useRef<ScrollView>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const lastTapAtRef = useRef(0);
  const recordingRef = useRef(false);
  const photoBusyRef = useRef(false);
  /** Bumped whenever the user starts something new, so a slow transcription
   *  from an abandoned recording cannot send itself later. */
  const turnTokenRef = useRef(0);

  const recorder = useVoiceRecorder();
  const client = useMemo(() => new AgentChatClient(apiBaseUrl), [apiBaseUrl]);

  // The orb travels from the middle of the translate screen down to its dock
  // in the bottom corner of the chat frame.
  const entrance = useRef(new Animated.Value(0)).current;
  const open = useRef(new Animated.Value(0)).current;
  const landing = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  // The orb starts exactly where the translate screen left it — the middle of
  // the body — and ends docked in the bottom corner of the chat frame.
  const dockCenterX = width - FRAME_INSET - ORB_MARGIN - ORB_SIZE / 2;
  const startTranslateX = width / 2 - dockCenterX;
  const dockCenterY = zoneHeight - ORB_MARGIN - ORB_SIZE / 2;
  const startTranslateY = zoneHeight / 2 - dockCenterY;
  const liftTranslateY = -dockCenterY + ORB_SIZE / 2 + 12;

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => () => client.dispose(), [client]);

  useEffect(() => {
    const removeListener = client.onEvent((event) => {
      const streamingId = streamingIdRef.current;
      if (!streamingId) return;
      // Late events from an interrupted turn carry the old id.
      if (event.turnId && event.turnId !== streamingId) return;
      setMessages((current) => applyAgentEvent(current, streamingId, event));
      if (event.type === "agent.done" || event.type === "agent.error") {
        streamingIdRef.current = undefined;
        setPhase("idle");
      }
    });
    return removeListener;
  }, [client]);

  // Captured once so editing the language mid-chat cannot replay the entrance;
  // leaving and re-entering the tab remounts the screen and plays it again.
  const entranceLanguageRef = useRef(settings.language);
  const dropOnly =
    agentEntranceForLanguage(entranceLanguageRef.current) === "drop";

  useEffect(() => {
    if (reduceMotion) {
      entrance.setValue(1);
      open.setValue(1);
      setEntranceDone(true);
      return;
    }

    entrance.setValue(0);
    open.setValue(0);
    landing.setValue(0);

    const fall = Animated.timing(entrance, {
      toValue: 1,
      duration: FALL_DURATION_MS,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    });
    const path = dropOnly
      ? fall
      : Animated.sequence([
          Animated.timing(entrance, {
            toValue: 0.42,
            duration: RISE_DURATION_MS,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          fall,
        ]);

    path.start(({ finished }) => {
      if (!finished) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(
        () => undefined,
      );
      landing.setValue(1);
      Animated.parallel([
        Animated.spring(landing, {
          toValue: 0,
          stiffness: 240,
          damping: 15,
          mass: 0.8,
          useNativeDriver: true,
        }),
        Animated.timing(open, {
          toValue: 1,
          duration: OPEN_DURATION_MS,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(() => setEntranceDone(true));
    });

    return () => path.stop();
  }, [dropOnly, entrance, landing, open, reduceMotion]);

  // Going back to the translate tab runs the same path backwards: the frame
  // closes onto the orb, then the orb rides back up to where it came from.
  useEffect(() => {
    if (!leaving) return;
    if (reduceMotion) {
      onExited();
      return;
    }

    setEntranceDone(false);
    const exit = Animated.sequence([
      Animated.timing(open, {
        toValue: 0,
        duration: CLOSE_DURATION_MS,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(entrance, {
        toValue: 0,
        duration: LIFT_DURATION_MS,
        easing: dropOnly ? Easing.out(Easing.quad) : Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
    ]);
    exit.start(({ finished }) => {
      if (finished) onExited();
    });
    return () => exit.stop();
  }, [dropOnly, entrance, leaving, onExited, open, reduceMotion]);

  // A greeting is also a hard boundary between language-specific sessions.
  // Keep the visible history, but start a new context whenever Settings changes.
  useEffect(() => {
    if (!entranceDone || leaving) return;
    const greetingPrefix = `agent-greeting-${settings.language}-`;
    const latestLocal = [...messages].reverse().find((message) => message.local);
    if (latestLocal?.id.startsWith(greetingPrefix)) return;

    setMessages((current) => {
      const currentLatestLocal = [...current]
        .reverse()
        .find((message) => message.local);
      if (currentLatestLocal?.id.startsWith(greetingPrefix)) return current;
      return [
        ...current,
        {
          id: `${greetingPrefix}${Date.now()}`,
          role: "assistant",
          text: GREETINGS[settings.language],
          status: "done",
          local: true,
          createdAt: Date.now(),
        },
      ];
    });
  }, [entranceDone, leaving, messages, setMessages, settings.language]);

  useEffect(() => {
    pulse.stopAnimation();
    if (phase !== "recording" || reduceMotion) {
      pulse.setValue(0);
      return;
    }
    pulse.setValue(0);
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 1_100,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [phase, pulse, reduceMotion]);

  const sendTurn = useCallback(
    (message: AgentChatMessage) => {
      const placeholderId = `agent-${Date.now()}`;
      const history = [...messagesRef.current, message];
      streamingIdRef.current = placeholderId;
      setMessages([...history, createAssistantPlaceholder(placeholderId)]);
      setPhase("streaming");
      setHint(undefined);
      void client.send(history, settings, placeholderId);
    },
    [client, settings],
  );

  /**
   * Drops the streaming id first so late events from the cancelled turn cannot
   * be appended to whatever the user sends next.
   */
  const stopStreaming = useCallback(() => {
    const streamingId = streamingIdRef.current;
    streamingIdRef.current = undefined;
    client.cancel();
    if (streamingId) {
      setMessages((current) =>
        current.map((message) =>
          message.id === streamingId
            ? { ...message, status: "done" }
            : message,
        ),
      );
    }
    setPhase("idle");
  }, [client, setMessages]);

  const finishRecording = useCallback(async () => {
    recordingRef.current = false;
    const token = turnTokenRef.current;
    const recording = await recorder.stop().catch(() => undefined);
    if (token !== turnTokenRef.current) return;
    if (!recording) {
      setPhase("idle");
      setHint("Giữ lâu hơn một chút rồi hãy thả tay");
      return;
    }

    setPhase("transcribing");
    try {
      const text = await transcribeRecording(
        apiBaseUrl,
        recording.wav,
        settings.language,
      );
      if (token !== turnTokenRef.current) return;
      sendTurn({
        id: `user-${Date.now()}`,
        role: "user",
        text,
        createdAt: Date.now(),
      });
    } catch (error) {
      if (token !== turnTokenRef.current) return;
      setPhase("idle");
      setHint(
        error instanceof Error
          ? error.message
          : "Không thể nhận dạng giọng nói lúc này",
      );
    }
  }, [apiBaseUrl, recorder, sendTurn, settings.language]);

  const beginRecording = useCallback(async () => {
    if (!micPermissionGranted) {
      setHint("Cần quyền truy cập micro để nói với trợ lý");
      return;
    }
    if (phase === "streaming") {
      stopStreaming();
    }
    turnTokenRef.current += 1;
    recordingRef.current = true;
    setHint(undefined);
    setPhase("recording");
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
      () => undefined,
    );
    try {
      await recorder.start();
    } catch {
      recordingRef.current = false;
      setPhase("idle");
      setHint("Không thể mở micro lúc này");
    }
  }, [micPermissionGranted, phase, recorder, stopStreaming]);

  const sendPhoto = useCallback(async () => {
    if (photoBusyRef.current || recordingRef.current) return;
    photoBusyRef.current = true;
    // A photo starts a fresh turn, so whatever is streaming has to stop first.
    if (streamingIdRef.current) stopStreaming();
    turnTokenRef.current += 1;
    try {
      const photo = await onRequestPhoto();
      if (!photo) return;
      setHint(undefined);
      const imageDataUrl = await compressPhotoForAgent(photo.uri, photo.width);
      sendTurn({
        id: `user-${Date.now()}`,
        role: "user",
        text: "",
        imageUri: photo.uri,
        imageDataUrl,
        createdAt: Date.now(),
      });
    } catch (error) {
      setHint(
        error instanceof Error ? error.message : "Không thể gửi ảnh lúc này",
      );
    } finally {
      photoBusyRef.current = false;
    }
  }, [onRequestPhoto, sendTurn, stopStreaming]);

  const handlePressIn = useCallback(() => {
    clearTimeout(holdTimerRef.current);
    holdTimerRef.current = setTimeout(() => {
      void beginRecording();
    }, HOLD_THRESHOLD_MS);
  }, [beginRecording]);

  const handlePressOut = useCallback(() => {
    clearTimeout(holdTimerRef.current);
    if (recordingRef.current) {
      void finishRecording();
      return;
    }

    const now = Date.now();
    if (now - lastTapAtRef.current <= DOUBLE_TAP_WINDOW_MS) {
      lastTapAtRef.current = 0;
      void Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => undefined);
      void sendPhoto();
      return;
    }
    lastTapAtRef.current = now;
    // Without a composer the orb is the only stop button there is.
    if (streamingIdRef.current) {
      stopStreaming();
      setHint("Đã dừng câu trả lời");
      return;
    }
    setHint("Giữ để nói, nhấn đúp để gửi ảnh");
  }, [finishRecording, sendPhoto, stopStreaming]);

  useEffect(() => () => clearTimeout(holdTimerRef.current), []);

  const language = LANGUAGE_META[settings.language];
  const statusText =
    phase === "recording"
      ? "Đang nghe bạn nói"
      : phase === "transcribing"
        ? "Đang chuyển giọng nói thành chữ"
        : phase === "streaming"
          ? "Trợ lý đang trả lời"
          : settings.search
            ? "Sẵn sàng, có thể tìm web"
            : "Sẵn sàng";

  const frameOpacity = open.interpolate({
    inputRange: [0, 0.2, 1],
    outputRange: [0, 0.5, 1],
  });
  const frameScaleY = open.interpolate({
    inputRange: [0, 1],
    outputRange: [0.08, 1],
  });
  const contentOpacity = open.interpolate({
    inputRange: [0, 0.74, 1],
    outputRange: [0, 0, 1],
  });
  const orbTranslateX = entrance.interpolate({
    inputRange: [0, 1],
    outputRange: [startTranslateX, 0],
  });
  // Vietnamese falls straight from the translate orb; the other languages lift
  // out of the layout first, so they need the extra control point.
  const orbTranslateY = dropOnly
    ? entrance.interpolate({
        inputRange: [0, 1],
        outputRange: [startTranslateY, 0],
      })
    : entrance.interpolate({
        inputRange: [0, 0.42, 1],
        outputRange: [startTranslateY, liftTranslateY, 0],
      });
  const orbScaleX = landing.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.16],
  });
  const orbScaleY = landing.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.84],
  });
  const ringOpacity = pulse.interpolate({
    inputRange: [0, 0.2, 1],
    outputRange: [0.5, 0.34, 0],
  });
  // Every voice control uses the same horizontal pulse language.
  const ringScaleX = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.94, 2.15],
  });

  return (
    <View
      style={styles.zone}
      onLayout={(event) => setZoneHeight(event.nativeEvent.layout.height)}
    >
      <Animated.View
        style={[
          styles.frame,
          {
            backgroundColor: theme.surfaceRaised,
            borderColor: `${frameColor}66`,
            opacity: frameOpacity,
            transformOrigin: "50% 100%",
            transform: [{ scaleY: frameScaleY }],
          },
        ]}
      >
        <Animated.View style={[styles.frameBody, { opacity: contentOpacity }]}>
          <View style={styles.labelRow}>
            <Text style={[styles.label, { color: frameColor }]}>
              EAGENT · {language.mainLabel}
            </Text>
            <Text style={[styles.note, { color: theme.muted }]} numberOfLines={1}>
              {settings.model.toUpperCase()}
            </Text>
          </View>

          <ScrollView
            ref={scrollRef}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.messages}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() =>
              scrollRef.current?.scrollToEnd({ animated: !reduceMotion })
            }
          >
            {messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                theme={theme}
                frameColor={frameColor}
              />
            ))}
          </ScrollView>

          {hint ? (
            <Text style={[styles.hint, { color: theme.muted }]}>{hint}</Text>
          ) : null}

          <Text style={[styles.status, { color: theme.faint }]}>
            {statusText}
          </Text>
        </Animated.View>
      </Animated.View>

      <Animated.View
        pointerEvents="box-none"
        style={[
          styles.orbAnchor,
          {
            transform: [
              { translateX: orbTranslateX },
              { translateY: orbTranslateY },
              { scaleX: orbScaleX },
              { scaleY: orbScaleY },
            ],
          },
        ]}
      >
        {phase === "recording" ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.ring,
              {
                borderColor: frameColor,
                opacity: ringOpacity,
                transform: [{ scaleX: ringScaleX }],
              },
            ]}
          />
        ) : null}
        <Pressable
          accessibilityLabel="Giữ để nói với trợ lý, nhấn đúp để gửi ảnh"
          accessibilityHint="Nhấn giữ để bật micro, thả tay để gửi"
          accessibilityRole="button"
          accessibilityState={{ busy: phase !== "idle" }}
          disabled={!entranceDone}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          style={({ pressed }) => [
            styles.orb,
            {
              backgroundColor:
                phase === "recording" ? frameColor : theme.surfaceRaised,
              borderColor:
                phase === "idle" ? frameColor : theme.accent,
              shadowColor: theme.shadow,
              opacity: pressed ? 0.92 : 1,
            },
          ]}
        >
          {phase === "transcribing" ? (
            <ActivityIndicator color={theme.accent} />
          ) : (
            <MaterialIcons
              name={
                phase === "recording"
                  ? "mic"
                  : phase === "streaming"
                    ? "more-horiz"
                    : "graphic-eq"
              }
              size={phase === "recording" ? 30 : 32}
              color={
                phase === "recording" ? readableTextColor(frameColor) : theme.text
              }
            />
          )}
        </Pressable>
      </Animated.View>
    </View>
  );
}

/** Memoised: a streamed answer re-renders the list on every token. */
const MessageBubble = memo(function MessageBubble({
  message,
  theme,
  frameColor,
}: {
  message: AgentChatMessage;
  theme: AppTheme;
  frameColor: string;
}) {
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const isUser = message.role === "user";
  const failed = message.status === "error";
  const streaming = message.status === "streaming";

  return (
    <View style={[styles.bubbleRow, isUser && styles.bubbleRowUser]}>
      <View
        style={[
          styles.bubble,
          isUser ? styles.bubbleUser : styles.bubbleAgent,
          {
            backgroundColor: isUser
              ? `${frameColor}1A`
              : failed
                ? theme.dangerSurface
                : theme.surface,
            borderColor: isUser ? `${frameColor}55` : theme.border,
          },
        ]}
      >
        {message.imageUri ? (
          <Image
            accessibilityIgnoresInvertColors
            resizeMode="cover"
            source={{ uri: message.imageUri }}
            style={styles.bubbleImage}
          />
        ) : null}

        {message.searches?.length ? (
          <View style={styles.searchRow}>
            <MaterialIcons name="travel-explore" size={14} color={theme.accent} />
            <Text
              numberOfLines={2}
              style={[styles.searchText, { color: theme.accent }]}
            >
              {message.searches.join(" · ")}
            </Text>
          </View>
        ) : null}

        {message.reasoning?.trim() ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: reasoningOpen }}
            onPress={() => setReasoningOpen((current) => !current)}
            style={styles.reasoningToggle}
          >
            <MaterialIcons
              name={reasoningOpen ? "expand-less" : "psychology"}
              size={15}
              color={theme.faint}
            />
            <Text style={[styles.reasoningLabel, { color: theme.faint }]}>
              {reasoningOpen ? "Ẩn suy luận" : "Xem suy luận"}
            </Text>
          </Pressable>
        ) : null}
        {reasoningOpen && message.reasoning ? (
          <Text style={[styles.reasoningText, { color: theme.faint }]}>
            {message.reasoning.trim()}
          </Text>
        ) : null}

        {message.text.trim() ? (
          <Text
            selectable
            style={[
              styles.bubbleText,
              { color: failed ? theme.danger : theme.text },
            ]}
          >
            {message.text.trim()}
          </Text>
        ) : streaming ? (
          <Text style={[styles.bubbleText, { color: theme.faint }]}>
            Đang soạn câu trả lời…
          </Text>
        ) : null}

        {message.sources?.length ? (
          <View style={styles.sources}>
            {message.sources.map((source, index) => (
              <SourceLink
                key={source.url}
                index={index + 1}
                source={source}
                theme={theme}
              />
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
});

function SourceLink({
  index,
  source,
  theme,
}: {
  index: number;
  source: AgentSource;
  theme: AppTheme;
}) {
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => {
        void Linking.openURL(source.url).catch(() => undefined);
      }}
      style={({ pressed }) => [styles.source, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Text style={[styles.sourceIndex, { color: theme.accent }]}>
        [{index}]
      </Text>
      <Text
        numberOfLines={1}
        style={[styles.sourceTitle, { color: theme.muted }]}
      >
        {source.title}
      </Text>
    </Pressable>
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
  zone: { flex: 1, paddingHorizontal: FRAME_INSET, paddingVertical: 8 },
  frame: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: 24,
    paddingHorizontal: FRAME_PADDING,
    paddingTop: 12,
    paddingBottom: 12,
  },
  frameBody: { flex: 1 },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  label: { fontSize: 11, fontWeight: "800", letterSpacing: 1.35 },
  note: { flexShrink: 1, fontSize: 10, fontWeight: "700", letterSpacing: 0.9 },
  // The last bubbles must clear the docked orb.
  messages: {
    flexGrow: 1,
    paddingTop: 14,
    paddingBottom: ORB_SIZE + 6,
    gap: 10,
  },
  bubbleRow: { flexDirection: "row" },
  bubbleRowUser: { justifyContent: "flex-end" },
  bubble: {
    maxWidth: "88%",
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 18,
    borderWidth: 1,
    gap: 7,
  },
  bubbleUser: { borderBottomRightRadius: 6 },
  bubbleAgent: { borderBottomLeftRadius: 6 },
  bubbleImage: {
    width: "100%",
    height: 168,
    borderRadius: 12,
  },
  bubbleText: { fontSize: 15, lineHeight: 22 },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  searchText: { flex: 1, fontSize: 12, fontWeight: "700" },
  reasoningToggle: { flexDirection: "row", alignItems: "center", gap: 5 },
  reasoningLabel: { fontSize: 12, fontWeight: "700" },
  reasoningText: { fontSize: 12, lineHeight: 18, fontStyle: "italic" },
  sources: { gap: 4 },
  source: { flexDirection: "row", alignItems: "center", gap: 6 },
  sourceIndex: { fontSize: 12, fontWeight: "800" },
  sourceTitle: { flex: 1, fontSize: 12 },
  hint: { paddingHorizontal: 4, paddingBottom: 6, fontSize: 12, lineHeight: 17 },
  status: {
    paddingTop: 8,
    paddingRight: ORB_SIZE + 12,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
  },
  orbAnchor: {
    position: "absolute",
    right: ORB_MARGIN,
    bottom: ORB_MARGIN,
    width: ORB_SIZE,
    height: ORB_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  ring: {
    position: "absolute",
    width: ORB_SIZE,
    height: ORB_SIZE,
    borderRadius: ORB_SIZE / 2,
    borderWidth: 2,
  },
  orb: {
    width: ORB_SIZE,
    height: ORB_SIZE,
    borderRadius: ORB_SIZE / 2,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 18,
    elevation: 7,
  },
});
