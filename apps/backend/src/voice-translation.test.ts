import { afterEach, describe, expect, it, vi } from "vitest";

import { type BackendConfig } from "./config.js";
import { languagesForDirection } from "./models.js";
import {
  createVoiceTranslationPayload,
  parseVoiceTranslation,
  speechTextForTranslation,
  translateVoiceText,
  translationMatchesTargetLanguage,
} from "./voice-translation.js";

afterEach(() => vi.restoreAllMocks());

describe("locked one-way voice translation", () => {
  it("derives source and target only from the selected direction", () => {
    expect(languagesForDirection("vi-to-zh")).toEqual({
      source: "vi",
      target: "zh",
    });
    expect(languagesForDirection("zh-to-vi")).toEqual({
      source: "zh",
      target: "vi",
    });
  });

  it("isolates fixed routing instructions from the source transcript", () => {
    const payload = createVoiceTranslationPayload(
      "Xin chào",
      "vi",
      "zh",
      "qwen3.6-flash",
    ) as {
      messages: Array<{ role: string; content: string }>;
      response_format: unknown;
    };

    expect(payload.messages[0]?.content).toContain(
      "source language is fixed as Vietnamese",
    );
    expect(payload.messages[0]?.content).toContain(
      "target language is fixed as Simplified Chinese",
    );
    expect(payload.messages[0]?.content).toContain("at most one fitting emoji");
    expect(payload.messages[1]).toEqual({
      role: "user",
      content: "Xin chào",
    });
    expect(payload.response_format).toEqual({ type: "json_object" });
  });

  it("shows emotion emoji but keeps it out of speech synthesis", () => {
    expect(speechTextForTranslation("Haha 😄! Tôi hiểu rồi.")).toBe(
      "Haha! Tôi hiểu rồi.",
    );
  });

  it("parses only structured translations and checks the target script", () => {
    expect(parseVoiceTranslation('{"translation":"你好"}')).toBe("你好");
    expect(parseVoiceTranslation("你好")).toBeUndefined();
    expect(translationMatchesTargetLanguage("你好", "zh", "Xin chào")).toBe(
      true,
    );
    expect(
      translationMatchesTargetLanguage("Xin chào 你好", "zh", "Xin chào"),
    ).toBe(false);
    expect(translationMatchesTargetLanguage("Xin chào", "vi", "你好")).toBe(
      true,
    );
    expect(translationMatchesTargetLanguage("你好", "vi", "你好")).toBe(
      false,
    );
    expect(translationMatchesTargetLanguage("????????", "vi", "你好")).toBe(
      false,
    );
    expect(translationMatchesTargetLanguage("Hello", "en", "Xin chào")).toBe(
      true,
    );
    expect(
      translationMatchesTargetLanguage("Xin chào", "en", "Xin chào"),
    ).toBe(false);
  });

  it("retries and refuses the first result when it is in the wrong language", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              { message: { content: '{"translation":"Xin chào"}' } },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              { message: { content: '{"translation":"你好"}' } },
            ],
          }),
          { status: 200 },
        ),
      );

    await expect(
      translateVoiceText(makeConfig(), "Xin chào", "vi", "zh"),
    ).resolves.toBe("你好");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryPayload = JSON.parse(
      String(fetchMock.mock.calls[1]?.[1]?.body),
    ) as { messages: Array<{ content: string }> };
    expect(retryPayload.messages[0]?.content).toContain(
      "previous result failed",
    );
  });
});

function makeConfig(): BackendConfig {
  return {
    dashscopeApiKey: "test-key-not-used",
    qwenBaseUrl:
      "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
    qwenImageOcrModel: "qwen3.6-flash",
    qwenImageTranslationModel: "qwen3.6-flash",
    qwenAgentModel: "qwen3.6-flash",
    qwenAsrModel: "qwen-audio-3.0-realtime-plus",
    qwenVoiceTranslationModel: "qwen3.6-flash",
    qwenTtsModel: "qwen-audio-3.0-tts-plus",
    qwenAudioVoice: "longanlingxin",
    qwenLiveBaseUrl:
      "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    qwenLiveApiKey: "test-live-key-not-used",
    qwenLiveVoice: "Tina",
    exaApiKey: "",
    host: "127.0.0.1",
    port: 8787,
  };
}
