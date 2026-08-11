import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

import type {
  LanguagePair,
  TranslationProfile,
} from "../settings/translation-settings";
import { buildImageTranslationUrl } from "./image-translator-url";

const MAX_IMAGE_WIDTH = 1_440;

export interface ImageTranslationResult {
  sourceLanguage: "vi" | "zh" | "en" | "other";
  targetLanguage: "vi" | "zh" | "en";
  translation: string;
}

interface ImageTranslationResponse {
  translation?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  message?: string;
}

export async function translateCapturedPhoto(
  apiBaseUrl: string,
  uri: string,
  width: number,
  languagePair: LanguagePair,
  profile: TranslationProfile,
): Promise<ImageTranslationResult> {
  const context = ImageManipulator.manipulate(uri);
  if (width > MAX_IMAGE_WIDTH) {
    context.resize({ width: MAX_IMAGE_WIDTH });
  }
  const rendered = await context.renderAsync();
  const compressed = await rendered.saveAsync({
    base64: true,
    compress: 0.78,
    format: SaveFormat.JPEG,
  });
  if (!compressed.base64) {
    throw new Error("Không thể đọc ảnh từ camera");
  }

  const response = await fetch(buildImageTranslationUrl(apiBaseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      imageDataUrl: `data:image/jpeg;base64,${compressed.base64}`,
      languagePair,
      translationModel: profile.textModel,
      translationPrompt: profile.prompt,
    }),
  });
  const result = (await response.json()) as ImageTranslationResponse;
  if (
    !response.ok ||
    !result.translation ||
    (result.sourceLanguage !== "vi" &&
      result.sourceLanguage !== "zh" &&
      result.sourceLanguage !== "en" &&
      result.sourceLanguage !== "other") ||
    (result.targetLanguage !== "vi" &&
      result.targetLanguage !== "zh" &&
      result.targetLanguage !== "en")
  ) {
    throw new Error(result.message || "Không thể dịch ảnh lúc này");
  }
  return {
    sourceLanguage: result.sourceLanguage,
    targetLanguage: result.targetLanguage,
    translation: result.translation.trim(),
  };
}
