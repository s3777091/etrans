import { describe, expect, it } from "vitest";

import {
  clientEventForServerMessage,
  createTranslationSessionUpdate,
  createTurnLanguageGate,
  releasePendingAudio,
} from "./live-translation.js";

describe("live translation session", () => {
  it("asks for audio at the rate the phone plays it back", () => {
    const update = createTranslationSessionUpdate("vi-to-zh", "Tina");
    const session = update.session as Record<string, unknown>;
    // The player is fixed at 24 kHz; the model defaults to 16 kHz.
    expect(session.sample_rate).toBe(24_000);
    expect(session.output_audio_format).toBe("pcm");
  });
});

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
    ).toEqual([
      {
        type: "conversation.item.input_audio_transcription.completed",
        transcript: "Phòng của tôi là số 1508.",
      },
    ]);

    expect(
      clientEventForServerMessage(
        { type: "response.audio_transcript.done", transcript: "我的房间是1508号。" },
        "vi-to-zh",
        gate,
      ),
    ).toEqual([
      { type: "response.audio_transcript.done", transcript: "我的房间是1508号。" },
    ]);

    expect(
      clientEventForServerMessage(
        { type: "response.audio.delta", delta: "AAAA" },
        "vi-to-zh",
        gate,
      ),
    ).toEqual([{ type: "response.audio.delta", delta: "AAAA" }]);
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
    ).toEqual([]);
    expect(gate.rejected).toBe(true);

    expect(
      clientEventForServerMessage(
        { type: "response.audio_transcript.done", transcript: "计划" },
        "vi-to-zh",
        gate,
      ),
    ).toEqual([]);
    expect(
      clientEventForServerMessage(
        { type: "response.audio.delta", delta: "AAAA" },
        "vi-to-zh",
        gate,
      ),
    ).toEqual([]);
  });

  it("holds audio that outruns the transcript, then releases it", () => {
    const gate = createTurnLanguageGate();

    // The spoken answer can arrive first; it must not play unjudged.
    expect(
      clientEventForServerMessage(
        { type: "response.audio.delta", delta: "AAAA" },
        "vi-to-zh",
        gate,
      ),
    ).toEqual([]);

    expect(
      clientEventForServerMessage(
        {
          type: "conversation.item.input_audio_transcription.completed",
          transcript: "Phòng của tôi là số 1508.",
        },
        "vi-to-zh",
        gate,
      ),
    ).toEqual([
      {
        type: "conversation.item.input_audio_transcription.completed",
        transcript: "Phòng của tôi là số 1508.",
      },
      { type: "response.audio.delta", delta: "AAAA" },
    ]);
  });

  it("never speaks audio held for a turn the gate refused", () => {
    const gate = createTurnLanguageGate();
    clientEventForServerMessage(
      { type: "response.audio.delta", delta: "AAAA" },
      "vi-to-zh",
      gate,
    );
    clientEventForServerMessage(
      {
        type: "conversation.item.input_audio_transcription.completed",
        transcript: "跟。",
      },
      "vi-to-zh",
      gate,
    );
    expect(releasePendingAudio(gate)).toEqual([]);
  });

  it("speaks a turn whose transcript never arrived", () => {
    const gate = createTurnLanguageGate();
    clientEventForServerMessage(
      { type: "response.audio.delta", delta: "AAAA" },
      "vi-to-zh",
      gate,
    );
    expect(releasePendingAudio(gate)).toEqual([
      { type: "response.audio.delta", delta: "AAAA" },
    ]);
    expect(releasePendingAudio(gate)).toEqual([]);
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
    ).toEqual([]);
    expect(gate.rejected).toBe(true);
  });
});
