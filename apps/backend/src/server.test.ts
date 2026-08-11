import { afterEach, describe, expect, it, vi } from "vitest";

import { QWEN_LIVE_MODEL } from "./models.js";
import {
  buildQwenChatCompletionsUrl,
  buildQwenRealtimeUrl,
  createImageOcrPayload,
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
      model: QWEN_LIVE_MODEL,
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

async function makeServer() {
  const server = await createServer({
    dashscopeApiKey: "test-key-not-used",
    qwenBaseUrl:
      "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    qwenLiveModel: QWEN_LIVE_MODEL,
    qwenImageOcrModel: "qwen-vl-ocr",
    qwenImageTranslationModel: "qwen-mt-flash",
    host: "127.0.0.1",
    port: 8787,
  });
  servers.push(server);
  return server;
}
