import { afterEach, describe, expect, it, vi } from "vitest";

import { QWEN_AGENT_MODEL, QWEN_LIVE_MODEL } from "./models.js";
import {
  buildQwenChatCompletionsUrl,
  buildQwenRealtimeUrl,
  createImageOcrPayload,
  createImageTranslationPayload,
  createMachineTranslationPayload,
  createServer,
  parseImageOcrResult,
  targetLanguageForImageSource,
} from "./server.js";

const servers: Array<Awaited<ReturnType<typeof createServer>>> = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("Qwen realtime proxy", () => {
  it("reports health without contacting Qwen", async () => {
    const server = await makeServer();
    const response = await server.inject({ method: "GET", url: "/healthz" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      provider: "qwen",
      model: "qwen-audio-3.0-realtime-plus",
      protocol: "realtime-one-session",
    });
  });

  it("converts the supplied OpenAI-compatible URL to Qwen realtime", () => {
    expect(
      buildQwenRealtimeUrl(
        "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        QWEN_LIVE_MODEL,
      ),
    ).toBe(
      `wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime?model=${QWEN_LIVE_MODEL}`,
    );
  });

  it("builds dedicated OCR and machine translation requests", () => {
    expect(
      buildQwenChatCompletionsUrl(
        "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
      ),
    ).toBe(
      "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions",
    );
    expect(
      createImageOcrPayload("data:image/jpeg;base64,abc", "qwen-vl-ocr"),
    ).toMatchObject({
      model: "qwen-vl-ocr",
      temperature: 0,
      stream: false,
    });
    expect(
      createMachineTranslationPayload(
        "Xin chào",
        "zh",
        "qwen-mt-flash",
      ),
    ).toEqual({
      model: "qwen-mt-flash",
      messages: [{ role: "user", content: "Xin chào" }],
      translation_options: {
        source_lang: "auto",
        target_lang: "Chinese",
      },
      stream: false,
    });
    expect(
      createMachineTranslationPayload(
        "Xin chào",
        "en",
        "qwen-mt-plus",
        "Keep product names",
      ),
    ).toMatchObject({
      model: "qwen-mt-plus",
      translation_options: {
        target_lang: "English",
        domains: "Keep product names",
      },
    });
    expect(
      createImageOcrPayload(
        "data:image/jpeg;base64,abc",
        "qwen3.6-flash",
      ),
    ).toMatchObject({
      model: "qwen3.6-flash",
      enable_thinking: false,
      response_format: { type: "json_object" },
    });
    expect(
      createMachineTranslationPayload(
        "Xin chào",
        "zh",
        "qwen3.6-flash",
      ),
    ).toMatchObject({
      model: "qwen3.6-flash",
      enable_thinking: false,
      stream: false,
    });
  });

  it("detects the source language and routes the translated panel", () => {
    expect(
      parseImageOcrResult(
        '```json\n{"sourceLanguage":"vi","text":"Xin chào"}\n```',
      ),
    ).toEqual({ sourceLanguage: "vi", text: "Xin chào" });
    expect(
      parseImageOcrResult('{"sourceLanguage":"zh","text":"你好"}'),
    ).toEqual({ sourceLanguage: "zh", text: "你好" });
    expect(
      parseImageOcrResult('{"sourceLanguage":"en","text":"Hello"}'),
    ).toEqual({ sourceLanguage: "en", text: "Hello" });
    expect(targetLanguageForImageSource("vi")).toBe("zh");
    expect(targetLanguageForImageSource("zh")).toBe("vi");
    expect(targetLanguageForImageSource("other")).toBe("vi");
    expect(targetLanguageForImageSource("vi", "vi-en")).toBe("en");
    expect(targetLanguageForImageSource("en", "vi-en")).toBe("vi");
    expect(
      parseImageOcrResult('{"sourceLanguage":"vi","text":""}'),
    ).toBeUndefined();
  });

  it("returns Vietnamese image translations for the Chinese panel", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    '{"sourceLanguage":"vi","text":"Xin chào"}',
                },
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "你好" } }],
          }),
          { status: 200 },
        ),
      );
    const server = await makeServer();

    const response = await server.inject({
      method: "POST",
      url: "/v1/qwen/image-translate",
      payload: {
        imageDataUrl: `data:image/jpeg;base64,${"a".repeat(32)}`,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      sourceLanguage: "vi",
      targetLanguage: "zh",
      sourceText: "Xin chào",
      translation: "你好",
    });
    const translationRequest = JSON.parse(
      String(fetchMock.mock.calls[1]?.[1]?.body),
    ) as { translation_options: { target_lang: string } };
    expect(translationRequest.translation_options.target_lang).toBe(
      "Chinese",
    );
  });
});

describe("single-pass image translation", () => {
  it("reads and translates a photo in one call when both steps share a model", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '{"sourceLanguage":"zh","text":"你好","translation":"Xin chào"}',
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const server = await makeServer({ qwenImageOcrModel: "qwen3.6-flash" });

    const response = await server.inject({
      method: "POST",
      url: "/v1/qwen/image-translate",
      payload: {
        imageDataUrl: `data:image/jpeg;base64,${"a".repeat(32)}`,
        translationModel: "qwen3.6-flash",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      sourceLanguage: "zh",
      targetLanguage: "vi",
      sourceText: "你好",
      translation: "Xin chào",
    });
    // The saving is the whole point: no second trip to the model host.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("still translates separately when one pass returns only the text", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              { message: { content: '{"sourceLanguage":"zh","text":"你好"}' } },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ choices: [{ message: { content: "Xin chào" } }] }),
          { status: 200 },
        ),
      );
    const server = await makeServer({ qwenImageOcrModel: "qwen3.6-flash" });

    const response = await server.inject({
      method: "POST",
      url: "/v1/qwen/image-translate",
      payload: {
        imageDataUrl: `data:image/jpeg;base64,${"a".repeat(32)}`,
        translationModel: "qwen3.6-flash",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ translation: "Xin chào" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("single-pass image payload", () => {
  it("asks for the text and its translation together", () => {
    const payload = createImageTranslationPayload(
      "data:image/jpeg;base64,abc",
      "qwen3.6-flash",
      "vi-en",
      "Keep product names",
    ) as {
      messages: Array<{ content: Array<{ type: string; text?: string }> }>;
      enable_thinking: boolean;
    };
    const instructions = payload.messages[0]?.content[1]?.text ?? "";

    expect(instructions).toContain('"translation"');
    expect(instructions).toContain("into English");
    expect(instructions).toContain("Keep product names");
    expect(payload.enable_thinking).toBe(false);
  });
});

async function makeServer(overrides: { qwenImageOcrModel?: string } = {}) {
  const server = await createServer({
    dashscopeApiKey: "test-key-not-used",
    qwenBaseUrl:
      "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    qwenImageOcrModel: "qwen-vl-ocr",
    qwenImageTranslationModel: "qwen-mt-flash",
    qwenAgentModel: QWEN_AGENT_MODEL,
    qwenAsrModel: "qwen-audio-3.0-realtime-plus",
    qwenVoiceTranslationModel: "qwen3.6-flash",
    qwenTtsModel: "qwen-audio-3.0-tts-plus",
    qwenAudioVoice: "longanlingxin",
    exaApiKey: "",
    host: "127.0.0.1",
    port: 8787,
    ...overrides,
  });
  servers.push(server);
  return server;
}
