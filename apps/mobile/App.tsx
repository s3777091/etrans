import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from "expo-audio";
import { useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Image,
  NativeModules,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { useInterpreterAudio } from "./src/audio/use-interpreter-audio";
import {
  LiveInterpreterEngine,
  type InterpreterMetrics,
} from "./src/interpreter/engine";
import { appendTranscript } from "./src/interpreter/transcript";
import {
  translateCapturedPhoto,
  type ImageTranslationResult,
} from "./src/qwen/image-translator";
import {
  languagesForDirection,
  type InterpreterDirection,
  type QwenLiveError,
  type TranslationLanguage,
} from "./src/qwen/types";
import {
  DEFAULT_TRANSLATION_SETTINGS,
  directionsForPair,
  languagesForPair,
  parseTranslationSettings,
  type LanguagePair,
  type TranslationProfile,
  type TranslationSettings,
} from "./src/settings/translation-settings";
import {
  CameraCaptureModal,
  type CapturedPhoto,
} from "./src/ui/CameraCaptureModal";
import { DeveloperModal } from "./src/ui/DeveloperModal";
import { GestureOrb } from "./src/ui/GestureOrb";
import { AppSplash, ETRANS_ICONS } from "./src/ui/AppSplash";
import { SettingsModal } from "./src/ui/SettingsModal";
import { TranscriptPanel } from "./src/ui/TranscriptPanel";
import { darkTheme, lightTheme } from "./src/ui/theme";
import { resolveThemeMode, type ThemeMode } from "./src/ui/theme-mode";

type AppPhase =
  | "connecting"
  | "ready"
  | "listening"
  | "translating"
  | "speaking"
  | "error";

const DEFAULT_METRICS: InterpreterMetrics = {
  provider: "Alibaba Qwen",
  currentModel: "qwen3.5-livetranslate-flash-realtime",
  mode: "REALTIME",
  direction: "zh-to-vi",
  pcmQueueMs: 0,
  droppedBuffers: 0,
};

const THEME_MODE_STORAGE_KEY = "interpreter.theme-mode";
const TRANSLATION_SETTINGS_STORAGE_KEY = "interpreter.translation-settings";

interface ETransIconNativeModule {
  setThemeMode: (
    mode: ThemeMode,
    resolvedTheme: "light" | "dark",
  ) => Promise<void>;
}

export default function App() {
  const systemColorScheme = useColorScheme();
  const [, requestCameraPermission] = useCameraPermissions();
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
  const [themeHydrated, setThemeHydrated] = useState(false);
  const [splashVisible, setSplashVisible] = useState(true);
  const activeColorScheme = resolveThemeMode(themeMode, systemColorScheme);
  const theme = activeColorScheme === "dark" ? darkTheme : lightTheme;
  const apiBaseUrl =
    process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:8787";
  const engine = useMemo(
    () => new LiveInterpreterEngine(apiBaseUrl),
    [apiBaseUrl],
  );
  const pull = useRef(new Animated.Value(0)).current;
  const orbTravel = useRef(new Animated.Value(0)).current;

  const [phase, setPhase] = useState<AppPhase>("connecting");
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [counterpartText, setCounterpartText] = useState("");
  const [vietnameseText, setVietnameseText] = useState("");
  const [metrics, setMetrics] = useState(DEFAULT_METRICS);
  const [developerVisible, setDeveloperVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [fatalMessage, setFatalMessage] = useState<string>();
  const [reduceMotion, setReduceMotion] = useState(false);
  const [translationSettings, setTranslationSettings] =
    useState<TranslationSettings>(DEFAULT_TRANSLATION_SETTINGS);
  const [imageTranslation, setImageTranslation] =
    useState<ImageTranslationResult>();
  const [imageError, setImageError] = useState<string>();
  const [imageBusy, setImageBusy] = useState(false);
  const [cameraVisible, setCameraVisible] = useState(false);
  const cameraOpeningRef = useRef(false);

  const languagePair = translationSettings.activePair;
  const activeProfile = translationSettings.profiles[languagePair];
  const languages = languagesForPair(languagePair);
  const directions = directionsForPair(languagePair);
  const counterpartColor =
    translationSettings.frameColors[languages.counterpart.code];
  const vietnameseColor = translationSettings.frameColors.vi;

  useEffect(() => {
    let active = true;
    void Promise.all([
      AsyncStorage.getItem(THEME_MODE_STORAGE_KEY),
      AsyncStorage.getItem(TRANSLATION_SETTINGS_STORAGE_KEY),
    ])
      .then(([savedMode, savedSettings]) => {
        if (!active) return;
        if (
          savedMode === "system" ||
          savedMode === "light" ||
          savedMode === "dark"
        ) {
          setThemeMode(savedMode);
        }
        setTranslationSettings(parseTranslationSettings(savedSettings));
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setThemeHydrated(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!themeHydrated) return;
    const timer = setTimeout(() => setSplashVisible(false), 720);
    return () => clearTimeout(timer);
  }, [themeHydrated]);

  useEffect(() => {
    if (!themeHydrated || Platform.OS !== "android") return;
    const iconModule = NativeModules.ETransIcon as
      | ETransIconNativeModule
      | undefined;
    void iconModule
      ?.setThemeMode(themeMode, activeColorScheme)
      .catch(() => undefined);
  }, [activeColorScheme, themeHydrated, themeMode]);

  const handleThemeModeChanged = useCallback((mode: ThemeMode) => {
    setThemeMode(mode);
    void AsyncStorage.setItem(THEME_MODE_STORAGE_KEY, mode).catch(
      () => undefined,
    );
  }, []);

  const persistTranslationSettings = useCallback(
    (next: TranslationSettings) => {
      setTranslationSettings(next);
      void AsyncStorage.setItem(
        TRANSLATION_SETTINGS_STORAGE_KEY,
        JSON.stringify(next),
      ).catch(() => undefined);
    },
    [],
  );

  const handleSaveProfile = useCallback(
    (pair: LanguagePair, profile: TranslationProfile) => {
      const next: TranslationSettings = {
        ...translationSettings,
        activePair: pair,
        profiles: {
          ...translationSettings.profiles,
          [pair]: profile,
        },
      };
      persistTranslationSettings(next);
      setCounterpartText("");
      setVietnameseText("");
      setImageTranslation(undefined);
      setImageError(undefined);
      setFatalMessage(undefined);
      setPhase("connecting");
    },
    [persistTranslationSettings, translationSettings],
  );

  const handleSaveFrameColors = useCallback(
    (frameColors: Record<TranslationLanguage, string>) => {
      persistTranslationSettings({ ...translationSettings, frameColors });
    },
    [persistTranslationSettings, translationSettings],
  );

  const handleAudioError = useCallback((value: unknown) => {
    const error = value as Partial<QwenLiveError>;
    if (error.code === "AUTH_UNAVAILABLE") {
      setFatalMessage(
        "Không thể kết nối Qwen. Hãy kiểm tra máy chủ, API key và số dư.",
      );
      setPhase("error");
    } else {
      setPhase("connecting");
    }
  }, []);

  const { activate: activateAudio, deactivate: deactivateAudio } =
    useInterpreterAudio({ engine, onError: handleAudioError });

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const permission = await requestRecordingPermissionsAsync();
      if (!active) return;
      setPermissionGranted(permission.granted);
      if (!permission.granted) {
        setFatalMessage("Cần quyền truy cập micro để phiên dịch trực tiếp");
        setPhase("error");
        return;
      }
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        interruptionMode: "doNotMix",
      });
    })().catch(handleAudioError);

    return () => {
      active = false;
    };
  }, [handleAudioError]);

  useEffect(
    () => () => {
      void engine.dispose();
    },
    [engine],
  );

  useEffect(() => {
    if (!permissionGranted) return;
    let active = true;
    setPhase((current) => (current === "error" ? current : "connecting"));
    void engine
      .connectWarm(directions.right, activeProfile.voiceModel)
      .then(() => {
        if (active) setPhase("ready");
      })
      .catch(handleAudioError);
    return () => {
      active = false;
    };
  }, [
    activeProfile.voiceModel,
    directions.right,
    engine,
    handleAudioError,
    permissionGranted,
  ]);

  useEffect(() => {
    const removeMetrics = engine.onMetrics((nextMetrics) => {
      setMetrics({ ...nextMetrics });
      if (nextMetrics.firstTranslatedAudioMs !== undefined) {
        setPhase((current) =>
          current === "translating" ? "speaking" : current,
        );
      }
    });
    const removeTranscript = engine.onTranscript((kind, text, direction) => {
      const { source, target } = languagesForDirection(direction);
      const language = kind === "input" ? source : target;
      if (language === "vi") {
        setVietnameseText((current) => appendTranscript(current, text, "vi"));
      } else {
        setCounterpartText((current) =>
          appendTranscript(current, text, language),
        );
      }
    });
    const removeError = engine.onError(handleAudioError);
    const removeComplete = engine.onTurnComplete(() => setPhase("ready"));
    return () => {
      removeMetrics();
      removeTranscript();
      removeError();
      removeComplete();
    };
  }, [engine, handleAudioError]);

  const prepare = useCallback(
    (direction: InterpreterDirection) => {
      void engine
        .prepare(direction, activeProfile.voiceModel)
        .catch(handleAudioError);
    },
    [activeProfile.voiceModel, engine, handleAudioError],
  );

  const activate = useCallback(
    (direction: InterpreterDirection) => {
      setCounterpartText("");
      setVietnameseText("");
      setImageTranslation(undefined);
      setImageError(undefined);
      setFatalMessage(undefined);
      setPhase("listening");
      void activateAudio(direction, activeProfile.voiceModel);
    },
    [activateAudio, activeProfile.voiceModel],
  );

  const release = useCallback(() => {
    setPhase("translating");
    void deactivateAudio().then((turnStarted) => {
      if (!turnStarted) {
        setPhase((current) =>
          current === "translating" ? "ready" : current,
        );
      }
    });
  }, [deactivateAudio]);

  const handleCameraCaptured = useCallback(
    async (photo: CapturedPhoto) => {
      setCameraVisible(false);
      setImageBusy(true);
      setImageTranslation(undefined);
      setImageError(undefined);
      setCounterpartText("");
      setVietnameseText("");
      try {
        const result = await translateCapturedPhoto(
          apiBaseUrl,
          photo.uri,
          photo.width,
          languagePair,
          activeProfile,
        );
        setImageTranslation(result);
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        ).catch(() => undefined);
      } catch (error) {
        const detail = error instanceof Error ? error.message : "";
        const isConnectionFailure =
          /fetch failed|network request failed|connectexception|failed to connect/i.test(
            detail,
          );
        setImageError(
          isConnectionFailure
            ? "Không thể kết nối máy chủ để dịch ảnh"
            : detail || "Không thể dịch ảnh lúc này",
        );
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Error,
        ).catch(() => undefined);
      } finally {
        setImageBusy(false);
      }
    },
    [activeProfile, apiBaseUrl, languagePair],
  );

  const handleCameraError = useCallback((_message: string) => {
    setCameraVisible(false);
    setImageTranslation(undefined);
    setImageError("Không thể mở camera lúc này");
    void Haptics.notificationAsync(
      Haptics.NotificationFeedbackType.Error,
    ).catch(() => undefined);
  }, []);

  const handleDoubleTap = useCallback(async () => {
    if (imageBusy || cameraVisible || cameraOpeningRef.current) return;
    cameraOpeningRef.current = true;
    try {
      const permission = await requestCameraPermission();
      if (!permission.granted) {
        setImageTranslation(undefined);
        setImageError(
          permission.canAskAgain
            ? "Cần quyền truy cập camera để chụp ảnh và dịch chữ"
            : "Quyền camera đang bị tắt. Hãy bật lại trong Cài đặt hệ thống.",
        );
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Error,
        ).catch(() => undefined);
        return;
      }
      setImageTranslation(undefined);
      setImageError(undefined);
      setCameraVisible(true);
    } catch {
      handleCameraError("Không thể yêu cầu quyền truy cập camera");
    } finally {
      cameraOpeningRef.current = false;
    }
  }, [cameraVisible, handleCameraError, imageBusy, requestCameraPermission]);

  const disabled =
    !permissionGranted ||
    phase === "translating" ||
    phase === "speaking" ||
    phase === "error" ||
    imageBusy;

  const counterpartImageTranslation =
    imageTranslation?.targetLanguage === languages.counterpart.code
      ? imageTranslation.translation
      : undefined;
  const vietnameseImageTranslation =
    imageTranslation?.targetLanguage === "vi"
      ? imageTranslation.translation
      : undefined;
  const counterpartNote = counterpartImageTranslation
    ? "DỊCH ẢNH"
    : undefined;
  const vietnameseNote = imageBusy
    ? "ĐANG ĐỌC ẢNH"
    : vietnameseImageTranslation || imageError
      ? "DỊCH ẢNH"
      : undefined;
  const connected = phase !== "connecting" && phase !== "error";

  return (
    <SafeAreaProvider>
      <StatusBar style={activeColorScheme === "dark" ? "light" : "dark"} />
      <View style={[styles.appRoot, { backgroundColor: theme.background }]}> 
        <SafeAreaView
          style={[styles.safeArea, { backgroundColor: theme.background }]}
        >
        <View style={styles.header}>
          <View style={styles.brand}>
            <Image
              accessibilityIgnoresInvertColors
              resizeMode="contain"
              source={ETRANS_ICONS[activeColorScheme]}
              style={styles.brandIcon}
            />
            <Text
              accessibilityRole="header"
              style={[styles.brandName, { color: theme.text }]}
            >
              ETrans
            </Text>
          </View>

          <View
            accessibilityRole="tablist"
            style={[
              styles.headerTabs,
              {
                backgroundColor: theme.surface,
                borderColor: theme.border,
              },
            ]}
          >
            <Pressable
              accessibilityLabel="Dịch"
              accessibilityRole="tab"
              accessibilityState={{ selected: true }}
              hitSlop={4}
              onPress={() => {
                setDeveloperVisible(false);
                setSettingsVisible(false);
              }}
              style={({ pressed }) => [
                styles.headerTabButton,
                styles.headerTabButtonActive,
                {
                  backgroundColor: theme.surfaceRaised,
                  shadowColor: theme.shadow,
                  opacity: pressed ? 0.72 : 1,
                  transform: [{ scale: pressed ? 0.96 : 1 }],
                },
              ]}
            >
              <MaterialIcons name="translate" size={22} color={theme.text} />
            </Pressable>

            <Pressable
              accessibilityLabel="Agent"
              accessibilityRole="tab"
              accessibilityState={{ selected: false }}
              hitSlop={4}
              onPress={() => {
                setSettingsVisible(false);
                setDeveloperVisible(true);
              }}
              style={({ pressed }) => [
                styles.headerTabButton,
                {
                  opacity: pressed ? 0.55 : 1,
                  transform: [{ scale: pressed ? 0.96 : 1 }],
                },
              ]}
            >
              <MaterialIcons
                name="support-agent"
                size={22}
                color={theme.muted}
              />
            </Pressable>

            <Pressable
              accessibilityLabel="Cài đặt"
              accessibilityRole="tab"
              accessibilityState={{ selected: false }}
              hitSlop={4}
              onPress={() => {
                setDeveloperVisible(false);
                setSettingsVisible(true);
              }}
              style={({ pressed }) => [
                styles.headerTabButton,
                {
                  opacity: pressed ? 0.55 : 1,
                  transform: [{ scale: pressed ? 0.96 : 1 }],
                },
              ]}
            >
              <MaterialIcons name="settings" size={22} color={theme.muted} />
            </Pressable>
          </View>
        </View>

        {fatalMessage ? (
          <View
            style={[
              styles.errorBanner,
              { backgroundColor: theme.dangerSurface },
            ]}
          >
            <Text style={[styles.errorText, { color: theme.danger }]}>
              {fatalMessage}
            </Text>
          </View>
        ) : null}

        <TranscriptPanel
          alignment="top"
          languageLabel={languages.counterpart.mainLabel}
          frameColor={counterpartColor}
          note={counterpartNote}
          text={counterpartImageTranslation ?? counterpartText}
          theme={theme}
          pull={pull}
          orbTravel={orbTravel}
        />

        <GestureOrb
          theme={theme}
          rightDirection={directions.right}
          leftDirection={directions.left}
          rightLanguageLabel={languages.counterpart.label.toLowerCase()}
          leftLanguageLabel="tiếng Việt"
          rightColor={counterpartColor}
          leftColor={vietnameseColor}
          connected={connected}
          disabled={disabled}
          reduceMotion={reduceMotion}
          waitingForTranslation={imageBusy || phase === "translating"}
          pull={pull}
          orbTravel={orbTravel}
          onPrepare={prepare}
          onActivate={activate}
          onRelease={release}
          onDoubleTap={handleDoubleTap}
        />

        <TranscriptPanel
          alignment="bottom"
          languageLabel="TIẾNG VIỆT"
          frameColor={vietnameseColor}
          note={vietnameseNote}
          text={imageError ?? vietnameseImageTranslation ?? vietnameseText}
          theme={theme}
          pull={pull}
          orbTravel={orbTravel}
        />

        <SettingsModal
          visible={settingsVisible}
          theme={theme}
          themeMode={themeMode}
          systemColorScheme={systemColorScheme}
          reduceMotion={reduceMotion}
          settings={translationSettings}
          onThemeModeChanged={handleThemeModeChanged}
          onSaveProfile={handleSaveProfile}
          onSaveFrameColors={handleSaveFrameColors}
          onClose={() => setSettingsVisible(false)}
        />

        <CameraCaptureModal
          visible={cameraVisible}
          theme={theme}
          onCaptured={handleCameraCaptured}
          onCancel={() => setCameraVisible(false)}
          onError={handleCameraError}
        />

        <DeveloperModal
          visible={developerVisible}
          metrics={metrics}
          theme={theme}
          onClose={() => setDeveloperVisible(false)}
        />
        </SafeAreaView>
        <AppSplash
          visible={splashVisible}
          colorScheme={activeColorScheme}
          theme={theme}
        />
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  appRoot: { flex: 1 },
  safeArea: { flex: 1 },
  header: {
    height: 62,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  brandIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    overflow: "hidden",
  },
  brandName: {
    fontSize: 20,
    lineHeight: 25,
    fontWeight: "800",
    letterSpacing: -0.55,
  },
  headerTabs: {
    height: 46,
    padding: 3,
    borderWidth: 1,
    borderRadius: 23,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  headerTabButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTabButtonActive: {
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.14,
    shadowRadius: 5,
    elevation: 2,
  },
  errorBanner: {
    marginHorizontal: 20,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  errorText: { textAlign: "center", fontSize: 13, fontWeight: "700" },
});
