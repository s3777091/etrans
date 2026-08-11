export const QWEN_LIVE_MODEL =
  "qwen3.5-livetranslate-flash-realtime" as const;

export const QWEN_LIVE_MODELS = [
  QWEN_LIVE_MODEL,
  "qwen3-livetranslate-flash-realtime",
] as const;

export const QWEN_MT_MODELS = [
  "qwen-mt-flash",
  "qwen-mt-lite",
  "qwen-mt-plus",
] as const;

export type VoiceTranslationModel = (typeof QWEN_LIVE_MODELS)[number];
export type TextTranslationModel = (typeof QWEN_MT_MODELS)[number];
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
