import { describe, expect, it } from "vitest";

import { DEFAULT_AGENT_SETTINGS } from "../settings/agent-settings";
import { encodeWavPcm16, pcmDurationMs } from "../audio/wav";
import {
  buildAgentSocketUrl,
  buildTurnPayload,
  parseAgentEvent,
  toWireMessages,
  type AgentChatMessage,
} from "./agent-client";
import { buildTranscribeUrl, wavDataUrl } from "./agent-speech";

describe("agent chat client", () => {
  it("upgrades the API base URL to a WebSocket URL", () => {
    expect(buildAgentSocketUrl("http://192.168.1.4:8787")).toBe(
      "ws://192.168.1.4:8787/v1/agent/chat",
    );
    expect(buildAgentSocketUrl("https://api.example.com/")).toBe(
      "wss://api.example.com/v1/agent/chat",
    );
    expect(buildTranscribeUrl("http://localhost:8787")).toBe(
      "http://localhost:8787/v1/agent/transcribe",
    );
  });

  it("keeps the canned greeting out of the payload", () => {
    // The greeting is app text, so paying for it on every turn is waste.
    expect(
      toWireMessages([
        message({
          id: "greeting",
          role: "assistant",
          text: "Xin chào, tôi giúp được gì cho bạn?",
          local: true,
        }),
        message({ id: "1", text: "Mấy giờ rồi?" }),
      ]),
    ).toEqual([{ role: "user", content: "Mấy giờ rồi?" }]);
  });

  it("starts a clean context after the Settings language changes", () => {
    expect(
      toWireMessages([
        message({ id: "old-user", text: "old language question" }),
        message({
          id: "old-answer",
          role: "assistant",
          text: "old language answer",
        }),
        message({
          id: "agent-greeting-zh-1",
          role: "assistant",
          text: "new language greeting",
          local: true,
        }),
        message({ id: "new-user", text: "new language question" }),
      ]),
    ).toEqual([{ role: "user", content: "new language question" }]);
  });

  it("sends only the newest photos and skips failed turns", () => {
    const messages: AgentChatMessage[] = [
      message({ id: "1", text: "Ảnh đầu", imageDataUrl: dataUrl("a") }),
      message({ id: "2", role: "assistant", text: "Đây là biển báo" }),
      message({ id: "3", text: "", status: "error" }),
      message({ id: "4", text: "Còn ảnh này?", imageDataUrl: dataUrl("b") }),
    ];

    expect(toWireMessages(messages)).toEqual([
      { role: "user", content: "[ảnh đã gửi] Ảnh đầu" },
      { role: "assistant", content: "Đây là biển báo" },
      {
        role: "user",
        content: [
          { type: "text", text: "Còn ảnh này?" },
          { type: "image_url", image_url: { url: dataUrl("b") } },
        ],
      },
    ]);
  });

  it("packs the turn with the saved agent settings", () => {
    const payload = buildTurnPayload(
      [message({ id: "1", text: "Chào" })],
      {
        ...DEFAULT_AGENT_SETTINGS,
        language: "en",
        reasoning: true,
        prompt: "  Be brief  ",
      },
      "agent-42",
    );

    expect(payload).toMatchObject({
      type: "agent.turn",
      turnId: "agent-42",
      language: "en",
      reasoning: true,
      search: true,
      prompt: "Be brief",
      messages: [{ role: "user", content: "Chào" }],
    });
  });

  it("accepts known server events only", () => {
    expect(parseAgentEvent('{"type":"agent.delta","text":"Xin"}')).toEqual({
      type: "agent.delta",
      text: "Xin",
    });
    expect(parseAgentEvent('{"type":"something.else"}')).toBeUndefined();
    expect(parseAgentEvent("boom")).toBeUndefined();
    expect(parseAgentEvent(42)).toBeUndefined();
  });
});

describe("recorded audio", () => {
  it("wraps PCM in a WAV container the server accepts", () => {
    const pcm = new Int16Array(16_000);
    const wav = encodeWavPcm16([pcm.buffer], 16_000);
    const view = new DataView(wav);

    expect(wav.byteLength).toBe(44 + 32_000);
    expect(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))).toBe("RIFF");
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(40, true)).toBe(32_000);
    expect(pcmDurationMs(32_000, 16_000)).toBe(1_000);
    expect(wavDataUrl(wav).startsWith("data:audio/wav;base64,")).toBe(true);
  });
});

function message(
  overrides: Partial<AgentChatMessage> & { id: string },
): AgentChatMessage {
  return {
    role: "user",
    text: "",
    createdAt: 0,
    ...overrides,
  };
}

function dataUrl(seed: string): string {
  return `data:image/jpeg;base64,${seed.repeat(64)}`;
}
