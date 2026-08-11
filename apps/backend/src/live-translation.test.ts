import { describe, expect, it } from "vitest";

import {
  clientEventsForAudioTranslation,
  createAudioTranslationSessionUpdate,
  serverEventsForAudioTranslation,
} from "./live-translation.js";

describe("Qwen-Audio live translation compatibility", () => {
  it("configures push-to-talk as a strict Vietnamese to Chinese translator", () => {
    expect(
      createAudioTranslationSessionUpdate(
        "vi-to-zh",
        "longanlingxin",
        "event_setup",
      ),
    ).toMatchObject({
      event_id: "event_setup",
      type: "session.update",
      session: {
        modalities: ["audio", "text"],
        voice: "longanlingxin",
        input_audio_format: "pcm",
        output_audio_format: "pcm",
        turn_detection: null,
        max_history_turns: 1,
      },
    });
    const event = createAudioTranslationSessionUpdate(
      "vi-to-zh",
      "longanlingxin",
    ) as { session: { instructions: string } };
    expect(event.session.instructions).toContain(
      "The user speaks Vietnamese",
    );
    expect(event.session.instructions).toContain("Simplified Chinese");
    expect(event.session.instructions).toContain("not an assistant");
  });

  it("turns the legacy finish event into commit and response.create", () => {
    expect(
      clientEventsForAudioTranslation(
        { type: "session.finish" },
        "zh-to-vi",
        "longanlingxin",
      ),
    ).toEqual([
      { type: "input_audio_buffer.commit" },
      {
        type: "response.create",
        response: { modalities: ["audio", "text"] },
      },
    ]);
  });

  it("maps input and output transcript deltas to the mobile protocol", () => {
    expect(
      serverEventsForAudioTranslation({
        type: "conversation.item.input_audio_transcription.delta",
        text: "Xin ",
        stash: "chao",
      }),
    ).toEqual([
      {
        type: "conversation.item.input_audio_transcription.text",
        text: "Xin ",
        stash: "chao",
      },
    ]);
    expect(
      serverEventsForAudioTranslation({
        type: "response.audio_transcript.delta",
        delta: "你好",
      }),
    ).toEqual([
      {
        type: "response.audio_transcript.text",
        delta: "你好",
        text: "你好",
      },
    ]);
  });

  it("finishes the legacy mobile turn only after Qwen completes", () => {
    expect(
      serverEventsForAudioTranslation({
        type: "response.done",
        response: { status: "completed" },
      }),
    ).toEqual([{ type: "session.finished" }]);
    expect(
      serverEventsForAudioTranslation({
        type: "response.done",
        response: {
          status: "failed",
          status_details: { reason: "tts_failed" },
        },
      }),
    ).toMatchObject([
      {
        type: "proxy.error",
        error: { code: "SERVICE_UNAVAILABLE" },
      },
    ]);
  });
});
