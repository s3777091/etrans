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
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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
  type AgentSettings,
} from "../settings/agent-settings";
import { LANGUAGE_META } from "../settings/translation-settings";
import type { CapturedPhoto } from "./CameraCaptureModal";
import type { AppTheme } from "./theme";

const ORB_SIZE = 78;
const ORB_MARGIN = 18;
const FRAME_INSET = 18;
const HOLD_THRESHOLD_MS = 200;
const DOUBLE_TAP_WINDOW_MS = 320;
const RISE_DURATION_MS = 360;
const FALL_DURATION_MS = 520;
const OPEN_DURATION_MS = 520;

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
}: AgentScreenProps) {
  const { width, height } = useWindowDimensions();
  const [phase, setPhase] = useState<AgentPhase>("idle");
  const [draft, setDraft] = useState("");
  const [hint, setHint] = useState<string>();
  const [entranceDone, setEntranceDone] = useState(reduceMotion);

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

  // The dock sits inside the frame padding, so the orb has that much further
  // to travel from the centre of the translate screen.
  const dockCenterX = width - FRAME_INSET - ORB_MARGIN - ORB_SIZE / 2;
  const startTranslateX = width / 2 - dockCenterX;

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

  useEffect(() => {
    if (reduceMotion) {
      entrance.setValue(1);
      open.setValue(1);
      setEntranceDone(true);
      return;
    }

    const dropOnly =
      agentEntranceForLanguage(entranceLanguageRef.current) === "drop";
    entrance.setValue(dropOnly ? 0.42 : 0);
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
  }, [entrance, landing, open, reduceMotion]);

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

  const sendText = useCallback(() => {
    const text = draft.trim();
    if (!text || phase !== "idle") return;
    turnTokenRef.current += 1;
    setDraft("");
    sendTurn({
      id: `user-${Date.now()}`,
      role: "user",
      text,
      createdAt: Date.now(),
    });
  }, [draft, phase, sendTurn]);

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
        text: draft.trim(),
        imageUri: photo.uri,
        imageDataUrl,
        createdAt: Date.now(),
      });
      setDraft("");
    } catch (error) {
      setHint(
        error instanceof Error ? error.message : "Không thể gửi ảnh lúc này",
      );
    } finally {
      photoBusyRef.current = false;
    }
  }, [draft, onRequestPhoto, sendTurn, stopStreaming]);

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
    setHint("Giữ để nói, nhấn đúp để gửi ảnh");
  }, [finishRecording, sendPhoto]);

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
  const orbTranslateY = entrance.interpolate({
    inputRange: [0, 0.42, 1],
    outputRange: [-height * 0.18, -height * 0.66, 0],
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
  const ringScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.96, 1.8],
  });

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.zone}
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
            {messages.length === 0 ? (
              <EmptyState theme={theme} settings={settings} />
            ) : (
              messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  theme={theme}
                  frameColor={frameColor}
                />
              ))
            )}
          </ScrollView>

          {hint ? (
            <Text style={[styles.hint, { color: theme.muted }]}>{hint}</Text>
          ) : null}

          <View style={styles.composer}>
            <TextInput
              accessibilityLabel="Nhắn cho trợ lý"
              multiline
              maxLength={4_000}
              value={draft}
              onChangeText={setDraft}
              placeholder="Nhắn cho trợ lý…"
              placeholderTextColor={theme.faint}
              selectionColor={theme.accent}
              style={[
                styles.input,
                {
                  backgroundColor: theme.background,
                  borderColor: theme.border,
                  color: theme.text,
                },
              ]}
            />
            <Pressable
              accessibilityLabel={
                phase === "streaming" ? "Dừng trả lời" : "Gửi tin nhắn"
              }
              accessibilityRole="button"
              onPress={() => {
                if (phase === "streaming") {
                  stopStreaming();
                  return;
                }
                sendText();
              }}
              disabled={phase !== "streaming" && !draft.trim()}
              style={({ pressed }) => [
                styles.sendButton,
                {
                  backgroundColor:
                    phase === "streaming"
                      ? theme.dangerSurface
                      : draft.trim()
                        ? frameColor
                        : theme.surface,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <MaterialIcons
                name={phase === "streaming" ? "stop" : "arrow-upward"}
                size={22}
                color={
                  phase === "streaming"
                    ? theme.danger
                    : draft.trim()
                      ? readableTextColor(frameColor)
                      : theme.faint
                }
              />
            </Pressable>
          </View>

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
                transform: [{ scale: ringScale }],
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
    </KeyboardAvoidingView>
  );
}

function EmptyState({
  theme,
  settings,
}: {
  theme: AppTheme;
  settings: AgentSettings;
}) {
  const language = LANGUAGE_META[settings.language];
  return (
    <View style={styles.empty}>
      <View
        style={[styles.emptyIcon, { backgroundColor: `${theme.accent}16` }]}
      >
        <MaterialIcons name="support-agent" size={30} color={theme.accent} />
      </View>
      <Text style={[styles.emptyTitle, { color: theme.text }]}>
        Trò chuyện bằng {language.label}
      </Text>
      <Text style={[styles.emptyNote, { color: theme.muted }]}>
        Giữ quả cầu để nói, thả tay là gửi. Nhấn đúp để chụp và gửi ảnh.
      </Text>
      <View style={styles.emptyBadges}>
        <Badge
          theme={theme}
          icon="travel-explore"
          label={settings.search ? "Tìm web bằng Exa" : "Không tìm web"}
          active={settings.search}
        />
        <Badge
          theme={theme}
          icon="psychology"
          label={settings.reasoning ? "Suy luận sâu" : "Trả lời nhanh"}
          active={settings.reasoning}
        />
      </View>
    </View>
  );
}

function Badge({
  theme,
  icon,
  label,
  active,
}: {
  theme: AppTheme;
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  active: boolean;
}) {
  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: active ? `${theme.accent}14` : theme.surface,
          borderColor: active ? `${theme.accent}55` : theme.border,
        },
      ]}
    >
      <MaterialIcons
        name={icon}
        size={15}
        color={active ? theme.accent : theme.muted}
      />
      <Text
        style={[
          styles.badgeText,
          { color: active ? theme.accent : theme.muted },
        ]}
      >
        {label}
      </Text>
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
    paddingHorizontal: 16,
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
  messages: { flexGrow: 1, paddingTop: 14, paddingBottom: 6, gap: 10 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  emptyIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: { marginTop: 4, fontSize: 17, fontWeight: "700" },
  emptyNote: {
    maxWidth: 280,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
  emptyBadges: { marginTop: 10, flexDirection: "row", gap: 8 },
  badge: {
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  badgeText: { fontSize: 12, fontWeight: "700" },
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
  composer: {
    paddingRight: ORB_SIZE + 12,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  },
  input: {
    flex: 1,
    minHeight: 46,
    maxHeight: 120,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    borderRadius: 16,
    borderWidth: 1.25,
    fontSize: 15,
    lineHeight: 20,
  },
  sendButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
  },
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
