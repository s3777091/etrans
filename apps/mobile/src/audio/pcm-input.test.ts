import { describe, expect, it } from "vitest";

import { Pcm16InputProcessor } from "./pcm-input";

describe("Pcm16InputProcessor", () => {
  it("emits Qwen-aligned 100 ms chunks and preserves the final tail", () => {
    const processor = new Pcm16InputProcessor();
    const input = new Int16Array(2_400);

    const chunks = processor.push(input.buffer, 16_000);
    const tail = processor.flush();

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.byteLength).toBe(1_600 * 2);
    expect(tail?.byteLength).toBe(800 * 2);
  });

  it("resamples hardware-rate PCM to 16 kHz", () => {
    const processor = new Pcm16InputProcessor();
    const input = new Int16Array(4_800);

    const chunks = processor.push(input.buffer, 48_000);
    const tail = processor.flush();

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.byteLength).toBe(1_600 * 2);
    expect(tail).toBeUndefined();
  });
});
