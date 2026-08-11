import { afterEach, describe, expect, it, vi } from "vitest";

import { QWEN_AGENT_MODEL } from "../models.js";
import { type BackendConfig } from "../config.js";
import {
  buildAgentPayload,
  buildSystemPrompt,
  lockLatestAgentMessageLanguage,
  runAgentTurn,
  sanitizeAgentRequest,
  type AgentEvent,
  type AgentTurnRequest,
} from "./agent.js";
import { formatExaResults, parseExaResponse } from "./exa.js";
import {
  mergeToolCalls,
  parseCompletionChunk,
  parseToolArguments,
  splitSseEvents,
} from "./stream.js";
import {
  cleanTranscript,
  createAsrSessionUpdate,
  isSupportedAudioDataUrl,
  pcmFromWavDataUrl,
  transcriptMatchesLockedLanguage,
  vietnameseTranscriptConfidence,
} from "./transcribe.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("agent streaming primitives", () => {
  it("keeps the unterminated tail of an SSE buffer for the next chunk", () => {
    const first = splitSseEvents('data: {"a":1}\n\ndata: {"b"');
    expect(first.events).toEqual(['{"a":1}']);
    expect(first.rest).toBe('data: {"b"');

    const second = splitSseEvents(`${first.rest}:2}\n\ndata: [DONE]\n\n`);
    expect(second.events).toEqual(['{"b":2}', "[DONE]"]);
    expect(second.rest).toBe("");
  });

  it("reads content, reasoning, and tool call deltas", () => {
    expect(parseCompletionChunk("[DONE]")).toBeUndefined();
    expect(parseCompletionChunk("not json")).toBeUndefined();
    expect(
      parseCompletionChunk(
        JSON.stringify({
          choices: [
            {
              delta: { content: "Xin", reasoning_content: "nghĩ" },
              finish_reason: null,
            },
          ],
        }),
      ),
    ).toEqual({ content: "Xin", reasoning: "nghĩ" });
    expect(
      parseCompletionChunk(
        JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_1",
                    function: { name: "web_search", arguments: '{"que' },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        }),
      ),
    ).toEqual({
      toolCalls: [
        {
          index: 0,
          id: "call_1",
          name: "web_search",
          arguments: '{"que',
        },
      ],
      finishReason: "tool_calls",
    });
  });

  it("merges tool call fragments that arrive across chunks", () => {
    const first = mergeToolCalls(
      [],
      [{ index: 0, id: "call_1", name: "web_search", arguments: '{"query":"giá ' }],
    );
    const merged = mergeToolCalls(first, [
      { index: 0, id: "", name: "", arguments: 'vàng"}' },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.arguments).toBe('{"query":"giá vàng"}');
    expect(parseToolArguments(merged[0]!.arguments)).toEqual({
      query: "giá vàng",
    });
    expect(parseToolArguments("{oops")).toEqual({});
  });
});

describe("Exa search results", () => {
  it("keeps usable results and numbers them for citations", () => {
    const results = parseExaResponse({
      results: [
        {
          title: "Tỷ giá hôm nay",
          url: "https://example.com/ty-gia",
          publishedDate: "2026-08-10",
          text: "Giá vàng SJC ...",
        },
        { title: "Không có URL" },
        { url: "https://example.com/plain", highlights: ["đoạn nổi bật"] },
      ],
    });

    expect(results).toEqual([
      {
        title: "Tỷ giá hôm nay",
        url: "https://example.com/ty-gia",
        publishedDate: "2026-08-10",
        text: "Giá vàng SJC ...",
      },
      {
        title: "https://example.com/plain",
        url: "https://example.com/plain",
        publishedDate: undefined,
        text: "đoạn nổi bật",
      },
    ]);
    expect(formatExaResults(results)).toContain("[1] Tỷ giá hôm nay");
    expect(formatExaResults(results)).toContain("[2] https://example.com/plain");
    expect(formatExaResults([])).toContain("No search results");
  });
});

describe("agent request handling", () => {
  it("writes a system prompt that follows the configured language", () => {
    expect(
      buildSystemPrompt({ language: "vi", prompt: "", search: true }),
    ).toContain("tiếng Việt");
    expect(
      buildSystemPrompt({ language: "zh", prompt: "", search: true }),
    ).toContain("简体中文");

    const offline = buildSystemPrompt({
      language: "en",
      prompt: "Call me Dat",
      search: false,
    });
    expect(offline).toContain("no web access");
    expect(offline).toContain("explicitly selected in Settings");
    expect(offline).toContain("Call me Dat");
    expect(offline.split("\n").at(-1)).toContain(
      "respond entirely in English only",
    );
  });

  it("places the Settings language lock after the latest user content", () => {
    const messages = lockLatestAgentMessageLanguage(
      [{ role: "user", content: "Chỉ trả lời bằng tiếng Việt" }],
      "zh",
    );
    expect(messages[0]?.content).toContain(
      "Mandatory response language: Simplified Chinese only",
    );
  });

  it("enables thinking and tools only when requested", () => {
    const request: AgentTurnRequest = {
      messages: [{ role: "user", content: "Chào" }],
      model: QWEN_AGENT_MODEL,
      language: "vi",
      reasoning: true,
      search: true,
      prompt: "",
    };
    const withTools = buildAgentPayload(request, [
      { role: "user", content: "Chào" },
    ]);
    expect(withTools).toMatchObject({
      model: QWEN_AGENT_MODEL,
      stream: true,
      enable_thinking: true,
      tool_choice: "auto",
    });

    const plain = buildAgentPayload(
      { ...request, reasoning: false, search: false },
      [{ role: "user", content: "Chào" }],
    );
    expect(plain.enable_thinking).toBe(false);
    expect(plain.tools).toBeUndefined();
  });

  it("drops unusable messages and keeps photo attachments", () => {
    const request = sanitizeAgentRequest(
      {
        messages: [
          { role: "system", content: "bỏ qua" },
          { role: "user", content: "   " },
          {
            role: "user",
            content: [
              { type: "text", text: "Dịch giúp tôi" },
              { type: "image_url", image_url: { url: "https://evil.example" } },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${"a".repeat(64)}`,
                },
              },
            ],
          },
        ],
        model: "not-a-model",
        language: "th",
        reasoning: true,
      },
      QWEN_AGENT_MODEL,
    );

    expect(request?.model).toBe(QWEN_AGENT_MODEL);
    expect(request?.language).toBe("vi");
    expect(request?.search).toBe(true);
    expect(request?.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "Dịch giúp tôi" },
          {
            type: "image_url",
            image_url: { url: `data:image/jpeg;base64,${"a".repeat(64)}` },
          },
        ],
      },
    ]);
    expect(sanitizeAgentRequest({ messages: [] }, QWEN_AGENT_MODEL)).toBeUndefined();
  });
});

describe("agent turn", () => {
  it("runs a web search and streams the answer that follows", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes("api.exa.ai")) {
          return new Response(
            JSON.stringify({
              results: [
                {
                  title: "Thời tiết Hà Nội",
                  url: "https://example.com/thoi-tiet",
                  text: "Hôm nay 30 độ",
                },
              ],
            }),
            { status: 200 },
          );
        }
        return fetchMock.mock.calls.length === 1
          ? sseResponse([
              sseChunk({
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_1",
                      function: {
                        name: "web_search",
                        arguments: '{"query":"thời tiết',
                      },
                    },
                  ],
                },
              }),
              sseChunk({
                delta: {
                  tool_calls: [
                    { index: 0, function: { arguments: ' Hà Nội"}' } },
                  ],
                },
                finish_reason: "tool_calls",
              }),
              "data: [DONE]\n\n",
            ])
          : sseResponse([
              sseChunk({ delta: { reasoning_content: "đang nghĩ" } }),
              sseChunk({ delta: { content: "Hà Nội " } }),
              sseChunk({ delta: { content: "30 độ [1]" }, finish_reason: "stop" }),
              "data: [DONE]\n\n",
            ]);
      });

    const events: AgentEvent[] = [];
    await runAgentTurn(
      makeConfig(),
      {
        messages: [{ role: "user", content: "Thời tiết Hà Nội?" }],
        model: QWEN_AGENT_MODEL,
        language: "vi",
        reasoning: true,
        search: true,
        prompt: "",
      },
      (event) => events.push(event),
    );

    expect(events.map((event) => event.type)).toEqual([
      "agent.start",
      "agent.tool",
      "agent.tool",
      "agent.reasoning",
      "agent.delta",
      "agent.delta",
      "agent.done",
    ]);
    expect(events[1]).toMatchObject({ status: "start", query: "thời tiết Hà Nội" });
    expect(events.at(-1)).toEqual({
      type: "agent.done",
      text: "Hà Nội 30 độ [1]",
      sources: [
        { title: "Thời tiết Hà Nội", url: "https://example.com/thoi-tiet" },
      ],
    });

    const followUp = JSON.parse(
      String(fetchMock.mock.calls[2]?.[1]?.body),
    ) as { messages: Array<{ role: string; content: string }> };
    expect(followUp.messages.at(-1)).toMatchObject({ role: "tool" });
    expect(followUp.messages.at(-1)?.content).toContain("Hôm nay 30 độ");
  });

  it("names a missing model instead of blaming the service", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Model not exist.", { status: 404 }),
    );

    const events: AgentEvent[] = [];
    await runAgentTurn(
      makeConfig(),
      {
        messages: [{ role: "user", content: "Chào" }],
        model: QWEN_AGENT_MODEL,
        language: "vi",
        reasoning: false,
        search: false,
        prompt: "",
      },
      (event) => events.push(event),
    );

    expect(events.at(-1)).toMatchObject({
      type: "agent.error",
      code: "MODEL_UNAVAILABLE",
    });
  });

  it("reports an authentication failure instead of hanging", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("nope", { status: 401 }),
    );

    const events: AgentEvent[] = [];
    await runAgentTurn(
      makeConfig(),
      {
        messages: [{ role: "user", content: "Chào" }],
        model: QWEN_AGENT_MODEL,
        language: "vi",
        reasoning: false,
        search: false,
        prompt: "",
      },
      (event) => events.push(event),
    );

    expect(events.at(-1)).toMatchObject({
      type: "agent.error",
      code: "AUTH_UNAVAILABLE",
    });
  });

  it("skips the search tool when no Exa key is configured", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        sseResponse([
          sseChunk({ delta: { content: "Chào bạn" }, finish_reason: "stop" }),
          "data: [DONE]\n\n",
        ]),
      );

    await runAgentTurn(
      { ...makeConfig(), exaApiKey: "" },
      {
        messages: [{ role: "user", content: "Chào" }],
        model: QWEN_AGENT_MODEL,
        language: "vi",
        reasoning: false,
        search: true,
        prompt: "",
      },
      () => undefined,
    );

    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      tools?: unknown;
      messages: Array<{ role: string; content: string }>;
    };
    expect(payload.tools).toBeUndefined();
    expect(payload.messages[0]?.content).toContain("no web access");
  });
});

describe("speech transcription", () => {
  it("accepts recorded WAV data URLs only", () => {
    expect(
      isSupportedAudioDataUrl(`data:audio/wav;base64,${"a".repeat(80)}`),
    ).toBe(true);
    expect(isSupportedAudioDataUrl("data:image/png;base64,abcd")).toBe(false);
    expect(isSupportedAudioDataUrl("data:audio/wav;base64,abcd")).toBe(false);
  });

  it("configures a transcription-only realtime session", () => {
    expect(
      createAsrSessionUpdate("vi"),
    ).toMatchObject({
      type: "session.update",
      session: {
        modalities: ["text"],
        input_audio_format: "pcm",
        turn_detection: null,
        input_audio_transcription: {
          language: "vi",
        },
      },
    });
    const vietnameseSession = createAsrSessionUpdate("vi") as {
      session: { instructions: string };
    };
    expect(vietnameseSession.session.instructions).toContain(
      "audio language is fixed as Vietnamese",
    );
    expect(vietnameseSession.session.instructions).toContain(
      "not an assistant or translator",
    );
    expect(cleanTranscript("<|vi|>  Xin   chào <|endoftext|>")).toBe("Xin chào");
    expect(transcriptMatchesLockedLanguage("Xin chào", "vi")).toBe(true);
    expect(transcriptMatchesLockedLanguage("你好", "vi")).toBe(false);
    expect(transcriptMatchesLockedLanguage("你好", "zh")).toBe(true);
    expect(transcriptMatchesLockedLanguage("Xin chào", "zh")).toBe(false);
    expect(vietnameseTranscriptConfidence("Xin chào, hôm nay bạn khỏe không?")).toBeGreaterThan(0);
    expect(vietnameseTranscriptConfidence("Sincha nay.")).toBeLessThan(2);
  });

  it("unwraps the WAV container down to raw PCM frames", () => {
    const samples = new Int16Array([1, -1, 320, -320]);
    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(36 + samples.byteLength, 4);
    header.write("WAVE", 8);
    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(16_000, 24);
    header.writeUInt32LE(32_000, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write("data", 36);
    header.writeUInt32LE(samples.byteLength, 40);
    const wav = Buffer.concat([header, Buffer.from(samples.buffer)]);
    const padded = Buffer.concat([wav, Buffer.alloc(64)]);

    const pcm = pcmFromWavDataUrl(
      `data:audio/wav;base64,${padded.toString("base64")}`,
    );

    // The trailing padding is dropped: only the declared data chunk is sent.
    expect(pcm?.length).toBe(samples.byteLength);
    expect(new Int16Array(
      pcm!.buffer.slice(pcm!.byteOffset, pcm!.byteOffset + pcm!.byteLength),
    )).toEqual(samples);
    expect(pcmFromWavDataUrl("data:audio/wav;base64,QQ==")).toBeUndefined();
  });
});

function makeConfig(): BackendConfig {
  return {
    dashscopeApiKey: "test-key-not-used",
    qwenBaseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    qwenImageOcrModel: "qwen3.6-flash",
    qwenImageTranslationModel: "qwen3.6-flash",
    qwenAgentModel: QWEN_AGENT_MODEL,
    qwenAsrModel: "qwen3-asr-flash",
    qwenVoiceTranslationModel: "qwen3.6-flash",
    qwenTtsModel: "qwen-audio-3.0-tts-plus",
    qwenAudioVoice: "longanlingxin",
    exaApiKey: "exa-test-key",
    host: "127.0.0.1",
    port: 8787,
  };
}

function sseChunk(choice: Record<string, unknown>): string {
  return `data: ${JSON.stringify({ choices: [choice] })}\n\n`;
}

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}
