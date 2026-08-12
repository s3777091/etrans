import { describe, expect, it } from "vitest";

import {
  StreamingSpeechSegmenter,
  analyzePcm16,
} from "./voice-segmentation.js";

const CHUNK_SAMPLES = 1_600;

describe("streaming speech segmentation", () => {
  it("commits speech after a natural pause while the stream stays open", () => {
    const segmenter = new StreamingSpeechSegmenter();
    const emitted: Buffer[] = [];
    for (let index = 0; index < 16; index += 1) {
      emitted.push(...segmenter.push(tone(2_400)));
    }
    for (let index = 0; index < 8; index += 1) {
      emitted.push(...segmenter.push(silence()));
    }
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.length).toBeGreaterThan(CHUNK_SAMPLES * 2 * 16);
  });

  it("carries a mid-sentence breath into one segment instead of cutting", () => {
    const segmenter = new StreamingSpeechSegmenter();
    const emitted: Buffer[] = [];
    // Half a sentence, a pause long enough to look final, then the rest. The
    // ASR reads a sub-second slice of Vietnamese as Chinese, so neither half
    // may leave on its own.
    for (let index = 0; index < 6; index += 1) {
      emitted.push(...segmenter.push(tone(2_400)));
    }
    for (let index = 0; index < 9; index += 1) {
      emitted.push(...segmenter.push(silence()));
    }
    expect(emitted).toEqual([]);

    for (let index = 0; index < 12; index += 1) {
      emitted.push(...segmenter.push(tone(2_400)));
    }
    for (let index = 0; index < 8; index += 1) {
      emitted.push(...segmenter.push(silence()));
    }
    expect(emitted).toHaveLength(1);
  });

  it("ignores steady noise and short taps", () => {
    const segmenter = new StreamingSpeechSegmenter();
    const emitted: Buffer[] = [];
    for (let index = 0; index < 10; index += 1) {
      emitted.push(...segmenter.push(tone(120)));
    }
    emitted.push(...segmenter.push(tone(4_000)));
    for (let index = 0; index < 7; index += 1) {
      emitted.push(...segmenter.push(silence()));
    }
    expect(emitted).toEqual([]);
    expect(segmenter.flush()).toBeUndefined();
  });

  it("flushes a final spoken phrase when the user releases", () => {
    const segmenter = new StreamingSpeechSegmenter();
    for (let index = 0; index < 4; index += 1) {
      segmenter.push(tone(2_000));
    }
    expect(segmenter.flush()?.length).toBeGreaterThan(0);
    expect(segmenter.flush()).toBeUndefined();
  });

  it("measures PCM energy", () => {
    expect(analyzePcm16(silence())).toEqual({ rms: 0, peak: 0 });
    expect(analyzePcm16(tone(2_000))).toEqual({ rms: 2_000, peak: 2_000 });
  });
});

function silence(): Buffer {
  return Buffer.alloc(CHUNK_SAMPLES * 2);
}

function tone(amplitude: number): Buffer {
  const pcm = Buffer.alloc(CHUNK_SAMPLES * 2);
  for (let index = 0; index < CHUNK_SAMPLES; index += 1) {
    pcm.writeInt16LE(index % 2 ? amplitude : -amplitude, index * 2);
  }
  return pcm;
}
