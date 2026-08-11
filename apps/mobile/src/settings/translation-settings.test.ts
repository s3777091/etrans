import { describe, expect, it } from "vitest";

import {
  DEFAULT_TRANSLATION_SETTINGS,
  directionsForPair,
  languagesForPair,
  parseTranslationSettings,
} from "./translation-settings";

describe("translation settings", () => {
  it("maps both language pairs to the main-screen directions", () => {
    expect(directionsForPair("vi-zh")).toEqual({
      right: "zh-to-vi",
      left: "vi-to-zh",
    });
    expect(directionsForPair("vi-en")).toEqual({
      right: "en-to-vi",
      left: "vi-to-en",
    });
    expect(languagesForPair("vi-en").counterpart.mainLabel).toBe("ENGLISH");
  });

  it("recovers invalid saved values without losing valid profile data", () => {
    const parsed = parseTranslationSettings(
      JSON.stringify({
        activePair: "vi-en",
        profiles: {
          "vi-en": {
            prompt: "Keep product names",
            textModel: "invalid",
            voiceModel: "qwen3-livetranslate-flash-realtime",
          },
        },
        frameColors: { vi: "#aabbcc", en: "wrong" },
      }),
    );

    expect(parsed.activePair).toBe("vi-en");
    expect(parsed.profiles["vi-en"].prompt).toBe("Keep product names");
    expect(parsed.profiles["vi-en"].textModel).toBe("qwen-mt-flash");
    expect(parsed.frameColors.vi).toBe("#AABBCC");
    expect(parsed.frameColors.en).toBe(
      DEFAULT_TRANSLATION_SETTINGS.frameColors.en,
    );
  });
});
