import type { TranslationLanguage } from "../qwen/types";
import type { LanguagePair } from "../settings/translation-settings";

export type TranslationHistoryKind = "voice" | "image";
export type HistorySourceLanguage = TranslationLanguage | "other";

export interface TranslationHistoryEntry {
  id: string;
  createdAt: number;
  pair: LanguagePair;
  kind: TranslationHistoryKind;
  sourceLanguage: HistorySourceLanguage;
  targetLanguage: TranslationLanguage;
  sourceText: string;
  translatedText: string;
}

export interface TranslationHistoryDisplayTexts {
  counterpartText: string;
  vietnameseText: string;
}

export const MAX_TRANSLATION_HISTORY = 50;

export function addTranslationHistoryEntry(
  current: TranslationHistoryEntry[],
  entry: TranslationHistoryEntry,
): TranslationHistoryEntry[] {
  const normalized = sanitizeEntry(entry);
  if (!normalized) return current;
  return [normalized, ...current.filter((item) => item.id !== normalized.id)].slice(
    0,
    MAX_TRANSLATION_HISTORY,
  );
}

export function parseTranslationHistory(
  value: string | null | undefined,
): TranslationHistoryEntry[] {
  if (!value) return [];
  try {
    const candidate = JSON.parse(value) as unknown;
    if (!Array.isArray(candidate)) return [];
    return candidate
      .map((item) => sanitizeEntry(item))
      .filter((item): item is TranslationHistoryEntry => Boolean(item))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_TRANSLATION_HISTORY);
  } catch {
    return [];
  }
}

/** Maps a saved translation back onto the two transcript panels. */
export function translationHistoryDisplayTexts(
  entry: TranslationHistoryEntry,
): TranslationHistoryDisplayTexts {
  const counterpartLanguage = entry.pair === "vi-zh" ? "zh" : "en";
  let counterpartText = "";
  let vietnameseText = "";

  if (entry.sourceLanguage === "vi") {
    vietnameseText = entry.sourceText;
  } else if (
    entry.sourceLanguage === counterpartLanguage ||
    entry.sourceLanguage === "other"
  ) {
    counterpartText = entry.sourceText;
  }

  if (entry.targetLanguage === "vi") {
    vietnameseText = entry.translatedText;
  } else if (entry.targetLanguage === counterpartLanguage) {
    counterpartText = entry.translatedText;
  }

  return { counterpartText, vietnameseText };
}

function sanitizeEntry(value: unknown): TranslationHistoryEntry | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Partial<TranslationHistoryEntry>;
  if (
    typeof item.id !== "string" ||
    !Number.isFinite(item.createdAt) ||
    (item.pair !== "vi-zh" && item.pair !== "vi-en") ||
    (item.kind !== "voice" && item.kind !== "image") ||
    !isSourceLanguage(item.sourceLanguage) ||
    !isTranslationLanguage(item.targetLanguage) ||
    typeof item.sourceText !== "string" ||
    typeof item.translatedText !== "string"
  ) {
    return undefined;
  }

  const sourceText = item.sourceText.trim().slice(0, 4_000);
  const translatedText = item.translatedText.trim().slice(0, 4_000);
  if (!sourceText || !translatedText) return undefined;

  return {
    id: item.id.slice(0, 120),
    createdAt: item.createdAt as number,
    pair: item.pair,
    kind: item.kind,
    sourceLanguage: item.sourceLanguage,
    targetLanguage: item.targetLanguage,
    sourceText,
    translatedText,
  };
}

function isSourceLanguage(value: unknown): value is HistorySourceLanguage {
  return value === "vi" || value === "zh" || value === "en" || value === "other";
}

function isTranslationLanguage(value: unknown): value is TranslationLanguage {
  return value === "vi" || value === "zh" || value === "en";
}
