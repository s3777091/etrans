export const QWEN_LIVE_MODEL =
  "qwen3.5-livetranslate-flash-realtime" as const;

export const QWEN_LIVE_MODELS = [
  QWEN_LIVE_MODEL,
  "qwen3-livetranslate-flash-realtime",
] as const;

// Models the phone may pick for the translation step of image translation.
// Kept in sync with the catalog the configured endpoint serves.
export const QWEN_MT_MODELS = [
  "qwen3.6-flash",
  "qwen3.7-plus",
  "qwen3.8-max",
] as const;

export const QWEN_AGENT_MODEL = "qwen3.6-flash" as const;

// Kept in sync with the model catalog the configured endpoint serves.
export const QWEN_AGENT_MODELS = [
  QWEN_AGENT_MODEL,
  "qwen3.7-plus",
  "qwen3.7-max",
  "qwen3.8-max",
] as const;

export const AGENT_LANGUAGES = ["vi", "zh", "en"] as const;

export type VoiceTranslationModel = (typeof QWEN_LIVE_MODELS)[number];
export type TextTranslationModel = (typeof QWEN_MT_MODELS)[number];
export type AgentModel = (typeof QWEN_AGENT_MODELS)[number];
export type AgentLanguage = (typeof AGENT_LANGUAGES)[number];
export type InterpreterDirection =
  | "zh-to-vi"
  | "vi-to-zh"
  | "en-to-vi"
  | "vi-to-en";

export function isInterpreterDirection(
  direction: string,
): direction is InterpreterDirection {
  return (
    direction === "zh-to-vi" ||
    direction === "vi-to-zh" ||
    direction === "en-to-vi" ||
    direction === "vi-to-en"
  );
}

export function isVoiceTranslationModel(
  model: string,
): model is VoiceTranslationModel {
  return QWEN_LIVE_MODELS.includes(model as VoiceTranslationModel);
}

export function isTextTranslationModel(
  model: string,
): model is TextTranslationModel {
  return QWEN_MT_MODELS.includes(model as TextTranslationModel);
}

export function isAgentModel(model: string): model is AgentModel {
  return QWEN_AGENT_MODELS.includes(model as AgentModel);
}

export function isAgentLanguage(language: string): language is AgentLanguage {
  return AGENT_LANGUAGES.includes(language as AgentLanguage);
}
