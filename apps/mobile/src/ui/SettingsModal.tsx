import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
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
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  LANGUAGE_META,
  LANGUAGE_PAIRS,
  isValidHexColor,
  languagesForPair,
  normalizeHexColor,
  pairTitle,
  type LanguagePair,
  type TranslationProfile,
  type TranslationSettings,
} from "../settings/translation-settings";
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
  onThemeModeChanged: (mode: ThemeMode) => void;
  onSaveProfile: (pair: LanguagePair, profile: TranslationProfile) => void;
  onSaveFrameColors: (
    colors: Record<TranslationLanguage, string>,
  ) => void;
  onClose: () => void;
}

type SettingsRoute = "root" | "profile" | "colors";
type DropdownId = "text" | "voice";

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
    value: "qwen-mt-flash",
    label: "Qwen MT Flash",
    note: "Cân bằng tốc độ và độ chính xác",
  },
  {
    value: "qwen-mt-lite",
    label: "Qwen MT Lite",
    note: "Nhanh nhất cho hội thoại ngắn",
  },
  {
    value: "qwen-mt-plus",
    label: "Qwen MT Plus",
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

const COLOR_PRESETS = [
  "#1C78E8",
  "#148C7B",
  "#D85A43",
  "#C94F78",
  "#7759C7",
] as const;

export function SettingsModal({
  visible,
  theme,
  themeMode,
  systemColorScheme,
  reduceMotion,
  settings,
  onThemeModeChanged,
  onSaveProfile,
  onSaveFrameColors,
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
  const [openDropdown, setOpenDropdown] = useState<DropdownId>();
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
    setOpenDropdown(undefined);
  }, [settings, visible]);

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
    setRoute("colors");
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
        : "Màu khung";

  return (
    <Modal
      animationType="slide"
      presentationStyle="pageSheet"
      visible={visible}
      onRequestClose={onClose}
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
              onOpenProfile={openProfile}
              onOpenColors={openColors}
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
          ) : (
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
              onSave={saveColors}
            />
          )}
        </KeyboardAvoidingView>

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
  onThemeChanged,
  onOpenProfile,
  onOpenColors,
}: {
  theme: AppTheme;
  themeMode: ThemeMode;
  settings: TranslationSettings;
  onThemeChanged: (mode: ThemeMode, event: GestureResponderEvent) => void;
  onOpenProfile: (pair: LanguagePair) => void;
  onOpenColors: () => void;
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

function ColorSettings({
  theme,
  languages,
  colors,
  valid,
  onColorChanged,
  onSave,
}: {
  theme: AppTheme;
  languages: TranslationLanguage[];
  colors: Record<TranslationLanguage, string>;
  valid: boolean;
  onColorChanged: (language: TranslationLanguage, color: string) => void;
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
              <View
                style={[
                  styles.colorPreview,
                  { backgroundColor: inputValid ? color : theme.border },
                ]}
              />
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
  colorPreview: { width: 34, height: 34, borderRadius: 10 },
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
  validation: { marginTop: 12, fontSize: 13, lineHeight: 18 },
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
