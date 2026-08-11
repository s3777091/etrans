import { describe, expect, it } from "vitest";

import {
  MAX_TRANSLATION_HISTORY,
  addTranslationHistoryEntry,
  parseTranslationHistory,
  translationHistoryDisplayTexts,
  type TranslationHistoryEntry,
} from "./translation-history";

const entry: TranslationHistoryEntry = {
  id: "voice-1",
  createdAt: 1,
  pair: "vi-zh",
  kind: "voice",
  sourceLanguage: "vi",
  targetLanguage: "zh",
  sourceText: "Xin chào",
  translatedText: "你好",
};

describe("translation history", () => {
  it("keeps newest valid entries and rejects incomplete values", () => {
    const parsed = parseTranslationHistory(
      JSON.stringify([{ ...entry, createdAt: 2 }, { id: "bad" }, entry]),
    );
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.createdAt).toBe(2);
  });

  it("deduplicates by id and caps stored history", () => {
    let current: TranslationHistoryEntry[] = [];
    for (let index = 0; index < MAX_TRANSLATION_HISTORY + 5; index += 1) {
      current = addTranslationHistoryEntry(current, {
        ...entry,
        id: `voice-${index}`,
        createdAt: index,
      });
    }
    expect(current).toHaveLength(MAX_TRANSLATION_HISTORY);
    expect(current[0]?.id).toBe(`voice-${MAX_TRANSLATION_HISTORY + 4}`);
  });

  it("restores both transcript panels in either direction", () => {
    expect(translationHistoryDisplayTexts(entry)).toEqual({
      counterpartText: "你好",
      vietnameseText: "Xin chào",
    });
    expect(
      translationHistoryDisplayTexts({
        ...entry,
        sourceLanguage: "zh",
        targetLanguage: "vi",
        sourceText: "谢谢",
        translatedText: "Cảm ơn",
      }),
    ).toEqual({
      counterpartText: "谢谢",
      vietnameseText: "Cảm ơn",
    });
  });

  it("shows an unknown image source in the counterpart panel", () => {
    expect(
      translationHistoryDisplayTexts({
        ...entry,
        kind: "image",
        sourceLanguage: "other",
        targetLanguage: "vi",
        sourceText: "Bonjour",
        translatedText: "Xin chào",
      }),
    ).toEqual({
      counterpartText: "Bonjour",
      vietnameseText: "Xin chào",
    });
  });
});
