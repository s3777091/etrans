import { describe, expect, it } from "vitest";

import { appendTranscript } from "./transcript";

describe("appendTranscript", () => {
  it("appends Chinese chunks without inserting spaces", () => {
    expect(appendTranscript("你好", "，我们开会", "zh")).toBe(
      "你好，我们开会",
    );
  });

  it("inserts a word boundary for Vietnamese chunks", () => {
    expect(appendTranscript("Xin chào", "chúng ta họp", "vi")).toBe(
      "Xin chào chúng ta họp",
    );
  });

  it("accepts a cumulative transcript without duplication", () => {
    expect(appendTranscript("Xin chào", "Xin chào mọi người", "vi")).toBe(
      "Xin chào mọi người",
    );
  });

  it("inserts word boundaries for English chunks", () => {
    expect(appendTranscript("Good", "morning", "en")).toBe("Good morning");
  });
});
