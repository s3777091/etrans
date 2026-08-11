import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Alert,
  Animated,
  Easing,
  Image,
  type ColorSchemeName,
  type GestureResponderEvent,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  AGENT_LANGUAGES,
  MAX_AGENT_PROMPT_LENGTH,
  type AgentLanguage,
  type AgentModel,
  type AgentSettings,
} from "../settings/agent-settings";
import {
  LANGUAGE_META,
  LANGUAGE_PAIRS,
  isValidHexColor,
  languagesForPair,
  normalizeHexColor,
  pairTitle,
  type LanguagePair,
  type TranslationDisplaySettings,
  type TranslationFont,
  type TranslationProfile,
  type TranslationSettings,
  type TranslationTextColor,
  type TranslationTextSize,
} from "../settings/translation-settings";
import type { TranslationHistoryEntry } from "../history/translation-history";
import type { AgentChatMessage } from "../agent/agent-client";
import type {
  TextTranslationModel,
  TranslationLanguage,
  VoiceTranslationModel,
} from "../qwen/types";
import { darkTheme, lightTheme, type AppTheme } from "./theme";
import { resolveThemeMode, type ThemeMode } from "./theme-mode";
import { ETRANS_ICONS } from "./AppSplash";

export type { LanguagePair } from "../settings/translation-settings";

interface SettingsModalProps {
  visible: boolean;
  theme: AppTheme;
  themeMode: ThemeMode;
  systemColorScheme: ColorSchemeName;
  reduceMotion: boolean;
  settings: TranslationSettings;
  agentSettings: AgentSettings;
  history: TranslationHistoryEntry[];
  agentHistory: AgentChatMessage[];
  onThemeModeChanged: (mode: ThemeMode) => void;
  onSaveProfile: (pair: LanguagePair, profile: TranslationProfile) => void;
  onSaveFrameColors: (
    colors: Record<TranslationLanguage, string>,
  ) => void;
  onSaveDisplay: (display: TranslationDisplaySettings) => void;
  onSaveAgent: (settings: AgentSettings) => void;
  onClearHistory: () => void;
  onClearAgentHistory: () => void;
  onDeleteHistoryEntry: (entryId: string) => void;
  onDeleteAgentHistoryTurn: (messageId: string) => void;
  onRestoreHistory: (entry: TranslationHistoryEntry) => void;
  onRestoreAgentHistory: () => void;
  onClose: () => void;
}

type SettingsRoute =
  | "root"
  | "profile"
  | "colors"
  | "typography"
  | "agent"
  | "translationHistory"
  | "agentHistory";
type DropdownId = "text" | "voice" | "agentModel";

const THEME_MODES: Array<{
  id: ThemeMode;
  title: string;
  icon: "brightness-auto" | "light-mode" | "dark-mode";
}> = [
  { id: "system", title: "Tự động", icon: "brightness-auto" },
  { id: "light", title: "Sáng", icon: "light-mode" },
  { id: "dark", title: "Tối", icon: "dark-mode" },
];

const TEXT_MODEL_OPTIONS: Array<{
  value: TextTranslationModel;
  label: string;
  note: string;
}> = [
  {
    value: "qwen3.6-flash",
    label: "Qwen 3.6 Flash",
    note: "Nhanh, đủ tốt cho chữ trong ảnh",
  },
  {
    value: "qwen3.7-plus",
    label: "Qwen 3.7 Plus",
    note: "Dịch mượt hơn với câu dài",
  },
  {
    value: "qwen3.8-max",
    label: "Qwen 3.8 Max",
    note: "Chính xác cao cho nội dung chuyên môn",
  },
];

const VOICE_MODEL_OPTIONS: Array<{
  value: VoiceTranslationModel;
  label: string;
  note: string;
}> = [
  {
    value: "qwen3.5-livetranslate-flash-realtime",
    label: "Qwen 3.5 LiveTranslate",
    note: "Khuyên dùng, nhận giọng nói tốt hơn khi có nhiễu",
  },
  {
    value: "qwen3-livetranslate-flash-realtime",
    label: "Qwen 3 LiveTranslate",
    note: "Tương thích với model thế hệ trước",
  },
];

const AGENT_MODEL_OPTIONS: Array<{
  value: AgentModel;
  label: string;
  note: string;
}> = [
  {
    value: "qwen3.6-flash",
    label: "Qwen 3.6 Flash",
    note: "Nhanh, hợp cho trò chuyện hằng ngày",
  },
  {
    value: "qwen3.7-plus",
    label: "Qwen 3.7 Plus",
    note: "Cân bằng, trả lời sâu hơn",
  },
  {
    value: "qwen3.7-max",
    label: "Qwen 3.7 Max",
    note: "Suy luận tốt cho câu hỏi khó",
  },
  {
    value: "qwen3.8-max",
    label: "Qwen 3.8 Max",
    note: "Mạnh nhất, chậm và tốn hơn",
  },
];

const AGENT_LANGUAGE_LABELS: Record<AgentLanguage, string> = {
  vi: "Tiếng Việt",
  zh: "中文",
  en: "English",
};

const COLOR_PRESETS = [
  "#1C78E8",
  "#148C7B",
  "#D85A43",
  "#C94F78",
  "#7759C7",
] as const;

const FULL_COLOR_PALETTE = [
  "#EF4444",
  "#F97316",
  "#F59E0B",
  "#EAB308",
  "#84CC16",
  "#22C55E",
  "#10B981",
  "#14B8A6",
  "#06B6D4",
  "#0EA5E9",
  "#3B82F6",
  "#1C78E8",
  "#6366F1",
  "#7759C7",
  "#A855F7",
  "#D946EF",
  "#EC4899",
  "#C94F78",
  "#D85A43",
  "#64748B",
  "#475569",
  "#374151",
  "#78716C",
  "#111827",
] as const;

const TEXT_SIZE_OPTIONS: Array<{
  value: TranslationTextSize;
  label: string;
  size: number;
}> = [
  { value: "small", label: "Nhỏ", size: 22 },
  { value: "medium", label: "Vừa", size: 27 },
  { value: "large", label: "Lớn", size: 34 },
];

const FONT_OPTIONS: Array<{
  value: TranslationFont;
  label: string;
  sample: string;
  fontFamily?: string;
}> = [
  { value: "system", label: "Hệ thống", sample: "Bản dịch rõ ràng" },
  {
    value: "serif",
    label: "Serif",
    sample: "Bản dịch rõ ràng",
    fontFamily: "serif",
  },
  {
    value: "monospace",
    label: "Monospace",
    sample: "Bản dịch rõ ràng",
    fontFamily: "monospace",
  },
];

export function SettingsModal({
  visible,
  theme,
  themeMode,
  systemColorScheme,
  reduceMotion,
  settings,
  agentSettings,
  history,
  agentHistory,
  onThemeModeChanged,
  onSaveProfile,
  onSaveFrameColors,
  onSaveDisplay,
  onSaveAgent,
  onClearHistory,
  onClearAgentHistory,
  onDeleteHistoryEntry,
  onDeleteAgentHistoryTurn,
  onRestoreHistory,
  onRestoreAgentHistory,
  onClose,
}: SettingsModalProps) {
  const [route, setRoute] = useState<SettingsRoute>("root");
  const [editingPair, setEditingPair] = useState<LanguagePair>(
    settings.activePair,
  );
  const [draftProfile, setDraftProfile] = useState<TranslationProfile>({
    ...settings.profiles[settings.activePair],
  });
  const [draftColors, setDraftColors] = useState({
    ...settings.frameColors,
  });
  const [draftDisplay, setDraftDisplay] = useState<TranslationDisplaySettings>({
    ...settings.display,
    textColors: { ...settings.display.textColors },
  });
  const [draftAgent, setDraftAgent] = useState<AgentSettings>({
    ...agentSettings,
  });
  const [openDropdown, setOpenDropdown] = useState<DropdownId>();
  const [colorPickerLanguage, setColorPickerLanguage] =
    useState<TranslationLanguage>();
  const [reveal, setReveal] = useState<{
    x: number;
    y: number;
    color: string;
    colorScheme: "light" | "dark";
  }>();
  const revealProgress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    setRoute("root");
    setEditingPair(settings.activePair);
    setDraftProfile({ ...settings.profiles[settings.activePair] });
    setDraftColors({ ...settings.frameColors });
    setDraftDisplay({
      ...settings.display,
      textColors: { ...settings.display.textColors },
    });
    setDraftAgent({ ...agentSettings });
    setOpenDropdown(undefined);
    setColorPickerLanguage(undefined);
  }, [agentSettings, settings, visible]);

  useEffect(
    () => () => {
      revealProgress.stopAnimation();
    },
    [revealProgress],
  );

  const openProfile = (pair: LanguagePair) => {
    setEditingPair(pair);
    setDraftProfile({ ...settings.profiles[pair] });
    setOpenDropdown(undefined);
    setRoute("profile");
  };

  const openColors = () => {
    setDraftColors({ ...settings.frameColors });
    setColorPickerLanguage(undefined);
    setRoute("colors");
  };

  const openTypography = () => {
    setDraftDisplay({
      ...settings.display,
      textColors: { ...settings.display.textColors },
    });
    setRoute("typography");
  };

  const openAgent = () => {
    setDraftAgent({ ...agentSettings });
    setOpenDropdown(undefined);
    setRoute("agent");
  };

  const saveAgent = () => {
    onSaveAgent({ ...draftAgent, prompt: draftAgent.prompt.trim() });
    setOpenDropdown(undefined);
    setRoute("root");
  };

  const saveProfile = () => {
    onSaveProfile(editingPair, {
      ...draftProfile,
      prompt: draftProfile.prompt.trim(),
    });
    setOpenDropdown(undefined);
    setRoute("root");
  };

  const { counterpart } = languagesForPair(settings.activePair);
  const colorLanguages: TranslationLanguage[] = ["vi", counterpart.code];
  const colorsAreValid = colorLanguages.every((language) =>
    isValidHexColor(normalizeHexColor(draftColors[language])),
  );

  const saveColors = () => {
    if (!colorsAreValid) return;
    onSaveFrameColors({
      vi: normalizeHexColor(draftColors.vi),
      zh: normalizeHexColor(draftColors.zh),
      en: normalizeHexColor(draftColors.en),
    });
    setRoute("root");
  };

  const textColorsAreValid = colorLanguages.every((language) => {
    const color = draftDisplay.textColors[language];
    return color === "auto" || isValidHexColor(normalizeHexColor(color));
  });

  const saveDisplay = () => {
    if (!textColorsAreValid) return;
    onSaveDisplay({
      ...draftDisplay,
      textColors: {
        vi: normalizeTextColor(draftDisplay.textColors.vi),
        zh: normalizeTextColor(draftDisplay.textColors.zh),
        en: normalizeTextColor(draftDisplay.textColors.en),
      },
    });
    setRoute("root");
  };

  const changeTheme = (mode: ThemeMode, event: GestureResponderEvent) => {
    if (mode === themeMode) return;
    if (reduceMotion) {
      onThemeModeChanged(mode);
      return;
    }

    const nextScheme = resolveThemeMode(mode, systemColorScheme);
    const nextTheme = nextScheme === "dark" ? darkTheme : lightTheme;
    setReveal({
      x: event.nativeEvent.pageX,
      y: event.nativeEvent.pageY,
      color: nextTheme.background,
      colorScheme: nextScheme,
    });
    revealProgress.setValue(0);
    Animated.timing(revealProgress, {
      toValue: 1,
      duration: 620,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      onThemeModeChanged(mode);
      requestAnimationFrame(() => setReveal(undefined));
    });
  };

  const title =
    route === "root"
      ? "Cài đặt"
      : route === "profile"
        ? pairTitle(editingPair)
        : route === "colors"
          ? "Màu khung"
          : route === "typography"
            ? "Hiển thị bản dịch"
            : route === "agent"
              ? "Trợ lý EAgent"
              : route === "translationHistory"
                ? "Lịch sử dịch"
                : "Lịch sử Agent";

  return (
    <Modal
      animationType="slide"
      presentationStyle="pageSheet"
      visible={visible}
      onRequestClose={() => {
        if (colorPickerLanguage) {
          setColorPickerLanguage(undefined);
        } else {
          onClose();
        }
      }}
    >
      <SafeAreaView
        style={[styles.safeArea, { backgroundColor: theme.background }]}
      >
        <View style={styles.header}>
          {route === "root" ? (
            <View style={styles.headerSpacer} />
          ) : (
            <Pressable
              accessibilityLabel="Quay lại"
              accessibilityRole="button"
              onPress={() => {
                setOpenDropdown(undefined);
                setColorPickerLanguage(undefined);
                setRoute("root");
              }}
              hitSlop={8}
              style={({ pressed }) => [
                styles.iconButton,
                {
                  backgroundColor: theme.surface,
                  opacity: pressed ? 0.62 : 1,
                },
              ]}
            >
              <MaterialIcons name="arrow-back" size={22} color={theme.text} />
            </Pressable>
          )}
          <Text
            numberOfLines={1}
            style={[styles.title, { color: theme.text }]}
          >
            {title}
          </Text>
          <Pressable
            accessibilityLabel="Đóng cài đặt"
            accessibilityRole="button"
            onPress={onClose}
            hitSlop={8}
            style={({ pressed }) => [
              styles.iconButton,
              {
                backgroundColor: theme.surface,
                opacity: pressed ? 0.62 : 1,
              },
            ]}
          >
            <MaterialIcons name="close" size={22} color={theme.text} />
          </Pressable>
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.body}
        >
          {route === "root" ? (
            <RootSettings
              theme={theme}
              themeMode={themeMode}
              settings={settings}
              onThemeChanged={changeTheme}
              agentSettings={agentSettings}
              onOpenProfile={openProfile}
              onOpenColors={openColors}
              onOpenTypography={openTypography}
              onOpenAgent={openAgent}
              onOpenTranslationHistory={() => setRoute("translationHistory")}
              onOpenAgentHistory={() => setRoute("agentHistory")}
              historyCount={history.length}
              agentHistoryCount={agentHistory.filter((message) => message.role === "user").length}
            />
          ) : route === "profile" ? (
            <ProfileSettings
              theme={theme}
              pair={editingPair}
              profile={draftProfile}
              openDropdown={openDropdown}
              onDropdownChanged={setOpenDropdown}
              onProfileChanged={setDraftProfile}
              onSave={saveProfile}
            />
          ) : route === "colors" ? (
            <ColorSettings
              theme={theme}
              languages={colorLanguages}
              colors={draftColors}
              valid={colorsAreValid}
              onColorChanged={(language, color) =>
                setDraftColors((current) => ({
                  ...current,
                  [language]: color,
                }))
              }
              onOpenPalette={setColorPickerLanguage}
              onSave={saveColors}
            />
          ) : route === "typography" ? (
            <TypographySettings
              theme={theme}
              languages={colorLanguages}
              display={draftDisplay}
              valid={textColorsAreValid}
              onDisplayChanged={setDraftDisplay}
              onSave={saveDisplay}
            />
          ) : route === "agent" ? (
            <AgentSettingsView
              theme={theme}
              settings={draftAgent}
              openDropdown={openDropdown}
              onDropdownChanged={setOpenDropdown}
              onSettingsChanged={setDraftAgent}
              onSave={saveAgent}
            />
          ) : route === "translationHistory" ? (
            <HistorySettings
              theme={theme}
              history={history}
              onClear={onClearHistory}
              onDelete={onDeleteHistoryEntry}
              onRestore={onRestoreHistory}
            />
          ) : (
            <AgentHistorySettings
              theme={theme}
              history={agentHistory}
              onClear={onClearAgentHistory}
              onDeleteTurn={onDeleteAgentHistoryTurn}
              onRestore={onRestoreAgentHistory}
            />
          )}
        </KeyboardAvoidingView>

        {route === "colors" && colorPickerLanguage ? (
          <ColorPickerOverlay
            key={colorPickerLanguage}
            theme={theme}
            language={colorPickerLanguage}
            value={draftColors[colorPickerLanguage]}
            onApply={(color) => {
              setDraftColors((current) => ({
                ...current,
                [colorPickerLanguage]: color,
              }));
              setColorPickerLanguage(undefined);
            }}
            onClose={() => setColorPickerLanguage(undefined)}
          />
        ) : null}

        {reveal ? (
          <>
            <Animated.View
              pointerEvents="none"
              style={[
                styles.themeReveal,
                {
                  backgroundColor: reveal.color,
                  left: reveal.x - 14,
                  top: reveal.y - 14,
                  transform: [
                    {
                      scale: revealProgress.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.01, 54],
                      }),
                    },
                  ],
                },
              ]}
            />
            <Animated.View
              pointerEvents="none"
              style={[
                styles.themeRevealBrand,
                {
                  opacity: revealProgress.interpolate({
                    inputRange: [0, 0.28, 0.62, 1],
                    outputRange: [0, 0, 1, 1],
                  }),
                  transform: [
                    {
                      scale: revealProgress.interpolate({
                        inputRange: [0, 0.28, 0.7, 1],
                        outputRange: [0.72, 0.72, 1.08, 1],
                      }),
                    },
                  ],
                },
              ]}
            >
              <Image
                accessibilityIgnoresInvertColors
                resizeMode="contain"
                source={ETRANS_ICONS[reveal.colorScheme]}
                style={styles.themeRevealIcon}
              />
            </Animated.View>
          </>
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

function RootSettings({
  theme,
  themeMode,
  settings,
  agentSettings,
  onThemeChanged,
  onOpenProfile,
  onOpenColors,
  onOpenTypography,
  onOpenAgent,
  onOpenTranslationHistory,
  onOpenAgentHistory,
  historyCount,
  agentHistoryCount,
}: {
  theme: AppTheme;
  themeMode: ThemeMode;
  settings: TranslationSettings;
  agentSettings: AgentSettings;
  onThemeChanged: (mode: ThemeMode, event: GestureResponderEvent) => void;
  onOpenProfile: (pair: LanguagePair) => void;
  onOpenColors: () => void;
  onOpenTypography: () => void;
  onOpenAgent: () => void;
  onOpenTranslationHistory: () => void;
  onOpenAgentHistory: () => void;
  historyCount: number;
  agentHistoryCount: number;
}) {
  const { counterpart } = languagesForPair(settings.activePair);
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.section}>
        <SectionTitle icon="contrast" title="Giao diện" theme={theme} />
        <Text style={[styles.helper, { color: theme.muted }]}>
          Chọn sáng, tối hoặc tự động theo điện thoại.
        </Text>
        <View
          accessibilityRole="radiogroup"
          style={[
            styles.themePicker,
            {
              backgroundColor: theme.surfaceRaised,
              borderColor: theme.border,
            },
          ]}
        >
          {THEME_MODES.map((mode) => {
            const selected = mode.id === themeMode;
            return (
              <Pressable
                key={mode.id}
                accessibilityLabel={`Giao diện ${mode.title.toLowerCase()}`}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={(event) => onThemeChanged(mode.id, event)}
                style={({ pressed }) => [
                  styles.themeChoice,
                  {
                    backgroundColor: selected
                      ? `${theme.accent}1F`
                      : "transparent",
                    opacity: pressed ? 0.64 : 1,
                  },
                ]}
              >
                <MaterialIcons
                  name={mode.icon}
                  size={19}
                  color={selected ? theme.accent : theme.muted}
                />
                <Text
                  style={[
                    styles.themeChoiceText,
                    { color: selected ? theme.accent : theme.muted },
                  ]}
                >
                  {mode.title}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.section}>
        <SectionTitle icon="translate" title="Dịch thuật" theme={theme} />
        <Text style={[styles.helper, { color: theme.muted }]}>
          Chạm một cặp ngôn ngữ để chọn model và thêm yêu cầu dịch.
        </Text>
        <View style={styles.options}>
          {LANGUAGE_PAIRS.map((pair) => (
            <NavigationRow
              key={pair}
              theme={theme}
              title={pairTitle(pair)}
              note={
                pair === settings.activePair
                  ? "Đang dùng trên toàn ứng dụng"
                  : "Chạm để thiết lập"
              }
              selected={pair === settings.activePair}
              onPress={() => onOpenProfile(pair)}
            />
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <SectionTitle
          icon="format-size"
          title="Hiển thị bản dịch"
          theme={theme}
        />
        <Text style={[styles.helper, { color: theme.muted }]}>
          Chỉnh cỡ chữ, màu chữ và font cho hai khung dịch.
        </Text>
        <View style={styles.options}>
          <NavigationRow
            theme={theme}
            title="Chữ trong khung dịch"
            note={`${textSizeLabel(settings.display.textSize)} • ${fontLabel(settings.display.font)}`}
            onPress={onOpenTypography}
            leading={
              <MaterialIcons
                name="text-fields"
                size={25}
                color={theme.accent}
              />
            }
          />
        </View>
      </View>

      <View style={styles.section}>
        <SectionTitle icon="palette" title="Màu khung" theme={theme} />
        <Text style={[styles.helper, { color: theme.muted }]}>
          Chọn màu riêng cho từng ngôn ngữ đang dùng.
        </Text>
        <View style={styles.options}>
          <NavigationRow
            theme={theme}
            title={`Tiếng Việt và ${counterpart.label}`}
            note="Màu viền khung dịch"
            onPress={onOpenColors}
            leading={
              <View style={styles.miniSwatches}>
                {["vi", counterpart.code].map((language) => (
                  <View
                    key={language}
                    style={[
                      styles.miniSwatch,
                      {
                        backgroundColor:
                          settings.frameColors[
                            language as TranslationLanguage
                          ],
                        borderColor: theme.background,
                      },
                    ]}
                  />
                ))}
              </View>
            }
          />
        </View>
      </View>

      <View style={styles.section}>
        <SectionTitle icon="support-agent" title="Trợ lý EAgent" theme={theme} />
        <Text style={[styles.helper, { color: theme.muted }]}>
          Chọn ngôn ngữ trò chuyện, model, suy luận và tìm kiếm web.
        </Text>
        <View style={styles.options}>
          <NavigationRow
            theme={theme}
            title={`Trò chuyện bằng ${AGENT_LANGUAGE_LABELS[agentSettings.language]}`}
            note={`${agentModelLabel(agentSettings.model)} • ${
              agentSettings.reasoning ? "Suy luận sâu" : "Trả lời nhanh"
            } • ${agentSettings.search ? "Có tìm web" : "Không tìm web"}`}
            onPress={onOpenAgent}
            leading={
              <MaterialIcons
                name="support-agent"
                size={25}
                color={theme.accent}
              />
            }
          />
        </View>
      </View>

      <View style={styles.section}>
        <SectionTitle icon="history" title="Lịch sử" theme={theme} />
        <Text style={[styles.helper, { color: theme.muted }]}>
          Xem riêng lịch sử phiên dịch và trò chuyện EAgent.
        </Text>
        <View style={styles.options}>
          <NavigationRow
            theme={theme}
            title="Lịch sử dịch"
            note={
              historyCount > 0
                ? `${historyCount} bản dịch gần đây`
                : "Chưa có bản dịch nào"
            }
            onPress={onOpenTranslationHistory}
            leading={
              <MaterialIcons name="translate" size={25} color={theme.accent} />
            }
          />
          <NavigationRow
            theme={theme}
            title="Lịch sử Agent"
            note={
              agentHistoryCount > 0
                ? `${agentHistoryCount} lượt trò chuyện gần đây`
                : "Chưa có cuộc trò chuyện nào"
            }
            onPress={onOpenAgentHistory}
            leading={
              <MaterialIcons
                name="support-agent"
                size={25}
                color={theme.accent}
              />
            }
          />
        </View>
      </View>

    </ScrollView>
  );
}

function ProfileSettings({
  theme,
  pair,
  profile,
  openDropdown,
  onDropdownChanged,
  onProfileChanged,
  onSave,
}: {
  theme: AppTheme;
  pair: LanguagePair;
  profile: TranslationProfile;
  openDropdown: DropdownId | undefined;
  onDropdownChanged: (id: DropdownId | undefined) => void;
  onProfileChanged: (profile: TranslationProfile) => void;
  onSave: () => void;
}) {
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View
        style={[
          styles.profileIntro,
          {
            backgroundColor: `${theme.accent}12`,
            borderColor: `${theme.accent}55`,
          },
        ]}
      >
        <MaterialIcons name="sync-alt" size={22} color={theme.accent} />
        <View style={styles.profileIntroCopy}>
          <Text style={[styles.profileIntroTitle, { color: theme.text }]}>
            {pairTitle(pair)}
          </Text>
          <Text style={[styles.profileIntroNote, { color: theme.muted }]}>
            Bấm Lưu để áp dụng thiết lập này cho toàn ứng dụng.
          </Text>
        </View>
      </View>

      <View style={styles.section}>
        <FieldLabel theme={theme} label="Model dịch chữ và ảnh" />
        <DropdownField
          theme={theme}
          value={profile.textModel}
          options={TEXT_MODEL_OPTIONS}
          expanded={openDropdown === "text"}
          onToggle={() =>
            onDropdownChanged(openDropdown === "text" ? undefined : "text")
          }
          onSelect={(value) => {
            onProfileChanged({ ...profile, textModel: value });
            onDropdownChanged(undefined);
          }}
        />
      </View>

      <View style={styles.section}>
        <FieldLabel theme={theme} label="Model dịch giọng nói" />
        <DropdownField
          theme={theme}
          value={profile.voiceModel}
          options={VOICE_MODEL_OPTIONS}
          expanded={openDropdown === "voice"}
          onToggle={() =>
            onDropdownChanged(openDropdown === "voice" ? undefined : "voice")
          }
          onSelect={(value) => {
            onProfileChanged({ ...profile, voiceModel: value });
            onDropdownChanged(undefined);
          }}
        />
      </View>

      <View style={styles.section}>
        <FieldLabel theme={theme} label="Yêu cầu dịch" />
        <Text style={[styles.helper, { color: theme.muted }]}>
          Không bắt buộc. Có thể thêm văn phong, thuật ngữ hoặc cách xưng hô.
        </Text>
        <TextInput
          accessibilityLabel="Yêu cầu dịch"
          multiline
          maxLength={800}
          value={profile.prompt}
          onChangeText={(prompt) => onProfileChanged({ ...profile, prompt })}
          placeholder="Ví dụ: Dịch tự nhiên, giữ nguyên tên riêng, số, giá và đơn vị."
          placeholderTextColor={theme.faint}
          selectionColor={theme.accent}
          textAlignVertical="top"
          style={[
            styles.promptInput,
            {
              backgroundColor: theme.surfaceRaised,
              borderColor: theme.border,
              color: theme.text,
            },
          ]}
        />
      </View>

      <SaveButton theme={theme} onPress={onSave} />
    </ScrollView>
  );
}

function AgentSettingsView({
  theme,
  settings,
  openDropdown,
  onDropdownChanged,
  onSettingsChanged,
  onSave,
}: {
  theme: AppTheme;
  settings: AgentSettings;
  openDropdown: DropdownId | undefined;
  onDropdownChanged: (id: DropdownId | undefined) => void;
  onSettingsChanged: (settings: AgentSettings) => void;
  onSave: () => void;
}) {
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View
        style={[
          styles.profileIntro,
          {
            backgroundColor: `${theme.accent}12`,
            borderColor: `${theme.accent}55`,
          },
        ]}
      >
        <MaterialIcons name="support-agent" size={22} color={theme.accent} />
        <View style={styles.profileIntroCopy}>
          <Text style={[styles.profileIntroTitle, { color: theme.text }]}>
            EAgent
          </Text>
          <Text style={[styles.profileIntroNote, { color: theme.muted }]}>
            Ngôn ngữ mặc định quyết định cả cách quả cầu rơi vào khung chat.
          </Text>
        </View>
      </View>

      <View style={styles.section}>
        <FieldLabel theme={theme} label="Ngôn ngữ mặc định" />
        <Text style={[styles.helper, { color: theme.muted }]}>
          Tiếng Việt: quả cầu rơi thẳng xuống. Ngôn ngữ khác: quả cầu bay lên
          rồi mới rơi xuống.
        </Text>
        <View
          accessibilityRole="radiogroup"
          style={[
            styles.themePicker,
            { backgroundColor: theme.surfaceRaised, borderColor: theme.border },
          ]}
        >
          {AGENT_LANGUAGES.map((language) => {
            const selected = language === settings.language;
            return (
              <Pressable
                key={language}
                accessibilityLabel={`Trò chuyện bằng ${AGENT_LANGUAGE_LABELS[language]}`}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => onSettingsChanged({ ...settings, language })}
                style={({ pressed }) => [
                  styles.themeChoice,
                  {
                    backgroundColor: selected
                      ? `${theme.accent}1F`
                      : "transparent",
                    opacity: pressed ? 0.64 : 1,
                  },
                ]}
              >
                <MaterialIcons
                  name={language === "vi" ? "south" : "swap-vert"}
                  size={19}
                  color={selected ? theme.accent : theme.muted}
                />
                <Text
                  style={[
                    styles.themeChoiceText,
                    { color: selected ? theme.accent : theme.muted },
                  ]}
                >
                  {AGENT_LANGUAGE_LABELS[language]}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.section}>
        <FieldLabel theme={theme} label="Model trợ lý" />
        <DropdownField
          theme={theme}
          value={settings.model}
          options={AGENT_MODEL_OPTIONS}
          expanded={openDropdown === "agentModel"}
          onToggle={() =>
            onDropdownChanged(
              openDropdown === "agentModel" ? undefined : "agentModel",
            )
          }
          onSelect={(model) => {
            onSettingsChanged({ ...settings, model });
            onDropdownChanged(undefined);
          }}
        />
      </View>

      <View style={styles.section}>
        <FieldLabel theme={theme} label="Cách trả lời" />
        <View style={styles.options}>
          <ToggleRow
            theme={theme}
            icon="psychology"
            title="Suy luận trước khi trả lời"
            note="Chậm hơn nhưng chắc chắn hơn với câu hỏi khó"
            value={settings.reasoning}
            onValueChange={(reasoning) =>
              onSettingsChanged({ ...settings, reasoning })
            }
          />
          <ToggleRow
            theme={theme}
            icon="travel-explore"
            title="Tìm kiếm web"
            note="Dùng Exa để tra thông tin mới, cần EXA_API_KEY trên máy chủ"
            value={settings.search}
            onValueChange={(search) =>
              onSettingsChanged({ ...settings, search })
            }
          />
        </View>
      </View>

      <View style={styles.section}>
        <FieldLabel theme={theme} label="Lời nhắc hệ thống" />
        <Text style={[styles.helper, { color: theme.muted }]}>
          Không bắt buộc. Mô tả vai trò, văn phong hoặc cách xưng hô bạn muốn.
        </Text>
        <TextInput
          accessibilityLabel="Lời nhắc hệ thống"
          multiline
          maxLength={MAX_AGENT_PROMPT_LENGTH}
          value={settings.prompt}
          onChangeText={(prompt) => onSettingsChanged({ ...settings, prompt })}
          placeholder="Ví dụ: Bạn là trợ lý du lịch, trả lời ngắn gọn và gợi ý địa điểm gần tôi."
          placeholderTextColor={theme.faint}
          selectionColor={theme.accent}
          textAlignVertical="top"
          style={[
            styles.promptInput,
            {
              backgroundColor: theme.surfaceRaised,
              borderColor: theme.border,
              color: theme.text,
            },
          ]}
        />
      </View>

      <SaveButton theme={theme} onPress={onSave} />
    </ScrollView>
  );
}

function ToggleRow({
  theme,
  icon,
  title,
  note,
  value,
  onValueChange,
}: {
  theme: AppTheme;
  icon: keyof typeof MaterialIcons.glyphMap;
  title: string;
  note: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View
      style={[
        styles.navigationRow,
        {
          backgroundColor: value ? `${theme.accent}12` : theme.surfaceRaised,
          borderColor: value ? theme.accent : theme.border,
        },
      ]}
    >
      <MaterialIcons
        name={icon}
        size={25}
        color={value ? theme.accent : theme.muted}
      />
      <View style={styles.navigationCopy}>
        <Text style={[styles.navigationTitle, { color: theme.text }]}>
          {title}
        </Text>
        <Text
          style={[
            styles.navigationNote,
            { color: value ? theme.accent : theme.muted },
          ]}
        >
          {note}
        </Text>
      </View>
      <Switch
        accessibilityLabel={title}
        value={value}
        onValueChange={onValueChange}
        thumbColor={value ? theme.accent : theme.surface}
        trackColor={{ false: theme.border, true: `${theme.accent}66` }}
      />
    </View>
  );
}

function agentModelLabel(model: AgentModel): string {
  return (
    AGENT_MODEL_OPTIONS.find((option) => option.value === model)?.label ?? model
  );
}

function ColorSettings({
  theme,
  languages,
  colors,
  valid,
  onColorChanged,
  onOpenPalette,
  onSave,
}: {
  theme: AppTheme;
  languages: TranslationLanguage[];
  colors: Record<TranslationLanguage, string>;
  valid: boolean;
  onColorChanged: (language: TranslationLanguage, color: string) => void;
  onOpenPalette: (language: TranslationLanguage) => void;
  onSave: () => void;
}) {
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[styles.colorIntro, { color: theme.muted }]}>
        Mỗi khung giữ một màu riêng. Khi đổi cặp dịch, tên ngôn ngữ ở đây cũng đổi theo.
      </Text>
      {languages.map((language) => {
        const color = colors[language];
        const inputValid = isValidHexColor(normalizeHexColor(color));
        return (
          <View
            key={language}
            style={[
              styles.colorCard,
              {
                backgroundColor: theme.surfaceRaised,
                borderColor: theme.border,
              },
            ]}
          >
            <View style={styles.colorCardHeader}>
              <Pressable
                accessibilityLabel={`Mở bảng màu ${LANGUAGE_META[language].label}`}
                accessibilityRole="button"
                hitSlop={6}
                onPress={() => onOpenPalette(language)}
                style={({ pressed }) => [
                  styles.colorPreviewButton,
                  {
                    backgroundColor: theme.background,
                    borderColor: theme.border,
                    opacity: pressed ? 0.66 : 1,
                    transform: [{ scale: pressed ? 0.94 : 1 }],
                  },
                ]}
              >
                <View
                  style={[
                    styles.colorPreview,
                    { backgroundColor: inputValid ? color : theme.border },
                  ]}
                />
                <View
                  style={[
                    styles.colorPreviewBadge,
                    { backgroundColor: theme.surfaceRaised },
                  ]}
                >
                  <MaterialIcons name="palette" size={11} color={theme.text} />
                </View>
              </Pressable>
              <View style={styles.colorCardCopy}>
                <Text style={[styles.colorTitle, { color: theme.text }]}>
                  {LANGUAGE_META[language].label}
                </Text>
                <Text style={[styles.colorNative, { color: theme.muted }]}>
                  {LANGUAGE_META[language].nativeLabel}
                </Text>
              </View>
              <TextInput
                accessibilityLabel={`Mã màu ${LANGUAGE_META[language].label}`}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={7}
                value={color}
                onChangeText={(value) => onColorChanged(language, value)}
                selectionColor={theme.accent}
                style={[
                  styles.hexInput,
                  {
                    backgroundColor: theme.background,
                    borderColor: inputValid ? theme.border : theme.danger,
                    color: theme.text,
                  },
                ]}
              />
            </View>
            <View style={styles.palette}>
              {COLOR_PRESETS.map((preset) => {
                const selected = normalizeHexColor(color) === preset;
                return (
                  <Pressable
                    key={preset}
                    accessibilityLabel={`Chọn màu ${preset}`}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    onPress={() => onColorChanged(language, preset)}
                    style={({ pressed }) => [
                      styles.swatchTouch,
                      { opacity: pressed ? 0.62 : 1 },
                    ]}
                  >
                    <View
                      style={[
                        styles.swatch,
                        {
                          backgroundColor: preset,
                          borderColor: selected ? theme.text : "transparent",
                        },
                      ]}
                    >
                      {selected ? (
                        <MaterialIcons name="check" size={17} color="#FFFFFF" />
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>
        );
      })}

      {!valid ? (
        <Text style={[styles.validation, { color: theme.danger }]}>
          Mã màu phải có dạng #RRGGBB.
        </Text>
      ) : null}
      <SaveButton theme={theme} onPress={onSave} disabled={!valid} />
    </ScrollView>
  );
}

function ColorPickerOverlay({
  theme,
  language,
  value,
  onApply,
  onClose,
}: {
  theme: AppTheme;
  language: TranslationLanguage;
  value: string;
  onApply: (color: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(
    isValidHexColor(value) ? normalizeHexColor(value) : "",
  );
  const valid = isValidHexColor(normalizeHexColor(draft));
  const normalizedDraft = valid ? normalizeHexColor(draft) : undefined;

  return (
    <View style={styles.colorPickerOverlay}>
      <Pressable
        accessibilityLabel="Đóng bảng màu"
        accessibilityRole="button"
        onPress={onClose}
        style={styles.colorPickerBackdrop}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        pointerEvents="box-none"
        style={styles.colorPickerKeyboard}
      >
        <View
          accessibilityViewIsModal
          style={[
            styles.colorPickerSheet,
            {
              backgroundColor: theme.surfaceRaised,
              borderColor: theme.border,
              shadowColor: theme.shadow,
            },
          ]}
        >
          <View style={styles.colorPickerHeader}>
            <View style={styles.colorPickerHeaderCopy}>
              <Text style={[styles.colorPickerTitle, { color: theme.text }]}>
                Bảng màu
              </Text>
              <Text style={[styles.colorPickerNote, { color: theme.muted }]}>
                Chọn màu cho {LANGUAGE_META[language].label}
              </Text>
            </View>
            <Pressable
              accessibilityLabel="Đóng bảng màu"
              accessibilityRole="button"
              hitSlop={8}
              onPress={onClose}
              style={({ pressed }) => [
                styles.colorPickerClose,
                {
                  backgroundColor: theme.background,
                  opacity: pressed ? 0.62 : 1,
                },
              ]}
            >
              <MaterialIcons name="close" size={21} color={theme.text} />
            </Pressable>
          </View>

          <View style={styles.fullPalette} accessibilityRole="radiogroup">
            {FULL_COLOR_PALETTE.map((color) => {
              const selected = normalizedDraft === color;
              return (
                <Pressable
                  key={color}
                  accessibilityLabel={`Chọn màu ${color}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => setDraft(color)}
                  style={({ pressed }) => [
                    styles.fullSwatchTouch,
                    { opacity: pressed ? 0.58 : 1 },
                  ]}
                >
                  <View
                    style={[
                      styles.fullSwatch,
                      {
                        backgroundColor: color,
                        borderColor: selected ? theme.text : `${theme.text}18`,
                        transform: [{ scale: selected ? 1.08 : 1 }],
                      },
                    ]}
                  >
                    {selected ? (
                      <MaterialIcons
                        name="check"
                        size={19}
                        color={contrastTextForColor(color)}
                      />
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>

          <Text style={[styles.colorPickerFieldLabel, { color: theme.text }]}>
            Mã màu tùy chỉnh
          </Text>
          <View style={styles.colorPickerInputRow}>
            <View
              style={[
                styles.colorPickerCurrent,
                {
                  backgroundColor: normalizedDraft ?? theme.border,
                  borderColor: theme.border,
                },
              ]}
            />
            <TextInput
              accessibilityLabel={`Mã màu tùy chỉnh ${LANGUAGE_META[language].label}`}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={7}
              value={draft}
              onChangeText={setDraft}
              placeholder="#RRGGBB"
              placeholderTextColor={theme.faint}
              selectionColor={theme.accent}
              style={[
                styles.colorPickerInput,
                {
                  backgroundColor: theme.background,
                  borderColor: valid ? theme.border : theme.danger,
                  color: theme.text,
                },
              ]}
            />
          </View>

          <View style={styles.colorPickerActions}>
            <Pressable
              accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => [
                styles.colorPickerAction,
                {
                  backgroundColor: theme.background,
                  borderColor: theme.border,
                  opacity: pressed ? 0.66 : 1,
                },
              ]}
            >
              <Text style={[styles.colorPickerCancelText, { color: theme.text }]}>
                Hủy
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !valid }}
              disabled={!valid}
              onPress={() => normalizedDraft && onApply(normalizedDraft)}
              style={({ pressed }) => [
                styles.colorPickerAction,
                {
                  backgroundColor: valid ? theme.accent : theme.border,
                  borderColor: valid ? theme.accent : theme.border,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <MaterialIcons
                name="check"
                size={19}
                color={theme.accentText}
              />
              <Text
                style={[
                  styles.colorPickerApplyText,
                  { color: theme.accentText },
                ]}
              >
                Áp dụng
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function TypographySettings({
  theme,
  languages,
  display,
  valid,
  onDisplayChanged,
  onSave,
}: {
  theme: AppTheme;
  languages: TranslationLanguage[];
  display: TranslationDisplaySettings;
  valid: boolean;
  onDisplayChanged: (display: TranslationDisplaySettings) => void;
  onSave: () => void;
}) {
  const changeTextColor = (
    language: TranslationLanguage,
    color: TranslationTextColor,
  ) => {
    onDisplayChanged({
      ...display,
      textColors: { ...display.textColors, [language]: color },
    });
  };

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.section}>
        <FieldLabel theme={theme} label="Cỡ chữ" />
        <Text style={[styles.helper, { color: theme.muted }]}>
          Áp dụng cho nội dung dịch ở cả hai khung.
        </Text>
        <View
          accessibilityRole="radiogroup"
          style={[
            styles.textSizePicker,
            { backgroundColor: theme.surfaceRaised, borderColor: theme.border },
          ]}
        >
          {TEXT_SIZE_OPTIONS.map((option) => {
            const selected = option.value === display.textSize;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() =>
                  onDisplayChanged({ ...display, textSize: option.value })
                }
                style={({ pressed }) => [
                  styles.textSizeChoice,
                  {
                    backgroundColor: selected
                      ? `${theme.accent}1F`
                      : "transparent",
                    opacity: pressed ? 0.62 : 1,
                  },
                ]}
              >
                <Text
                  style={{
                    color: selected ? theme.accent : theme.text,
                    fontSize: Math.min(option.size, 24),
                    fontWeight: "700",
                  }}
                >
                  A
                </Text>
                <Text
                  style={[
                    styles.textSizeLabel,
                    { color: selected ? theme.accent : theme.muted },
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.section}>
        <FieldLabel theme={theme} label="Font chữ" />
        <View
          style={[
            styles.fontList,
            { backgroundColor: theme.surfaceRaised, borderColor: theme.border },
          ]}
        >
          {FONT_OPTIONS.map((option, index) => {
            const selected = option.value === display.font;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() =>
                  onDisplayChanged({ ...display, font: option.value })
                }
                style={({ pressed }) => [
                  styles.fontRow,
                  index > 0 && {
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: theme.border,
                  },
                  { opacity: pressed ? 0.62 : 1 },
                ]}
              >
                <View style={styles.fontCopy}>
                  <Text style={[styles.fontLabel, { color: theme.text }]}>
                    {option.label}
                  </Text>
                  <Text
                    style={[
                      styles.fontSample,
                      { color: theme.muted, fontFamily: option.fontFamily },
                    ]}
                  >
                    {option.sample}
                  </Text>
                </View>
                <MaterialIcons
                  name={selected ? "radio-button-checked" : "radio-button-unchecked"}
                  size={23}
                  color={selected ? theme.accent : theme.faint}
                />
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.section}>
        <FieldLabel theme={theme} label="Màu chữ" />
        <Text style={[styles.helper, { color: theme.muted }]}>
          Tự động sẽ đổi màu theo giao diện sáng hoặc tối.
        </Text>
        {languages.map((language) => {
          const color = display.textColors[language];
          const automatic = color === "auto";
          const customValid = automatic || isValidHexColor(normalizeHexColor(color));
          return (
            <View
              key={language}
              style={[
                styles.textColorGroup,
                { borderBottomColor: theme.border },
              ]}
            >
              <Text style={[styles.colorTitle, { color: theme.text }]}>
                {LANGUAGE_META[language].label}
              </Text>
              <View style={styles.textPalette}>
                <Pressable
                  accessibilityLabel={`Màu chữ tự động cho ${LANGUAGE_META[language].label}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: automatic }}
                  onPress={() => changeTextColor(language, "auto")}
                  style={({ pressed }) => [
                    styles.autoColor,
                    {
                      backgroundColor: automatic
                        ? `${theme.accent}1F`
                        : theme.surfaceRaised,
                      borderColor: automatic ? theme.accent : theme.border,
                      opacity: pressed ? 0.62 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.autoColorText,
                      { color: automatic ? theme.accent : theme.muted },
                    ]}
                  >
                    Tự động
                  </Text>
                </Pressable>
                {COLOR_PRESETS.map((preset) => {
                  const selected = !automatic && normalizeHexColor(color) === preset;
                  return (
                    <Pressable
                      key={preset}
                      accessibilityLabel={`Chọn màu chữ ${preset}`}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      onPress={() => changeTextColor(language, preset)}
                      style={({ pressed }) => [
                        styles.textSwatchTouch,
                        { opacity: pressed ? 0.62 : 1 },
                      ]}
                    >
                      <View
                        style={[
                          styles.textSwatch,
                          {
                            backgroundColor: preset,
                            borderColor: selected ? theme.text : "transparent",
                          },
                        ]}
                      />
                    </Pressable>
                  );
                })}
              </View>
              <TextInput
                accessibilityLabel={`Mã màu chữ ${LANGUAGE_META[language].label}`}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={7}
                value={automatic ? "" : color}
                onChangeText={(value) => changeTextColor(language, value)}
                placeholder="#RRGGBB"
                placeholderTextColor={theme.faint}
                selectionColor={theme.accent}
                style={[
                  styles.textColorInput,
                  {
                    backgroundColor: theme.surfaceRaised,
                    borderColor: customValid ? theme.border : theme.danger,
                    color: theme.text,
                  },
                ]}
              />
            </View>
          );
        })}
      </View>

      {!valid ? (
        <Text style={[styles.validation, { color: theme.danger }]}>
          Mã màu chữ phải có dạng #RRGGBB.
        </Text>
      ) : null}
      <SaveButton theme={theme} onPress={onSave} disabled={!valid} />
    </ScrollView>
  );
}

function HistorySettings({
  theme,
  history,
  onClear,
  onDelete,
  onRestore,
}: {
  theme: AppTheme;
  history: TranslationHistoryEntry[];
  onClear: () => void;
  onDelete: (entryId: string) => void;
  onRestore: (entry: TranslationHistoryEntry) => void;
}) {
  const confirmClear = () => {
    Alert.alert(
      "Xóa lịch sử dịch?",
      "Các bản dịch đã lưu trên thiết bị sẽ bị xóa.",
      [
        { text: "Hủy", style: "cancel" },
        { text: "Xóa", style: "destructive", onPress: onClear },
      ],
    );
  };
  const confirmDelete = (entry: TranslationHistoryEntry) => {
    Alert.alert(
      "Xóa bản dịch này?",
      "Bản dịch đã chọn sẽ bị xóa khỏi lịch sử trên thiết bị.",
      [
        { text: "Hủy", style: "cancel" },
        {
          text: "Xóa",
          style: "destructive",
          onPress: () => onDelete(entry.id),
        },
      ],
    );
  };

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {history.length === 0 ? (
        <View style={styles.historyEmpty}>
          <View
            style={[
              styles.historyEmptyIcon,
              { backgroundColor: `${theme.accent}16` },
            ]}
          >
            <MaterialIcons name="history" size={31} color={theme.accent} />
          </View>
          <Text style={[styles.historyEmptyTitle, { color: theme.text }]}>
            Chưa có lịch sử dịch
          </Text>
          <Text style={[styles.historyEmptyNote, { color: theme.muted }]}>
            Bản dịch giọng nói và hình ảnh sẽ tự động xuất hiện ở đây.
          </Text>
        </View>
      ) : (
        <>
          <Text style={[styles.historyIntro, { color: theme.muted }]}>
            {history.length} bản dịch gần nhất. Chạm một mục để nạp lại.
          </Text>
          <View
            style={[
              styles.historyList,
              { backgroundColor: theme.surfaceRaised, borderColor: theme.border },
            ]}
          >
            {history.map((entry, index) => (
              <View
                key={entry.id}
                style={[
                  styles.historyItem,
                  index > 0 && {
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: theme.border,
                  },
                ]}
              >
                <View style={styles.historyMetaRow}>
                  <View style={styles.historyKindRow}>
                    <MaterialIcons
                      name={entry.kind === "image" ? "photo-camera" : "mic"}
                      size={16}
                      color={theme.accent}
                    />
                    <Text style={[styles.historyMeta, { color: theme.accent }]}>
                      {entry.kind === "image" ? "Ảnh" : "Giọng nói"}
                    </Text>
                  </View>
                  <Text style={[styles.historyDate, { color: theme.faint }]}>
                    {formatHistoryDate(entry.createdAt)}
                  </Text>
                </View>
                <Text style={[styles.historyPair, { color: theme.muted }]}>
                  {pairTitle(entry.pair)}
                </Text>
                <Text style={[styles.historyLanguage, { color: theme.muted }]}>
                  {historyLanguageLabel(entry.sourceLanguage)}
                </Text>
                <Text
                  numberOfLines={3}
                  style={[styles.historySource, { color: theme.text }]}
                >
                  {entry.sourceText}
                </Text>
                <View style={styles.historyTargetRow}>
                  <MaterialIcons name="south" size={16} color={theme.faint} />
                  <Text style={[styles.historyLanguage, { color: theme.muted }]}>
                    {LANGUAGE_META[entry.targetLanguage].label}
                  </Text>
                </View>
                <Text
                  numberOfLines={4}
                  style={[styles.historyTranslation, { color: theme.text }]}
                >
                  {entry.translatedText}
                </Text>
                <View style={styles.historyItemActions}>
                  <Pressable
                    accessibilityLabel={`Nạp lại bản dịch ${entry.sourceText}`}
                    accessibilityRole="button"
                    onPress={() => onRestore(entry)}
                    style={({ pressed }) => [
                      styles.historyItemAction,
                      {
                        backgroundColor: `${theme.accent}14`,
                        opacity: pressed ? 0.62 : 1,
                      },
                    ]}
                  >
                    <MaterialIcons name="replay" size={16} color={theme.accent} />
                    <Text
                      style={[styles.historyActionText, { color: theme.accent }]}
                    >
                      Nạp lại
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityLabel={`Xóa bản dịch ${entry.sourceText}`}
                    accessibilityRole="button"
                    onPress={() => confirmDelete(entry)}
                    style={({ pressed }) => [
                      styles.historyItemAction,
                      {
                        backgroundColor: theme.dangerSurface,
                        opacity: pressed ? 0.62 : 1,
                      },
                    ]}
                  >
                    <MaterialIcons
                      name="delete-outline"
                      size={17}
                      color={theme.danger}
                    />
                    <Text
                      style={[styles.historyActionText, { color: theme.danger }]}
                    >
                      Xóa
                    </Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={confirmClear}
            style={({ pressed }) => [
              styles.clearHistoryButton,
              {
                backgroundColor: theme.dangerSurface,
                opacity: pressed ? 0.68 : 1,
              },
            ]}
          >
            <MaterialIcons name="delete-outline" size={20} color={theme.danger} />
            <Text style={[styles.clearHistoryText, { color: theme.danger }]}>
              Xóa lịch sử
            </Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

function AgentHistorySettings({
  theme,
  history,
  onClear,
  onDeleteTurn,
  onRestore,
}: {
  theme: AppTheme;
  history: AgentChatMessage[];
  onClear: () => void;
  onDeleteTurn: (messageId: string) => void;
  onRestore: () => void;
}) {
  const visibleHistory = history.filter(
    (message) => message.text.trim() || message.imageDataUrl || message.imageUri,
  );
  const turnCount = visibleHistory.filter(
    (message) => message.role === "user",
  ).length;
  const confirmClear = () => {
    Alert.alert(
      "Xóa lịch sử Agent?",
      "Các cuộc trò chuyện EAgent đã lưu trên thiết bị sẽ bị xóa.",
      [
        { text: "Hủy", style: "cancel" },
        { text: "Xóa", style: "destructive", onPress: onClear },
      ],
    );
  };
  const confirmDeleteTurn = (messageId: string) => {
    Alert.alert(
      "Xóa lượt trò chuyện này?",
      "Câu hỏi và câu trả lời trong lượt này sẽ bị xóa khỏi lịch sử.",
      [
        { text: "Hủy", style: "cancel" },
        {
          text: "Xóa",
          style: "destructive",
          onPress: () => onDeleteTurn(messageId),
        },
      ],
    );
  };

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {visibleHistory.length === 0 ? (
        <View style={styles.historyEmpty}>
          <View
            style={[
              styles.historyEmptyIcon,
              { backgroundColor: `${theme.accent}16` },
            ]}
          >
            <MaterialIcons
              name="support-agent"
              size={31}
              color={theme.accent}
            />
          </View>
          <Text style={[styles.historyEmptyTitle, { color: theme.text }]}>
            Chưa có lịch sử Agent
          </Text>
          <Text style={[styles.historyEmptyNote, { color: theme.muted }]}>
            Các câu hỏi và trả lời của EAgent sẽ tự động xuất hiện ở đây.
          </Text>
        </View>
      ) : (
        <>
          <Text style={[styles.historyIntro, { color: theme.muted }]}>
            {turnCount} lượt trò chuyện gần nhất được lưu trên thiết bị.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={onRestore}
            style={({ pressed }) => [
              styles.restoreAgentButton,
              {
                backgroundColor: `${theme.accent}16`,
                borderColor: `${theme.accent}45`,
                opacity: pressed ? 0.66 : 1,
              },
            ]}
          >
            <MaterialIcons name="replay" size={20} color={theme.accent} />
            <Text
              style={[styles.restoreAgentText, { color: theme.accent }]}
            >
              Mở lại cuộc trò chuyện
            </Text>
          </Pressable>
          <View
            style={[
              styles.historyList,
              { backgroundColor: theme.surfaceRaised, borderColor: theme.border },
            ]}
          >
            {visibleHistory.map((message, index) => {
              const isUser = message.role === "user";
              const isTurnEnd =
                index === visibleHistory.length - 1 ||
                visibleHistory[index + 1]?.role === "user";
              return (
                <View
                  key={message.id}
                  style={[
                    styles.historyItem,
                    index > 0 && {
                      borderTopWidth: StyleSheet.hairlineWidth,
                      borderTopColor: theme.border,
                    },
                  ]}
                >
                  <View style={styles.historyMetaRow}>
                    <View style={styles.historyKindRow}>
                      <MaterialIcons
                        name={isUser ? "person-outline" : "support-agent"}
                        size={17}
                        color={
                          message.status === "error"
                            ? theme.danger
                            : theme.accent
                        }
                      />
                      <Text
                        style={[
                          styles.historyMeta,
                          {
                            color:
                              message.status === "error"
                                ? theme.danger
                                : theme.accent,
                          },
                        ]}
                      >
                        {isUser ? "Bạn" : "EAgent"}
                      </Text>
                    </View>
                    <Text style={[styles.historyDate, { color: theme.faint }]}>
                      {formatHistoryDate(message.createdAt)}
                    </Text>
                  </View>
                  <Text
                    numberOfLines={6}
                    style={[
                      styles.agentHistoryText,
                      {
                        color:
                          message.status === "error"
                            ? theme.danger
                            : theme.text,
                      },
                    ]}
                  >
                    {message.text.trim() || "[Ảnh]"}
                  </Text>
                  {message.sources?.length ? (
                    <View style={styles.agentHistorySources}>
                      <MaterialIcons
                        name="link"
                        size={15}
                        color={theme.muted}
                      />
                      <Text
                        style={[styles.agentHistorySourceText, { color: theme.muted }]}
                      >
                        {message.sources.length} nguồn tham khảo
                      </Text>
                    </View>
                  ) : null}
                  {isTurnEnd ? (
                    <View style={styles.historyItemActions}>
                      <Pressable
                        accessibilityLabel="Xóa lượt trò chuyện này"
                        accessibilityRole="button"
                        onPress={() => confirmDeleteTurn(message.id)}
                        style={({ pressed }) => [
                          styles.historyItemAction,
                          {
                            backgroundColor: theme.dangerSurface,
                            opacity: pressed ? 0.62 : 1,
                          },
                        ]}
                      >
                        <MaterialIcons
                          name="delete-outline"
                          size={17}
                          color={theme.danger}
                        />
                        <Text
                          style={[
                            styles.historyActionText,
                            { color: theme.danger },
                          ]}
                        >
                          Xóa lượt này
                        </Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={confirmClear}
            style={({ pressed }) => [
              styles.clearHistoryButton,
              {
                backgroundColor: theme.dangerSurface,
                opacity: pressed ? 0.68 : 1,
              },
            ]}
          >
            <MaterialIcons name="delete-outline" size={20} color={theme.danger} />
            <Text style={[styles.clearHistoryText, { color: theme.danger }]}>
              Xóa lịch sử Agent
            </Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

function contrastTextForColor(color: string): "#111827" | "#FFFFFF" {
  const normalized = normalizeHexColor(color).slice(1);
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  const luminance = (red * 299 + green * 587 + blue * 114) / 1_000;
  return luminance > 156 ? "#111827" : "#FFFFFF";
}

function normalizeTextColor(color: TranslationTextColor): TranslationTextColor {
  return color === "auto" ? color : normalizeHexColor(color);
}

function textSizeLabel(value: TranslationTextSize): string {
  return TEXT_SIZE_OPTIONS.find((option) => option.value === value)?.label ?? "Vừa";
}

function fontLabel(value: TranslationFont): string {
  return FONT_OPTIONS.find((option) => option.value === value)?.label ?? "Hệ thống";
}

function historyLanguageLabel(language: TranslationHistoryEntry["sourceLanguage"]): string {
  return language === "other" ? "Ngôn ngữ tự phát hiện" : LANGUAGE_META[language].label;
}

function formatHistoryDate(value: number): string {
  return new Date(value).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function SectionTitle({
  icon,
  title,
  theme,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  title: string;
  theme: AppTheme;
}) {
  return (
    <View style={styles.sectionHeader}>
      <MaterialIcons name={icon} size={20} color={theme.accent} />
      <Text style={[styles.sectionHeading, { color: theme.text }]}>{title}</Text>
    </View>
  );
}

function FieldLabel({ theme, label }: { theme: AppTheme; label: string }) {
  return <Text style={[styles.fieldLabel, { color: theme.text }]}>{label}</Text>;
}

function NavigationRow({
  theme,
  title,
  note,
  selected = false,
  leading,
  onPress,
}: {
  theme: AppTheme;
  title: string;
  note: string;
  selected?: boolean;
  leading?: ReactNode;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.navigationRow,
        {
          backgroundColor: selected
            ? `${theme.accent}12`
            : theme.surfaceRaised,
          borderColor: selected ? theme.accent : theme.border,
          opacity: pressed ? 0.66 : 1,
        },
      ]}
    >
      {leading}
      <View style={styles.navigationCopy}>
        <Text style={[styles.navigationTitle, { color: theme.text }]}>
          {title}
        </Text>
        <Text
          style={[
            styles.navigationNote,
            { color: selected ? theme.accent : theme.muted },
          ]}
        >
          {note}
        </Text>
      </View>
      <MaterialIcons name="chevron-right" size={24} color={theme.faint} />
    </Pressable>
  );
}

function DropdownField<T extends string>({
  theme,
  value,
  options,
  expanded,
  onToggle,
  onSelect,
}: {
  theme: AppTheme;
  value: T;
  options: Array<{ value: T; label: string; note: string }>;
  expanded: boolean;
  onToggle: () => void;
  onSelect: (value: T) => void;
}) {
  const selected =
    options.find((option) => option.value === value) ?? options[0]!;
  return (
    <View style={styles.dropdownWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={onToggle}
        style={({ pressed }) => [
          styles.dropdownButton,
          {
            backgroundColor: theme.surfaceRaised,
            borderColor: expanded ? theme.accent : theme.border,
            opacity: pressed ? 0.68 : 1,
          },
        ]}
      >
        <View style={styles.dropdownCopy}>
          <Text style={[styles.dropdownLabel, { color: theme.text }]}>
            {selected.label}
          </Text>
          <Text style={[styles.dropdownNote, { color: theme.muted }]}>
            {selected.note}
          </Text>
        </View>
        <MaterialIcons
          name={expanded ? "expand-less" : "expand-more"}
          size={24}
          color={theme.faint}
        />
      </Pressable>
      {expanded ? (
        <View
          style={[
            styles.dropdownList,
            {
              backgroundColor: theme.surfaceRaised,
              borderColor: theme.border,
            },
          ]}
        >
          {options.map((option, index) => {
            const optionSelected = option.value === value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ selected: optionSelected }}
                onPress={() => onSelect(option.value)}
                style={({ pressed }) => [
                  styles.dropdownOption,
                  index > 0 && {
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: theme.border,
                  },
                  { opacity: pressed ? 0.62 : 1 },
                ]}
              >
                <View style={styles.dropdownCopy}>
                  <Text style={[styles.dropdownLabel, { color: theme.text }]}>
                    {option.label}
                  </Text>
                  <Text style={[styles.dropdownNote, { color: theme.muted }]}>
                    {option.note}
                  </Text>
                </View>
                {optionSelected ? (
                  <MaterialIcons name="check" size={21} color={theme.accent} />
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

function SaveButton({
  theme,
  onPress,
  disabled = false,
}: {
  theme: AppTheme;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel="Lưu thiết lập"
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.saveButton,
        {
          backgroundColor: disabled ? theme.border : theme.accent,
          opacity: pressed ? 0.72 : 1,
        },
      ]}
    >
      <MaterialIcons name="check" size={20} color={theme.accentText} />
      <Text style={[styles.saveText, { color: theme.accentText }]}>Lưu</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, overflow: "hidden" },
  body: { flex: 1 },
  header: {
    minHeight: 68,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerSpacer: { width: 42, height: 42 },
  title: {
    flex: 1,
    fontSize: 21,
    fontWeight: "700",
    letterSpacing: -0.4,
  },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  content: { paddingHorizontal: 18, paddingBottom: 46 },
  section: { marginTop: 22 },
  sectionHeader: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  sectionHeading: { fontSize: 16, lineHeight: 22, fontWeight: "700" },
  helper: { marginTop: 4, fontSize: 13, lineHeight: 19 },
  themePicker: {
    minHeight: 62,
    marginTop: 10,
    padding: 4,
    borderRadius: 15,
    borderWidth: 1,
    flexDirection: "row",
    gap: 3,
  },
  themeChoice: {
    flex: 1,
    minHeight: 52,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  themeChoiceText: { fontSize: 12, lineHeight: 16, fontWeight: "700" },
  options: { marginTop: 10, gap: 9 },
  navigationRow: {
    minHeight: 70,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 15,
    borderWidth: 1.25,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  navigationCopy: { flex: 1 },
  navigationTitle: { fontSize: 15, lineHeight: 21, fontWeight: "700" },
  navigationNote: { marginTop: 1, fontSize: 12, lineHeight: 17 },
  miniSwatches: { width: 32, flexDirection: "row", paddingLeft: 3 },
  miniSwatch: {
    width: 22,
    height: 22,
    marginLeft: -4,
    borderRadius: 11,
    borderWidth: 2,
  },
  profileIntro: {
    marginTop: 8,
    padding: 15,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  profileIntroCopy: { flex: 1 },
  profileIntroTitle: { fontSize: 15, lineHeight: 21, fontWeight: "700" },
  profileIntroNote: { marginTop: 2, fontSize: 12, lineHeight: 17 },
  fieldLabel: { fontSize: 15, lineHeight: 21, fontWeight: "700" },
  dropdownWrap: { marginTop: 9 },
  dropdownButton: {
    minHeight: 70,
    paddingHorizontal: 15,
    paddingVertical: 11,
    borderRadius: 15,
    borderWidth: 1.25,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  dropdownCopy: { flex: 1 },
  dropdownLabel: { fontSize: 14, lineHeight: 20, fontWeight: "700" },
  dropdownNote: { marginTop: 2, fontSize: 12, lineHeight: 17 },
  dropdownList: {
    marginTop: 6,
    borderRadius: 15,
    borderWidth: 1,
    overflow: "hidden",
  },
  dropdownOption: {
    minHeight: 64,
    paddingHorizontal: 15,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  promptInput: {
    minHeight: 128,
    marginTop: 10,
    paddingHorizontal: 14,
    paddingTop: 13,
    paddingBottom: 13,
    borderRadius: 15,
    borderWidth: 1.25,
    fontSize: 15,
    lineHeight: 22,
  },
  saveButton: {
    minHeight: 52,
    marginTop: 28,
    borderRadius: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  saveText: { fontSize: 15, lineHeight: 21, fontWeight: "800" },
  colorIntro: { marginTop: 8, fontSize: 13, lineHeight: 19 },
  colorCard: {
    marginTop: 14,
    padding: 14,
    borderRadius: 17,
    borderWidth: 1,
  },
  colorCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  colorPreviewButton: {
    width: 46,
    height: 46,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  colorPreview: { width: 34, height: 34, borderRadius: 9 },
  colorPreviewBadge: {
    position: "absolute",
    right: -4,
    bottom: -4,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  colorCardCopy: { flex: 1 },
  colorTitle: { fontSize: 14, lineHeight: 20, fontWeight: "700" },
  colorNative: { fontSize: 12, lineHeight: 17 },
  hexInput: {
    width: 88,
    minHeight: 40,
    paddingHorizontal: 10,
    borderRadius: 11,
    borderWidth: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    textAlign: "center",
  },
  palette: {
    minHeight: 48,
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  swatchTouch: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  swatch: {
    width: 35,
    height: 35,
    borderRadius: 18,
    borderWidth: 2.5,
    alignItems: "center",
    justifyContent: "center",
  },
  colorPickerOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 45,
  },
  colorPickerBackdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(12, 14, 13, 0.56)",
  },
  colorPickerKeyboard: { flex: 1, justifyContent: "flex-end" },
  colorPickerSheet: {
    width: "100%",
    paddingHorizontal: 18,
    paddingTop: 17,
    paddingBottom: 20,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 24,
  },
  colorPickerHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  colorPickerHeaderCopy: { flex: 1 },
  colorPickerTitle: { fontSize: 19, lineHeight: 25, fontWeight: "800" },
  colorPickerNote: { marginTop: 1, fontSize: 12, lineHeight: 17 },
  colorPickerClose: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  fullPalette: {
    marginTop: 14,
    flexDirection: "row",
    flexWrap: "wrap",
  },
  fullSwatchTouch: {
    width: "16.6667%",
    height: 50,
    alignItems: "center",
    justifyContent: "center",
  },
  fullSwatch: {
    width: 37,
    height: 37,
    borderRadius: 19,
    borderWidth: 2.5,
    alignItems: "center",
    justifyContent: "center",
  },
  colorPickerFieldLabel: {
    marginTop: 12,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
  },
  colorPickerInputRow: {
    marginTop: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  colorPickerCurrent: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
  },
  colorPickerInput: {
    flex: 1,
    minHeight: 46,
    paddingHorizontal: 13,
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
  },
  colorPickerActions: {
    marginTop: 16,
    flexDirection: "row",
    gap: 10,
  },
  colorPickerAction: {
    flex: 1,
    minHeight: 49,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  colorPickerCancelText: { fontSize: 14, lineHeight: 20, fontWeight: "700" },
  colorPickerApplyText: { fontSize: 14, lineHeight: 20, fontWeight: "800" },
  validation: { marginTop: 12, fontSize: 13, lineHeight: 18 },
  textSizePicker: {
    minHeight: 82,
    marginTop: 10,
    padding: 4,
    borderRadius: 15,
    borderWidth: 1,
    flexDirection: "row",
    gap: 3,
  },
  textSizeChoice: {
    flex: 1,
    minHeight: 72,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  textSizeLabel: { fontSize: 12, lineHeight: 16, fontWeight: "700" },
  fontList: {
    marginTop: 10,
    borderRadius: 15,
    borderWidth: 1,
    overflow: "hidden",
  },
  fontRow: {
    minHeight: 68,
    paddingHorizontal: 15,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  fontCopy: { flex: 1 },
  fontLabel: { fontSize: 14, lineHeight: 20, fontWeight: "700" },
  fontSample: { marginTop: 1, fontSize: 14, lineHeight: 20 },
  textColorGroup: {
    paddingVertical: 15,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  textPalette: {
    minHeight: 46,
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  autoColor: {
    height: 38,
    paddingHorizontal: 11,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  autoColorText: { fontSize: 11, lineHeight: 16, fontWeight: "800" },
  textSwatchTouch: {
    flex: 1,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
  },
  textSwatch: {
    width: 31,
    height: 31,
    borderRadius: 16,
    borderWidth: 2.5,
  },
  textColorInput: {
    minHeight: 44,
    marginTop: 8,
    paddingHorizontal: 12,
    borderRadius: 11,
    borderWidth: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
  },
  historyIntro: { marginTop: 8, marginBottom: 12, fontSize: 13, lineHeight: 19 },
  historyList: {
    borderRadius: 17,
    borderWidth: 1,
    overflow: "hidden",
  },
  historyItem: { paddingHorizontal: 15, paddingVertical: 15 },
  historyMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  historyKindRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  historyMeta: { fontSize: 12, lineHeight: 17, fontWeight: "800" },
  historyDate: { fontSize: 11, lineHeight: 16, fontWeight: "600" },
  historyPair: { marginTop: 4, fontSize: 11, lineHeight: 16 },
  historyLanguage: { marginTop: 10, fontSize: 11, lineHeight: 16, fontWeight: "700" },
  historySource: { marginTop: 2, fontSize: 14, lineHeight: 20, fontWeight: "500" },
  historyTargetRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  historyTranslation: { marginTop: 2, fontSize: 16, lineHeight: 23, fontWeight: "700" },
  historyItemActions: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
  },
  historyItemAction: {
    minHeight: 36,
    paddingHorizontal: 11,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  historyActionText: { fontSize: 12, lineHeight: 17, fontWeight: "800" },
  restoreAgentButton: {
    minHeight: 48,
    marginBottom: 12,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  restoreAgentText: { fontSize: 14, lineHeight: 20, fontWeight: "800" },
  agentHistoryText: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "500",
  },
  agentHistorySources: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  agentHistorySourceText: { fontSize: 11, lineHeight: 16, fontWeight: "600" },
  clearHistoryButton: {
    minHeight: 50,
    marginTop: 16,
    borderRadius: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  clearHistoryText: { fontSize: 14, lineHeight: 20, fontWeight: "800" },
  historyEmpty: {
    minHeight: 420,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 30,
  },
  historyEmptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  historyEmptyTitle: {
    marginTop: 16,
    fontSize: 18,
    lineHeight: 25,
    fontWeight: "800",
    textAlign: "center",
  },
  historyEmptyNote: {
    marginTop: 5,
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
  },
  themeReveal: {
    position: "absolute",
    zIndex: 50,
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  themeRevealBrand: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 51,
    alignItems: "center",
    justifyContent: "center",
  },
  themeRevealIcon: {
    width: 116,
    height: 116,
  },
});
