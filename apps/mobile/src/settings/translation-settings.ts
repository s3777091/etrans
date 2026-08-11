import {
  QWEN_LIVE_MODEL,
  QWEN_LIVE_MODELS,
  QWEN_MT_MODELS,
  type InterpreterDirection,
  type TextTranslationModel,
  type TranslationLanguage,
  type VoiceTranslationModel,
} from "../qwen/types";

export type LanguagePair = "vi-zh" | "vi-en";
export type TranslationTextSize = "small" | "medium" | "large";
export type TranslationFont = "system" | "serif" | "monospace";
export type TranslationTextColor = "auto" | string;

export interface TranslationProfile {
  prompt: string;
  textModel: TextTranslationModel;
  voiceModel: VoiceTranslationModel;
}

export interface TranslationDisplaySettings {
  textSize: TranslationTextSize;
  font: TranslationFont;
  textColors: Record<TranslationLanguage, TranslationTextColor>;
}

export interface TranslationSettings {
  activePair: LanguagePair;
  profiles: Record<LanguagePair, TranslationProfile>;
  frameColors: Record<TranslationLanguage, string>;
  display: TranslationDisplaySettings;
}

export interface LanguageMeta {
  code: TranslationLanguage;
  label: string;
  mainLabel: string;
  nativeLabel: string;
}

export const LANGUAGE_META: Record<TranslationLanguage, LanguageMeta> = {
  vi: {
    code: "vi",
    label: "Tiếng Việt",
    mainLabel: "TIẾNG VIỆT",
    nativeLabel: "Tiếng Việt",
  },
  zh: {
    code: "zh",
    label: "Tiếng Trung",
    mainLabel: "中文",
    nativeLabel: "中文",
  },
  en: {
    code: "en",
    label: "Tiếng Anh",
    mainLabel: "ENGLISH",
    nativeLabel: "English",
  },
};

export const LANGUAGE_PAIRS: readonly LanguagePair[] = ["vi-zh", "vi-en"];

export const DEFAULT_TRANSLATION_SETTINGS: TranslationSettings = {
  activePair: "vi-zh",
  profiles: {
    "vi-zh": {
      prompt: "",
      textModel: "qwen3.6-flash",
      voiceModel: QWEN_LIVE_MODEL,
    },
    "vi-en": {
      prompt: "",
      textModel: "qwen3.6-flash",
      voiceModel: QWEN_LIVE_MODEL,
    },
  },
  frameColors: {
    vi: "#1C78E8",
    zh: "#D85A43",
    en: "#148C7B",
  },
  display: {
    textSize: "medium",
    font: "system",
    textColors: {
      vi: "auto",
      zh: "auto",
      en: "auto",
    },
  },
};

export function languagesForPair(pair: LanguagePair): {
  vietnamese: LanguageMeta;
  counterpart: LanguageMeta;
} {
  return {
    vietnamese: LANGUAGE_META.vi,
    counterpart: LANGUAGE_META[pair === "vi-zh" ? "zh" : "en"],
  };
}

export function directionsForPair(pair: LanguagePair): {
  right: InterpreterDirection;
  left: InterpreterDirection;
} {
  return pair === "vi-zh"
    ? { right: "zh-to-vi", left: "vi-to-zh" }
    : { right: "en-to-vi", left: "vi-to-en" };
}

export function pairTitle(pair: LanguagePair): string {
  const { counterpart } = languagesForPair(pair);
  return `Tiếng Việt ↔ ${counterpart.label}`;
}

export function parseTranslationSettings(
  value: string | null | undefined,
): TranslationSettings {
  if (!value) return cloneDefaults();
  try {
    const candidate = JSON.parse(value) as Partial<TranslationSettings>;
    const activePair = isLanguagePair(candidate.activePair)
      ? candidate.activePair
      : DEFAULT_TRANSLATION_SETTINGS.activePair;
    return {
      activePair,
      profiles: {
        "vi-zh": sanitizeProfile(candidate.profiles?.["vi-zh"], "vi-zh"),
        "vi-en": sanitizeProfile(candidate.profiles?.["vi-en"], "vi-en"),
      },
      frameColors: {
        vi: sanitizeHex(
          candidate.frameColors?.vi,
          DEFAULT_TRANSLATION_SETTINGS.frameColors.vi,
        ),
        zh: sanitizeHex(
          candidate.frameColors?.zh,
          DEFAULT_TRANSLATION_SETTINGS.frameColors.zh,
        ),
        en: sanitizeHex(
          candidate.frameColors?.en,
          DEFAULT_TRANSLATION_SETTINGS.frameColors.en,
        ),
      },
      display: {
        textSize: isTranslationTextSize(candidate.display?.textSize)
          ? candidate.display.textSize
          : DEFAULT_TRANSLATION_SETTINGS.display.textSize,
        font: isTranslationFont(candidate.display?.font)
          ? candidate.display.font
          : DEFAULT_TRANSLATION_SETTINGS.display.font,
        textColors: {
          vi: sanitizeTextColor(candidate.display?.textColors?.vi),
          zh: sanitizeTextColor(candidate.display?.textColors?.zh),
          en: sanitizeTextColor(candidate.display?.textColors?.en),
        },
      },
    };
  } catch {
    return cloneDefaults();
  }
}

export function isValidHexColor(value: string): boolean {
  return /^#[0-9A-F]{6}$/i.test(value.trim());
}

export function normalizeHexColor(value: string): string {
  const trimmed = value.trim();
  const prefixed = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  return prefixed.toUpperCase();
}

function cloneDefaults(): TranslationSettings {
  return {
    activePair: DEFAULT_TRANSLATION_SETTINGS.activePair,
    profiles: {
      "vi-zh": { ...DEFAULT_TRANSLATION_SETTINGS.profiles["vi-zh"] },
      "vi-en": { ...DEFAULT_TRANSLATION_SETTINGS.profiles["vi-en"] },
    },
    frameColors: { ...DEFAULT_TRANSLATION_SETTINGS.frameColors },
    display: {
      ...DEFAULT_TRANSLATION_SETTINGS.display,
      textColors: { ...DEFAULT_TRANSLATION_SETTINGS.display.textColors },
    },
  };
}

function isLanguagePair(value: unknown): value is LanguagePair {
  return value === "vi-zh" || value === "vi-en";
}

function sanitizeProfile(
  value: Partial<TranslationProfile> | undefined,
  pair: LanguagePair,
): TranslationProfile {
  const fallback = DEFAULT_TRANSLATION_SETTINGS.profiles[pair];
  return {
    prompt:
      typeof value?.prompt === "string" ? value.prompt.slice(0, 800) : "",
    textModel: QWEN_MT_MODELS.includes(
      value?.textModel as TextTranslationModel,
    )
      ? (value?.textModel as TextTranslationModel)
      : fallback.textModel,
    voiceModel: QWEN_LIVE_MODELS.includes(
      value?.voiceModel as VoiceTranslationModel,
    )
      ? (value?.voiceModel as VoiceTranslationModel)
      : fallback.voiceModel,
  };
}

function sanitizeHex(value: unknown, fallback: string): string {
  return typeof value === "string" && isValidHexColor(value)
    ? normalizeHexColor(value)
    : fallback;
}

function sanitizeTextColor(value: unknown): TranslationTextColor {
  if (value === "auto") return value;
  return typeof value === "string" && isValidHexColor(value)
    ? normalizeHexColor(value)
    : "auto";
}

function isTranslationTextSize(
  value: unknown,
): value is TranslationTextSize {
  return value === "small" || value === "medium" || value === "large";
}

function isTranslationFont(value: unknown): value is TranslationFont {
  return value === "system" || value === "serif" || value === "monospace";
}
