import { describe, expect, it } from "vitest";

import {
  clientEventForServerMessage,
  createTurnLanguageGate,
} from "./live-translation.js";

describe("live translation language gate", () => {
  it("passes a turn the ASR heard in the locked source language", () => {
    const gate = createTurnLanguageGate();

    expect(
      clientEventForServerMessage(
        {
          type: "conversation.item.input_audio_transcription.completed",
          transcript: "Phòng của tôi là số 1508.",
        },
        "vi-to-zh",
        gate,
      ),
    ).toEqual({
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "Phòng của tôi là số 1508.",
    });

    expect(
      clientEventForServerMessage(
        { type: "response.audio_transcript.done", transcript: "我的房间是1508号。" },
        "vi-to-zh",
        gate,
      ),
    ).toEqual({
      type: "response.audio_transcript.done",
      transcript: "我的房间是1508号。",
    });

    expect(
      clientEventForServerMessage(
        { type: "response.audio.delta", delta: "AAAA" },
        "vi-to-zh",
        gate,
      ),
    ).toEqual({ type: "response.audio.delta", delta: "AAAA" });
  });

  it("drops the whole turn when Vietnamese speech comes back as Chinese", () => {
    const gate = createTurnLanguageGate();

    expect(
      clientEventForServerMessage(
        {
          type: "conversation.item.input_audio_transcription.completed",
          transcript: "跟。",
        },
        "vi-to-zh",
        gate,
      ),
    ).toBeUndefined();
    expect(gate.rejected).toBe(true);

    // The translation and its audio were built on the misheard text, so the
    // phone must not receive them either.
    expect(
      clientEventForServerMessage(
        { type: "response.audio_transcript.done", transcript: "计划" },
        "vi-to-zh",
        gate,
      ),
    ).toBeUndefined();
    expect(
      clientEventForServerMessage(
        { type: "response.audio.delta", delta: "AAAA" },
        "vi-to-zh",
        gate,
      ),
    ).toBeUndefined();
  });

  it("drops a translation that came back in the source language", () => {
    const gate = createTurnLanguageGate();
    clientEventForServerMessage(
      {
        type: "conversation.item.input_audio_transcription.completed",
        transcript: "Phòng của tôi là số 1508.",
      },
      "vi-to-zh",
      gate,
    );

    expect(
      clientEventForServerMessage(
        {
          type: "response.audio_transcript.done",
          transcript: "Phòng của tôi là số 1508.",
        },
        "vi-to-zh",
        gate,
      ),
    ).toBeUndefined();
    expect(gate.rejected).toBe(true);
  });
});
