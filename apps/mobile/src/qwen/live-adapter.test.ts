import { describe, expect, it } from "vitest";

import {
  buildQwenProxyWebSocketUrl,
  createSessionUpdate,
  parseHotwords,
} from "./live-adapter";

describe("Qwen live adapter", () => {
  it("builds the backend WebSocket URL", () => {
    expect(
      buildQwenProxyWebSocketUrl("https://example.com/api", "zh-to-vi"),
    ).toBe(
      "wss://example.com/v1/qwen/live?direction=zh-to-vi&model=qwen3.5-livetranslate-flash-realtime",
    );
  });

  it("configures Chinese input and Vietnamese translation", () => {
    expect(createSessionUpdate("zh-to-vi")).toMatchObject({
      type: "session.update",
      session: {
        sample_rate: 16_000,
        input_audio_transcription: { language: "zh" },
        translation: { language: "vi" },
      },
    });
  });

  it("configures Vietnamese input and Chinese translation", () => {
    expect(createSessionUpdate("vi-to-zh")).toMatchObject({
      session: {
        input_audio_transcription: { language: "vi" },
        translation: { language: "zh" },
      },
    });
  });

  it("configures both English directions", () => {
    expect(createSessionUpdate("en-to-vi")).toMatchObject({
      session: {
        input_audio_transcription: { language: "en" },
        translation: { language: "vi" },
      },
    });
    expect(createSessionUpdate("vi-to-en")).toMatchObject({
      session: {
        input_audio_transcription: { language: "vi" },
        translation: { language: "en" },
      },
    });
  });

  it("adds validated terminology hotwords without breaking invalid JSON", () => {
    const hotwords = parseHotwords(
      '{"人工智能":"trí tuệ nhân tạo","":"ignored","bad":4}',
    );
    expect(createSessionUpdate("zh-to-vi", "event_hotwords", hotwords)).toMatchObject({
      session: {
        translation: {
          corpus: { phrases: { 人工智能: "trí tuệ nhân tạo" } },
        },
      },
    });
    expect(parseHotwords("not-json")).toEqual({});
  });
});
